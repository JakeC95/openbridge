import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssetRecord, SharedLibraryRoot, SharedLibraryStatus } from "../shared/types";
import { modelFormatFromExtension } from "../shared/model-preview";
import { checkHdrDimensions, hdrLimitsFor, PUBLIC_PREVIEW_MAX_BYTES } from "./public/preview-data";

const BATCH_SIZE = 128;
const SKIP_FOLDERS = new Set(["archive", "archives", "cache", "caches", "temp", "tmp", "node_modules"]);
const HDR_EXTENSIONS = new Set([".hdr", ".exr"]);
const RENDER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export function isInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function normalizeSharedRoots(input: unknown): SharedLibraryRoot[] {
  if (!Array.isArray(input)) return [];
  const roots: SharedLibraryRoot[] = [];
  for (const value of input.slice(0, 16)) {
    if (!value || typeof value !== "object") continue;
    const { id, name, kind } = value as SharedLibraryRoot;
    const path = typeof value.path === "string" ? value.path.trim() : "";
    if (typeof id !== "string" || !/^[a-z0-9-]{1,64}$/i.test(id) || typeof name !== "string" ||
        !name.trim() || !isAbsolute(path) || !["models", "hdris"].includes(kind)) continue;
    const target = resolve(path);
    if (roots.some(root => root.id === id || root.name.toLowerCase() === name.trim().slice(0, 80).toLowerCase() || isInside(root.path, target) || isInside(target, root.path))) continue;
    roots.push({ id, name: name.trim().slice(0, 80), path: target, kind });
  }
  return roots;
}

export function sharedRootId(assetId: string): string {
  return /^shared:([a-z0-9-]+):[a-f0-9]{32}$/i.exec(assetId)?.[1] ?? "";
}

function assetId(root: SharedLibraryRoot, path: string): string {
  const locator = relative(root.path, path).split(sep).join("/");
  return `shared:${root.id}:${createHash("sha256").update(locator).digest("hex").slice(0, 32)}`;
}

export function variantFamily(name: string): string {
  let stem = name.toLowerCase().trim();
  for (;;) {
    const core = stem.replace(/[-_.\s]+(?:v\d{1,5}|lod[-_]?\d{1,2}|\d{1,2}k|\d{2,5}x\d{2,5}|lq|hq)$/i, "");
    if (core === stem) return stem.replace(/[-_.\s]+/g, " ");
    stem = core;
  }
}

function matchingAsset(kind: SharedLibraryRoot["kind"], name: string): boolean {
  const extension = extname(name).toLowerCase();
  if (kind === "hdris") return HDR_EXTENSIONS.has(extension);
  return Boolean(modelFormatFromExtension(extension)) || extension === ".hip" || extension === ".hiplc" || extension === ".hipnc";
}

export async function scanSharedRoot(
  root: SharedLibraryRoot,
  cancelled: () => boolean,
  publish: (assets: AssetRecord[]) => void
): Promise<SharedLibraryStatus> {
  const canonicalRoot = await realpath(root.path).catch(() => null);
  if (!canonicalRoot) return { id: root.id, state: "unavailable", count: 0 };
  const remaining = [root.path];
  let batch: AssetRecord[] = [];
  let count = 0;
  let partial = false;

  while (remaining.length && !cancelled()) {
    const folder = remaining.pop()!;
    const folders: string[] = [];
    const candidateNames: string[] = [];
    const renders = new Map<string, string>();
    try {
      const canonicalFolder = await realpath(folder);
      if (relative(join(canonicalRoot, relative(root.path, folder)), canonicalFolder) !== "") {
        partial = true;
        continue;
      }
      const entries = await opendir(folder);
      for await (const entry of entries) {
        if (cancelled()) break;
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && !SKIP_FOLDERS.has(entry.name.toLowerCase())) {
          folders.push(join(folder, entry.name));
        } else if (entry.isFile()) {
          const extension = extname(entry.name);
          if (matchingAsset(root.kind, entry.name)) candidateNames.push(entry.name);
          else if (RENDER_EXTENSIONS.has(extension.toLowerCase())) {
            renders.set(basename(entry.name, extension).toLowerCase(), entry.name);
          }
        }
      }
    } catch {
      if (folder === root.path) return { id: root.id, state: "unavailable", count };
      partial = true;
      continue;
    }
    for (const subfolder of folders) remaining.push(subfolder);
    const categories = [root.name, ...relative(root.path, folder).split(sep).filter(Boolean)];
    // Metadata reads are parallel in small groups to avoid serial round trips on a share.
    for (let offset = 0; offset < candidateNames.length && !cancelled(); offset += 12) {
      const files = await Promise.all(candidateNames.slice(offset, offset + 12).map(async file => {
        const path = join(folder, file);
        const info = await lstat(path).catch(() => null);
        if (!info?.isFile()) { partial = true; return null; }
        const extension = extname(file);
        const stem = basename(file, extension);
        const image = renders.get(stem.toLowerCase()) ?? renders.get(`${stem.toLowerCase()}_preview`);
        return {
          id: assetId(root, path), name: stem, type: root.kind === "hdris" ? "hdri" : "3d",
          repo: "shared", path, jsonPath: "", preview: image ? join(folder, image) : null, thumb: null,
          categories, tags: [extension.slice(1).toLowerCase()], mtime: info.mtimeMs, previewRelativeSize: "",
          searchStr: `${categories.join(" ")} ${file}`.toLowerCase(),
          sizeBytes: info.size, fileCount: 1
        } satisfies AssetRecord;
      }));
      for (const file of files) if (file) batch.push(file);
      if (batch.length >= BATCH_SIZE && !cancelled()) {
        count += batch.length;
        publish(batch);
        batch = [];
        await new Promise<void>(done => setImmediate(done));
      }
    }
  }
  if (batch.length && !cancelled()) {
    count += batch.length;
    publish(batch);
  }
  return { id: root.id, state: partial ? "partial" : "ready", count };
}

/** Resolve only an indexed file under its current registered root. */
export async function resolveSharedFile(asset: AssetRecord, roots: SharedLibraryRoot[], path = asset.path): Promise<string> {
  const root = roots.find(entry => entry.id === sharedRootId(asset.id));
  if (asset.repo !== "shared" || !root || !isInside(root.path, path)) throw new Error("This shared asset is no longer registered.");
  const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root.path), realpath(path)]).catch(() => {
    throw new Error("The shared file is unavailable. Check its mount and rescan the Library.");
  });
  const location = relative(root.path, path);
  if (!isInside(canonicalRoot, canonicalFile) || relative(join(canonicalRoot, location), canonicalFile) !== "") {
    throw new Error("Linked files outside their indexed location cannot be opened.");
  }
  return canonicalFile;
}


export async function inspectSharedHdr(path: string): Promise<{ width: number; height: number; panorama: boolean }> {
  if (!HDR_EXTENSIONS.has(extname(path).toLowerCase())) throw new Error("This file is not an HDR or EXR source.");
  const file = await open(path);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > PUBLIC_PREVIEW_MAX_BYTES) {
      throw new Error("This HDR file exceeds the 160 MiB live preview limit. Open the original in its associated app.");
    }
    const header = Buffer.alloc(Math.min(info.size, 1024 * 1024));
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const { width, height } = checkHdrDimensions(header.subarray(0, bytesRead), extname(path), hdrLimitsFor("shared"));
    return { width, height, panorama: width / height >= 1.95 && width / height <= 2.05 };
  } finally {
    await file.close();
  }
}
