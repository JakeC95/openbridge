import { createHash } from "node:crypto";
import { lstat, opendir, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssetRecord, SharedHdrInfo, SharedLibraryRoot, SharedLibraryStatus } from "../shared/types";
import { modelFormatFromExtension } from "../shared/model-preview";
import { type SharedHdrFacts, inspectSharedHdrFacts } from "./shared-hdr-facts";
import { readPresentationCard } from "./shared-presentation-card";
import { hdrLimitsFor, PUBLIC_PREVIEW_MAX_BYTES } from "./public/preview-data";

const BATCH_SIZE = 128;
const SKIP_FOLDERS = new Set(["archive", "archives", "cache", "caches", "temp", "tmp", "node_modules"]);
const HDR_EXTENSIONS = new Set([".hdr", ".exr"]);
const RENDER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MODEL_FOLDERS = /^(?:model[s]?|geo|geometry|mesh(?:es)?)$/i;
const PREVIEW_FOLDERS = ["preview", "previews"];
const MAX_PACKAGE_PREVIEW_ENTRIES = 4096;

function coverStem(stem: string): string {
  return stem.toLowerCase().replace(/[.\s]+$/, "").replace(/[-_.\s]+(?:preview|thumbnail|render)$/i, "");
}

/** Only look in explicitly named cover folders within the same package. */
async function packageCovers(folder: string, canonicalFolder: string, cancelled: () => boolean): Promise<Map<string, string | null>> {
  const covers = new Map<string, string | null>();
  for (const name of PREVIEW_FOLDERS) {
    if (cancelled()) break;
    const directory = join(folder, name);
    try {
      if (!(await lstat(directory)).isDirectory() ||
          relative(join(canonicalFolder, name), await realpath(directory)) !== "") continue;
      let inspected = 0;
      for await (const entry of await opendir(directory)) {
        if (cancelled() || ++inspected > MAX_PACKAGE_PREVIEW_ENTRIES) return new Map();
        const extension = extname(entry.name);
        if (entry.name.startsWith(".") || !entry.isFile() || !RENDER_EXTENSIONS.has(extension.toLowerCase())) continue;
        const key = coverStem(basename(entry.name, extension));
        covers.set(key, covers.has(key) ? null : join(directory, entry.name));
      }
    } catch {
      // Optional cover folders do not affect source indexing.
    }
  }
  return covers;
}

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
        !name.trim() || !isAbsolute(path) || !["models", "hdris", "presentations"].includes(kind)) continue;
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
  if (kind === "presentations") return extension === ".glb";
  return Boolean(modelFormatFromExtension(extension)) || extension === ".hip" || extension === ".hiplc" || extension === ".hipnc";
}

export interface SharedTraversal {
  pending: string[];
  partial: boolean;
}

interface ScanOptions {
  cancelled(): boolean;
  checkpoint(key: string, state: SharedTraversal): void;
  loadCheckpoint(key: string): SharedTraversal | null;
  publish(assets: AssetRecord[]): void;
}

