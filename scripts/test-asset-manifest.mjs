import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { assetFixture } from "./fixtures/asset-manifest.mjs";

const output = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
  export { parseAssetManifest } from './src/shared/asset-manifest';
  export { compileHoudiniArnold, selectAssetHandoff } from './src/main/asset-handoff';
  export { houdiniRecipe } from './src/main/houdini-send';
` }, bundle: true, platform: "node", format: "esm", write: false, external: ["electron"] });
const { parseAssetManifest, compileHoudiniArnold, selectAssetHandoff, houdiniRecipe } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const root = await mkdtemp(join(tmpdir(), "openbridge-asset-manifest-"));
const roots = [{ id: "source", name: "Source", kind: "models", path: root }];
try {
  const data = assetFixture("source");
  const abc = join(root, "Source.abc");
  const color = join(root, "Source Color.png");
  await Promise.all([abc, color].map(p => writeFile(p, "fixture")));
  const info = await stat(abc);
  data.files[0].fingerprint = { bytes: info.size, mtimeMs: Math.trunc(info.mtimeMs) };
  const asset = parseAssetManifest(data);
  const arnold = await compileHoudiniArnold(asset, roots);
  assert.equal(arnold.geometry, abc);
  assert.equal(arnold.bindingAttribute, "shop_materialpath");
  assert.deepEqual(arnold.materials[0].maps.base_color, { path: color, fileColorSpace: "srgb" });
  assert.equal(selectAssetHandoff(asset, "maya").representation.file, "rig");
  assert.equal(asset.materials[0].native.parameters.coat, 0.7);
  assert.equal(asset.textures[1].source.tiles.length, 2);
  assert.throws(() => selectAssetHandoff(asset, "houdini", "arnold", "alternate"), /Unverified variant scale/);
  const mutate = fn => { const clone = structuredClone(data); fn(clone); return clone; };
  assert.throws(() => parseAssetManifest(mutate(d => d.files[0].path = "../outside.abc")), /library-root-relative/);
  assert.throws(() => parseAssetManifest(mutate(d => d.representations[0].file = "preview")), /preview/i);
  assert.throws(() => parseAssetManifest(mutate(d => d.bindingSets[0].assignments[0].material = "not-there")), /Unresolved assigned material/);
  assert.throws(() => parseAssetManifest(mutate(d => d.handoffs[0].evidence = [])), /verification evidence/);
  for (const [change, expected] of [
    [d => d.materials[0].portable.inputs[0].texture = "tile-data", /cannot preserve/],
    [d => d.materials[0].portable.inputs[0].component = "g", /cannot preserve/],
    [d => d.evidence[0].status = "inferred", /verification evidence/],
    [d => d.materials[0].portable.parameters.coat = 0.4, /cannot preserve/],
    [d => d.representations[0].selection = { kind: "objects", paths: ["/Body"] }, /object selections/]
  ]) await assert.rejects(async () => compileHoudiniArnold(parseAssetManifest(mutate(change)), roots), expected);
  await writeFile(join(root, "asset.json"), JSON.stringify(data));
  assert.deepEqual(await houdiniRecipe(join(root, "Prepared prop.glb"), roots), arnold);
  await writeFile(abc, "changed length");
  await assert.rejects(compileHoudiniArnold(asset, roots), /Source changed since ingest/);
  console.log("Canonical manifest preserves native and portable facts, separates variants, and validates Houdini source/OCIO input.");
} finally { await rm(root, { recursive: true, force: true }); }
