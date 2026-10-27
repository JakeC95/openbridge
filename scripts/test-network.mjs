import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";

Error.stackTraceLimit = 0; // Bundled in-memory URLs otherwise make failures unreadably large.
const directory = await mkdtemp(join(tmpdir(), "openbridge-network-"));
globalThis.fixtureDirectory = directory;
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
  export { JsonTransport, RequestCache, retryAfter, HttpError } from './src/main/network';
  export { LegacyApi, searchCatalog } from './src/main/legacy-api';
  export { AuthService } from './src/main/auth';
  export { downloadFile } from './src/main/downloader';
  export { DownloadManager } from './src/main/download-manager';
  export { DownloadStats, downloadSource } from './src/main/download-stats';
` }, bundle: true, platform: "node", format: "esm", write: false,
  banner: { js: 'import { createRequire as fixtureRequire } from "node:module"; const require = fixtureRequire(process.cwd() + "/package.json");' },
  define: { __OPENBRIDGE_CONFIG__: JSON.stringify({ algoliaAppId: "fixture", algoliaApiKey: "fixture" }) },
  plugins: [{ name: "electron-fixture", setup(bundler) {
    bundler.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" }));
    bundler.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      export const net = { fetch: (...args) => globalThis.fixtureFetch(...args) };
      export const app = { getPath: () => globalThis.fixtureDirectory };
      export const BrowserWindow = class {};
      export const safeStorage = { isEncryptionAvailable: () => false };
    ` }));
  } }]
});
const { JsonTransport, RequestCache, retryAfter, LegacyApi, searchCatalog, AuthService, downloadFile, DownloadManager,
  DownloadStats, downloadSource } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const logger = { info() {}, warn() {}, error() {} };
