import assert from "node:assert/strict";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const built = await build({
  stdin: { contents: "export { inspectSharedHdrFacts } from './src/main/shared-hdr-facts';", resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false
});
const directory = await mkdtemp(join(tmpdir(), "openbridge-hdr-facts-"));
const entry = join(directory, "facts.mjs");
await writeFile(entry, built.outputFiles[0].text);
const { inspectSharedHdrFacts } = await import(pathToFileURL(entry).href);

function int(value) { const body = Buffer.alloc(4); body.writeInt32LE(value); return body; }
function attribute(name, type, body) {
  return Buffer.concat([Buffer.from(name + "\0" + type + "\0"), int(body.length), body]);
}
function channel(name, type) {
  return Buffer.concat([Buffer.from(name + "\0"), int(type), Buffer.alloc(4), int(1), int(1)]);
}
function exr({ width = 16384, height = 8192, types = [1, 1, 1], flags = 2, views = [] } = {}) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(20000630); header.writeUInt32LE(flags, 4);
  return Buffer.concat([
    header,
    attribute("dataWindow", "box2i", Buffer.concat([int(17), int(-3), int(17 + width - 1), int(-3 + height - 1)])),
    attribute("channels", "chlist", Buffer.concat([
      ...types.map((type, index) => channel(["R", "G", "right.B"][index], type)), Buffer.from([0])
    ])),
    attribute("compression", "compression", Buffer.from([4])),
    ...(views.length ? [attribute("multiView", "stringvector",
      Buffer.concat(views.map(view => Buffer.concat([int(Buffer.byteLength(view)), Buffer.from(view)]))))] : []),
    Buffer.from([0])
  ]);
}

try {
  const large = join(directory, "oversized.exr");
  await writeFile(large, exr({ views: ["left", "right"] }));
  const sparse = await open(large, "r+");
  try { await sparse.truncate(2 * 1024 * 1024 * 1024); }
  finally { await sparse.close(); }
  const facts = await inspectSharedHdrFacts(large);
  assert.equal(facts.width, 16384);
  assert.equal(facts.height, 8192);
  assert.equal(facts.projectionHint, "equirectangular");
  assert.equal(facts.projectionBasis, "aspect-ratio");
  assert.equal(facts.bitDepth, 16);
  assert.equal(facts.compression, "PIZ");
  assert.deepEqual(facts.views, ["left", "right"]);
  assert.deepEqual(facts.channels.map(item => item.name), ["R", "G", "right.B"]);
  console.log("PASS oversized EXR facts use header bytes and retain channels, bit depth, compression and multiview metadata");

  const unsupported = join(directory, "unsupported.exr");
  await writeFile(unsupported, exr({ width: 1024, height: 1024, types: [0, 1, 2], flags: 2 | 0x200 | 0x800 | 0x1000 }));
  const mixed = await inspectSharedHdrFacts(unsupported);
  assert.equal(mixed.bitDepth, null);
  assert.equal(mixed.projectionHint, "flat");
  assert.ok(mixed.tiled && mixed.deep && mixed.multipart);
  assert.deepEqual(mixed.channels.map(item => item.type), ["uint", "half", "float"]);
  console.log("PASS unsupported EXR preview modes remain inspectable and mixed channel precision stays explicit");

  const radiance = join(directory, "sky.hdr");
  await writeFile(radiance, "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 512 +X 1024\n");
  const sky = await inspectSharedHdrFacts(radiance);
  assert.equal(sky.format, "hdr");
  assert.equal(sky.width, 1024);
  assert.equal(sky.height, 512);
  assert.equal(sky.bitDepth, null);
  assert.equal(sky.channels[3].name, "Exponent");
  console.log("PASS Radiance RGBE is described as shared-exponent data without invented 8-bit RGB precision");

  const broken = join(directory, "broken.exr");
  await writeFile(broken, exr().subarray(0, 43));
  await assert.rejects(() => inspectSharedHdrFacts(broken), /header|limit|Invalid/);
  await writeFile(broken, Buffer.from([1, 2, 3]));
  await assert.rejects(() => inspectSharedHdrFacts(broken), /Invalid OpenEXR/);
  const endless = Buffer.alloc(1024 * 1024 + 5, 65);
  endless.writeUInt32LE(20000630); endless.writeUInt32LE(2, 4);
  await writeFile(broken, endless);
  await assert.rejects(() => inspectSharedHdrFacts(broken), /header/);
  console.log("PASS invalid and over-budget headers fail without reading image payloads");
} finally {
  await rm(directory, { recursive: true, force: true });
}
