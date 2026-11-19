import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { encodeExrRgba } from "@bb-studio/exr";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "openbridge-hdr-thumbs-"));
const require = createRequire(import.meta.url);
async function bundle(entry, output) {
  await build({ entryPoints: [entry], outfile: output, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
}
const digest = value => createHash("sha256").update(value).digest("hex");
function image(width, height, brightness = 1) {
  const rgba = new Float32Array(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([brightness, brightness / 2, brightness / 4, 1], offset);
  return encodeExrRgba({ width, height, rgba }, { precision: "half", includeAlpha: true, compression: 0 });
}
function int(value) { const bytes = Buffer.alloc(4); bytes.writeInt32LE(value); return bytes; }
function attribute(name, type, body) {
  return Buffer.concat([Buffer.from(name + "\0" + type + "\0"), int(body.length), body]);
}
function multiviewHeader() {
  const prefix = Buffer.alloc(8); prefix.writeUInt32LE(20000630); prefix.writeUInt32LE(2, 4);
  return Buffer.concat([prefix,
    attribute("dataWindow", "box2i", Buffer.concat([int(0), int(0), int(3), int(1)])),
    attribute("multiView", "stringvector", Buffer.concat([int(4), Buffer.from("left"), int(5), Buffer.from("right")])),
    Buffer.from([0])]);
}

try {
  await Promise.all([
    bundle("src/main/shared-hdr-thumbnails.ts", join(directory, "thumbnail.cjs")),
    bundle("src/main/shared-facts-worker.ts", join(directory, "shared-facts-worker.js")),
    bundle("src/main/hdr-decode-worker.ts", join(directory, "hdr-decode-worker.js"))
  ]);
  const { SharedHdrThumbnailCache } = require(join(directory, "thumbnail.cjs"));
  const cacheDirectory = join(directory, "profile", "hdr-thumbnails");
  const service = new SharedHdrThumbnailCache(cacheDirectory);
  const sourceDirectory = join(directory, "sources");
  await mkdir(sourceDirectory);
  const source = join(sourceDirectory, "fixture.hdr"); // Intentional EXR content / HDR suffix.
  const original = image(8, 4);
  await writeFile(source, original);
  const first = await service.get(source);
  assert.equal(first.previewAvailable, true);
  assert.equal(first.panorama, true);
  assert.equal(first.width, 8);
  assert.ok(first.path.startsWith(cacheDirectory));
  const png = await readFile(first.path);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 8);
  assert.equal(png.readUInt32BE(20), 4);
  let offset = 8; const payload = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") payload.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const pixels = inflateSync(Buffer.concat(payload));
  assert.ok(pixels[1] > pixels[2] && pixels[2] > pixels[3] && pixels[3] > 0);
  assert.equal(pixels[4], 255);
  const written = (await stat(first.path)).mtimeMs;
  assert.equal((await service.get(source)).path, first.path);
  assert.equal((await stat(first.path)).mtimeMs, written);
  assert.equal(digest(await readFile(source)), digest(original));
  assert.deepEqual(await readdir(sourceDirectory), ["fixture.hdr"]);
  console.log("PASS genuine tone-mapped PNG pixels, content-magic input, cache reuse and unchanged source directory");

  await writeFile(source, image(8, 4, 0.125));
  const future = new Date(Date.now() + 5000);
  await utimes(source, future, future);
  const changed = await service.get(source);
  assert.notEqual(changed.path, first.path);
  assert.notDeepEqual(await readFile(changed.path), png);
  const portrait = join(sourceDirectory, "portrait.exr");
  await writeFile(portrait, image(2, 1024));
  const vertical = await service.get(portrait);
  const verticalPng = await readFile(vertical.path);
  assert.equal(vertical.panorama, false);
  assert.ok(verticalPng.readUInt32BE(16) <= 512 && verticalPng.readUInt32BE(20) <= 512);
  console.log("PASS source identity invalidates stale PNG and portrait output stays within 512 pixels per axis");

  await writeFile(changed.path, Buffer.alloc(0));
  assert.equal((await service.get(source)).path, changed.path);
  assert.ok((await stat(changed.path)).size > 0);
  const oldCacheFile = join(cacheDirectory, "0".repeat(64) + ".png");
  const largeCache = await open(oldCacheFile, "w");
  try { await largeCache.truncate(129 * 1024 * 1024); } finally { await largeCache.close(); }
  const fresh = join(sourceDirectory, "fresh.exr");
  await writeFile(fresh, image(4, 2));
  // A fresh instance performs its one-time disk reconciliation, as on app startup.
  assert.ok((await new SharedHdrThumbnailCache(cacheDirectory).get(fresh)).path);
  await assert.rejects(stat(oldCacheFile), { code: "ENOENT" });
  console.log("PASS empty cache files regenerate and published thumbnails trigger the 128 MiB disk budget");

  const oversized = join(sourceDirectory, "oversized.exr");
  await writeFile(oversized, image(4, 2));
  const sparse = await open(oversized, "r+");
  try { await sparse.truncate(160 * 1024 * 1024 + 1); } finally { await sparse.close(); }
  const large = await service.get(oversized);
  assert.equal(large.path, null);
  assert.match(large.reason, /160 MiB/);
  const stereo = join(sourceDirectory, "multiview.exr");
  await writeFile(stereo, multiviewHeader());
  const multi = await service.get(stereo);
  assert.equal(multi.path, null);
  assert.match(multi.reason, /multiview/);
  const beyondAxis = join(sourceDirectory, "wide.exr");
  await writeFile(beyondAxis, image(8193, 1));
  assert.match((await service.get(beyondAxis)).reason, /8K/);
  const broken = join(sourceDirectory, "broken.hdr");
  await writeFile(broken, "broken");
  await assert.rejects(service.get(broken), /Invalid OpenEXR/);
  assert.equal((await service.get(source)).path, changed.path);
  console.log("PASS oversized, multiview and over-axis files have explicit fallbacks; malformed input does not poison the queue");

  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(service.get(source, cancelled.signal), { name: "AbortError" });
  const stalled = join(directory, "stalled");
  await mkdir(stalled);
  await bundle("src/main/shared-hdr-thumbnails.ts", join(stalled, "thumbnail.cjs"));
  await writeFile(join(stalled, "shared-facts-worker.js"), "setInterval(() => {}, 1000);\n");
  const SlowCache = require(join(stalled, "thumbnail.cjs")).SharedHdrThumbnailCache;
  const slow = new SlowCache(join(stalled, "cache"));
  const active = new AbortController();
  const pending = slow.get(source, active.signal);
  setTimeout(() => active.abort(), 50);
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(slow.get(source, AbortSignal.timeout(50)), { name: "TimeoutError" });
  const subscriber = new AbortController();
  const cancelledSubscriber = service.get(source, subscriber.signal);
  const survivingSubscriber = service.get(source);
  subscriber.abort();
  await assert.rejects(cancelledSubscriber, { name: "AbortError" });
  assert.ok((await survivingSubscriber).path);
  const simultaneous = await Promise.all([service.get(source), service.get(source)]);
  assert.equal(simultaneous[0].path, simultaneous[1].path);
  console.log("PASS already-aborted, active cancellation and timeout stop queued/worker requests");
  assert.ok((await readdir(cacheDirectory)).every(name => /^[a-f0-9]{64}\.png$/.test(name)));
} finally {
  await rm(directory, { recursive: true, force: true });
}
