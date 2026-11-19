import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, open, realpath, rm, rmdir, statfs } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SharedCopyReport } from "../shared/types";
import { isInside } from "./shared-library";

const MAX_MANIFEST = 24 * 1024 * 1024;
const MAX_DEPENDENCIES = 2048;

async function readManifest(path: string, binary = false): Promise<string> {
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
    throw new Error("This model references an absolute or remote dependency. Use relative project files to package it.");
  }
  const expected = fileURLToPath(url);
  if (!isInside(root, expected)) throw new Error("A model dependency is outside its shared root.");
  const actual = await realpath(expected).catch(() => null);
  const info = actual ? await lstat(actual).catch(() => null) : null;
  if (!actual || !info?.isFile()) throw new Error(`Missing model dependency: ${basename(expected)}`);
  if (relative(expected, actual) !== "") throw new Error("A linked model dependency cannot be copied safely.");
  return actual;
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

export async function listSharedModelPackage(root: string, primary: string): Promise<string[]> {
  if (!isInside(root, primary)) throw new Error("The shared model is outside its registered root.");
  const locator = relative(root, primary);
  const [canonicalRoot, canonicalPrimary] = await Promise.all([realpath(root), realpath(primary)]);
  if (relative(join(canonicalRoot, locator), canonicalPrimary) !== "") {
    throw new Error("A linked model cannot be copied safely.");
  }
  root = canonicalRoot;
  primary = canonicalPrimary;
  const files = new Set([primary]);
  async function add(author: string, reference: string, encoded = false): Promise<string | null> {
    const file = await dependency(root, author, reference, encoded);
    if (file) files.add(file);
    if (files.size > MAX_DEPENDENCIES) throw new Error("The model has too many dependencies for one package.");
    return file;
  }
  const extension = extname(primary).toLowerCase();
  if (extension === ".gltf" || extension === ".glb") {
    const manifest = JSON.parse(await readManifest(primary, extension === ".glb")) as {
      buffers?: Array<{ uri?: string }>;
      images?: Array<{ uri?: string }>;
    };
    for (const list of [manifest.buffers, manifest.images]) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) if (typeof entry?.uri === "string") await add(primary, entry.uri, true);
    }
  } else if (extension === ".obj") {
    const source = await readManifest(primary);
    const materials = new Set<string>();
    for (const match of source.matchAll(/^\s*mtllib[ \t]+([^\r\n]+)$/gim)) {
      const reference = match[1].trim();
      try {
        const file = await add(primary, reference);
        if (file) materials.add(file);
      } catch (error) {
        // Some exporters list several space-delimited libraries on one line.
        const names = reference.match(/"[^"]*"|[^\s]+/g) ?? [];
        if (names.length < 2 || !(error instanceof Error && error.message.startsWith("Missing model dependency:"))) throw error;
        for (const name of names) {
          const file = await add(primary, name);
          if (file) materials.add(file);
        }
      }
    }
    for (const material of materials) {
      const contents = await readManifest(material);
      for (const match of contents.matchAll(/^[ \t]*(?:map_\w+|bump|disp|decal|refl|norm)[ \t]+([^\r\n]+)$/gim)) {
        await add(material, mtlTexture(match[1]));
      }
    }
  } else {
    throw new Error("Dependency packaging supports glTF, GLB and OBJ.");
  }
  return [...files];
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
