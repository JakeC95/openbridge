import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type {
  AssetJson,
  AssetRecord,
  LibraryHealthReport,
  LibraryIssue,
  LibraryTypeStats,
  RepoKind,
  ScanResult
} from "../shared/types";
import type { Logger } from "./logger";

const DOWNLOADED_TYPES = ["3d", "atlas", "surface", "3dplant", "brush"];
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg"]);
const MESH_EXT = new Set([".fbx", ".obj", ".abc", ".usd", ".usdz", ".gltf", ".glb"]);

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

async function readAssetRoot(root: string, repo: RepoKind): Promise<AssetRecord[]> {
  const records: AssetRecord[] = [];
  if (!existsSync(root)) return records;

  const pushFolders = async (parent: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(parent);
    } catch {
      return;
    }
    for (const entry of entries) {
      const folder = join(parent, entry);
      try {
        if (!(await stat(folder)).isDirectory()) continue;
      } catch {
        continue;
      }
      const record = await readAssetFolder(folder, repo);
      if (record) records.push(record);
    }
  };

  if (repo === "dhi" || repo === "custom") {
    await pushFolders(root);
    for (const entry of await readdir(root).catch(() => [])) {
      const child = join(root, entry);
      if (entry.toLowerCase() === "support") continue;
      try {
        if ((await stat(child)).isDirectory()) await pushFolders(child);
      } catch {
        // ignore
      }
    }
  } else {
    for (const type of DOWNLOADED_TYPES) {
      await pushFolders(join(root, type));
    }
  }

  return records;
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
      if (IMAGE_EXT.has(ext) && !entry.name.toLowerCase().includes("preview") && !entry.name.toLowerCase().includes("thumb")) {
        textures += 1;
      }
    }
  };
  await visit(folder);
  return { files, bytes, zeroBytes, meshes, textures };
}

export class LibraryService {
  private cache: ScanResult | null = null;

  constructor(
    private readonly getLibraryPath: () => string,
    private readonly cacheFile: string,
    private readonly logger: Logger
  ) {}

  async scan(force = false): Promise<ScanResult> {
    const libraryPath = this.getLibraryPath();
    if (!force && this.cache && this.cache.libraryPath === libraryPath) {
      return this.cache;
    }

    const started = Date.now();
    const roots: Array<[string, RepoKind]> = [
      [join(libraryPath, "Downloaded"), "downloaded"],
      [join(libraryPath, "Custom"), "custom"],
      [join(libraryPath, "Downloaded", "DHI"), "dhi"]
    ];

    const seen = new Set<string>();
    const assets: AssetRecord[] = [];
    for (const [root, repo] of roots) {
      const found = await readAssetRoot(root, repo);
      for (const asset of found) {
        if (seen.has(asset.id)) continue;
        seen.add(asset.id);
        assets.push(asset);
      }
    }

    assets.sort((a, b) => b.mtime - a.mtime);
    this.cache = { assets, scannedAt: Date.now(), libraryPath };
    void this.writeCache(this.cache);

    this.logger.info("Library scan complete", {
      libraryPath,
      assets: assets.length,
      milliseconds: Date.now() - started
    });
    return this.cache;
  }


  async health(): Promise<LibraryHealthReport> {
    const libraryPath = this.getLibraryPath();
    const roots: Array<[string, RepoKind]> = [
      [join(libraryPath, "Downloaded"), "downloaded"],
      [join(libraryPath, "Custom"), "custom"],
      [join(libraryPath, "Downloaded", "DHI"), "dhi"]
    ];
    const records: AssetRecord[] = [];
    for (const [root, repo] of roots) {
      records.push(...(await readAssetRoot(root, repo)));
    }

    const issues: LibraryIssue[] = [];
    const byType: Record<string, LibraryTypeStats> = {};
    const ids = new Map<string, string[]>();
    let files = 0;
    let totalBytes = 0;

    for (const asset of records) {
      const paths = ids.get(asset.id) ?? [];
      paths.push(asset.path);
      ids.set(asset.id, paths);

      const walked = await walkAssetFolder(asset.path);
      files += walked.files;
      totalBytes += walked.bytes;
      const type = (asset.type || "unknown").toLowerCase();
      const stats = byType[type] ?? { assets: 0, bytes: 0, files: 0 };
      stats.assets += 1;
      stats.bytes += walked.bytes;
      stats.files += walked.files;
      byType[type] = stats;

      if (!asset.preview) {
        issues.push({
          kind: "missing-preview",
          severity: "warning",
          assetId: asset.id,
          name: asset.name,
          path: asset.path,
          message: "No preview or thumbnail found"
        });
      }
      if (walked.zeroBytes > 0) {
        issues.push({
          kind: "zero-byte",
          severity: "error",
          assetId: asset.id,
          name: asset.name,
          path: asset.path,
          message: walked.zeroBytes + " zero-byte file(s)"
        });
      }
      if (walked.files === 0) {
        issues.push({
          kind: "empty-folder",
          severity: "error",
          assetId: asset.id,
          name: asset.name,
          path: asset.path,
          message: "Asset folder is empty"
        });
      }
      if ((type.startsWith("3d") || type === "3dplant") && walked.meshes === 0) {
        issues.push({
          kind: "missing-mesh",
          severity: "warning",
          assetId: asset.id,
          name: asset.name,
          path: asset.path,
          message: "No mesh file found"
        });
      }
      if (["surface", "atlas", "decal"].includes(type) && walked.textures === 0) {
        issues.push({
          kind: "missing-texture",
          severity: "warning",
          assetId: asset.id,
          name: asset.name,
          path: asset.path,
          message: "No texture file found"
        });
      }
    }

    const duplicates: Array<{ assetId: string; paths: string[] }> = [];
    for (const [assetId, paths] of ids) {
      if (paths.length < 2) continue;
      duplicates.push({ assetId, paths });
      issues.push({
        kind: "duplicate-id",
        severity: "warning",
        assetId,
        path: paths.join("; "),
        message: "Asset ID appears in " + paths.length + " locations"
      });
    }

    return {
      libraryPath,
      scannedAt: Date.now(),
      assets: records.length,
      files,
      totalBytes,
      byType,
      issues,
      duplicates
    };
  }

  async removeAssets(assetIds: string[]): Promise<{ removed: number }> {
    const wanted = new Set(assetIds);
    const result = await this.scan(true);
    let removed = 0;
    const libraryRoot = resolve(this.getLibraryPath());
    for (const asset of result.assets) {
      if (!wanted.has(asset.id)) continue;
      const target = resolve(asset.path);
      if (!target.startsWith(libraryRoot + sep)) continue;
      await rm(target, { recursive: true, force: true });
      removed += 1;
    }
    this.invalidate();
    return { removed };
  }

  invalidate(): void {
    this.cache = null;
  }

  private async writeCache(result: ScanResult): Promise<void> {
    try {
      await writeFile(this.cacheFile, JSON.stringify(result), "utf8");
    } catch (error) {
      this.logger.warn("Could not write library cache", { error });
    }
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
