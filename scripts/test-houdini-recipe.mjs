import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const output = await build({
  entryPoints: ["src/main/houdini-send.ts"], bundle: true, format: "esm",
  platform: "node", write: false, external: ["electron"]
});
const { houdiniRecipe } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const temp = await mkdtemp(join(tmpdir(), "openbridge-handoff-"));
try {
  const library = join(temp, "library");
  await mkdir(library);
  const index = join(library, "preview.glb");
  const source = join(library, "source.obj");
  const map = join(library, "color.png");
  await Promise.all([index, source, map].map(path => writeFile(path, "fixture")));
  await assert.rejects(houdiniRecipe(index, [library]), /no verified Houdini/);
  const input = {
    schemaVersion: 1, geometry: "source.obj", metersPerUnit: 0.01, upAxis: "Y",
    materials: [{ group: "", maps: { base_color: { path: "color.png", colorSpace: "sRGB" } } }]
  };
  async function save() { await writeFile(`${index}.houdini.json`, JSON.stringify(input)); }
  await save();
  assert.deepEqual(await houdiniRecipe(index, [library]), {
    geometry: source, metersPerUnit: 0.01,
    materials: [{ group: "", maps: { base_color: { path: map, colorSpace: "sRGB" } } }]
  });
  input.geometry = "preview.glb";
  await save();
  await assert.rejects(houdiniRecipe(index, [library]), /explicit OBJ/);
  input.geometry = "source.obj";
  input.materials[0].maps.base_color.path = "missing.png";
  await save();
  await assert.rejects(houdiniRecipe(index, [library]), /missing.png/);
  if (process.platform === "linux") {
    const outside = join(temp, "outside.png");
    await writeFile(outside, "fixture");
    await symlink(outside, join(library, "external.png"));
    input.materials[0].maps.base_color.path = "external.png";
    await save();
    await assert.rejects(houdiniRecipe(index, [library]), /registered library/);
  }
  console.log("Houdini recipe resolves explicit source files and rejects missing or out-of-root dependencies.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