export async function scanSharedRoot(root: SharedLibraryRoot, options: ScanOptions): Promise<SharedLibraryStatus> {
  const { cancelled, checkpoint, loadCheckpoint, publish } = options;
  const canonicalRoot = await realpath(root.path).catch(() => "");
  const mount = canonicalRoot ? await lstat(canonicalRoot).catch(() => null) : null;
  if (!mount?.isDirectory()) return { id: root.id, state: "unavailable", count: 0 };
  const key = JSON.stringify([root, canonicalRoot, mount.dev, mount.ino]);
  if (cancelled()) return { id: root.id, state: "paused", count: 0 };
  const state = loadCheckpoint(key) ?? { pending: [""], partial: false };
  checkpoint(key, state);
  let lastCheckpoint = Date.now();
  let count = 0;

  async function visit(locator: string) {
    const folder = resolve(root.path, locator);
    const folders: string[] = [];
    const candidateNames: string[] = [];
    const renders = new Map<string, string>();
    let canonicalFolder: string;
    try {
      canonicalFolder = await realpath(folder);
      if (!isInside(root.path, folder) || relative(join(canonicalRoot, locator), canonicalFolder) !== "") {
        return { folders, assets: [] as AssetRecord[], partial: true, offline: !locator };
      }
      const entries = await opendir(folder);
      for await (const entry of entries) {
        if (cancelled()) break;
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && !SKIP_FOLDERS.has(entry.name.toLowerCase()) &&
            (root.kind !== "presentations" || !locator)) {
          folders.push(join(locator, entry.name));
        } else if (entry.isFile()) {
          const extension = extname(entry.name);
          if (matchingAsset(root.kind, entry.name) && (root.kind !== "presentations" ||
            (locator && basename(entry.name, extension) === basename(folder)))) candidateNames.push(entry.name);
          else if (RENDER_EXTENSIONS.has(extension.toLowerCase())) {
            renders.set(basename(entry.name, extension).toLowerCase(), entry.name);
          }
        }
      }
    } catch {
      return { folders: [], assets: [] as AssetRecord[], partial: true, offline: !locator };
    }
    const categories = root.kind === "presentations" ? [root.name] : [root.name, ...locator.split(sep).filter(Boolean)];
    const assets: AssetRecord[] = [];
    let partial = false;
    let covers = new Map<string, string | null>();
    if (root.kind === "models" && candidateNames.length && !cancelled()) {
      const inModelFolder = Boolean(locator) && MODEL_FOLDERS.test(basename(folder));
      const packageFolder = inModelFolder ? dirname(folder) : folder;
      const canonicalPackage = inModelFolder ? dirname(canonicalFolder) : canonicalFolder;
      covers = await packageCovers(packageFolder, canonicalPackage, cancelled);
    }
    // A presentation starts with an artist-selected cover and contains one
    // named portable mesh. Ambiguous or incomplete folders stay out of the grid.
    if (root.kind === "presentations" && (candidateNames.length !== 1 ||
        !renders.has(basename(folder).toLowerCase()))) return { folders, assets, partial, offline: false };
    for (let offset = 0; offset < candidateNames.length && !cancelled(); offset += 8) {
      const files = await Promise.all(candidateNames.slice(offset, offset + 8).map(async file => {
        const path = join(folder, file);
        const info = await lstat(path).catch(() => null);
        if (!info?.isFile()) { partial = true; return null; }
        const extension = extname(file);
        const stem = basename(file, extension);
        const image = renders.get(stem.toLowerCase()) ?? renders.get(`${stem.toLowerCase()}_preview`);
        const key = coverStem(stem);
        // A version or LOD may use the explicitly named unversioned cover.
        // Preserve distinct letter/number suffixes used as asset identifiers.
        const family = key.replace(/(?:[-_.\s]+(?:v\d{1,5}|lod[-_]?\d{1,2}))+$/i, "");
        const cover = covers.has(key) ? covers.get(key) : covers.get(family);
        const card = root.kind === "presentations" ? await readPresentationCard(path) : null;
        return {
          id: assetId(root, path), name: stem, type: root.kind === "hdris" ? "hdri" : "3d",
          repo: "shared", path, jsonPath: "", preview: image ? join(folder, image) : cover ?? null, thumb: null,
          categories, tags: [extension.slice(1).toLowerCase()], mtime: info.mtimeMs, previewRelativeSize: "",
          searchStr: [categories.join(" "), file, card?.job, card?.artist, card?.renderer, card?.originalFormat, card?.originalSize]
            .filter(Boolean).join(" ").toLowerCase(),
          sizeBytes: info.size, fileCount: 1
        } satisfies AssetRecord;
      }));
      for (const file of files) if (file) assets.push(file);
    }
    return { folders, assets, partial, offline: false };
  }

  let batch: AssetRecord[] = [];
  while (state.pending.length && !cancelled()) {
    // Leave the active wave on the checkpoint until all its files are written.
    const wave = state.pending.slice(-4);
    const results = await Promise.all(wave.map(visit));
    if (cancelled()) break;
    if (results.some(item => item.offline)) return { id: root.id, state: "unavailable", count };
    state.pending.splice(-wave.length);
    for (const result of results) {
      for (const folder of result.folders) state.pending.push(folder);
      for (const asset of result.assets) {
        batch.push(asset);
        if (batch.length === BATCH_SIZE) {
          publish(batch);
          count += batch.length;
          batch = [];
        }
      }
      state.partial ||= result.partial;
    }
    if (Date.now() - lastCheckpoint >= 4000) {
      if (batch.length) { publish(batch); count += batch.length; batch = []; }
      checkpoint(key, state);
      lastCheckpoint = Date.now();
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
  if (cancelled()) {
    // The last durable checkpoint still contains anything not yet published.
    return { id: root.id, state: "paused", count };
  }
  if (batch.length) { publish(batch); count += batch.length; }
  // Do not persist an empty frontier before reconciliation. A crash in that gap
  // must repeat work, never treat an earlier incomplete walk as successful.
  return { id: root.id, state: state.partial ? "partial" : "ready", count };
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


export async function inspectSharedHdr(path: string): Promise<SharedHdrInfo> {
  if (!HDR_EXTENSIONS.has(extname(path).toLowerCase())) throw new Error("This file is not an HDR or EXR source.");
  const [info, image] = await Promise.all([lstat(path), inspectSharedHdrFacts(path)]);
  return sharedHdrInfo(image, info.size);
}

export function sharedHdrInfo(image: SharedHdrFacts, bytes: number): SharedHdrInfo {
  const { width, height } = image;
  const limits = hdrLimitsFor("shared");
  const reason = image.tiled || image.deep || image.multipart || image.views.length > 1
    ? "This EXR uses a tiled, deep, multipart or multiview layout. Inspect its source facts here and open it in an external tool."
    : bytes > PUBLIC_PREVIEW_MAX_BYTES
      ? "This source exceeds the 160 MiB live preview limit. Choose a smaller variant or open the original in its associated app."
      : width > limits.maxWidth || height > limits.maxWidth || width * height > limits.maxPixels
        ? "This source exceeds the 8K live preview limit. Choose a smaller variant or open the original in its associated app."
        : undefined;
  return { width, height, panorama: image.projectionHint === "equirectangular",
    previewAvailable: !reason, ...(reason ? { reason } : {}) };
}
