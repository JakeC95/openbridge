import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "openbridge-lookdev-"));
try {
  const root = join(directory, "asset");
  const publish = join(root, "texture", "v002");
  const latest = join(root, "texture", "latest");
  await mkdir(publish, { recursive: true });
  await symlink(publish, latest, process.platform === "win32" ? "junction" : "dir");
  const scene = join(root, "lookdev.hip");
  const model = join(root, "geometry.abc");
  const tile = join(publish, "DIF_1001.exr");
  const digest = value => createHash("sha256").update(value).digest("hex");
  function parameters(geometry, texture) {
    return `fileName\t[ 0\tlocks=0 ]\t(\t${geometry}\t)\nfilename\t[ 0\tlocks=0 ]\t(\t${texture}\t)\n`;
  }
  await writeFile(scene, parameters(model, join(latest, "DIF_<UDIM>.exr")));
  await writeFile(model, "geometry");
  await writeFile(tile, "tile");
  const metadata = join(root, "shader_assignments.json");
  await writeFile(metadata, JSON.stringify({ schema: "maya_texture_pipeline.shader_assignments",
    model: { abc_size_bytes: 8, abc_sha256: digest("geometry") } }));
  await writeFile(join(publish, "texture_manifest.json"), JSON.stringify({ map_tag: "DIF", version: "v002",
    file_records: [{ name: "DIF_1001.exr", size_bytes: 4, sha256: digest("tile") }] }));
  const run = () => spawnSync(process.execPath, ["scripts/study-houdini-preview.mjs", root, scene], { encoding: "utf8" });
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  const recipe = JSON.parse(valid.stdout);
  assert.equal(recipe.modelManifestVerified, true);
  assert.equal(recipe.textures[0].manifestVerified, true);
  assert.equal(recipe.textures[0].version, "v002");
  assert.equal(recipe.textures[0].files[0].tile, 1001);
  assert.match(recipe.textures[0].files[0].path, /v002[\\/]DIF_1001\.exr$/);

  await writeFile(tile, "evil");
  assert.match(run().stderr, /does not match its texture manifest/);
  await writeFile(tile, "tile");
  await writeFile(model, "modified");
  assert.match(run().stderr, /does not match its shader-assignment manifest/);
  await writeFile(model, "geometry");

  const outside = join(directory, "other");
  await mkdir(outside);
  const linked = join(root, "other");
  await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
  await writeFile(scene, parameters(model, join(linked, "DIF_<UDIM>.exr")));
  assert.match(run().stderr, /resolved outside the asset root/);
  console.log("PASS saved lookdev references resolve a pinned publish, verify digests and reject escaped dependencies");
} finally {
  await rm(directory, { recursive: true, force: true });
}
