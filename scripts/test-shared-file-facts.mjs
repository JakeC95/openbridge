import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { encodeExrRgba } from "@bb-studio/exr";

const directory = await mkdtemp(join(tmpdir(), "openbridge-file-facts-"));
const require = createRequire(import.meta.url);
async function bundle(entry, outfile) {
  await build({ entryPoints: [entry], outfile, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
}
async function sparse(path, size) {
  const file = await open(path, "w");
  try { await file.truncate(size); } finally { await file.close(); }
}

try {
  await Promise.all([
    bundle("src/main/shared-file-facts.ts", join(directory, "facts.cjs")),
    bundle("src/main/shared-facts-worker.ts", join(directory, "shared-facts-worker.js")),
    bundle("src/main/library-index.ts", join(directory, "index.cjs")),
    bundle("src/main/shared-library.ts", join(directory, "shared.cjs")),
    bundle("src/main/hdr-decode.ts", join(directory, "decode.cjs")),
    bundle("src/main/hdr-decode-worker.ts", join(directory, "hdr-decode-worker.js"))
  ]);
  const { inspectSharedFileFacts, SHARED_FACTS_REVISION } = require(join(directory, "facts.cjs"));
  const path = join(directory, "Fixture_LOD3_v004.hdr");
  const header = "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n";
  await writeFile(path, Buffer.concat([Buffer.from(header), Buffer.from([128, 64, 32, 129, 64, 32, 16, 129])]));
  const metadata = await inspectSharedFileFacts(path);
  const source = await stat(path);
  assert.equal(metadata.revision, SHARED_FACTS_REVISION);
  assert.equal(metadata.bytes, source.size);
  assert.equal(metadata.mtimeMs, source.mtimeMs);
  assert.equal(metadata.lod, 3);
  assert.equal(metadata.version, "004");
  assert.equal(metadata.image.width, 2);
  assert.equal(metadata.image.projectionBasis, "aspect-ratio");
  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), metadata);
  console.log("PASS isolated worker returns serializable image facts, source identity and filename evidence");

  const { sharedHdrInfo } = require(join(directory, "shared.cjs"));
  assert.equal(sharedHdrInfo(metadata.image, metadata.bytes).previewAvailable, true);
  assert.equal(sharedHdrInfo({ ...metadata.image, projectionHint: "flat" }, metadata.bytes).panorama, false);
  assert.equal(sharedHdrInfo(metadata.image, 160 * 1024 * 1024 + 1).previewAvailable, false);
  assert.equal(sharedHdrInfo({ ...metadata.image, width: 8193 }, metadata.bytes).previewAvailable, false);
  assert.equal(sharedHdrInfo({ ...metadata.image, width: 8192, height: 8192 }, metadata.bytes).previewAvailable, false);
  for (const flag of ["tiled", "deep", "multipart"]) {
    assert.equal(sharedHdrInfo({ ...metadata.image, [flag]: true }, metadata.bytes).previewAvailable, false);
  }
  assert.equal(sharedHdrInfo({ ...metadata.image, views: ["left", "right"] }, metadata.bytes).previewAvailable, false);
  console.log("PASS persisted image facts enforce byte, axis, pixel, layout and multiview preview policy");

  const { LibraryIndex } = require(join(directory, "index.cjs"));
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const index = new LibraryIndex(join(directory, "library.sqlite"), logger);
  try {
    const asset = { id: "shared:test:fixture", provider: "shared", repo: "shared", path,
      name: "Fixture", type: "hdri", categories: [], tags: [], jsonPath: "", preview: null,
      thumb: null, mtime: source.mtimeMs, sizeBytes: source.size, previewRelativeSize: "", searchStr: "Fixture" };
    index.upsert(asset, source.mtimeMs, 0);
    index.saveSharedTechnical(asset.id, path, { resolution: 2, local: metadata });
    assert.deepEqual(index.getById(asset.id).technical.local, metadata);
    index.upsert(asset, source.mtimeMs, 0);
    assert.deepEqual(index.getById(asset.id).technical.local, metadata);
    index.upsert({ ...asset, sizeBytes: source.size + 1 }, source.mtimeMs, 0);
    assert.equal(index.getById(asset.id).technical?.local, undefined);
  } finally { index.close(); }
  console.log("PASS SQLite persists facts, retains unchanged scan facts and invalidates changed size");

  const obj = join(directory, "Fixture.obj");
  await writeFile(obj, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
  assert.equal((await inspectSharedFileFacts(obj)).model.triangles, 1);
  const broken = join(directory, "broken.exr");
  await writeFile(broken, "broken");
  await assert.rejects(inspectSharedFileFacts(broken), /Invalid OpenEXR/);
  await assert.rejects(inspectSharedFileFacts(join(directory, "missing.hdr")), /ENOENT/);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(inspectSharedFileFacts(path, aborted.signal), { name: "AbortError" });
  console.log("PASS model worker, malformed header, missing source and already-aborted calls");

  // Substitute only the worker in an isolated directory to deterministically exercise
  // cancellation and abnormal exit without a slow filesystem or a 45-second wait.
  const stalled = join(directory, "stalled");
  await mkdir(stalled);
  await bundle("src/main/shared-file-facts.ts", join(stalled, "facts.cjs"));
  await writeFile(join(stalled, "shared-facts-worker.js"), "setInterval(() => {}, 1000);\n");
  const slow = require(join(stalled, "facts.cjs"));
  const cancel = new AbortController();
  const pending = slow.inspectSharedFileFacts(path, cancel.signal);
  setTimeout(() => cancel.abort(), 100);
  await assert.rejects(pending, { name: "AbortError" });
  await assert.rejects(slow.inspectSharedFileFacts(path, AbortSignal.timeout(100)), { name: "TimeoutError" });
  await writeFile(join(stalled, "shared-facts-worker.js"), "process.exit(0);\n");
  await assert.rejects(slow.inspectSharedFileFacts(path), /ended before returning metadata/);
  console.log("PASS active cancellation, deadline cancellation and worker exit reject and terminate");

  const { decodeHdrFile } = require(join(directory, "decode.cjs"));
  const limits = { maxWidth: 8192, maxPixels: 8192 * 4096 };
  const decoded = await decodeHdrFile(path, limits, AbortSignal.timeout(10_000));
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 1);
  assert.equal(decoded.data.length, 8);
  const exrNamedHdr = join(directory, "misnamed.hdr");
  await writeFile(exrNamedHdr, encodeExrRgba({width:2,height:1,
    rgba:new Float32Array([1,0.5,0.25,1,0.25,0.5,1,1])},{precision:"half",includeAlpha:true}));
  const misnamedFacts=await inspectSharedFileFacts(exrNamedHdr);
  assert.equal(misnamedFacts.image.format,"exr");
  assert.match(misnamedFacts.notes[0],/filename contains OpenEXR/);
  const exrDecoded=await decodeHdrFile(exrNamedHdr,limits,AbortSignal.timeout(10_000));
  assert.equal(exrDecoded.width,2);
  assert.deepEqual([...exrDecoded.data.slice(0,4)],[15360,14336,13312,15360]);
  const hdrNamedExr=join(directory,"misnamed.exr");
  await writeFile(hdrNamedExr,Buffer.concat([Buffer.from(header),Buffer.from([128,64,32,129,64,32,16,129])]));
  assert.equal((await inspectSharedFileFacts(hdrNamedExr)).image.format,"hdr");
  assert.deepEqual((await decodeHdrFile(hdrNamedExr,limits,AbortSignal.timeout(10_000))).data,decoded.data);
  console.log("PASS mismatched HDR/EXR filenames retain actual encoding and decode correct half-float pixels");
  const huge = join(directory, "huge.hdr");
  await sparse(huge, 2 * 1024 * 1024 * 1024);
  await assert.rejects(decodeHdrFile(huge, limits, AbortSignal.timeout(10_000)), /160 MiB live preview limit/);
  await assert.rejects(decodeHdrFile(directory, limits, AbortSignal.timeout(10_000)), /regular file|EISDIR|EPERM|EACCES/);
  assert.equal((await decodeHdrFile(path, limits, AbortSignal.timeout(10_000))).width, 2);
  console.log("PASS HDR worker decodes valid source, rejects 2 GiB sparse input and directories, and recovers its queue");
} finally {
  await rm(directory, { recursive: true, force: true });
}
