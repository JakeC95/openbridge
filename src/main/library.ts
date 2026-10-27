import { readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type {
  AssetJson,
  AssetRecord,
  LibraryHealthProgress,
  LibraryHealthReport,
  LibraryIssue,
  LibraryQuery,
  LibraryQueryResult,
  LibrarySnapshot,
  RepoKind,
  ScanResult
} from "../shared/types";
import { LibraryIndex } from "./library-index";
import type { Logger } from "./logger";

const DOWNLOADED_TYPES = ["3d", "atlas", "surface", "3dplant", "brush"];
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg"]);
const MESH_EXT = new Set([".fbx", ".obj", ".abc", ".usd", ".usdz", ".gltf", ".glb"]);

interface AssetFolder {
  folder: string;
  repo: RepoKind;
  folderMtime: number;
}

function isAssetJson(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".json") &&
    !lower.includes("_export") &&
    !lower.includes("megascansassets") &&
    lower !== "assetsdata.json"
  );
}

function pickImage(files: string[], needle: "preview" | "thumb"): string | null {
  for (const file of files) {
    const lower = file.toLowerCase();
    const ext = extname(lower);
    if (!IMAGE_EXT.has(ext)) continue;
    if (lower.includes(needle) || (needle === "preview" && lower.includes("grid"))) {
      return file;
    }
  }
  return null;
}

function toArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function readAssetFolder(folder: string, repo: RepoKind): Promise<AssetRecord | null> {
  let files: string[];
  try {
    files = await readdir(folder);
  } catch {
    return null;
  }

  const jsonFiles = files.filter(isAssetJson).sort();
  for (const file of jsonFiles) {
    const jsonPath = join(folder, file);
    let json: AssetJson;
    try {
      json = JSON.parse((await readFile(jsonPath, "utf8")).replace(/^\uFEFF/, "")) as AssetJson;
    } catch {
      continue;
    }
    if (!json || typeof json.id !== "string" || json.id.length === 0) continue;

    const previewName = pickImage(files, "preview");
    const thumbName = pickImage(files, "thumb");
    const preview = previewName ? join(folder, previewName) : null;
    const thumb = thumbName ? join(folder, thumbName) : preview;
    const name = typeof json.name === "string" && json.name ? json.name : json.id;
    const type =
      typeof json.type === "string" && json.type
        ? json.type
        : basename(dirname(folder)) || "unknown";
    const categories = toArray(json.categories);
    const tags = toArray(json.tags);
    let mtime = 0;
    try {
      mtime = (await stat(jsonPath)).mtimeMs;
    } catch {
      // ignore
    }

    const searchStr = [json.id, name, type, ...categories, ...tags]
      .join(" ")
      .replace(/[_|-]+/g, " ")
      .toLowerCase();

    return {
      id: json.id,
      name,
      type,
      categories,
      tags,
      repo,
      path: folder,
      jsonPath,
      preview,
      thumb,
      mtime,
      previewRelativeSize: json.previews?.relativeSize ?? "1x1",
      searchStr
    };
  }
  return null;
}

async function listDirectories(parent: string): Promise<AssetFolder[]> {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  const output: AssetFolder[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = join(parent, entry.name);
    const info = await stat(folder).catch(() => null);
    if (!info) continue;
    output.push({ folder, repo: "custom", folderMtime: info.mtimeMs });
  }
  return output;
}

async function collectAssetFolders(libraryPath: string): Promise<AssetFolder[]> {
  const output: AssetFolder[] = [];
  const seen = new Set<string>();
  const add = (folders: AssetFolder[], repo: RepoKind): void => {
    for (const folder of folders) {
      if (seen.has(folder.folder)) continue;
      seen.add(folder.folder);
      output.push({ ...folder, repo });
    }
  };

  for (const type of DOWNLOADED_TYPES) {
    add(await listDirectories(join(libraryPath, "Downloaded", type)), "downloaded");
  }

  const customRoot = join(libraryPath, "Custom");
  const customTop = (await listDirectories(customRoot)).filter(
    folder => basename(folder.folder).toLowerCase() !== "support"
  );
  add(customTop, "custom");
  for (const folder of customTop) {
    add(await listDirectories(folder.folder), "custom");
  }

  const dhiRoot = join(libraryPath, "Downloaded", "DHI");
  const dhiTop = await listDirectories(dhiRoot);
  add(dhiTop, "dhi");
  for (const folder of dhiTop) {
    add(await listDirectories(folder.folder), "dhi");
  }

  return output;
}

