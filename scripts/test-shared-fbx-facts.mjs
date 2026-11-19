import assert from "node:assert/strict";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "openbridge-fbx-facts-"));
const scalar = (type, value) => {
  if (type === "S") { const text = Buffer.from(value); const out = Buffer.alloc(5); out.write(type); out.writeUInt32LE(text.length, 1); return Buffer.concat([out, text]); }
  const out = Buffer.alloc(9); out.write(type);
  if (type === "D") out.writeDoubleLE(value, 1); else out.writeBigInt64LE(BigInt(value), 1);
  return out;
};
const array = (type, values, compressed = true, declaredLength = values.length) => {
  const data = Buffer.alloc(values.length * (type === "d" ? 8 : 4));
  values.forEach((value, i) => type === "d" ? data.writeDoubleLE(value, i * 8) : data.writeInt32LE(value, i * 4));
  const body = compressed ? deflateSync(data) : data;
  const header = Buffer.alloc(13); header.write(type); header.writeUInt32LE(declaredLength, 1); header.writeUInt32LE(compressed ? 1 : 0, 5); header.writeUInt32LE(body.length, 9);
  return Buffer.concat([header, body]);
};
const node = (name, properties = [], children = []) => ({ name, properties, children });
function fbx(version, roots) {
  const wide = version >= 7500, size = wide ? 25 : 13;
  function encode(item, offset) {
    const name = Buffer.from(item.name), properties = Buffer.concat(item.properties);
    let cursor = offset + size + name.length + properties.length;
    const children = item.children.map(child => { const out = encode(child, cursor); cursor += out.length; return out; });
    const tail = item.children.length ? Buffer.alloc(size) : Buffer.alloc(0);
    const header = Buffer.alloc(size);
    const write = (value, at) => wide ? header.writeBigUInt64LE(BigInt(value), at) : header.writeUInt32LE(value, at);
    write(cursor + tail.length, 0); write(item.properties.length, wide ? 8 : 4); write(properties.length, wide ? 16 : 8); header[size - 1] = name.length;
    return Buffer.concat([header, name, properties, ...children, tail]);
  }
  const header = Buffer.alloc(27); header.write("Kaydara FBX Binary  \0\x1a\0", "binary"); header.writeUInt32LE(version, 23);
  let cursor = 27;
  return Buffer.concat([header, ...roots.map(root => { const out = encode(root, cursor); cursor += out.length; return out; }), Buffer.alloc(size)]);
}
const fixture = (compressed = true) => [
  node("GlobalSettings", [], [node("Properties70", [], [node("P", [scalar("S", "UnitScaleFactor"), scalar("S", "double"), scalar("S", "Number"), scalar("S", ""), scalar("D", 100)])])]),
  node("Objects", [], [
    node("Geometry", [scalar("L", 1), scalar("S", "Geometry::Fixture"), scalar("S", "Mesh")], [
      node("Vertices", [array("d", [0, 0, 0, 2, 0, 0, 2, 3, 0, 0, 3, 0], compressed)]),
      node("PolygonVertexIndex", [array("i", [0, 1, 2, -4], compressed)]),
      node("LayerElementNormal", [], [node("Normals", [array("d", [0, 0, 1], compressed)])]),
      node("LayerElementUV", [], [node("UV", [array("d", [0, 0, 1, 0, 1, 1, 0, 1], compressed)])])
    ]),
    node("Material", [scalar("L", 2), scalar("S", "Material::Paint"), scalar("S", "")]),
    node("Video", [scalar("L", 3), scalar("S", "Video::Image"), scalar("S", "Clip")]),
    node("Geometry", [scalar("L", 4), scalar("S", "Geometry::Morph"), scalar("S", "Shape")])
  ])
];
try {
  const bundled = await build({ stdin: { contents: 'export { inspectSharedModelFacts } from "./src/main/shared-model-facts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false });
  const entry = join(directory, "facts.mjs"); await writeFile(entry, bundled.outputFiles[0].text);
  const { inspectSharedModelFacts: inspect } = await import(pathToFileURL(entry).href);
  const source = join(directory, "Fixture.fbx");
  for (const [version, compressed] of [[7400, false], [7400, true], [7500, false], [7500, true]]) {
    await writeFile(source, fbx(version, fixture(compressed)));
    const facts = await inspect(source);
    assert.equal(facts.status, "ready", facts.notes.join("\n"));
    assert.equal(facts.format, "fbx"); assert.equal(facts.vertices, 4); assert.equal(facts.triangles, 2);
    assert.equal(facts.geometryCount, 1); assert.equal(facts.materials, 1); assert.equal(facts.textureImages, 1);
    assert.equal(facts.normals, 1); assert.equal(facts.uvCoordinates, 4);
    assert.deepEqual(facts.bounds, { min: [0, 0, 0], max: [2, 3, 0], space: "mesh-local", unit: "unknown" });
    assert.deepEqual(facts.sourceUnits, { metresPerUnit: 1, basis: "FBX UnitScaleFactor" });
  }
  console.log("PASS binary FBX32/64-bit offsets, compressed/uncompressed geometry, source units and material records");
  const capped = fixture(); capped[1].children[0].children[0].properties = [array("d", [0], true, 3_000_000)];
  await writeFile(source, fbx(7500, capped));
  const limited = await inspect(source);
  assert.equal(limited.status, "limited"); assert.equal(limited.vertices, 1_000_000); assert.equal(limited.triangles, null);
  assert.equal(limited.bounds, null); assert.equal(limited.materials, 1); assert.equal(limited.geometryCount, 1);
  assert.match(limited.notes.join(" "), /budget/);
  console.log("PASS oversized declared geometry is rejected before decompression or allocation");
  const malicious = fixture(); malicious[1].children[0].children[0].properties = [array("d", Array(5000).fill(0), true, 3)];
  await writeFile(source, fbx(7400, malicious));
  assert.equal((await inspect(source)).status, "limited");
  const invalidFace = fixture(); invalidFace[1].children[0].children[1].properties = [array("i", [0, 1, -100])];
  await writeFile(source, fbx(7400, invalidFace));
  const invalid = await inspect(source); assert.equal(invalid.status, "limited"); assert.equal(invalid.triangles, null);
  console.log("PASS decompression output caps and out-of-range polygon indices preserve unknown counts");
  const sparse = fbx(7500, fixture());
  await writeFile(source, sparse); const file = await open(source, "r+"); try { await file.truncate(128 * 1024 * 1024); } finally { await file.close(); }
  assert.equal((await inspect(source)).triangles, 2);
  const broken = Buffer.from(sparse); broken.writeBigUInt64LE(0xffffffffffffffffn, 27); await writeFile(source, broken);
  assert.equal((await inspect(source)).status, "limited");
  await writeFile(source, "; FBX ASCII metadata fixture\nObjects: {}\n"); assert.equal((await inspect(source)).status, "limited");
  const abort = new AbortController(); abort.abort(); await assert.rejects(() => inspect(source, abort.signal), { name: "AbortError" });
  console.log("PASS sparse-file selective reads, corrupt offsets, ASCII limitation and cancellation");
} finally { await rm(directory, { recursive: true, force: true }); }
