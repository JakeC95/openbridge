import { open, opendir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

const MAX_SCENE_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_TEXTURE_BYTES = 128 * 1024 * 1024;
const TILE_PATTERN = /<UDIM>/i;
const inside = (root, path) => {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
};

async function readBounded(path, maximum) {
  const handle = await open(path);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw new Error("Input is not a bounded regular file.");
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("Input changed during inspection.");
      offset += bytesRead;
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}

async function inspect(assetRoot, scenePath) {
  const root = await realpath(assetRoot);
  const scene = await realpath(scenePath);
  if (!inside(root, scene)) throw new Error("The saved scene must be within the asset root.");
  const text = (await readBounded(scene, MAX_SCENE_BYTES)).toString("utf8");
  const geometry = new Set();
  const patterns = new Set();
  for (const match of text.matchAll(/(?:^|\n)(?:fileName|filename)\t\[[^\r\n\]]{1,96}\]\t\(\t([^\r\n\0\t]{1,4096})\t\)/g)) {
    const value = match[1].trim().replace(/^"(.*)"$/, "$1");
    if (!isAbsolute(value) || !inside(root, value) || value.includes("$")) continue;
    if (/\.abc$/i.test(value)) geometry.add(value);
    else if (TILE_PATTERN.test(basename(value)) && /\.(exr|png|jpe?g)$/i.test(value)) patterns.add(value);
  }
  if (geometry.size !== 1 || !patterns.size || patterns.size > 32) {
    throw new Error("The readable parameters do not identify a unique Alembic and explicit UDIM textures. Review this scene manually.");
  }
  const model = await realpath([...geometry][0]);
  const modelInfo = await stat(model);
  if (!inside(root, model) || !modelInfo.isFile() || modelInfo.size > MAX_TEXTURE_BYTES) {
    throw new Error("The geometry publish must be a bounded file within the asset root.");
  }
  const modelSha256 = await sha256(model);
  const modelManifestPath = await realpath(join(dirname(model), "shader_assignments.json")).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  let modelManifestVerified = false;
  if (modelManifestPath) {
    if (!inside(dirname(model), modelManifestPath)) throw new Error("The model manifest resolved outside its publish.");
    const assignments = JSON.parse(await readBounded(modelManifestPath, MAX_MANIFEST_BYTES));
    if (assignments.schema === "maya_texture_pipeline.shader_assignments" && assignments.model?.abc_sha256) {
      if (assignments.model.abc_size_bytes !== modelInfo.size || assignments.model.abc_sha256 !== modelSha256) {
        throw new Error("The geometry does not match its shader-assignment manifest.");
      }
      modelManifestVerified = true;
    }
  }
  const textures = [];
  for (const pattern of [...patterns].sort()) {
    const published = await realpath(dirname(pattern));
    if (!inside(root, published)) throw new Error("A texture publish resolved outside the asset root.");
    const name = basename(pattern);
    const [prefix, suffix] = name.split(TILE_PATTERN);
    const matches = [];
    let entries = 0;
    for await (const entry of await opendir(published)) {
      if (++entries > 2048) throw new Error("The texture publish exceeds the directory scan budget.");
      if (entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix) &&
          /^1\d{3}$/.test(entry.name.slice(prefix.length, entry.name.length - suffix.length))) matches.push(entry);
    }
    if (!matches.length || matches.length > 100) throw new Error("A texture pattern does not identify a bounded tile set.");
    const manifestPath = await realpath(join(published, "texture_manifest.json")).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (manifestPath && !inside(published, manifestPath)) throw new Error("A texture manifest resolved outside its publish.");
    const manifest = manifestPath ? JSON.parse(await readBounded(manifestPath, MAX_MANIFEST_BYTES)) : null;
    const files = [];
    for (const entry of matches.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = await realpath(join(published, entry.name));
      const info = await stat(path);
      if (!inside(published, path) || !info.isFile() || info.size > MAX_TEXTURE_BYTES) {
        throw new Error("A UDIM tile is not a bounded file in its publish.");
      }
      const record = manifest?.file_records?.find(item => item.name === entry.name);
      const hash = typeof record?.sha256 === "string" && /^[0-9a-f]{64}$/i.test(record.sha256) ? await sha256(path) : null;
      if (manifest && (!record || !hash || info.size !== record.size_bytes || hash !== record.sha256.toLowerCase())) {
        throw new Error("A published tile does not match its texture manifest.");
      }
      files.push({ tile: Number(entry.name.slice(prefix.length, prefix.length + 4)), path,
        bytes: info.size, ...(hash && { sha256: hash }) });
    }
    textures.push({ pattern, published, mapTag: manifest?.map_tag ?? null, version: manifest?.version ?? null,
      manifestVerified: Boolean(manifest), files });
  }
  return { root, scene, model, modelSha256, modelManifestVerified, textures };
}

const [root, scene] = process.argv.slice(2);
if (!root || !scene) {
  console.error("Usage: node scripts/study-houdini-preview.mjs ASSET_ROOT SAVED_HIP > recipe.json");
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(await inspect(root, scene), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