async function walkAssetFolder(folder: string): Promise<{
  files: number;
  bytes: number;
  zeroBytes: number;
  meshes: number;
  textures: number;
}> {
  let files = 0;
  let bytes = 0;
  let zeroBytes = 0;
  let meshes = 0;
  let textures = 0;
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      files += 1;
      const info = await stat(target).catch(() => null);
      if (!info) continue;
      bytes += info.size;
      if (info.size === 0) zeroBytes += 1;
      const ext = extname(entry.name).toLowerCase();
      if (MESH_EXT.has(ext)) meshes += 1;
      if (
        IMAGE_EXT.has(ext) &&
        !entry.name.toLowerCase().includes("preview") &&
        !entry.name.toLowerCase().includes("thumb")
      ) {
        textures += 1;
      }
    }
  };
  await visit(folder);
  return { files, bytes, zeroBytes, meshes, textures };
}

function issuesForAsset(
  row: { path: string; id: string; name: string; type: string; preview: string | null },
  walked: Awaited<ReturnType<typeof walkAssetFolder>>
): LibraryIssue[] {
  const issues: LibraryIssue[] = [];
  const type = (row.type || "unknown").toLowerCase();
  if (!row.preview) {
    issues.push({
      kind: "missing-preview",
      severity: "warning",
      assetId: row.id,
      name: row.name,
      path: row.path,
      message: "No preview or thumbnail found"
    });
  }
  if (walked.zeroBytes > 0) {
    issues.push({
      kind: "zero-byte",
      severity: "error",
      assetId: row.id,
      name: row.name,
      path: row.path,
      message: `${walked.zeroBytes} zero-byte file(s)`
    });
  }
  if (walked.files === 0) {
    issues.push({
      kind: "empty-folder",
      severity: "error",
      assetId: row.id,
      name: row.name,
      path: row.path,
      message: "Asset folder is empty"
    });
  }
  if ((type.startsWith("3d") || type === "3dplant") && walked.meshes === 0) {
    issues.push({
      kind: "missing-mesh",
      severity: "warning",
      assetId: row.id,
      name: row.name,
      path: row.path,
      message: "No mesh file found"
    });
  }
  if (["surface", "atlas", "decal"].includes(type) && walked.textures === 0) {
    issues.push({
      kind: "missing-texture",
      severity: "warning",
      assetId: row.id,
      name: row.name,
      path: row.path,
      message: "No texture file found"
    });
  }
  return issues;
}

export class LibraryService {
  private readonly index: LibraryIndex;
  private snapshotCache: LibrarySnapshot | null = null;
  private closed = false;

  constructor(
    private readonly getLibraryPath: () => string,
    indexPath: string,
    private readonly logger: Logger
  ) {
    this.index = new LibraryIndex(indexPath, logger);
  }

  async scan(force = false, includeAssets = true): Promise<ScanResult> {
    const libraryPath = this.getLibraryPath();
    const started = Date.now();
    this.index.ensureLibraryPath(libraryPath);
    const folders = await collectAssetFolders(libraryPath);
    const seen = new Set<string>();
    const changes: Array<{ asset: AssetRecord; folderMtime: number; jsonMtime: number }> = [];
    let skipped = 0;

    for (const folder of folders) {
      seen.add(folder.folder);
      const cached = this.index.getCachedRow(folder.folder);
      if (!force && cached && Math.trunc(cached.folder_mtime) === Math.trunc(folder.folderMtime)) {
        const jsonInfo = await stat(cached.json_path).catch(() => null);
        if (jsonInfo && Math.trunc(jsonInfo.mtimeMs) === Math.trunc(cached.json_mtime)) {
          skipped += 1;
          continue;
        }
      }

      const asset = await readAssetFolder(folder.folder, folder.repo);
      if (!asset) {
        seen.delete(folder.folder);
        continue;
      }
      const jsonInfo = await stat(asset.jsonPath).catch(() => null);
      changes.push({
        asset,
        folderMtime: folder.folderMtime,
        jsonMtime: jsonInfo?.mtimeMs ?? 0
      });
    }

    this.index.upsertMany(changes);
    const deleted = this.index.deleteMissing(seen);
    const scannedAt = Date.now();
    this.index.setScannedAt(scannedAt);
    this.snapshotCache = null;

    const assets = includeAssets ? this.index.allAssets() : [];
    this.logger.info("Library scan complete", {
      libraryPath,
      assets: includeAssets ? assets.length : this.index.counts().all,
      changed: changes.length,
      skipped,
      deleted,
      milliseconds: scannedAt - started,
      indexed: true
    });
    return { assets, scannedAt, libraryPath };
  }

