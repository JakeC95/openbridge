import { build } from "esbuild";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";

const tempRoot = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir();
await mkdir(tempRoot, { recursive: true });
const directory = await mkdtemp(join(tempRoot, "public-providers-"));
try {
  const file = join(directory, "catalogs.mjs");
  await build({ entryPoints: ["src/main/hdr-decode-worker.ts"], outfile: join(directory, "hdr-decode-worker.js"),
    bundle: true, platform: "node", format: "cjs", target: "node22" });
  await build({ stdin: { contents: `
    export { PublicCatalog } from './src/main/public/catalog';
    export { AmbientCgAdapter } from './src/main/public/ambientcg';
    export { OpenHdriAdapter } from './src/main/public/openhdri';
    export { BlenderKitCatalog } from './src/main/public/blenderkit';
    export { numberValue } from './src/main/public/common';
    export { PublicDownloadManager, publicManifest } from './src/main/public/download';
    export { LibraryService } from './src/main/library';
    export { PublicPreviewService } from './src/main/public/previews';
    export { decodeHdrFile } from './src/main/hdr-decode';
    export { checkHdrDimensions, hdrLimitsFor, toneMappedPng } from './src/main/public/preview-data';
    export { publicCategoryQuery } from './src/renderer/public-taxonomy';
    export { publicHdriCategory } from './src/shared/public-categories';
    export { normalizePublicQuery, normalizePublicSaved } from './src/renderer/public-preferences';
    export { ambientCgPanoramaUrl, openHdriImageUrl, OPENHDRI_PREVIEW_WIDTH, publicCardThumbnail } from './src/shared/public-providers';
    export { ALL_SOURCE_TREE } from './src/renderer/all-sources';
  `, resolveDir: process.cwd(), loader: "ts" }, outfile: file, bundle: true, platform: "node", format: "esm", target: "node24",
    banner: { js: 'import { createRequire as fixtureRequire } from "node:module"; import { fileURLToPath as fixtureFilePath } from "node:url"; const __dirname = fixtureFilePath(new URL(".", import.meta.url)); const require = fixtureRequire(process.cwd() + "/package.json");' },
    plugins: [{ name: "electron-fixture", setup(bundler) { bundler.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" })); bundler.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export const net = { fetch: (...args) => globalThis.fetch(...args) }; export const app = { getPath: () => process.env.TEMP }; export const nativeImage = { createFromBuffer: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }) };' })); } }]
  });
  const { PublicCatalog, AmbientCgAdapter, OpenHdriAdapter, BlenderKitCatalog, numberValue, PublicDownloadManager, publicManifest, LibraryService, PublicPreviewService, decodeHdrFile, checkHdrDimensions, hdrLimitsFor, toneMappedPng, ambientCgPanoramaUrl, openHdriImageUrl, OPENHDRI_PREVIEW_WIDTH, publicCardThumbnail, publicCategoryQuery, publicHdriCategory, normalizePublicQuery, normalizePublicSaved, ALL_SOURCE_TREE } = await import(pathToFileURL(file).href);
  const logger = { info() {}, warn() {}, error(...args) { console.error(...args); } };
  assert.equal(numberValue(null), null);
  assert.equal(numberValue(undefined), null);
  assert.equal(numberValue(""), null);
  assert.equal(numberValue(0), 0);
  const restoredQuery = normalizePublicQuery("ambientcg", { provider: "other", limit: 9999, offset: 120, ids: ["stale"], query: "wood", types: ["material", 42], minResolution: 2048, maxTris: -5, timeEnd: 24, timeWindows: [{ start: 4, end: 8 }, { start: -1, end: 99 }], sort: "name" });
  assert.equal(restoredQuery.provider, "ambientcg"); assert.equal(restoredQuery.offset, 0); assert.equal(restoredQuery.limit, 60); assert.equal(restoredQuery.ids, undefined); assert.deepEqual(restoredQuery.types, ["material"]); assert.equal(restoredQuery.maxTris, undefined); assert.deepEqual(restoredQuery.timeWindows, [{ start: 4, end: 8 }]);
  assert.equal(normalizePublicSaved("ambientcg", [{ id: "one", name: "Wood", query: restoredQuery }])[0].query.minResolution, 2048);
  assert.equal(normalizePublicQuery("blenderkit", { sort: "name" }).sort, "relevance");
  const base = { id: "clear", provider: "ambientcg", name: "Clear daylight", type: "hdri", typeLabel: "HDRI", categories: ["HDRIs/Outdoor"], category: "HDRIs/Outdoor", tags: ["clear"], description: "Fixture", authors: {}, attributes: {}, maxResolution: 2048, resolutions: ["1K", "2K"], dimensions: null, dimensionsMm: null, polycount: null, texelDensity: null, publishedAt: 100, downloadCount: 1, thumbnail: null, previews: [], timeOfDay: 12, weather: "clear", mapCodes: [], mapFormats: ["exr"], modelFormats: [], lodCount: 0, license: "CC0-1.0", free: true, websiteUrl: "https://example.invalid", filesHash: "fixture", enriched: true, files: [{ role: "hdri", name: "sky_2K.exr", url: "https://example.invalid/sky.exr", bytes: 4, resolution: "2K", format: "exr" }] };
  let fail = false;
  assert.equal(publicHdriCategory("Forest trail", ["outdoor", "sky", "clear", "forest"]), "HDRIs/Outdoor/Forest & Woodland");
  assert.equal(publicHdriCategory("Day Sky HDRI", ["sky", "day"]), "HDRIs/Skies");
  assert.equal(publicHdriCategory("Indoor studio", ["overcast"]), "HDRIs/Studio");
  const trees = [{ key: "Materials", label: "Materials", children: [{ key: "Materials/Wood", label: "Wood", children: [] }, { key: "Materials/Planks", label: "Planks", children: [] }, { key: "Materials/Metal", label: "Metal", children: [] }] }];
  assert.deepEqual(publicCategoryQuery("ambientcg", "surface:wood", trees).categoryPaths, ["Materials/Wood", "Materials/Planks"]);
  assert.deepEqual(publicCategoryQuery("ambientcg", "surface:unknown", trees).types, ["__none__"]);
  assert.deepEqual(publicCategoryQuery("openhdri", "hdri:nature:forest").categoryPaths, ["HDRIs/Outdoor/Forest & Woodland"]);
  assert.deepEqual(publicCategoryQuery("blenderkit", "hdri:clear").types, ["__none__"]);
  assert.equal(OPENHDRI_PREVIEW_WIDTH, 4096);
  assert.equal(openHdriImageUrl("fly-studio-02", 512), "https://openhdri.org/api/image/fly-studio-02.jpg?w=512&q=80&f=png");
  assert.equal(openHdriImageUrl("fly-studio-02", 4096), "https://openhdri.org/api/image/fly-studio-02.jpg?w=4096&q=90&f=png");
  const acgPreviews = [
    { type: "thumbnail", label: "Preview", url: "https://example.invalid/sphere.png" },
    { type: "hdr-source", label: "HDR panorama LQ", url: "https://example.invalid/Test_LQ.exr?123" },
    { type: "hdr-source", label: "HDR panorama HQ", url: "https://example.invalid/Test_HQ.exr?456" }
  ];
  assert.equal(ambientCgPanoramaUrl(acgPreviews, "LQ"), "https://example.invalid/Test_LQ.jpg");
  assert.equal(ambientCgPanoramaUrl(acgPreviews, "HQ"), "https://example.invalid/Test_HQ.jpg");
  assert.equal(publicCardThumbnail({ ...base, provider: "ambientcg", type: "hdri", thumbnail: "https://example.invalid/sphere.png", previews: acgPreviews }, 512), "https://example.invalid/Test_LQ.jpg");
  const colorChecker = { role: "colorchart", name: "fixture_colorchecker.exr", url: "https://example.invalid/colorchecker.exr", bytes: 0, format: "exr", fileType: "colorchecker", downloadable: true };
  const openDetail = { ...base, provider: "openhdri", type: "hdri", files: [...base.files, colorChecker] };
  assert.equal(publicManifest(openDetail, {}).length, 1);
  assert.equal(publicManifest(openDetail, { includeColorChecker: true }).length, 2);
  assert.equal(publicManifest(openDetail, { includeColorChecker: true })[1].role, "colorchart");
  const hdrSource = Buffer.concat([Buffer.from("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n"), Buffer.from([128,64,32,129,64,128,32,129])]);
  assert.deepEqual(checkHdrDimensions(hdrSource, ".hdr"), { width: 2, height: 1 });
  const hdrFixturePath = join(directory, "worker-fixture.hdr");
  await writeFile(hdrFixturePath, hdrSource);
  const decodeAbort = new AbortController();
  const abandoned = decodeHdrFile(hdrFixturePath, hdrLimitsFor("blenderkit"), decodeAbort.signal);
  await Promise.resolve(); // Enter the worker path before cancelling it.
  decodeAbort.abort();
  await assert.rejects(abandoned, { name: "AbortError" });
  await assert.rejects(decodeHdrFile(hdrFixturePath, { maxWidth: 1, maxPixels: 1 }, new AbortController().signal), /budget/);
  const decoded = await decodeHdrFile(hdrFixturePath, hdrLimitsFor("blenderkit"), new AbortController().signal);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.data.length, 8);
  assert.throws(() => checkHdrDimensions(Buffer.from("#?RADIANCE\n\n-Y 8192 +X 16384\n"), ".hdr"), /budget/);
  const exrWindow = Buffer.alloc(16); exrWindow.writeInt32LE(16383, 8); exrWindow.writeInt32LE(8191, 12);
  const exrSize = Buffer.alloc(4); exrSize.writeUInt32LE(16);
  const exrHeader = Buffer.concat([Buffer.from([0x76,0x2f,0x31,0x01,2,0,0,0]), Buffer.from("dataWindow\0box2i\0"), exrSize, exrWindow, Buffer.from([0])]);
  assert.throws(() => checkHdrDimensions(exrHeader, ".exr"), /budget/);
  assert.throws(() => checkHdrDimensions(exrHeader, ".exr", hdrLimitsFor("openhdri")), /budget/);
  let previewTransfers = 0;
  const hdrDetail = { ...base, provider: "blenderkit", id: "preview-hdr", type: "hdr", previews: [{ type: "panorama", label: "Panorama", url: "https://example.invalid/tonemapped.jpg" }], files: [{ role: "hdri", name: "fixture.hdr", url: "https://example.invalid/fixture.hdr", resolution: "1K", format: "hdr", bytes: hdrSource.length }], raw: {} };
  const previewProgress = [];
  const previewService = new PublicPreviewService(join(directory, "previews"), async () => hdrDetail, async (_, url) => url, value => previewProgress.push(value), async (url, destination, progress) => { previewTransfers++; const body = url.endsWith(".hdr") ? hdrSource : toneMappedPng({ width: 2, height: 1, resolution: "fixture", data: new Uint16Array(8).fill(15360) }); await writeFile(destination, body); progress?.({ received: body.length, total: body.length, ratio: 1 }); return destination; });
  try {
    const [first, second] = await Promise.all([previewService.hdr("blenderkit", hdrDetail.id), previewService.hdr("blenderkit", hdrDetail.id)]);
    assert.equal(previewTransfers, 1); assert.equal(first.width, 2); assert.equal(second.data.length, 8); assert.ok(first.data instanceof Uint16Array);
    const png = toneMappedPng(first); assert.deepEqual([...png.slice(0, 8)], [137,80,78,71,13,10,26,10]); assert.equal(png.readUInt32BE(16), 2);
    const entries = await previewService.previews("blenderkit", hdrDetail.id); assert.equal(entries.hdrAvailable, true); assert.equal(entries.maps[1].exposure.mapType, "HDR");
    assert.match(entries.maps[1].url, /^file:/, "HDR poster must be cached locally so the 360 viewer can fetch it under CSP");
    assert.ok(previewProgress.every(value => value.preview && value.assetId.startsWith("public-preview:")));
    const high = await previewService.highResolution("blenderkit", hdrDetail.id, "JPG"); assert.ok((await readFile(fileURLToPath(high.url))).length > 40);
  } finally { previewService.close(); }
  const png = toneMappedPng({ width: 2, height: 1, resolution: "fixture", data: new Uint16Array(8).fill(15360) });
  const entryName = Buffer.from("../Fixture_Color.png");
  const localHeader = Buffer.alloc(30); localHeader.writeUInt32LE(0x04034b50); localHeader.writeUInt16LE(20, 4); localHeader.writeUInt32LE(crc32(png), 14); localHeader.writeUInt32LE(png.length, 18); localHeader.writeUInt32LE(png.length, 22); localHeader.writeUInt16LE(entryName.length, 26);
  const directoryEntry = Buffer.alloc(46); directoryEntry.writeUInt32LE(0x02014b50); directoryEntry.writeUInt16LE(20, 4); directoryEntry.writeUInt16LE(20, 6); directoryEntry.writeUInt32LE(crc32(png), 16); directoryEntry.writeUInt32LE(png.length, 20); directoryEntry.writeUInt32LE(png.length, 24); directoryEntry.writeUInt16LE(entryName.length, 28);
  const footer = Buffer.alloc(22); footer.writeUInt32LE(0x06054b50); footer.writeUInt16LE(1, 8); footer.writeUInt16LE(1, 10); footer.writeUInt32LE(directoryEntry.length + entryName.length, 12); footer.writeUInt32LE(localHeader.length + entryName.length + png.length, 16);
  const fixtureZip = Buffer.concat([localHeader, entryName, png, directoryEntry, entryName, footer]);
  let selectedZip = fixtureZip;
  const mapDetail = { ...base, type: "material", files: [{ role: "package", name: "1K-PNG.zip", url: "https://example.invalid/package.zip", bytes: fixtureZip.length, resolution: "1K", format: "png" }], previews: [{ type: "map", label: "Color", map: "color", url: "https://example.invalid/Color.png" }], raw: {} };
  const mapService = new PublicPreviewService(join(directory, "map-previews"), async () => mapDetail, async (_, url) => url, () => {}, async (url, destination) => { await writeFile(destination, url.endsWith(".zip") ? selectedZip : png); return destination; });
  try {
    // yauzl rejects path traversal before our extraction code is allowed to read a member.
    await assert.rejects(() => mapService.highResolution("ambientcg", "map-fixture", "color"), /invalid relative path|escapes|path/i);
    selectedZip = Buffer.from(fixtureZip);
    const safeName = Buffer.from("SubFixture_Color.png"); assert.equal(safeName.length, entryName.length);
    safeName.copy(selectedZip, localHeader.length); safeName.copy(selectedZip, localHeader.length + entryName.length + png.length + directoryEntry.length);
    mapDetail.filesHash = "safe-preview-fixture";
    const full = await mapService.highResolution("ambientcg", "map-fixture", "color");
    assert.equal(full.resolution, "1K"); assert.deepEqual(await readFile(fileURLToPath(full.url)), png);
    assert.equal((await mapService.previews("ambientcg", "map-fixture")).maps[0].map.type, "color");
  } finally { mapService.close(); }
  let releasePreview;
  const pendingDetail = new Promise(resolve => { releasePreview = resolve; });
  const cancelling = new PublicPreviewService(join(directory, "cancel-preview"), async () => pendingDetail, async (_, url) => url, () => {});
  const cancelled = cancelling.previews("openhdri", "cancel-fixture");
  await Promise.resolve(); cancelling.cancel("openhdri", "cancel-fixture"); releasePreview({ ...hdrDetail, provider: "openhdri", files: [] });
  await assert.rejects(() => cancelled, error => error.name === "AbortError"); cancelling.close();
  let openPosterSource = "";
  const openPreview = new PublicPreviewService(join(directory, "open-previews"), async () => ({ ...hdrDetail, id: "fixture", provider: "openhdri", type: "hdri", previews: [{ type: "panorama", label: "Stale catalog preview", url: "https://example.invalid/old-thumbnail.jpg" }], files: [{ ...hdrDetail.files[0], resolution: "16K", name: "original.exr" }] }), async (_, url) => { openPosterSource = url; assert.ok(!url.endsWith(".exr"), "Previews must not eagerly transfer a 16K EXR"); return url; }, () => {}, async (_, destination) => { await writeFile(destination, png); return destination; });
  try { const entries = await openPreview.previews("openhdri", "fixture"); assert.equal(entries.hdrAvailable, false, "OpenHDRI's 16K EXR must stay outside the 8K live-preview budget"); assert.equal(entries.maps.length, 1); assert.equal(entries.maps[0].type, "JPG"); assert.equal(entries.maps[0].panorama, true); assert.match(entries.note, /16K.*8K/); assert.equal(openPosterSource, "https://openhdri.org/api/image/fixture.jpg?w=4096&q=90&f=png", "OpenHDRI must ignore stale catalog previews and fetch the 4096px PNG"); assert.match(entries.renders[0].url, /^file:/, "OpenHDRI render must use the cached cropped poster"); assert.equal(entries.renders[0].url, entries.maps[0].url); }
  finally { openPreview.close(); }
  let acgPosterSource = "";
  const acgDetail = { ...hdrDetail, id: "acg-fixture", provider: "ambientcg", type: "hdri", thumbnail: "https://example.invalid/sphere.png", previews: acgPreviews, files: [{ ...hdrDetail.files[0], resolution: "2K", name: "source_2K.exr" }] };
  const acgPreview = new PublicPreviewService(join(directory, "acg-previews"), async () => acgDetail, async (_, url) => { assert.match(url, /_HQ\.jpg/); acgPosterSource = url; return url; }, () => {}, async (_, destination) => { await writeFile(destination, png); return destination; });
  try {
    const entries = await acgPreview.previews("ambientcg", "acg-fixture");
    assert.equal(acgPosterSource, "https://example.invalid/Test_HQ.jpg");
    assert.equal(entries.hdrAvailable, true);
    assert.equal(entries.renders.length, 1);
    assert.equal(entries.renders[0].label, "Panorama preview");
    assert.match(entries.renders[0].url, /^file:/);
    assert.equal(entries.renders[0].url, entries.maps[0].url);
    assert.equal(entries.maps[0].panorama, true);
    assert.equal(entries.maps[0].map.type, "JPG");
    const high = await acgPreview.highResolution("ambientcg", "acg-fixture", "JPG");
    assert.equal(high.url, entries.maps[0].url);
  } finally { acgPreview.close(); }
  console.log("PASS artist category mappings, genuine HDR half-float decode, coalescing, ambientCG panorama JPG previews, 8K HDR limits including OpenHDRI");
  const catalog = new PublicCatalog("ambientcg", join(directory, "fixture.sqlite"), { async fetch() { if (fail) throw new Error("Fixture outage"); return { assets: [base, { ...base, id: "cloud", name: "Overcast night", weather: "overcast", timeOfDay: 0, resolutions: ["4K"], maxResolution: 4096 }] }; } }, { ...logger, error() {} });
  const q = patch => catalog.query({ provider: "ambientcg", limit: 60, offset: 0, ...patch });
  try {
    await catalog.refresh();
    assert.equal(q({ query: "daylight" }).hits[0].id, "clear");
    const browse = q({ query: "d", limit: 1 });
    const quick = q({ query: "d", limit: 1, includeFacets: false });
    assert.deepEqual(quick.hits, browse.hits);
    assert.equal(quick.total, browse.total);
    assert.equal(quick.hasMore, browse.hasMore);
    assert.ok(browse.facets.types.length > 0);
    assert.deepEqual(quick.facets.types, []);
    assert.equal(q({ query: '" OR bad:*' }).total, 0);
    assert.equal(q({ ids: [] }).total, 0);
    assert.equal(q({ types: ["__none__"] }).total, 0);
    assert.equal(q({ weather: ["clear"] }).total, 1);
    assert.equal(q({ weather: ["clear"], timeStart: 0, timeEnd: 24 }).total, 1);
    assert.equal(q({ timeStart: 22, timeEnd: 2 }).hits[0].id, "cloud");
    assert.equal(q({ resolutions: ["2K", "4K"] }).total, 2);
    assert.equal(q({ categoryPaths: ["HDRIs"] }).total, 2);
    assert.equal(q({ categoryPaths: ["HDRIs/Studio"] }).total, 0);
    assert.equal(q({ sort: "resolution" }).hits[0].id, "cloud");
    assert.equal(q({ limit: 1, offset: 1 }).hits.length, 1);
    assert.equal(q({}).hits[0].polycount, null);
    await catalog.refresh(); assert.equal(q({ query: "night" }).total, 1);
    fail = true; await catalog.refresh(); assert.equal(catalog.status().state, "error"); assert.equal(q({}).total, 2);
    assert.throws(() => publicManifest({ ...base, raw: {} }, { resolution: "32K" }), /unavailable/);
    assert.equal(publicManifest({ ...base, raw: {} }, {})[0].resolution, "2K");
    const native = { role: "package", name: "native.blend", fileType: "blend", format: "blend", url: "https://example.invalid/native", bytes: 8 };
    const tier = { ...native, name: "2K.blend", fileType: "resolution_2K", resolution: "2K" };
    assert.equal(publicManifest({ ...base, files: [native, tier], raw: {} }, { fileType: "blend", format: "blend" })[0].name, "native.blend");
    const glb = { ...native, name: "native.glb", format: "glb", fileType: "gltf" };
    assert.equal(publicManifest({ ...base, provider: "blenderkit", files: [native, tier, glb], raw: {} }, { format: "glb" })[0].name, "native.glb");
    assert.equal(publicManifest({ ...base, provider: "blenderkit", files: [native, tier, glb], raw: {} }, { format: "gltf" })[0].name, "native.glb");
    console.log("PASS local catalogue search, nulls, weather, time windows, OR resolutions, category prefixes, pagination, repeated FTS refresh and stale-data recovery");
  } finally { catalog.close(); }

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      const parsed = new URL(String(url));
      const term = parsed.searchParams.get("query") ?? "";
      const type = /asset_type:(\w+)/.exec(term)?.[1] ?? "model";
      const page = Number(parsed.searchParams.get("page") ?? 1);
      const count = type === "model" ? 130 : type === "material" ? 35 : 0;
      const results = Array.from({ length: Math.max(0, Math.min(100, count - (page - 1) * 100)) }, (_, i) => ({ assetBaseId: `${type}-${(page - 1) * 100 + i}`, displayName: `${type} fixture ${(page - 1) * 100 + i}`, assetType: type, isFree: true, license: "cc_zero", files: [], dictParameters: {} }));
      const next = page * 100 < count ? `${parsed.origin}${parsed.pathname}?query=${encodeURIComponent(term)}&page_size=100&page=${page + 1}` : null;
      return new Response(JSON.stringify({ count, results, next }), { headers: { "content-type": "application/json" } });
    };
    const online = new BlenderKitCatalog({ apiKey: () => "" }, logger);
    const ids = [];
    for (let offset = 0; offset < 165; offset += 60) {
      const result = await online.search({ provider: "blenderkit", types: ["model", "material"], limit: 60, offset });
      ids.push(...result.hits.map(hit => hit.id));
      assert.equal(result.hasMore, offset + result.hits.length < 165);
    }
    assert.equal(ids.length, 165); assert.equal(new Set(ids).size, 165);
    assert.equal((await online.search({ provider: "blenderkit", ids: [], limit: 60, offset: 0 })).total, 0);
    assert.equal((await online.search({ provider: "blenderkit", types: ["__none__"], limit: 60, offset: 0 })).total, 0);
    console.log("PASS BlenderKit global pagination crosses type/page boundaries without omissions or duplicates; empty scopes stay empty");
    online.close();
  } finally { globalThis.fetch = originalFetch; }
  const resolverRequests = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const source = new URL(String(url)); resolverRequests.push({ source, init });
      if (source.hostname === "www.blenderkit.com") {
        assert.equal(new Headers(init.headers).get("Authorization"), "Bearer fixture-not-a-real-key");
        if (source.pathname === "/api/v1/me") return new Response(JSON.stringify({ user: { firstName: "Fixture" }, plan: { name: "Free" } }), { headers: { "content-type": "application/json" } });
        assert.ok(source.searchParams.get("scene_uuid"));
        const invalidCredentials = new URL("https://invalid.example/file.exr"); invalidCredentials.username = "fixture"; invalidCredentials.password = "fixture";
        return new Response(JSON.stringify({ filePaths: [{ url: "javascript:invalid" }, { url: invalidCredentials.href }, { url: "https://expired.example.invalid/file.exr" }, { url: "https://storage.example.invalid/file.exr" }], filePath: "https://fallback.example.invalid/file.exr" }), { headers: { "content-type": "application/json" } });
      }
      assert.equal(new Headers(init.headers).get("Authorization"), null);
      if (source.hostname === "expired.example.invalid") return new Response(null, { status: 403 });
      if (init.method === "HEAD") return new Response(null, { status: 405 });
      assert.equal(new Headers(init.headers).get("Range"), "bytes=0-0");
      return new Response(new Uint8Array([1]), { status: 206 });
    };
    const authenticated = new BlenderKitCatalog({ apiKey: () => "fixture-not-a-real-key" }, logger);
    assert.equal(await authenticated.resolveDownload("https://www.blenderkit.com/api/v1/downloads/fixture/"), "https://storage.example.invalid/file.exr");
    assert.equal(resolverRequests.some(request => request.source.username || request.source.protocol !== "https:"), false);
    assert.deepEqual(await authenticated.testKey(), { ok: true, userName: "Fixture", plan: "Free" });
    await assert.rejects(() => authenticated.resolveDownload("https://other.example.invalid/api/v1/downloads/fixture/"), /endpoint/);
    globalThis.fetch = async () => new Response(null, { status: 403 });
    await assert.rejects(() => authenticated.resolveDownload("https://www.blenderkit.com/api/v1/downloads/fixture/"), /plan entitlement/);
    authenticated.close();
    console.log("PASS BlenderKit resolver protocol, ephemeral session ID, alternate CDN fallback, invalid-source rejection and credential isolation");
  } finally { globalThis.fetch = originalFetch; }

  const root = join(directory, "library"); await mkdir(root);
  let finished;
  const completion = new Promise(resolve => { finished = resolve; });
  const manager = new PublicDownloadManager(join(directory, "queue.json"), join(directory, "history.sqlite"), async () => ({ ...base, thumbnail: "https://example.invalid/api/image/fixture.jpg?w=512&f=png", raw: {} }), () => root, async (_, url) => url, logger, () => finished(), async (_, destination, progress, timeout, signal) => { signal?.throwIfAborted(); await writeFile(destination, Buffer.from("test")); progress?.({ received: 4, total: 4, ratio: 1 }); return destination; });
  try {
    await manager.start("clear", {}, "ambientcg"); await completion;
    assert.equal(manager.list()[0].status, "complete");
    assert.equal(manager.overview().history[0].assetId, "ambientcg:clear");
    assert.equal((await readFile(join(root, "clear", "preview.png"))).toString(), "test", "PNG-requested thumbnails must not be mislabeled .jpg");
    const sidecar = await readFile(join(root, "clear", "openbridge-ambientcg.json"), "utf8");
    assert.equal(sidecar.includes("https://example.invalid/sky.exr"), false);
    const library = new LibraryService(() => join(directory, "missing-mega"), () => join(directory, "missing-poli"), () => join(directory, "missing-poly"), () => null, () => null, join(directory, "library.sqlite"), logger, () => ({ ambientcg: root }));
    try { const scan = await library.scan(true); assert.equal(scan.assets.length, 1); assert.equal(scan.assets[0].id, "ambientcg:clear"); assert.equal(scan.assets[0].provider, "ambientcg"); assert.equal((await library.snapshot()).counts.ambientcg, 1); }
    finally { library.close(); }
    console.log("PASS public download completion, safe sidecar, offline library scanning and provider counts");
  } finally { await manager.close(); }
  const waitStatus = (downloads, status) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`Timed out waiting for ${status}`)); }, 5000);
    const stop = downloads.onProgress(progress => { if (progress.status === status) { clearTimeout(timer); stop(); resolve(progress); } });
    const existing = downloads.list().find(progress => progress.status === status);
    if (existing) { clearTimeout(timer); stop(); resolve(existing); }
  });
  const queueFile = join(directory, "resume-queue.json"), historyFile = join(directory, "resume-history.sqlite");
  let allowTransfer = false;
  let forceFailure = false;
  const makeManager = () => new PublicDownloadManager(queueFile, historyFile, async (_, id) => ({ ...base, id, raw: {} }), () => root, async (_, url) => url, { ...logger, error() {} }, () => {}, async (_, destination, progress, timeout, signal) => {
    signal?.throwIfAborted();
    if (forceFailure) throw new Error("Fixture delivery outage");
    if (!allowTransfer) await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    await writeFile(destination, Buffer.from("test")); progress?.({ received: 4, total: 4, ratio: 1 }); return destination;
  });
  const pausing = makeManager();
  await pausing.start("ambientcg:resumable", { resolution: "2K", format: "exr" });
  await waitStatus(pausing, "downloading"); await pausing.pause("ambientcg:resumable");
  assert.equal(pausing.list()[0].status, "paused"); await pausing.close();
  allowTransfer = true;
  const restored = makeManager();
  try {
    await restored.ready; assert.equal(restored.list()[0].status, "paused");
    await restored.resume("ambientcg:resumable"); await waitStatus(restored, "complete");
    assert.equal(restored.overview().history.length, 1);
    forceFailure = true;
    await restored.start("ambientcg:retry-fixture"); await waitStatus(restored, "error");
    forceFailure = false;
    await restored.retry("ambientcg:retry-fixture");
    const retryOutcome = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stop(); reject(new Error("Retry did not finish")); }, 5000);
      const stop = restored.onProgress(progress => { if (progress.assetId === "ambientcg:retry-fixture" && progress.status === "complete") { clearTimeout(timer); stop(); resolve(progress); } });
    });
    assert.equal(retryOutcome.status, "complete");
    console.log("PASS pause aborts delivery, queue restores paused with original options, resume completes, failed delivery retries without duplicate completion history");
  } finally { await restored.close(); }
  if (process.argv.includes("--live")) {
    for (const [provider, adapter] of [["ambientcg", new AmbientCgAdapter()], ["openhdri", new OpenHdriAdapter()]]) {
      let snapshot;
      const capturedAdapter = { async fetch(log) { return snapshot ??= await adapter.fetch(log); } };
      const catalog = new PublicCatalog(provider, join(directory, `${provider}.sqlite`), capturedAdapter, logger);
      try {
        const status = await catalog.refresh();
        assert.equal(status.state, "ready", status.error);
        assert.ok(status.count > 0);
        const result = catalog.query({ provider, limit: 20, offset: 0 });
        assert.equal(result.hits.length, 20);
        assert.ok(result.hits.every(hit => hit.thumbnail && hit.files.length && hit.license));
        const term = result.hits[0].name.split(" ")[0];
        const searched = catalog.query({ provider, query: term, limit: 10, offset: 0 });
        assert.ok(searched.hits.length > 0);
        assert.equal(catalog.query({ provider, ids: [], limit: 10, offset: 0 }).total, 0);
        for (const bucket of result.facets.types) {
          const filtered = catalog.query({ provider, types: [bucket.value], limit: 300, offset: 0 });
          assert.ok(filtered.hits.every(hit => hit.type === bucket.value));
          assert.equal(filtered.total, bucket.count);
        }
        const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
        let mapped = 0, covered = new Set();
        for (const node of flatten(ALL_SOURCE_TREE)) {
          const mapping = publicCategoryQuery(provider, node.value, catalog.categories());
          if (mapping.types?.includes("__none__")) continue;
          const filtered = catalog.query({ ...mapping, provider, limit: 300, offset: 0 });
          if (node.value.includes(":")) mapped++;
          for (const hit of filtered.hits) {
            if (mapping.types?.length) assert.ok(mapping.types.includes(hit.type), `${node.value}: wrong type`);
            if (mapping.weather?.length) assert.ok(mapping.weather.includes(hit.weather), `${node.value}: wrong weather`);
            if (mapping.categoryPaths?.length) assert.ok(mapping.categoryPaths.some(path => hit.category === path || hit.category.startsWith(path + "/")), `${node.value}: wrong category`);
            covered.add(hit.id);
          }
        }
        if (provider === "ambientcg") assert.ok(catalog.query({ ...publicCategoryQuery(provider, "surface:wood", catalog.categories()), provider, limit: 10, offset: 0 }).total > 0, "Wood category must include ambientCG materials");
        console.log(`${provider}: ${mapped} mapped artist-category branches audited against the live catalogue`);
        if (provider === "ambientcg") {
          const hdri = catalog.query({ provider, types: ["hdri"], limit: 1, offset: 0 }).hits[0];
          const previews = new PublicPreviewService(join(directory, "live-previews"), async (_, id) => catalog.extended(id), async (_, url) => url, () => {});
          try {
            const set = await previews.previews(provider, hdri.id);
            assert.equal(set.hdrAvailable, true); assert.equal(set.maps[0].panorama, true);
            const hdr = await previews.hdr(provider, hdri.id); assert.ok(hdr.width <= 8192 && hdr.data.length === hdr.width * hdr.height * 4);
            console.log(`ambientcg: real ${hdri.id} EXR decoded to ${hdr.width}×${hdr.height} half-float pixels; HQ JPG panorama and exposure source verified`);
          } finally { previews.close(); }
          const material = catalog.query({ provider, types: ["material"], limit: 20, offset: 0 }).hits.find(hit => hit.files.some(file => file.resolution === "1K" && file.format === "jpg" && file.bytes > 0 && file.bytes < 15_000_000));
          assert.ok(material, "Small ambientCG material fixture not found");
          let settle;
          const completed = new Promise(resolve => { settle = resolve; });
          const downloads = new PublicDownloadManager(join(directory, "live-queue.json"), join(directory, "live-history.sqlite"), async (_, id) => catalog.extended(id), () => join(directory, "live-library"), async (_, url) => url, logger, () => {});
          const unsubscribe = downloads.onProgress(progress => { if (["complete", "error"].includes(progress.status)) settle(progress); });
          try {
            await downloads.start(material.id, { resolution: "1K", format: "jpg" }, "ambientcg");
            const outcome = await completed;
            assert.equal(outcome.status, "complete", outcome.message);
            const localLibrary = new LibraryService(() => join(directory, "empty-mega"), () => join(directory, "empty-poli"), () => join(directory, "empty-poly"), () => null, () => null, join(directory, "live-library.sqlite"), logger, () => ({ ambientcg: join(directory, "live-library") }));
            try { const scan = await localLibrary.scan(true); assert.equal(scan.assets[0].provider, "ambientcg"); assert.ok(scan.assets[0].technical.mapCount > 0, "Extracted material maps missing from offline index"); }
            finally { localLibrary.close(); }
            console.log(`ambientcg: real ${material.id} 1K JPG ZIP downloaded, extracted and indexed offline`);
          } finally { unsubscribe(); await downloads.close(); }
        } else {
          // Verify delivery without transferring a multi-GB OpenHDRI panorama.
          const url = result.hits[0].files.find(file => file.role === "hdri").url;
          const response = await fetch(url, { headers: { Range: "bytes=0-63" }, signal: AbortSignal.timeout(60_000) });
          assert.ok(response.ok, `OpenHDRI EXR endpoint HTTP ${response.status}`);
          const reader = response.body.getReader();
          const first = await reader.read(); await reader.cancel();
          assert.deepEqual([...first.value.slice(0, 4)], [0x76, 0x2f, 0x31, 0x01], "OpenHDRI payload is not OpenEXR");
          console.log("openhdri: real download endpoint returned a valid OpenEXR header (full multi-GB transfer intentionally not performed)");
        }
        await catalog.refresh(); // Regression: repeated contentless-FTS rebuild must work.
        assert.equal(catalog.status().state, "ready");
        console.log(`${provider}: ${status.count} assets; search, types, empty IDs and repeat refresh passed`);
      } finally { catalog.close(); }
    }
    const bk = new BlenderKitCatalog({ apiKey: () => "" }, logger);
    await bk.ensureReady();
    for (const type of ["model", "material", "hdr", "brush"]) {
      const result = await bk.search({ provider: "blenderkit", query: "", types: [type], freeOnly: true, limit: 4, offset: 0 });
      assert.ok(result.hits.length > 0);
      assert.ok(result.hits.every(hit => hit.type === type && hit.free));
      assert.equal((await bk.extended(result.hits[0].id)).id, result.hits[0].id);
      console.log(`blenderkit: ${type} search and free access passed (${result.total})`);
    }
    const walk = nodes => nodes.flatMap(node => [node, ...walk(node.children ?? [])]);
    const nativeCategories = bk.categories();
    const descendants = new Map(walk(nativeCategories).map(node => [node.key, new Set(walk([node]).map(child => child.key))]));
    let mappedBlenderCategories = 0;
    for (const node of walk(ALL_SOURCE_TREE)) {
      const mapping = publicCategoryQuery("blenderkit", node.value, nativeCategories);
      if (!mapping.categoryPaths?.length || mapping.types?.includes("__none__")) continue;
      const result = await bk.search({ ...mapping, provider: "blenderkit", freeOnly: true, limit: 2, offset: 0 });
      const allowed = new Set(mapping.categoryPaths.flatMap(path => [...(descendants.get(path) ?? [])]));
      assert.ok(result.hits.every(hit => allowed.has(hit.attributes.categorySlug)), `${node.value}: unrelated BlenderKit category`);
      mappedBlenderCategories++;
    }
    const highResolution = await bk.search({ provider: "blenderkit", types: ["hdr"], minResolution: 4096, freeOnly: true, limit: 3, offset: 0 });
    assert.ok(highResolution.hits.length > 0 && highResolution.hits.every(hit => hit.maxResolution >= 4096));
    const lowPoly = await bk.search({ provider: "blenderkit", types: ["model"], maxTris: 5000, freeOnly: true, limit: 3, offset: 0 });
    assert.ok(lowPoly.hits.length > 0 && lowPoly.hits.every(hit => hit.polycount !== null && hit.polycount <= 5000));
    console.log(`blenderkit: ${mappedBlenderCategories} mapped artist categories, native-resolution and polygon filters audited live`);
    await assert.rejects(() => bk.resolveDownload("https://www.blenderkit.com/api/v1/downloads/test/"), /API key/);
    bk.close();
  }
  console.log("Public-provider checks passed");
} finally { await rm(directory, { recursive: true, force: true }); }