let passed = 0;
async function test(name, work) { await work(); passed++; console.log(`PASS ${name}`); }
let server;
const keepAlive = setInterval(() => {}, 1000); // Mock bodies have no socket to keep timeout tests alive.
try {
  await test("download sources expose only host and advertised edge/region, never signed URLs", async () => {
    const source = downloadSource("https://cdn.example.invalid/private/asset.jpg?Signature=fixture-secret", new Headers({ "x-amz-cf-pop": "LHR61-P1" }));
    assert.deepEqual(source, { host: "cdn.example.invalid", provider: "CloudFront", edgeCode: "LHR61-P1", locationKind: "edge", location: "London, UK", country: "United Kingdom", countryCode: "gb" });
    assert.equal(JSON.stringify(source).includes("fixture-secret"), false);
    assert.equal(JSON.stringify(source).includes("private"), false);
    const unknown = downloadSource("https://eu-west-1.example.invalid/file", new Headers());
    assert.equal(unknown.location, undefined);
    const unknownPop = downloadSource("https://cdn.example.invalid/file", new Headers({ "x-amz-cf-pop": "ZZZ12-P1" }));
    assert.equal(unknownPop.location, undefined); assert.equal(unknownPop.edgeCode, "ZZZ12-P1");
    const cloudflare = downloadSource("https://cdn.example.invalid/file", new Headers({ "cf-ray": "fixture-request-id-YYZ" }));
    assert.equal(cloudflare.location, "Toronto, Canada"); assert.equal(cloudflare.edgeCode, "YYZ");
    const region = downloadSource("https://storage.example.invalid/file", new Headers({ "x-amz-bucket-region": "eu-west-1" }));
    assert.equal(region.location, "Ireland"); assert.equal(region.locationKind, "region");
  });
  await test("live stats aggregate files, separate received/written bytes and decay to zero", async () => {
    let now = 0;
    const stats = new DownloadStats(() => now);
    const source = { host: "cdn.example.invalid" };
    stats.record("one", { receivedBytes: 0, writtenBytes: 0, active: true, source });
    stats.record("two", { receivedBytes: 0, writtenBytes: 0, active: true, source });
    now = 1000;
    stats.record("one", { receivedBytes: 1024, writtenBytes: 512, active: true, source });
    stats.record("two", { receivedBytes: 2048, writtenBytes: 1024, active: true, source });
    const snapshot = stats.snapshot();
    assert.equal(snapshot.receiveBytesPerSecond, 3072); assert.equal(snapshot.writeBytesPerSecond, 1536);
    assert.equal(snapshot.activeTransfers, 2); assert.equal(snapshot.sources.length, 1);
    snapshot.sources[0].host = "changed"; assert.equal(stats.snapshot().sources[0].host, source.host);
    assert.equal(stats.snapshot(false).receiveBytesPerSecond, 0);
    now = 4100; assert.equal(stats.snapshot().receiveBytesPerSecond, 0); assert.equal(stats.snapshot().writeBytesPerSecond, 0);
    stats.record("one", { receivedBytes: 0, writtenBytes: 0, active: false, source });
    stats.record("two", { receivedBytes: 0, writtenBytes: 0, active: false, source });
    assert.equal(stats.snapshot().activeTransfers, 0);
  });
  await test("steady long transfers keep reporting their current rate, not a lifetime average", async () => {
    let now = 0;
    const stats = new DownloadStats(() => now);
    const source = { host: "cdn.example.invalid" };
    // One second of samples at a constant 1 MB/s, then check a minute into the transfer.
    for (let second = 0; second < 60; second++) {
      now = second * 1000;
      stats.record("one", { receivedBytes: 1024 * 1024, writtenBytes: 1024 * 1024, active: true, source });
    }
    const late = stats.snapshot();
    assert.equal(Math.round(late.receiveBytesPerSecond), 1024 * 1024);
    assert.equal(Math.round(late.writeBytesPerSecond), 1024 * 1024);
    // A stall longer than the sample window reports zero rather than a stale lifetime average.
    now = 63_000;
    assert.equal(stats.snapshot().receiveBytesPerSecond, 0);
  });
  await test("transient failures retry; permission failures and unsafe writes do not", async () => {
    let calls = 0;
    const transport = new JsonTransport(async () => ++calls < 3 ? json({}, 503) : json({ ok: true }));
    assert.equal((await transport.request("https://retry.invalid/data")).ok, true);
    assert.equal(calls, 3);
    calls = 0;
    const denied = new JsonTransport(async () => { calls++; return json({}, 403); });
    await assert.rejects(() => denied.request("https://denied.invalid/data"), error => error.status === 403);
    assert.equal(calls, 1);
    calls = 0;
    const mutation = new JsonTransport(async () => { calls++; throw new TypeError("Network failed"); });
    await assert.rejects(() => mutation.request("https://mutation.invalid/data", { method: "POST" }));
    assert.equal(calls, 1);
  });
  await test("Retry-After, bounded deadlines, malformed responses and redacted errors", async () => {
    assert.equal(retryAfter("2"), 2000);
    assert.equal(retryAfter(new Date(5000).toUTCString(), 1000), 4000);
    let calls = 0;
    const limited = new JsonTransport(async () => { calls++; return json({}, 429, { "Retry-After": "10" }); });
    await assert.rejects(() => limited.request("https://limited.invalid/?Signature=fixture-secret", {}, { totalTimeoutMs: 100 }), error =>
      error.status === 429 && !error.message.includes("fixture-secret"));
    assert.equal(calls, 1);
    calls = 0;
    const malformed = new JsonTransport(async () => ++calls === 1 ? new Response("<html>gateway</html>") : json({ ok: true }));
    assert.equal((await malformed.request("https://json.invalid/data")).ok, true);
    assert.equal(calls, 2);
    const stalled = new JsonTransport(async (_url, options) => new Response(new ReadableStream({
      start(controller) { options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true }); }
    })));
    await assert.rejects(() => stalled.request("https://body.invalid/data", {}, { timeoutMs: 20, totalTimeoutMs: 40, attempts: 1 }), error => error.name === "TimeoutError");
  });
  await test("per-origin concurrency is bounded and queued cancellation starts no request", async () => {
    let active = 0, maximum = 0, calls = 0;
    const transport = new JsonTransport(async () => {
      active++; calls++; maximum = Math.max(maximum, active); await wait(30); active--; return json({ ok: true });
    });
    const first = Array.from({ length: 6 }, () => transport.request("https://pool.invalid/data"));
    await wait(5);
    const controller = new AbortController();
    const cancelled = transport.request("https://pool.invalid/cancelled", {}, { signal: controller.signal });
    controller.abort(); await assert.rejects(() => cancelled, error => error.name === "AbortError");
    await Promise.all([...first, ...Array.from({ length: 12 }, () => transport.request("https://pool.invalid/data"))]);
    assert.equal(maximum, 6); assert.equal(calls, 18);
  });
  await test("interactive work takes queued priority over background metadata", async () => {
    let open;
    const gate = new Promise(resolve => { open = resolve; });
    const starts = [];
    const transport = new JsonTransport(async url => { starts.push(url); await gate; return json({}); });
    const requests = Array.from({ length: 6 }, (_, index) => transport.request(`https://priority.invalid/active${index}`));
    await wait(0);
    requests.push(transport.request("https://priority.invalid/background", {}, { priority: -1 }));
    requests.push(transport.request("https://priority.invalid/interactive", {}, { priority: 1 }));
    open(); await Promise.all(requests);
    assert.ok(starts.indexOf("https://priority.invalid/interactive") < starts.indexOf("https://priority.invalid/background"));
  });
  await test("identical reads coalesce, clone results and isolate subscriber cancellation", async () => {
    const cache = new RequestCache(2);
    let calls = 0, aborted = false;
    const load = async signal => { calls++; signal.addEventListener("abort", () => { aborted = true; }); await wait(20); return { nested: { value: 1 } }; };
    const controller = new AbortController();
    const first = cache.get("metadata", 1000, load, controller.signal);
    const second = cache.get("metadata", 1000, load);
    controller.abort(); await assert.rejects(() => first);
    const value = await second; value.nested.value = 99;
    assert.equal((await cache.get("metadata", 1000, load)).nested.value, 1);
    assert.equal(calls, 1); assert.equal(aborted, false);
    const many = await Promise.all(Array.from({ length: 25 }, () => cache.get("burst", 1000, load)));
    assert.equal(many.length, 25); assert.equal(calls, 2);
    cache.invalidate();
    await cache.get("metadata", 1000, load); assert.equal(calls, 3);
  });
  await test("last subscriber cancellation aborts the shared request and caches no failure", async () => {
    const cache = new RequestCache();
    let aborted = false;
    const controller = new AbortController();
    const pending = cache.get("cancel", 1000, signal => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); });
    }), controller.signal);
    await wait(0); controller.abort(); await assert.rejects(() => pending); await wait(0);
    assert.equal(aborted, true);
    assert.equal(await cache.get("cancel", 1000, async () => 42), 42);
  });
  await test("metadata/signing caches are account-scoped; mutations invalidate favorites", async () => {
    let generation = 0, calls = 0;
    const listeners = [];
    const auth = { sessionGeneration: () => generation, onChanged: listener => listeners.push(listener),
      getToken: async () => "fixture", refresh: async () => "fixture", headers: () => ({}) };
    globalThis.fixtureFetch = async url => {
      calls++;
      if (url.includes("favorites/")) return new Response("", { status: 200 });
      if (url.endsWith("favorites")) return json(["asset"]);
      if (url.includes("generateSignedUrl")) return json({ url: "https://example.invalid/*", expiresIn: 3600000 });
      return json({ id: "asset", name: "Fixture", acl: { resolution: 4096 } });
    };
    const api = new LegacyApi(auth, logger);
    const values = await Promise.all(Array.from({ length: 25 }, () => api.extended("asset")));
    assert.equal(calls, 1); values[0].acl.resolution = 1;
    assert.equal((await api.extended("asset")).acl.resolution, 4096);
    await Promise.all([api.signedMapsUrl(), api.signedMapsUrl()]); assert.equal(calls, 2);
    await api.favorites(); await api.favorites(); assert.equal(calls, 3);
    await api.addFavorite("asset"); await api.favorites(); assert.equal(calls, 5);
    generation++; listeners.forEach(listener => listener());
    await api.extended("asset"); await api.signedMapsUrl(); assert.equal(calls, 7);
  });
  const jwt = value => `fixture.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + value })).toString("base64url")}.fixture`;
  await test("concurrent token expiry/401s refresh once, with late-401 protection", async () => {
    let calls = 0;
    const next = jwt(3600);
    globalThis.fixtureFetch = async () => { calls++; await wait(20); return json({ token: next, refreshToken: "fixture" }); };
    const auth = new AuthService(logger, () => {});
    auth.record = { token: jwt(-60), refreshToken: "fixture", email: "" };
    const old = auth.record.token;
    const tokens = await Promise.all(Array.from({ length: 25 }, () => auth.getToken()));
    assert.equal(calls, 1); assert.ok(tokens.every(token => token === next));
    assert.equal(await auth.refresh(old), next); assert.equal(calls, 1);
  });
  await test("many independent 401 responses share one refresh and recover safely", async () => {
    const old = jwt(3600), next = jwt(7200);
    let refreshes = 0;
    const auth = new AuthService(logger, () => {});
    auth.record = { token: old, refreshToken: "fixture", email: "" };
    globalThis.fixtureFetch = async (url, options) => {
      if (url.endsWith("/login")) { refreshes++; await wait(10); return json({ token: next, refreshToken: "fixture" }); }
      if (options.headers.Authorization === `Bearer ${old}`) return json({}, 401);
      return json({ id: "asset", name: "Fixture" });
    };
    const api = new LegacyApi(auth, logger);
    const results = await Promise.all(Array.from({ length: 25 }, (_, index) => api.extended(`asset${index}`)));
    assert.equal(refreshes, 1); assert.equal(results.length, 25);
  });
  await test("logout cannot be undone by a late token refresh", async () => {
    let release;
    globalThis.fixtureFetch = async url => url.endsWith("logout") ? json({}) : new Promise(resolve => { release = () => resolve(json({ token: jwt(3600), refreshToken: "fixture" })); });
    const auth = new AuthService(logger, () => {});
    auth.record = { token: jwt(-60), refreshToken: "fixture", email: "" };
    const refresh = auth.refresh(); await wait(0); await auth.logout(); release();
    await assert.rejects(() => refresh, /Session changed/);
    assert.equal(auth.state().loggedIn, false);
  });
  await test("permanent refresh rejection stops repeated sign-in attempts without logging out on outages", async () => {
    let calls = 0;
    globalThis.fixtureFetch = async () => { calls++; return json({}, 401); };
    const auth = new AuthService(logger, () => {});
    auth.record = { token: jwt(-60), refreshToken: "fixture", email: "" };
    await assert.rejects(() => auth.getToken(), /sign in again/);
    assert.equal(auth.state().loggedIn, false);
    await assert.rejects(() => auth.getToken(), /Not signed in/);
    assert.equal(calls, 1);
    globalThis.fixtureFetch = async () => json({}, 503);
    auth.record = { token: jwt(-60), refreshToken: "fixture", email: "" };
    await assert.rejects(() => auth.getToken());
    assert.equal(auth.state().loggedIn, true);
  });
  await test("valid search results survive a failed optional facet refinement", async () => {
    globalThis.fixtureFetch = async (_url, options) => {
      const query = new URLSearchParams(JSON.parse(options.body).params);
      return query.get("hitsPerPage") === "0" ? json({}, 400) : json({ hits: [{ id: "asset" }], nbHits: 1, page: 0, nbPages: 1 });
    };
    const result = await searchCatalog({ query: "unique-fixture", page: 0, facets: ["biome"], facetFilters: { biome: ["forest"] } });
    assert.equal(result.hits.length, 1); assert.equal(result.facetCountsPartial, true);
  });

  // Real HTTP bodies/streams, all on loopback with a disposable destination. No external services.
  globalThis.fixtureFetch = (...args) => fetch(...args);
  const body = Buffer.alloc(64 * 1024, 7);
  const seen = [];
  server = createServer((request, response) => {
    const path = request.url.split("?")[0];
    const offset = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
    seen.push({ path, offset, validator: request.headers["if-range"] });
    if (path === "/denied") { response.writeHead(403); response.end(); return; }
    if (path === "/complete") { response.writeHead(416, { "Content-Range": `bytes */${body.length}` }); response.end(); return; }
    if (path === "/stall") { response.writeHead(200, { "Content-Length": body.length }); response.flushHeaders(); return; }
    if (path === "/gzip") {
      const compressed = gzipSync(body);
      response.writeHead(200, { "Content-Length": compressed.length, "Content-Encoding": "gzip", ETag: '"fixture"' }); response.end(compressed); return;
    }
    if (path === "/invalid" && offset > 0) {
      response.writeHead(206, { "Content-Range": `bytes ${offset + 1}-${body.length - 1}/${body.length}`, "Content-Length": body.length - offset, ETag: '"fixture"' }); response.end(body.subarray(offset)); return;
    }
    const resume = offset > 0 && path !== "/ignore";
    response.writeHead(resume ? 206 : 200, { "Content-Length": body.length - (resume ? offset : 0), ETag: '"fixture"', "X-Amz-Cf-Pop": "LHR61-P1",
      ...(resume ? { "Content-Range": `bytes ${offset}-${body.length - 1}/${body.length}` } : {}) });
    if (path === "/resume" && !offset) {
      response.write(body.subarray(0, 16384));
      const timer = setTimeout(() => response.end(body.subarray(16384)), 150);
      response.on("close", () => clearTimeout(timer));
    } else response.end(resume ? body.subarray(offset) : body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const seed = async (path, size) => {
    const target = join(directory, path.slice(1));
    await writeFile(`${target}.part`, body.subarray(0, size));
    await writeFile(`${target}.part.meta.json`, JSON.stringify({ resource: createHash("sha256").update(`${origin}${path}?`).digest("hex"), etag: '"fixture"' }));
    return target;
  };
  await test("cancelled transfers close cleanly and resume with ETag/If-Range", async () => {
    const controller = new AbortController();
    const target = join(directory, "resume");
    await assert.rejects(() => downloadFile(`${origin}/resume`, target, progress => { if (progress.received >= 16384) controller.abort(); }, 1, controller.signal, body.length));
    const partial = await stat(`${target}.part`);
    assert.ok(partial.size < body.length);
    await downloadFile(`${origin}/resume?Signature=rotated`, target, undefined, 1, undefined, body.length);
    assert.deepEqual(await readFile(target), body);
    const resumed = seen.find(item => item.path === "/resume" && item.offset > 0);
    if (partial.size > 0) { assert.ok(resumed); assert.equal(resumed.validator, '"fixture"'); }
  });
  await test("ignored/invalid byte ranges restart safely instead of corrupting files", async () => {
    for (const path of ["/ignore", "/invalid"]) {
      const target = await seed(path, 16384);
      await downloadFile(origin + path, target, undefined, 1, undefined, body.length);
      assert.deepEqual(await readFile(target), body);
    }
  });
  await test("already-complete partial files finalize correctly on HTTP 416", async () => {
    const target = await seed("/complete", body.length);
    await downloadFile(`${origin}/complete`, target, undefined, 1, undefined, body.length);
    assert.deepEqual(await readFile(target), body);
    await assert.rejects(() => stat(`${target}.part.meta.json`));
  });
  await test("transfer telemetry measures new network and completed writes, not resumed bytes", async () => {
    const target = await seed("/telemetry", 16384);
    const samples = [];
    await downloadFile(`${origin}/telemetry?Signature=fixture-secret`, target, undefined, 1, undefined, body.length, sample => samples.push(sample));
    assert.equal(samples.reduce((sum, sample) => sum + sample.receivedBytes, 0), body.length - 16384);
    assert.equal(samples.reduce((sum, sample) => sum + sample.writtenBytes, 0), body.length - 16384);
    assert.equal(samples[0].active, true); assert.equal(samples.at(-1).active, false);
    assert.equal(samples[0].source.host, new URL(origin).host); assert.equal(samples[0].source.location, "London, UK");
    assert.equal(JSON.stringify(samples).includes("fixture-secret"), false);
  });
  await test("compressed responses validate decoded bytes rather than compressed wire length", async () => {
    const target = join(directory, "gzip");
    await downloadFile(`${origin}/gzip`, target, undefined, 1, undefined, body.length);
    assert.deepEqual(await readFile(target), body);
  });
  await test("transfer permission errors do not retry and stalled bodies have a finite timeout", async () => {
    const before = seen.length;
    await assert.rejects(() => downloadFile(`${origin}/denied?Signature=fixture-secret`, join(directory, "denied")), error => error.status === 403 && !error.message.includes("fixture-secret"));
    assert.equal(seen.length, before + 1);
    await assert.rejects(() => downloadFile(`${origin}/stall`, join(directory, "stall"), undefined, 0.03), error => error.name === "TimeoutError");
  });
  await test("workers share one expired-URL re-sign and finish without reacquisition", async () => {
    let signs = 0;
    const asset = { id: "managed", name: "Fixture", type: "surface", categories: ["surface"], components: [{ type: "albedo" }] };
    const api = { extended: async () => asset, acquired: async () => ["managed"],
      requestDownload: async () => {
        const expired = ++signs === 1; await wait(10);
        return { json: asset, components: ["one", "two"].map(name => ({
          uri: `${origin}/${expired ? "denied" : "valid"}?file=${name}`, saveAs: `${name}.jpg`, contentLength: body.length
        })) };
      }, acquire: async () => { throw new Error("Unexpected acquisition"); } };
    const manager = new DownloadManager({}, api, logger, () => ({}), () => join(directory, "managed-library"), () => {}, () => {});
    const observations = []; manager.onProgress(progress => observations.push(progress));
    try {
      const job = manager.createJob("managed");
      await manager.runJob(job);
      assert.equal(job.status, "complete"); assert.equal(signs, 2);
      assert.deepEqual(await readFile(join(job.path, "one.jpg")), body);
      assert.deepEqual(await readFile(join(job.path, "two.jpg")), body);
      assert.ok(observations.some(item => item.diagnostics?.sources.some(source => source.location === "London, UK")));
      assert.equal(observations.at(-1).diagnostics.receiveBytesPerSecond, 0);
    } finally { manager.flushQueue(); }
  });
  await test("empty signing responses cannot be finalized as successful asset downloads", async () => {
    const asset = { id: "empty", name: "Fixture", type: "surface", categories: ["surface"], components: [{ type: "albedo" }] };
    const api = { extended: async () => asset, acquired: async () => ["empty"], requestDownload: async () => ({ json: asset }) };
    const manager = new DownloadManager({}, api, logger, () => ({}), () => join(directory, "empty-library"), () => {}, () => {});
    try {
      const job = manager.createJob("empty"); await manager.runJob(job);
      assert.equal(job.status, "error"); assert.match(job.message, /no asset files/);
    } finally { manager.flushQueue(); }
  });
  await test("exhausted transient failures pause jobs without deleting verified work", async () => {
    const temp = join(directory, "openbridge", "asset-paused");
    await mkdir(temp, { recursive: true }); await writeFile(join(temp, "already.jpg"), body);
    globalThis.fixtureFetch = async () => { throw new DOMException("Download stalled", "TimeoutError"); };
    const asset = { id: "paused", name: "Fixture", type: "surface", categories: ["surface"], components: [{ type: "albedo" }] };
    const api = { extended: async () => asset, acquired: async () => ["paused"], requestDownload: async () => ({ json: asset,
      components: ["already", "pending"].map(name => ({ uri: `https://transfer.invalid/${name}.jpg`, saveAs: `${name}.jpg`, contentLength: body.length })) }) };
    const manager = new DownloadManager({}, api, logger, () => ({}), () => join(directory, "paused-library"), () => {}, () => {});
    try {
      const job = manager.createJob("paused"); await manager.runJob(job);
      assert.equal(job.status, "paused"); assert.match(job.message, /Resume/);
      assert.deepEqual(await readFile(join(temp, "already.jpg")), body);
    } finally { manager.flushQueue(); globalThis.fixtureFetch = (...args) => fetch(...args); }
  });
  await test("real Electron net.fetch streams and resumes correctly on Windows", async () => {
    const target = await seed("/electron-range", 16384);
    const entry = join(directory, "electron-network.cjs");
    await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import { app } from 'electron';
      import { readFile } from 'node:fs/promises';
      import { downloadFile } from './src/main/downloader';
      app.setPath('userData', ${JSON.stringify(join(directory, "electron-profile"))});
      app.disableHardwareAcceleration();
      app.whenReady().then(async () => {
        try {
          await downloadFile(${JSON.stringify(origin + "/electron-range?Signature=rotated")}, ${JSON.stringify(target)}, undefined, 5, undefined, 65536);
          const actual = await readFile(${JSON.stringify(target)});
          if (!actual.equals(Buffer.alloc(65536, 7))) throw new Error('Real Electron transfer data mismatch');
          app.exit(0);
        } catch { console.error('Real Electron transfer failed'); app.exit(1); }
      });
    ` }, bundle: true, platform: "node", format: "cjs", external: ["electron"], outfile: entry, logLevel: "silent" });
    const require = createRequire(import.meta.url);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [entry], { env, stdio: "inherit" });
    const timeout = setTimeout(() => child.kill(), 20_000);
    try {
      const code = await new Promise((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
      assert.equal(code, 0);
      assert.ok(seen.some(item => item.path === "/electron-range" && item.offset === 16384 && item.validator === '"fixture"'));
    } finally { clearTimeout(timeout); }
  });
  console.log(`\n${passed} networking regression checks passed (no external services used).`);
} finally {
  clearInterval(keepAlive);
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(directory, { recursive: true, force: true });
}
