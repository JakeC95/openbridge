import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, open, opendir, realpath, rm, rmdir, statfs } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SharedCopyReport } from "../shared/types";
import { isInside } from "./shared-library";
import type { ModelMapType } from "../shared/model-preview";

const MAX_MANIFEST = 24 * 1024 * 1024;
const MAX_DEPENDENCIES = 2048;

class MissingDependencyError extends Error {}
class UnsafeDependencyError extends Error {}

export interface SharedModelDependencies {
  files: string[];
  notes: string[];
  maps: Array<{ path: string; type: ModelMapType; material: string; role: string }>;
  complete: boolean;
  textureAliases: Array<[string, string]>;
}

async function readManifest(path: string, binary = false, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const file = await open(path);
  try {
    const info = await file.stat();
    let offset = 0;
    let length = info.size;
    if (binary) {
      const header = Buffer.alloc(20);
      const read = await file.read(header, 0, header.length, 0);
      if (read.bytesRead !== header.length || header.readUInt32LE(0) !== 0x46546c67 ||
          header.readUInt32LE(4) !== 2 || header.readUInt32LE(16) !== 0x4e4f534a) {
        throw new Error("The GLB does not have a valid glTF 2 JSON chunk.");
      }
      offset = header.length;
      length = header.readUInt32LE(12);
    }
    if (length > MAX_MANIFEST || offset + length > info.size) throw new Error("The model dependency manifest exceeds the inspection limit.");
    const body = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      signal?.throwIfAborted();
      const result = await file.read(body, read, length - read, offset + read);
      if (!result.bytesRead) throw new Error("The model changed during dependency inspection.");
      read += result.bytesRead;
    }
    return body.toString("utf8").replace(/^\uFEFF/, "");
  } finally { await file.close(); }
}

async function dependency(root: string, author: string, reference: string, encoded: boolean): Promise<string | null> {
  const clean = reference.trim().replace(/^"(.*)"$/, "$1");
  if (encoded && clean.startsWith("data:")) return null;
  const literal = clean.replace(/\\/g, "/");
  // Bare model paths use literal characters, including spaces and #. glTF uses URI syntax.
  const ref = encoded ? literal : literal.split("/").map(encodeURIComponent).join("/");
  const url = new URL(ref, pathToFileURL(author));
  if (url.protocol !== "file:" || url.search || url.hash || literal.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(literal)) {
    throw new UnsafeDependencyError("This model references an absolute or remote dependency. Use relative project files to package it.");
  }
  const expected = fileURLToPath(url);
  if (!isInside(root, expected)) throw new UnsafeDependencyError("A model dependency is outside its shared root.");
  const actual = await realpath(expected).catch(() => null);
  if (actual && relative(expected, actual) !== "") throw new UnsafeDependencyError("A linked model dependency cannot be copied safely.");
  const info = actual ? await lstat(actual).catch(() => null) : null;
  if (!actual || !info?.isFile()) throw new MissingDependencyError(`Missing model dependency: ${basename(expected)}`);
  return actual;
}

/** Older binary FBX exports can have a matching OBJ export in the same collection. */
export async function legacyFbxCompanion(root: string, primary: string, signal?: AbortSignal): Promise<{ legacy: boolean; path: string | null }> {
  const unsupported = { legacy: true, path: null };
  if (!/\.fbx$/i.test(primary)) return { legacy: false, path: null };
  signal?.throwIfAborted();
  const file = await open(primary);
  const header = Buffer.alloc(27);
  try { await file.read(header, 0, header.length, 0); }
  finally { await file.close(); }
  if (header.subarray(0, 23).toString("binary") !== "Kaydara FBX Binary  \0\x1a\0" ||
      header.readUInt32LE(23) >= 7000) return { legacy: false, path: null };
  const folder = dirname(primary);
  const parent = dirname(folder);
  if (basename(folder).toLowerCase() !== "fbx" || !isInside(root, parent)) return unsupported;
  try {
    let objFolder: string | undefined;
    let inspected = 0;
    for await (const entry of await opendir(parent)) {
      signal?.throwIfAborted();
      if (++inspected > 4096) return unsupported;
      if (!entry.isDirectory() || entry.name.toLowerCase() !== "obj") continue;
      if (objFolder) return unsupported;
      objFolder = join(parent, entry.name);
    }
    if (!objFolder || relative(objFolder, await realpath(objFolder)) !== "") return unsupported;
    const stem = basename(primary, extname(primary)).toLowerCase();
    let match: string | null = null;
    inspected = 0;
    for await (const entry of await opendir(objFolder)) {
      signal?.throwIfAborted();
      if (++inspected > 4096) return unsupported;
      if (!entry.isFile() || ![stem + ".obj", stem + "_scanline.obj"].includes(entry.name.toLowerCase())) continue;
      if (match) return unsupported;
      match = join(objFolder, entry.name);
    }
    if (match && relative(match, await realpath(match)) === "") {
      const info = await lstat(match);
      if (info.isFile() && info.size > 0 && info.size <= 96 * 1024 * 1024) return { legacy: true, path: match };
    }
  } catch {
    signal?.throwIfAborted();
  }
  return unsupported;
}

