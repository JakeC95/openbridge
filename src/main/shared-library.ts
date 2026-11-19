import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssetRecord, SharedLibraryRoot, SharedLibraryStatus } from "../shared/types";
import { modelFormatFromExtension } from "../shared/model-preview";
import { checkHdrDimensions, hdrLimitsFor, PUBLIC_PREVIEW_MAX_BYTES } from "./public/preview-data";

const MAX_ENTRIES = 30_000;
const MAX_DEPTH = 12;
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

function matchingAsset(kind: SharedLibraryRoot["kind"], name: string): boolean {
  const extension = extname(name).toLowerCase();
  if (kind === "hdris") return HDR_EXTENSIONS.has(extension);
  return Boolean(modelFormatFromExtension(extension)) || extension === ".hip" || extension === ".hiplc" || extension === ".hipnc";
}

export async function scanSharedRoot(root: SharedLibraryRoot, cancelled: () => boolean): Promise<{
  assets: AssetRecord[];
  status: SharedLibraryStatus;
}> {
  const assets: AssetRecord[] = [];
  const canonicalRoot = await realpath(root.path).catch(() => null);
  if (!canonicalRoot) return { assets, status: { id: root.id, state: "unavailable", count: 0 } };
  let visited = 0;
  let partial = false;
  let unreadable = false;
  const visit = async (folder: string, depth: number): Promise<void> => {
    if (cancelled()) return;
    if (depth > MAX_DEPTH || visited >= MAX_ENTRIES) { partial = true; return; }
    try {
      const canonicalFolder = await realpath(folder);
      if (relative(join(canonicalRoot, relative(root.path, folder)), canonicalFolder) !== "") {
        partial = true;
        return;
      }
      const entries = await opendir(folder);
      const children: string[] = [];
      const files: string[] = [];
      for await (const entry of entries) {
        if (++visited > MAX_ENTRIES) { partial = true; break; }
        if (cancelled()) return;
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && !SKIP_FOLDERS.has(entry.name.toLowerCase())) children.push(join(folder, entry.name));
        if (entry.isFile()) files.push(entry.name);
      }
      const renders = new Map(files.filter(file => RENDER_EXTENSIONS.has(extname(file).toLowerCase()))
        .map(file => [basename(file, extname(file)).toLowerCase(), file]));
      for (const file of files) {
        if (cancelled()) return;
        if (!matchingAsset(root.kind, file)) continue;
        const path = join(folder, file);
        const info = await lstat(path).catch(() => null);
        if (!info?.isFile()) { partial = true; continue; }
        const extension = extname(file);
        const stem = basename(file, extension);
        const image = renders.get(stem.toLowerCase()) ?? renders.get(`${stem.toLowerCase()}_preview`);
        const categories = [root.name, ...relative(root.path, folder).split(sep).filter(Boolean)];
        assets.push({
          id: assetId(root, path), name: stem, type: root.kind === "hdris" ? "hdri" : "3d",
          repo: "shared", path, jsonPath: "", preview: image ? join(folder, image) : null, thumb: null,
          categories, tags: [extension.slice(1).toLowerCase()], mtime: info.mtimeMs, previewRelativeSize: "",
          searchStr: `${categories.join(" ")} ${file}`.toLowerCase(),
          sizeBytes: info.size, fileCount: 1
        });
      }
      for (const child of children) {
        if (cancelled()) break;
        if (visited >= MAX_ENTRIES) { partial = true; break; }
        await visit(child, depth + 1);
      }
    } catch {
      if (depth === 0) unreadable = true;
      else partial = true;
    }
  };
  await visit(root.path, 0);
  return { assets, status: { id: root.id, state: unreadable ? "unavailable" : partial ? "partial" : "ready", count: assets.length } };
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