  async snapshot(force = false): Promise<LibrarySnapshot> {
    if (!force && this.snapshotCache) return this.snapshotCache;
    await this.scan(force, false);
    const snapshot = this.index.getSnapshot(this.getLibraryPath());
    this.snapshotCache = snapshot;
    return snapshot;
  }

  query(options: LibraryQuery): LibraryQueryResult {
    return this.index.query(options);
  }
  ids(options: LibraryQuery): string[] {
    return this.index.ids(options);
  }

  async health(
    force = false,
    onProgress?: (progress: LibraryHealthProgress) => void
  ): Promise<LibraryHealthReport> {
    const libraryPath = this.getLibraryPath();
    const started = Date.now();
    await this.scan(false, false);
    this.snapshotCache = this.index.getSnapshot(libraryPath);
    const rows = this.index.healthRows(force);
    const total = rows.length;
    let checked = 0;
    let batch: Array<{
      path: string;
      stats: { files: number; bytes: number; zeroBytes: number; meshes: number; textures: number };
      issues: LibraryIssue[];
    }> = [];
    onProgress?.({ checked: 0, total, percent: 0 });
    for (const row of rows) {
      const walked = await walkAssetFolder(row.path);
      batch.push({
        path: row.path,
        stats: {
          files: walked.files,
          bytes: walked.bytes,
          zeroBytes: walked.zeroBytes,
          meshes: walked.meshes,
          textures: walked.textures
        },
        issues: issuesForAsset(row, walked)
      });
      checked += 1;
      if (batch.length >= 25) {
        this.index.setHealthMany(batch);
        batch = [];
        await new Promise(resolve => setImmediate(resolve));
      }
      if (checked % 10 === 0 || checked === total) {
        onProgress?.({
          checked,
          total,
          percent: total > 0 ? Math.round((checked / total) * 100) : 100
        });
      }
    }
    if (batch.length > 0) this.index.setHealthMany(batch);
    const report = this.index.healthReport(libraryPath);
    this.logger.info("Library health complete", {
      libraryPath,
      checked,
      assets: report.assets,
      issues: report.issues.length,
      milliseconds: Date.now() - started
    });
    return report;
  }

  async removeAssets(assetIds: string[]): Promise<{ removed: number }> {
    const wanted = new Set(assetIds);
    const result = await this.scan(false);
    const libraryRoot = resolve(this.getLibraryPath());
    let removed = 0;
    for (const asset of result.assets) {
      if (!wanted.has(asset.id)) continue;
      const target = resolve(asset.path);
      if (!target.startsWith(libraryRoot + sep)) continue;
      await rm(target, { recursive: true, force: true });
      removed += 1;
    }
    if (removed > 0) {
      await this.scan(false);
      this.snapshotCache = null;
    }
    return { removed };
  }

  invalidate(): void {
    this.snapshotCache = null;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.index.close();
  }
}

export function assetFileKind(file: string): "texture" | "mesh" | "preview" | "other" {
  const lower = file.toLowerCase();
  const ext = extname(lower);
  if (IMAGE_EXT.has(ext)) {
    if (lower.includes("preview") || lower.includes("thumb") || lower.includes("grid")) {
      return "preview";
    }
    return "texture";
  }
  if (MESH_EXT.has(ext)) return "mesh";
  return "other";
}