// Some OBJ collections place meshes in OBJ/ and their authored maps in a
// sibling TEXTURES/ folder. Resolve a bare reference only inside that package.
async function siblingObjTextures(root: string, primary: string, signal?: AbortSignal): Promise<Map<string, string | null>> {
  const folder = dirname(primary);
  const matches = new Map<string, string | null>();
  if (basename(folder).toLowerCase() !== "obj") return matches;
  const parent = dirname(folder);
  if (!isInside(root, parent)) return matches;
  try {
    let textureFolder: string | undefined;
    let inspected = 0;
    for await (const entry of await opendir(parent)) {
      signal?.throwIfAborted();
      if (++inspected > 4096) return new Map();
      if (!entry.isDirectory() || entry.name.toLowerCase() !== "textures") continue;
      if (textureFolder) return new Map();
      textureFolder = join(parent, entry.name);
    }
    if (!textureFolder || relative(textureFolder, await realpath(textureFolder)) !== "") return matches;
    inspected = 0;
    for await (const entry of await opendir(textureFolder)) {
      signal?.throwIfAborted();
      if (++inspected > 4096) return new Map();
      if (!entry.isFile() || !/\.(png|jpe?g|webp|tga|exr)$/i.test(entry.name)) continue;
      const key = entry.name.toLowerCase();
      matches.set(key, matches.has(key) ? null : join(textureFolder, entry.name));
    }
    return matches;
  } catch {
    signal?.throwIfAborted();
    return new Map();
  }
}

function mtlTexture(value: string): string {
  // Standard MTL switches precede the filename. A quoted filename can contain spaces.
  const words = value.match(/"[^"]*"|[^\s]+/g) ?? [];
  const one = new Set(["-blendu", "-blendv", "-boost", "-bm", "-cc", "-clamp", "-imfchan", "-texres", "-type", "-colorspace"]);
  while (words[0]?.startsWith("-")) {
    const option = words.shift()!.toLowerCase();
    if (one.has(option)) words.shift();
    else if (option === "-mm") words.splice(0, 2);
    else if (["-o", "-s", "-t"].includes(option)) {
      for (let i = 0; i < 3 && words[0] && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(words[0]); i++) words.shift();
    } else throw new Error(`Unsupported MTL texture option: ${option}`);
  }
  if (!words.length) throw new Error("An MTL texture reference has no filename.");
  return words.join(" ");
}

