import assert from "node:assert/strict";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "openbridge-model-facts-"));
try {
  const bundled = await build({
    stdin: { contents: 'export { inspectSharedModelFacts } from "./src/main/shared-model-facts";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "esm", write: false
  });
  const module = join(directory, "facts.mjs");
  await writeFile(module, bundled.outputFiles[0].text);
  const { inspectSharedModelFacts } = await import(pathToFileURL(module).href);
  const obj = join(directory, "Model.obj");
  await writeFile(obj, "mtllib materials.mtl\nv 0 0 0\nv 2 0 0\nv 2 3 0\nv 0 3 0\nvt 0 0\nvn 0 0 1\nusemtl Paint\nf -4/1/1 -3/1/1 -2/1/1 -1/1/1\n");
  const object = await inspectSharedModelFacts(obj);
  assert.equal(object.vertices, 4);
  assert.equal(object.triangles, 2);
  assert.equal(object.materials, 1);
  assert.equal(object.uvCoordinates, 1);
  assert.equal(object.normals, 1);
  assert.deepEqual(object.bounds, { min: [0, 0, 0], max: [2, 3, 0], space: "mesh-local", unit: "unknown" });
  assert.deepEqual(object.materialLibraries, ["materials.mtl"]);
  assert.equal(object.textureImages, null);
  console.log("PASS OBJ polygon, negative index, material and unitless bounds facts");

  await writeFile(obj, "v 0 0 0\nf 1 2 3\n");
  const invalid = await inspectSharedModelFacts(obj);
  assert.equal(invalid.status, "limited");
  assert.equal(invalid.triangles, null);
  assert.equal(invalid.bounds, null);
  const gltf = join(directory, "Model.gltf");
  const document = {
    asset: { version: "2.0" },
    buffers: [{ uri: "missing-on-purpose.bin", byteLength: 100 }],
    accessors: [{ type: "VEC3", count: 4, min: [-1, 0, 0], max: [1, 3, 2] }, { type: "SCALAR", count: 6 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0, translation: [100, 0, 0] }, { mesh: 0 }],
    images: [{ uri: "missing-on-purpose.png" }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 0 } }, normalTexture: { index: 0 }, alphaMode: "MASK" }]
  };
  await writeFile(gltf, JSON.stringify(document));
  const fact = await inspectSharedModelFacts(gltf);
  assert.equal(fact.vertices, 4);
  assert.equal(fact.triangles, 2);
  assert.equal(fact.textureImages, 1);
  assert.equal(fact.materials, 1);
  assert.deepEqual(fact.mapTypes, ["basecolor", "metalness", "roughness", "normal", "opacity"]);
  assert.deepEqual(fact.bounds, { min: [-1, 0, 0], max: [1, 3, 2], space: "mesh-local", unit: "metres" });
  assert.ok(fact.notes.some(note => note.includes("Scene transforms")));
  console.log("PASS glTF mesh-local facts preserve units and avoid instancing and transform guesses");

  const glb = join(directory, "Large.glb");
  const text = JSON.stringify(document);
  const chunk = Buffer.from(text.padEnd(Math.ceil(Buffer.byteLength(text) / 4) * 4, " "));
  const header = Buffer.alloc(20);
  const largeSize = 32 * 1024 * 1024;
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(largeSize, 8);
  header.writeUInt32LE(chunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const handle = await open(glb, "w");
  await handle.write(Buffer.concat([header, chunk]));
  await handle.truncate(largeSize);
  await handle.close();
  assert.equal((await inspectSharedModelFacts(glb)).triangles, 2);
  console.log("PASS GLB inspects the bounded JSON chunk without reading the large geometry payload");

  const large = await open(obj, "w");
  await large.truncate(25 * 1024 * 1024);
  await large.close();
  const limited = await inspectSharedModelFacts(obj);
  assert.equal(limited.status, "limited");
  assert.equal(limited.vertices, null);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(() => inspectSharedModelFacts(gltf, aborted.signal), { name: "AbortError" });
  assert.equal((await inspectSharedModelFacts(join(directory, "native.mb"))).status, "unsupported");
  console.log("PASS inspection limits, cancellation and unsupported native formats");
} finally {
  await rm(directory, { recursive: true, force: true });
}