async function listSharedDependencies(root: string, primary: string, tolerateMissing: boolean, signal?: AbortSignal): Promise<SharedModelDependencies> {
  if (!isInside(root, primary)) throw new Error("The shared model is outside its registered root.");
  signal?.throwIfAborted();
  const locator = relative(root, primary);
  const [canonicalRoot, canonicalPrimary] = await Promise.all([realpath(root), realpath(primary)]);
  if (relative(join(canonicalRoot, locator), canonicalPrimary) !== "") {
    throw new Error("A linked model cannot be copied safely.");
  }
  root = canonicalRoot;
  primary = canonicalPrimary;
  const files = new Set([primary]);
  const notes = new Set<string>();
  const maps: SharedModelDependencies["maps"] = [];
  const textureAliases: SharedModelDependencies["textureAliases"] = [];
  let complete = true;
  const addMap = (path: string | null | undefined, type: ModelMapType, material: string, role = type as string) => {
    if (path && !maps.some(map => map.path === path && map.type === type && map.material === material)) {
      if (maps.length >= MAX_DEPENDENCIES) throw new Error("The model has too many material map assignments.");
      maps.push({ path, type, material, role });
    }
  };
  let references = 0;
  async function add(author: string, reference: string, encoded = false): Promise<string | null> {
    signal?.throwIfAborted();
    if (++references > MAX_DEPENDENCIES) throw new Error("The model has too many dependencies for one package.");
    const file = await dependency(root, author, reference, encoded);
    if (file) files.add(file);
    if (files.size > MAX_DEPENDENCIES) throw new Error("The model has too many dependencies for one package.");
    return file;
  }
  function missing(error: unknown): boolean {
    if (!tolerateMissing || !(error instanceof MissingDependencyError || error instanceof UnsafeDependencyError)) return false;
    complete = false;
    notes.add(`${error.message}. The available model resources remain usable in preview.`);
    return true;
  }
  async function addAvailable(author: string, reference: string, encoded = false): Promise<string | null> {
    try { return await add(author, reference, encoded); }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  const extension = extname(primary).toLowerCase();
  if (extension === ".gltf" || extension === ".glb") {
    const manifest = JSON.parse(await readManifest(primary, extension === ".glb", signal)) as {
      buffers?: Array<{ uri?: string }>;
      images?: Array<{ uri?: string }>;
      textures?: Array<{ source?: number }>;
      materials?: Array<Record<string, unknown>>;
    };
    const imageFiles = new Map<number, string>();
    for (const list of [manifest.buffers, manifest.images]) {
      if (!Array.isArray(list)) continue;
      if (list.length > MAX_DEPENDENCIES) throw new Error("The model has too many resource references.");
      for (const [index, entry] of list.entries()) if (typeof entry?.uri === "string") {
        const path = await addAvailable(primary, entry.uri, true);
        if (path && list === manifest.images) imageFiles.set(index, path);
      }
    }
    if (Array.isArray(manifest.materials)) {
      if (manifest.materials.length > MAX_DEPENDENCIES || (manifest.textures?.length ?? 0) > MAX_DEPENDENCIES) throw new Error("The model has too many materials or textures.");
      for (const [index, value] of manifest.materials.entries()) {
        if (!value || typeof value !== "object") continue;
        const material = typeof value.name === "string" ? value.name : `Material ${index + 1}`;
        const pbr = value.pbrMetallicRoughness as Record<string, unknown> | undefined;
        const bind = (info: unknown, type: ModelMapType) => {
          const index = (info as { index?: number } | undefined)?.index;
          if (!Number.isSafeInteger(index) || !Array.isArray(manifest.textures)) return;
          const image = manifest.textures[index!]?.source;
          if (Number.isSafeInteger(image)) addMap(imageFiles.get(image!), type, material);
        };
        bind(pbr?.baseColorTexture, "basecolor");
        bind(pbr?.metallicRoughnessTexture, "metalness");
        bind(pbr?.metallicRoughnessTexture, "roughness");
        bind(value.normalTexture, "normal");
        bind(value.occlusionTexture, "ao");
        bind(value.emissiveTexture, "emissive");
        if (["MASK", "BLEND"].includes(String(value.alphaMode))) bind(pbr?.baseColorTexture, "opacity");
      }
    }
  } else if (extension === ".obj") {
    const source = await readManifest(primary, false, signal);
    const materials = new Set<string>();
    for (const match of source.matchAll(/^\s*mtllib[ \t]+([^\r\n]+)$/gim)) {
      const reference = match[1].trim();
      try {
        const file = await add(primary, reference);
        if (file) materials.add(file);
      } catch (error) {
        // Some exporters list several space-delimited libraries on one line.
        const names = reference.match(/"[^"]*"|[^\s]+/g) ?? [];
        if (error instanceof UnsafeDependencyError && missing(error)) continue;
        if (!(error instanceof MissingDependencyError)) throw error;
        if (names.length < 2) {
          if (missing(error)) continue;
          throw error;
        }
        for (const name of names) {
          const file = await addAvailable(primary, name);
          if (file) materials.add(file);
        }
      }
    }
    let siblingTextures: Map<string, string | null> | undefined;
    for (const material of materials) {
      const contents = await readManifest(material, false, signal);
      let materialName = basename(material);
      const types: Record<string, ModelMapType> = { map_kd: "basecolor", map_ka: "unknown", map_ks: "specular", map_ns: "gloss", map_d: "opacity", map_ke: "emissive", map_pr: "roughness", map_pm: "metalness", map_bump: "displacement", bump: "displacement", norm: "normal", disp: "displacement" };
      for (const match of contents.matchAll(/^[ \t]*(newmtl|map_\w+|bump|disp|decal|refl|norm)[ \t]+([^\r\n]+)$/gim)) {
        const key = match[1].toLowerCase();
        if (key === "newmtl") { materialName = match[2].trim(); continue; }
        const reference = mtlTexture(match[2]).replace(/^"(.*)"$/, "$1");
        let path: string | null;
        try {
          path = await add(material, reference);
        } catch (error) {
          path = null;
          if (tolerateMissing && error instanceof MissingDependencyError &&
              !/[/\\:#?%]/.test(reference)) {
            siblingTextures ??= await siblingObjTextures(root, primary, signal);
            const candidate = siblingTextures.get(reference.toLowerCase());
            if (candidate && relative(candidate, await realpath(candidate).catch(() => root)) === "" &&
                (await lstat(candidate).catch(() => null))?.isFile()) {
              path = candidate;
              files.add(candidate);
              textureAliases.push([new URL(reference, pathToFileURL(material)).href, pathToFileURL(candidate).href]);
              complete = false;
              notes.add("Preview resolved authored texture filenames in the package’s sibling textures folder. Package copy still requires the authored paths.");
            }
          }
          if (!path && !missing(error)) throw error;
        }
        addMap(path, types[key] ?? "unknown", materialName, match[1]);
      }
    }
  } else {
    throw new Error("Dependency packaging supports glTF, GLB and OBJ.");
  }
  return { files: [...files], notes: [...notes], maps, complete, textureAliases };
}

/** Preview omits and reports missing/unsafe references; only validated resources are returned. */
export function inspectSharedModelDependencies(root: string, primary: string, signal?: AbortSignal): Promise<SharedModelDependencies> {
  return listSharedDependencies(root, primary, true, signal);
}

/** Copying requires a complete, self-contained dependency set. */
export async function listSharedModelPackage(root: string, primary: string): Promise<string[]> {
  return (await listSharedDependencies(root, primary, false)).files;
}

export async function copySharedModelPackage(root: string, primary: string, destination: string): Promise<{ folder: string; files: number }> {
  const files = await listSharedModelPackage(root, primary);
  primary = files[0];
  let required = 0n;
  for (const path of files) required += (await lstat(path, { bigint: true })).size;
  const disk = await statfs(destination, { bigint: true }).catch(() => null);
  if (disk && required > disk.bavail * disk.bsize) throw new Error("There is not enough free space for this model package.");
  let base = dirname(primary);
  while (files.some(file => !isInside(base, file))) base = dirname(base);
  // Use a fresh directory, preserving the layout that each dependency references.
  const stem = (basename(primary, extname(primary)).replace(/[^\p{L}\p{N}_ -]/gu, "_").slice(0, 60) || "Model");
  const folder = await mkdtemp(join(destination, `${stem}-`));
  try {
    for (const source of files) {
      const target = join(folder, relative(base, source));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target, constants.COPYFILE_EXCL);
    }
    return { folder, files: files.length };
  } catch (error) {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function copySharedSelection(
  destination: string,
  assets: Array<{ id: string; name: string }>,
  resolveAsset: (id: string) => Promise<{ root: string; path: string }>,
  signal: AbortSignal,
  progress: (completed: number) => void
): Promise<SharedCopyReport> {
  const failures: SharedCopyReport["failures"] = [];
  if (signal.aborted) return { folder: null, copied: 0, cancelled: true, failures };
  const folder = await mkdtemp(join(destination, "OpenBridge assets-"));
  let copied = 0;
  let completed = 0;
  try {
    for (const asset of assets) {
      if (signal.aborted) break;
      try {
        const { root, path } = await resolveAsset(asset.id);
        if (/\.(gltf|glb|obj)$/i.test(path)) {
          await copySharedModelPackage(root, path, folder);
        } else {
          const individual = await mkdtemp(join(folder, "Asset-"));
          try {
            await copyFile(path, join(individual, basename(path)), constants.COPYFILE_EXCL);
          } catch (error) {
            await rm(individual, { recursive: true, force: true }).catch(() => {});
            throw error;
          }
        }
        copied++;
      } catch (error) {
        failures.push({ name: asset.name, message: error instanceof Error ? error.message : String(error) });
      }
      progress(++completed);
    }
    return { folder: copied > 0 ? folder : null, copied, cancelled: signal.aborted && completed < assets.length, failures };
  } finally {
    if (copied === 0) await rmdir(folder).catch(() => {});
  }
}
