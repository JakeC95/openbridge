import { isInside, resolveSharedFile, scanSharedRoot, sharedRootId, variantFamily } from "./shared-library";
import type { SharedAssetOrganization, SharedLibraryRoot, SharedLibraryStatus } from "../shared/types";
import { realpath, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AssetJson,
  AssetProvider,
  AssetRecord,
  AssetTechnicalSummary,
  LibraryHealthProgress,
  LibraryHealthReport,
  LibraryIssue,
  LibraryQuery,
  LibraryQueryResult,
  LibrarySnapshot,
  MapPreview,
  PoliigonAssetSummary,
  PolyHavenAssetSummary,
  RepoKind,
  ScanResult
} from "../shared/types";
import { assetTechnicalFacts } from "../shared/asset-metadata";
import { LibraryIndex } from "./library-index";
import type { Logger } from "./logger";
import { isPublicProviderId, type PublicProviderId } from "../shared/public-providers";

const DOWNLOADED_TYPES = ["3d", "atlas", "surface", "3dplant", "brush"];
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg"]);
const TEXTURE_EXT = new Set([".png", ".jpg", ".jpeg", ".exr", ".hdr", ".tif", ".tiff", ".webp", ".psd"]);
const MESH_EXT = new Set([".fbx", ".obj", ".abc", ".usd", ".usdz", ".gltf", ".glb", ".blend"]);

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
      provider: "megascans",
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
      searchStr,
      technical: assetTechnicalFacts(json as Parameters<typeof assetTechnicalFacts>[0])
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
        TEXTURE_EXT.has(ext) &&
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

interface PoliigonFileInfo {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

interface PoliigonInspection {
  asset: AssetRecord;
  stats: { files: number; bytes: number; zeroBytes: number; meshes: number; textures: number };
}

const MAP_TOKENS = [
  "BaseColorOpacity",
  "ScatteringColor",
  "AmbientOcclusion",
  "Displacement",
  "Translucency",
  "Transmission",
  "BaseColor",
  "Emission",
  "Roughness",
  "Metallic",
  "Opacity",
  "Normal",
  "SheenColor",
  "ALPHAMASKED",
  "METALNESS",
  "ROUGHNESS",
  "DISP16",
  "EMISSIVE",
  "BUMP16",
  "OVERLAY16",
  "TRANSMISSION",
  "TRANSLUCENCY",
  "DIRECTION",
  "ALPHA",
  "IDMAP",
  "ORM",
  "NRM16",
  "GLOSS",
  "REFL",
  "DISP",
  "NRM",
  "SSS",
  "BUMP",
  "MASK",
  "FUZZ",
  "AO",
  "COL",
  "DIFF",
  "ENV",
  "JPG",
  "HDR",
  "LIGHT",
  "nor_gl",
  "nor_dx",
  "rough_ao",
  "Diffuse",
  "Metal",
  "Rough",
  "arm"
];

function resolutionPixels(value: string): number | null {
  const match = /^(\d+)(K)?$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2] ? amount * 1024 : amount;
}

function inferMapTypes(files: PoliigonFileInfo[]): string[] {
  const types = new Set<string>();
  for (const file of files) {
    if (!TEXTURE_EXT.has(extname(file.name).toLowerCase())) continue;
    const base = file.name.replace(/\.[^.]+$/, "").toLowerCase();
    if (/preview|thumb|grid/.test(base)) continue;
    const parts = base.split(/[_\s.]+/).filter(Boolean);
    for (const token of MAP_TOKENS) {
      const wanted = token.toLowerCase();
      const separated = new RegExp(`(?:^|[^a-z0-9])${wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`);
      if (parts.includes(wanted) || separated.test(base)) {
        types.add(token);
        break;
      }
    }
  }
  return [...types];
}

function previewScore(file: PoliigonFileInfo, depth: number): number {
  const base = file.name.replace(/\.[^.]+$/, "").toLowerCase();
  let score = 0;
  if (base.endsWith("_preview1") || base.endsWith("_preview01") || base.endsWith("_preview")) score = 100;
  else if (base.includes("preview")) score = 80;
  else if (base.includes("thumb")) score = 70;
  else if (base.includes("grid")) score = 60;
  return score > 0 ? score + (depth === 0 ? 5 : 0) : 0;
}

function buildPoliigonTechnical(
  summary: PoliigonAssetSummary | null,
  files: PoliigonFileInfo[],
  sizes: Set<string>,
  lods: Set<string>,
  mapTypes: string[]
): AssetTechnicalSummary {
  let resolution: number | null = null;
  for (const size of sizes) {
    const pixels = resolutionPixels(size);
    if (pixels !== null && (resolution === null || pixels > resolution)) resolution = pixels;
  }
  if (resolution === null) resolution = summary?.maxResolution ?? null;
  const mesh = files.find(file => MESH_EXT.has(extname(file.name).toLowerCase()));
  const hasAlpha = mapTypes.some(type =>
    ["ALPHA", "ALPHAMASKED", "OPACITY", "Opacity", "BaseColorOpacity"].includes(type)
  );
  const workflow: AssetTechnicalSummary["materialWorkflow"] =
    summary?.convention === 1
      ? "metal-rough"
      : mapTypes.some(type => ["GLOSS", "REFL", "SPECULAR"].includes(type))
        ? "spec-gloss"
        : mapTypes.some(type => ["METALNESS", "Metallic"].includes(type))
          ? "metal-rough"
          : null;
  const localFormats = new Set<string>();
  for (const file of files) {
    const ext = extname(file.name).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") localFormats.add("JPG");
    else if (ext === ".png") localFormats.add("PNG");
    else if (ext === ".tif" || ext === ".tiff") localFormats.add("TIFF");
    else if (ext === ".exr") localFormats.add("EXR");
    else if (ext === ".hdr") localFormats.add("HDR");
  }
  return {
    resolution,
    mapTypes,
    mapCount: mapTypes.length,
    mapFormats: [...localFormats],
    lodCount: lods.size > 0 ? lods.size : summary?.lodCount ?? 0,
    lodTriangles: [],
    maxTris: summary?.maxTris ?? 0,
    variationCount: 0,
    billboardCount: 0,
    tileable: null,
    tilingDirections: [],
    scanArea: null,
    texelDensity: null,
    physicalSize: summary?.physicalSize ?? null,
    dimensions: summary?.physicalSize ?? null,
    height: null,
    variationDimensions: [],
    meshType: mesh ? extname(mesh.name).replace(".", "").toLowerCase() : null,
    hasHighpoly: false,
    hasZtool: false,
    hasBrushes: summary?.type === "Brushes",
    closedMesh: null,
    scaleFixed: null,
    assembly: null,
    smallAsset: null,
    splitSubmeshes: null,
    modular: false,
    hasAlpha,
    materialWorkflow: workflow,
    averageColor: null,
    packId: null,
    packName: null,
    revision: null,
    revised: null,
    semantic: {
      subjectMatter: null,
      color: [],
      state: [],
      interiorExterior: [],
      industry: [],
      theme: [],
      descriptive: [],
      contains: [],
      orientation: []
    }
  };
}

async function readPoliigonFolder(
  folder: string,
  lookup: (assetName: string) => PoliigonAssetSummary | null
): Promise<PoliigonInspection | null> {
  const files: PoliigonFileInfo[] = [];
  const sizes = new Set<string>();
  const lods = new Set<string>();
  let latest = 0;
  let totalBytes = 0;
  let zeroBytes = 0;
  let meshes = 0;
  let textures = 0;
  let preview: string | null = null;
  let bestPreview = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 6 || files.length > 20_000) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(target).catch(() => null);
      if (!info) continue;
      const file: PoliigonFileInfo = {
        name: entry.name,
        path: target,
        size: info.size,
        mtime: info.mtimeMs
      };
      files.push(file);
      totalBytes += info.size;
      if (info.size === 0) zeroBytes += 1;
      latest = Math.max(latest, info.mtimeMs);
      const ext = extname(entry.name).toLowerCase();
      if (MESH_EXT.has(ext)) meshes += 1;
      if (TEXTURE_EXT.has(ext) && !/preview|thumb|grid/i.test(entry.name)) textures += 1;
      const score = previewScore(file, depth);
      if (score > bestPreview) {
        bestPreview = score;
        preview = target;
      }
      for (const part of target.slice(folder.length + 1).split(/[\\/]/)) {
        if (/^(256|512|\d+K)$/i.test(part)) sizes.add(part.toUpperCase());
      }
      const sizeToken = entry.name.match(/_(256|512|\d+K)(?:_|\.)/i);
      if (sizeToken) sizes.add(sizeToken[1].toUpperCase());
      const lod = entry.name.match(/lod(\d+)/i);
      if (lod) lods.add(`LOD${lod[1]}`);
      if (/_SOURCE/i.test(entry.name)) lods.add("SOURCE");
      if (/_PROXY/i.test(entry.name)) lods.add("PROXY");
    }
  };
  await visit(folder, 0);
  if (files.length === 0) return null;

  const folderName = basename(folder);
  const summary = lookup(folderName);
  const localMapTypes = inferMapTypes(files);
  const mapTypes = localMapTypes.length > 0 ? localMapTypes : summary?.mapCodes ?? [];
  const type = summary?.typeLabel || (meshes > 0 ? "Model" : files.some(file => /\.(hdr|exr)$/i.test(file.name)) ? "HDRI" : "Texture");
  const asset: AssetRecord = {
    id: summary ? `poliigon:${summary.id}` : `poliigon:local:${folderName}`,
    provider: "poliigon",
    name: summary?.name || folderName,
    type,
    categories: summary?.categories?.length ? [summary.categories[0]] : ["Poliigon / Unmatched"],
    tags: summary?.tags ?? [],
    repo: "downloaded",
    path: folder,
    jsonPath: "",
    preview,
    thumb: preview,
    mtime: latest,
    previewRelativeSize: "1x1",
    searchStr: [
      summary ? `poliigon:${summary.id}` : `poliigon:local:${folderName}`,
      summary?.name ?? folderName,
      folderName,
      type,
      ...(summary?.categories ?? []),
      ...(summary?.tags ?? []),
      ...mapTypes,
      ...sizes,
      ...lods
    ]
      .join(" ")
      .replace(/[_|-]+/g, " ")
      .toLowerCase(),
    technical: buildPoliigonTechnical(summary, files, sizes, lods, mapTypes)
  };

  return {
    asset,
    stats: { files: files.length, bytes: totalBytes, zeroBytes, meshes, textures }
  };
}

async function resolvePoliigonRoot(path: string): Promise<string> {
  if (!path) return "";
  const nested = join(path, "Library");
  const info = await stat(nested).catch(() => null);
  if (!info?.isDirectory()) return path;
  const entries = await readdir(nested, { withFileTypes: true }).catch(() => []);
  return entries.some(entry => entry.isDirectory()) ? nested : path;
}

async function collectPoliigonFolders(path: string): Promise<Array<{ folder: string; folderMtime: number }>> {
  if (!path) return [];
  const root = await resolvePoliigonRoot(path);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const skip = new Set(["support", "cache", "assetindex", "onlinepreviews", "logs", "plugins", "utils"]);
  const output: Array<{ folder: string; folderMtime: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (skip.has(entry.name.toLowerCase())) continue;
    const folder = join(root, entry.name);
    const info = await stat(folder).catch(() => null);
    if (!info) continue;
    output.push({ folder, folderMtime: info.mtimeMs });
  }
  return output;
}

async function collectPolyHavenFolders(path: string): Promise<Array<{ folder: string; folderMtime: number }>> {
  if (!path) return [];
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const skip = new Set(["support", "cache", "logs", "plugins", "utils", "temp"]);
  const output: Array<{ folder: string; folderMtime: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (skip.has(entry.name.toLowerCase())) continue;
    const folder = join(path, entry.name);
    const info = await stat(folder).catch(() => null);
    if (!info) continue;
    output.push({ folder, folderMtime: info.mtimeMs });
  }
  return output;
}

interface PolyHavenMetadata {
  id?: string;
  name?: string;
  type?: string;
  typeLabel?: string;
  category?: string;
  categories?: string[];
  tags?: string[];
  collections?: string[];
  publishedAt?: number | null;
  authors?: Record<string, string>;
  maxResolution?: number | null;
  resolutions?: string[];
  dimensions?: string | null;
  dimensionsMm?: number[] | null;
  polycount?: number | null;
  texelDensity?: string | null;
  mapCodes?: string[];
  mapFormats?: string[];
  lodCount?: number;
}

function buildPolyHavenTechnical(
  summary: PolyHavenAssetSummary | null,
  metadata: PolyHavenMetadata | null,
  files: PoliigonFileInfo[],
  sizes: Set<string>,
  lods: Set<string>,
  mapTypes: string[]
): AssetTechnicalSummary {
  let resolution: number | null = null;
  for (const size of sizes) {
    const pixels = resolutionPixels(size);
    if (pixels !== null && (resolution === null || pixels > resolution)) resolution = pixels;
  }
  if (resolution === null) resolution = summary?.maxResolution ?? metadata?.maxResolution ?? null;
  const mesh = files.find(file => MESH_EXT.has(extname(file.name).toLowerCase()));
  const localFormats = new Set<string>();
  for (const file of files) {
    const ext = extname(file.name).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") localFormats.add("JPG");
    else if (ext === ".png") localFormats.add("PNG");
    else if (ext === ".tif" || ext === ".tiff") localFormats.add("TIFF");
    else if (ext === ".exr") localFormats.add("EXR");
    else if (ext === ".hdr") localFormats.add("HDR");
  }
  return {
    resolution,
    mapTypes,
    mapCount: mapTypes.length,
    mapFormats: localFormats.size > 0 ? [...localFormats] : (summary?.mapFormats ?? metadata?.mapFormats ?? []).map(value => value.toUpperCase()),
    lodCount: lods.size > 0 ? lods.size : summary?.lodCount ?? metadata?.lodCount ?? 0,
    lodTriangles: [],
    maxTris: summary?.polycount ?? metadata?.polycount ?? 0,
    variationCount: 0,
    billboardCount: 0,
    tileable: null,
    tilingDirections: [],
    scanArea: null,
    texelDensity: summary?.texelDensity ?? metadata?.texelDensity ?? null,
    physicalSize: summary?.dimensions ?? metadata?.dimensions ?? null,
    dimensions: summary?.dimensions ?? metadata?.dimensions ?? null,
    height: null,
    variationDimensions: [],
    meshType: mesh ? extname(mesh.name).replace(".", "").toLowerCase() : null,
    hasHighpoly: false,
    hasZtool: false,
    hasBrushes: false,
    closedMesh: null,
    scaleFixed: null,
    assembly: null,
    smallAsset: null,
    splitSubmeshes: null,
    modular: false,
    hasAlpha: mapTypes.some(type => /alpha|opacity|mask/i.test(type)),
    materialWorkflow: mapTypes.some(type => /metal|arm|rough/i.test(type))
      ? "metal-rough"
      : null,
    averageColor: null,
    packId: null,
    packName: metadata?.collections?.[0] ?? null,
    revision: null,
    revised: null,
    semantic: {
      subjectMatter: null,
      color: [],
      state: [],
      interiorExterior: [],
      industry: [],
      theme: [],
      descriptive: [],
      contains: [],
      orientation: []
    }
  };
}

async function readPolyHavenFolder(
  folder: string,
  lookup: (id: string) => PolyHavenAssetSummary | null,
  provider: "polyhaven" | PublicProviderId = "polyhaven"
): Promise<PoliigonInspection | null> {
  const folderName = basename(folder);
  let metadata: PolyHavenMetadata | null = null;
  try {
    metadata = JSON.parse(
      (await readFile(join(folder, `openbridge-${provider}.json`), "utf8")).replace(/^\uFEFF/, "")
    ) as PolyHavenMetadata;
  } catch {
    // folders created by other tools still match by id/name below
  }
  const lookupId = metadata?.id || folderName;
  const summary = lookup(lookupId) ?? lookup(folderName);
  const id = summary?.id || metadata?.id || folderName;
  const files: PoliigonFileInfo[] = [];
  const sizes = new Set<string>();
  const lods = new Set<string>();
  let latest = 0;
  let totalBytes = 0;
  let zeroBytes = 0;
  let meshes = 0;
  let textures = 0;
  let preview: string | null = null;
  let bestPreview = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 6 || files.length > 20_000) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target, depth + 1);
        continue;
      }
      if (!entry.isFile() || entry.name === `openbridge-${provider}.json` || /\.part(?:\.meta\.json)?$/.test(entry.name)) continue;
      const info = await stat(target).catch(() => null);
      if (!info) continue;
      const file: PoliigonFileInfo = {
        name: entry.name,
        path: target,
        size: info.size,
        mtime: info.mtimeMs
      };
      files.push(file);
      totalBytes += info.size;
      if (info.size === 0) zeroBytes += 1;
      latest = Math.max(latest, info.mtimeMs);
      const ext = extname(entry.name).toLowerCase();
      if (MESH_EXT.has(ext)) meshes += 1;
      if (TEXTURE_EXT.has(ext) && !/preview|thumb|grid/i.test(entry.name)) textures += 1;
      const score = previewScore(file, depth);
      if (score > bestPreview) {
        bestPreview = score;
        preview = target;
      }
      for (const part of target.slice(folder.length + 1).split(/[\\/]/)) {
        if (/^(256|512|\d+K)$/i.test(part)) sizes.add(part.toUpperCase());
      }
      const sizeToken = entry.name.match(/_(256|512|\d+K)(?:_|\.)/i);
      if (sizeToken) sizes.add(sizeToken[1].toUpperCase());
      if (/lod\d+/i.test(entry.name)) lods.add(entry.name.match(/lod\d+/i)?.[0]?.toUpperCase() ?? "LOD");
    }
  };
  await visit(folder, 0);
  if (files.length === 0) return null;
  if (!preview) {
    preview = files.find(file => /\.(png|jpe?g|webp)$/i.test(file.name))?.path ?? null;
  }

  const localMapTypes = inferMapTypes(files);
  const mapTypes = localMapTypes.length > 0 ? localMapTypes : summary?.mapCodes ?? metadata?.mapCodes ?? [];
  const type = summary?.typeLabel
    || metadata?.typeLabel
    || (meshes > 0 ? "Model" : files.some(file => /\.(hdr|exr)$/i.test(file.name)) ? "HDRI" : "Texture");
  const metadataCategories = metadata?.categories ?? [];
  const categories = summary?.category
    ? [summary.category]
    : metadata?.category
      ? [metadata.category]
       : [`${provider} / Unmatched`];
  const tags = [
    ...new Set([
      ...(summary?.tags ?? metadata?.tags ?? []),
      ...(summary?.categories ?? metadataCategories)
    ])
  ];
  const asset: AssetRecord = {
    id: `${provider}:${id}`,
    provider,
    name: summary?.name || metadata?.name || folderName,
    type,
    categories,
    tags,
    repo: "downloaded",
    path: folder,
    jsonPath: join(folder, `openbridge-${provider}.json`),
    preview,
    thumb: preview,
    mtime: latest,
    previewRelativeSize: "1x1",
    searchStr: [
      `${provider}:${id}`,
      id,
      summary?.name ?? metadata?.name ?? folderName,
      summary?.category ?? metadata?.category ?? "",
      type,
      ...categories,
      ...tags,
      ...mapTypes,
      ...sizes,
      ...lods
    ]
      .join(" ")
      .replace(/[_|-]+/g, " ")
      .toLowerCase(),
    technical: buildPolyHavenTechnical(summary, metadata, files, sizes, lods, mapTypes)
  };

  return {
    asset,
    stats: { files: files.length, bytes: totalBytes, zeroBytes, meshes, textures }
  };
}


function issuesForAsset(
  row: { path: string; id: string; name: string; type: string; preview: string | null; provider?: AssetProvider },
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
  if ((type.startsWith("3d") || type === "3dplant" || type === "model") && walked.meshes === 0) {
    issues.push({
      kind: "missing-mesh",
      severity: "warning",
      assetId: row.id,
      name: row.name,
      path: row.path,
      message: "No mesh file found"
    });
  }
  // BlenderKit material assets are native .blend packages, not loose image maps.
  const nativeMaterialPackage = row.provider === "blenderkit" && ["surface", "material", "texture"].includes(type);
  if (["surface", "atlas", "decal", "texture", "model", "hdri"].includes(type) && walked.textures === 0 && !nativeMaterialPackage) {
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

type LibraryScan = Omit<ScanResult, "assets">;

function libraryFolderKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export class LibraryService {
  private readonly index: LibraryIndex;
  private snapshotCache: LibrarySnapshot | null = null;
  private scanRevision = 0;
  private readonly dirtyFolders = new Set<string>();
  private activeScan: { revision: number; force: boolean; result: Promise<LibraryScan | null> } | null = null;
  private closed = false;
  private sharedStatus: SharedLibraryStatus[] = [];
  private sharedSignature = "";
  private sharedEpoch = 0;
  private sharedScan: { signature: string; epoch: number; result: Promise<void> } | null = null;

  constructor(
    private readonly getLibraryPath: () => string,
    private readonly getPoliigonLibraryPath: () => string,
    private readonly getPolyHavenLibraryPath: () => string,
    private readonly lookupPoliigonAsset: (assetName: string) => PoliigonAssetSummary | null,
    private readonly lookupPolyHavenAsset: (id: string) => PolyHavenAssetSummary | null,
    indexPath: string,
    private readonly logger: Logger,
    private readonly getPublicLibraryPaths: () => Partial<Record<PublicProviderId, string>> = () => ({}),
    private readonly getSharedRoots: () => SharedLibraryRoot[] = () => [],
    private readonly onSharedProgress?: () => void
  ) {
    this.index = new LibraryIndex(indexPath, logger);
  }

  async scan(force = false, includeAssets = true): Promise<ScanResult> {
    const scan = await this.scanIndex(force);
    return { ...scan, assets: includeAssets ? this.index.allAssets() : [] };
  }

  private async scanIndex(force: boolean): Promise<LibraryScan> {
    for (;;) {
      if (this.closed) throw new Error("Library index is closed");
      const revision = this.scanRevision;
      let scan = this.activeScan;
      if (scan && (scan.revision !== revision || (force && !scan.force))) {
        // Let the sole writer finish, then share the replacement scan.
        await scan.result.catch(() => null);
        continue;
      }
      if (!scan) {
        const result = this.performScan(force, revision).finally(() => { this.activeScan = null; });
        scan = this.activeScan = { revision, force, result };
      }
      const result = await scan.result;
      if (result && revision === this.scanRevision) return result;
    }
  }

  private async performScan(force: boolean, revision: number): Promise<LibraryScan | null> {
    const libraryPath = this.getLibraryPath();
    const poliigonLibraryPath = this.getPoliigonLibraryPath();
    const polyhavenLibraryPath = this.getPolyHavenLibraryPath();
    const publicPaths = this.getPublicLibraryPaths();
    const started = Date.now();
    this.index.ensureLibraryPaths(libraryPath, poliigonLibraryPath, polyhavenLibraryPath);
    const megaFolders = await collectAssetFolders(libraryPath);
    const poliigonFolders = await collectPoliigonFolders(poliigonLibraryPath);
    const polyhavenFolders = await collectPolyHavenFolders(polyhavenLibraryPath);
    const publicFolders = (await Promise.all(Object.entries(publicPaths).map(async ([provider, root]) => {
      if (!isPublicProviderId(provider) || !root) return [];
      const folders = await listDirectories(root);
      // Only completed sidecar-backed assets belong to the Library, never a partial transfer.
      return (await Promise.all(folders.map(async folder => {
        const info = await stat(join(folder.folder, `openbridge-${provider}.json`)).catch(() => null);
        return info?.isFile() ? { ...folder, provider, repo: "downloaded" as const, sidecarMtime: info.mtimeMs } : null;
      }))).filter((folder): folder is NonNullable<typeof folder> => folder !== null);
    }))).flat();
    const folders: Array<{
      folder: string;
      repo: RepoKind;
      provider: AssetProvider;
      folderMtime: number;
      sidecarMtime?: number;
    }> = [
      ...publicFolders,
      ...megaFolders.map(folder => ({ ...folder, provider: "megascans" as const })),
      ...poliigonFolders.map(folder => ({
        ...folder,
        repo: "downloaded" as RepoKind,
        provider: "poliigon" as const
      })),
      ...polyhavenFolders.map(folder => ({
        ...folder,
        repo: "downloaded" as RepoKind,
        provider: "polyhaven" as const
      }))
    ];
    const seen = new Set<string>();
    const changes: Array<{ asset: AssetRecord; folderMtime: number; jsonMtime: number }> = [];
    const healthChanges: Array<{
      path: string;
      stats: { files: number; bytes: number; zeroBytes: number; meshes: number; textures: number };
      issues: LibraryIssue[];
    }> = [];
    let skipped = 0;

    for (const folder of folders) {
      if (this.closed || revision !== this.scanRevision) return null;
      seen.add(folder.folder);
      const cached = this.index.getCachedRow(folder.folder);
      if (!force && cached && !(this.dirtyFolders.size && this.dirtyFolders.has(libraryFolderKey(folder.folder))) &&
        Math.trunc(cached.folder_mtime) === Math.trunc(folder.folderMtime)) {
        if (folder.provider === "poliigon" || folder.provider === "polyhaven") {
          skipped += 1;
          continue;
        }
        const jsonMtime = folder.sidecarMtime ?? (await stat(cached.json_path).catch(() => null))?.mtimeMs;
        if (jsonMtime !== undefined && Math.trunc(jsonMtime) === Math.trunc(cached.json_mtime)) {
          skipped += 1;
          continue;
        }
      }

      if (folder.provider === "poliigon") {
        const inspected = await readPoliigonFolder(folder.folder, this.lookupPoliigonAsset);
        if (!inspected) {
          seen.delete(folder.folder);
          continue;
        }
        changes.push({
          asset: inspected.asset,
          folderMtime: folder.folderMtime,
          jsonMtime: 0
        });
        healthChanges.push({
          path: inspected.asset.path,
          stats: inspected.stats,
          issues: issuesForAsset(inspected.asset, inspected.stats)
        });
        continue;
      }

      if (folder.provider === "polyhaven" || isPublicProviderId(folder.provider)) {
        const inspected = await readPolyHavenFolder(folder.folder, folder.provider === "polyhaven" ? this.lookupPolyHavenAsset : () => null, folder.provider);
        if (!inspected) {
          seen.delete(folder.folder);
          continue;
        }
        changes.push({
          asset: inspected.asset,
          folderMtime: folder.folderMtime,
          jsonMtime: folder.sidecarMtime ?? 0
        });
        healthChanges.push({
          path: inspected.asset.path,
          stats: inspected.stats,
          issues: issuesForAsset(inspected.asset, inspected.stats)
        });
        continue;
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

    if (this.closed || revision !== this.scanRevision) return null;
    this.index.upsertMany(changes);
    if (healthChanges.length > 0) this.index.setHealthMany(healthChanges);
    const deleted = this.index.deleteMissing(seen);
    const shared = this.startSharedScan(force);
    if (!this.onSharedProgress) await shared;
    if (this.closed || revision !== this.scanRevision) return null;
    const scannedAt = Date.now();
    this.index.setScannedAt(scannedAt);
    this.dirtyFolders.clear();
    this.snapshotCache = null;

    this.logger.info("Library scan complete", {
      libraryPath,
      poliigonLibraryPath,
      polyhavenLibraryPath,
      assets: this.index.counts().all,
      changed: changes.length,
      skipped,
      deleted,
      milliseconds: scannedAt - started,
      indexed: true
    });
    return {
      scannedAt, libraryPath, poliigonLibraryPath, polyhavenLibraryPath,
      ambientcgLibraryPath: publicPaths.ambientcg,
      blenderkitLibraryPath: publicPaths.blenderkit,
      openhdriLibraryPath: publicPaths.openhdri,
      sharedLibraries: this.sharedStatus
    };
  }

  private startSharedScan(force: boolean): Promise<void> {
    const roots = this.getSharedRoots();
    const signature = JSON.stringify(roots);
    if (this.sharedScan?.signature === signature && this.sharedScan.epoch === this.sharedEpoch) return this.sharedScan.result;
    if (!force && signature === this.sharedSignature) return Promise.resolve();
    if (this.sharedScan) {
      // The running scan observes the new settings and stops at its next batch.
      return this.sharedScan.result.then(() => this.startSharedScan(force));
    }
    const epoch = ++this.sharedEpoch;
    const result = this.scanSharedAssets(roots, signature, epoch).catch(error => {
      if (this.closed) return;
      this.logger.warn("Shared library scan failed", { error });
      this.sharedStatus = this.sharedStatus.map(status => status.state === "scanning" ? { ...status, state: "partial" } : status);
      this.snapshotCache = null;
      this.onSharedProgress?.();
    }).finally(() => { this.sharedScan = null; });
    this.sharedScan = { signature, epoch, result };
    return result;
  }

  stopSharedScan(): void {
    if (!this.sharedScan || !this.sharedStatus.some(status => status.state === "scanning")) return;
    this.sharedEpoch++;
    this.sharedSignature = this.sharedScan.signature;
    this.sharedStatus = this.sharedStatus.map(status => status.state === "scanning" ? {
      id: status.id, state: "paused", count: this.index.countSharedRoot(status.id)
    } : status);
    this.snapshotCache = null;
    this.onSharedProgress?.();
  }

  private async scanSharedAssets(roots: SharedLibraryRoot[], signature: string, epoch: number): Promise<void> {
    const registered = new Set(roots.map(root => root.id));
    this.index.reconcileSharedRoots(registered, new Map());
    this.sharedStatus = roots.map(root => ({ id: root.id, state: "scanning", count: this.index.countSharedRoot(root.id) }));
    let lastProgress = 0;
    const progress = (): void => {
      this.snapshotCache = null;
      lastProgress = Date.now();
      this.onSharedProgress?.();
    };
    let currentRoots = roots;
    const cancelled = (): boolean => {
      if (this.closed || this.sharedEpoch !== epoch) return true;
      const changed = this.getSharedRoots();
      if (changed === currentRoots) return false;
      if (JSON.stringify(changed) !== signature) return true;
      currentRoots = changed;
      return false;
    };
    // Mounts progress independently. Commits are synchronous and each batch is bounded.
    const outcomes = await Promise.allSettled(roots.map(async root => {
      const seen = new Set<string>();
      const status = await scanSharedRoot(root, cancelled, assets => {
        const changed = assets.filter(asset => {
          const previous = this.index.getCachedRow(asset.path);
          if (previous && previous.repo !== "shared") return false;
          seen.add(asset.path);
          return !previous || previous.id !== asset.id || previous.mtime !== Math.trunc(asset.mtime) ||
            previous.preview !== asset.preview || previous.bytes !== asset.sizeBytes || previous.categories !== JSON.stringify(asset.categories);
        });
        this.index.upsertMany(changed.map(asset => ({ asset, folderMtime: asset.mtime, jsonMtime: 0 })));
        if (changed.length) this.index.setHealthMany(changed.map(asset => ({
          path: asset.path,
          stats: { files: 1, bytes: asset.sizeBytes ?? 0, zeroBytes: Number(asset.sizeBytes === 0), meshes: Number(asset.type === "3d"), textures: 0 },
          issues: asset.sizeBytes === 0 ? [{ kind: "zero-byte", severity: "error", assetId: asset.id, name: asset.name, path: asset.path, message: "This shared file is empty." }] : []
        })));
        if (Date.now() - lastProgress > 2000) {
          this.sharedStatus = this.sharedStatus.map(value => ({ ...value, count: this.index.countSharedRoot(value.id) }));
          progress();
        }
      });
      if (cancelled()) return;
      // An unmounted share can leave an accessible, empty mount point.
      const emptyMount = seen.size === 0 && this.index.countSharedRoot(root.id) > 0;
      if (status.state === "ready" && !emptyMount) this.index.reconcileSharedRoots(registered, new Map([[root.id, seen]]));
      this.sharedStatus = this.sharedStatus.map(value => value.id === root.id ? {
        id: root.id, state: emptyMount && status.state === "ready" ? "partial" : status.state,
        count: this.index.countSharedRoot(root.id)
      } : value);
      progress();
    }));
    if (cancelled()) return;
    for (let index = 0; index < outcomes.length; index++) {
      const outcome = outcomes[index];
      if (outcome.status !== "rejected") continue;
      const { id } = roots[index];
      this.logger.warn("Shared source could not finish indexing", { id, error: outcome.reason });
      this.sharedStatus = this.sharedStatus.map(value => value.id === id
        ? { id, state: "partial", count: this.index.countSharedRoot(id) }
        : value);
      progress();
    }
    this.sharedSignature = signature;
  }

  sharedSnapshot(): LibrarySnapshot | null {
    if (this.closed) return null;
    const paths = this.getPublicLibraryPaths();
    return this.readSnapshot({
      scannedAt: this.index.getScannedAt(),
      libraryPath: this.getLibraryPath(), poliigonLibraryPath: this.getPoliigonLibraryPath(),
      polyhavenLibraryPath: this.getPolyHavenLibraryPath(), ambientcgLibraryPath: paths.ambientcg,
      blenderkitLibraryPath: paths.blenderkit, openhdriLibraryPath: paths.openhdri,
      sharedLibraries: this.sharedStatus
    });
  }

  sharedVariants(id: string): AssetRecord[] {
    const asset = typeof id === "string" ? this.index.getById(id) : null;
    if (asset?.repo !== "shared") return [];
    const family = variantFamily(asset.name);
    return this.index.sharedSiblings(asset.path, sharedRootId(id))
      .filter(item => item.id !== id && item.type === asset.type && variantFamily(item.name) === family);
  }

  getSharedOrganization(id: string): SharedAssetOrganization {
    if (typeof id !== "string" || this.index.getById(id)?.repo !== "shared") throw new Error("This shared asset is no longer indexed.");
    return this.index.getSharedOrganization(id);
  }

  saveSharedOrganization(id: string, value: SharedAssetOrganization): SharedAssetOrganization {
    this.getSharedOrganization(id);
    const normalize = (input: unknown): string[] => {
      if (!Array.isArray(input)) return [];
      const names = new Map<string, string>();
      for (const entry of input.slice(0, 30)) {
        if (typeof entry !== "string") continue;
        const name = entry.trim().slice(0, 80);
        if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
      }
      return [...names.values()];
    };
    const clean = {
      tags: normalize(value?.tags),
      collections: normalize(value?.collections),
      notes: typeof value?.notes === "string" ? value.notes.trim().slice(0, 4000) : ""
    };
    this.index.setSharedOrganization(id, clean);
    return clean;
  }

  async sharedFile(id: string): Promise<{ asset: AssetRecord; path: string }> {
    const asset = this.index.getById(id);
    if (!asset || asset.repo !== "shared") throw new Error("This shared asset is no longer indexed.");
    return { asset, path: await resolveSharedFile(asset, this.getSharedRoots()) };
  }

  async snapshot(force = false): Promise<LibrarySnapshot> {
    if (!force && this.snapshotCache) return this.snapshotCache;
    return this.readSnapshot(await this.scanIndex(force));
  }

  private readSnapshot(scan: LibraryScan): LibrarySnapshot {
    const { libraryPath, poliigonLibraryPath, polyhavenLibraryPath, ambientcgLibraryPath, blenderkitLibraryPath, openhdriLibraryPath } = scan;
    return this.snapshotCache ??= {
      ...this.index.getSnapshot(libraryPath, poliigonLibraryPath, polyhavenLibraryPath),
      ambientcgLibraryPath, blenderkitLibraryPath, openhdriLibraryPath, sharedLibraries: scan.sharedLibraries
    };
  }

  getAsset(id: string): AssetRecord | null {
    return this.index.getById(id);
  }

  getAssets(ids: string[]): AssetRecord[] {
    return this.index.getByIds(ids);
  }
  query(options: LibraryQuery): LibraryQueryResult {
    return this.index.query(options);
  }
  ids(options: LibraryQuery): string[] {
    return this.index.ids(options);
  }

  async previews(id: string, indexedPath?: string): Promise<{ renders: MapPreview[]; maps: MapPreview[] }> {
    const asset = indexedPath ? this.index.getByIds([id]).find(item => item.path === indexedPath) : this.index.getById(id);
    if (!asset) throw new Error("Local asset is no longer indexed. Rescan the library.");
    const renders: MapPreview[] = [];
    const maps: MapPreview[] = [];
    if (asset.repo === "shared") {
      if (asset.preview) {
        const path = await resolveSharedFile(asset, this.getSharedRoots(), asset.preview).catch(() => "");
        if (path) renders.push({ type: "render", label: basename(path), url: pathToFileURL(path).href, panorama: false });
      }
      return { renders, maps };
    }
    // Only enumerate indexed asset folders, never renderer-supplied paths or symlinks.
    let inspected = 0;
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > 5 || inspected >= 5000) return;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (++inspected > 5000) break;
        if (entry.isSymbolicLink()) continue;
        const target = join(directory, entry.name);
        if (entry.isDirectory()) { await visit(target, depth + 1); continue; }
        if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
        const label = target.slice(asset.path.length + 1).replace(/\\/g, " / ");
        const preview: MapPreview = { type: entry.name, label, url: pathToFileURL(target).href };
        const tokens = entry.name.toLowerCase().split(/[^a-z0-9]+/);
        const mapType = asset.technical?.mapTypes.find(type => tokens.includes(type.toLowerCase()));
        if (asset.repo === "downloaded" && mapType) {
          preview.map = { type: mapType, referenceUri: entry.name, billboard: /billboard/i.test(entry.name) };
        }
        if (/preview|thumb|grid/i.test(entry.name)) renders.push(preview);
        else maps.push(preview);
      }
    };
    await visit(asset.path, 0);
    renders.sort((a, b) => a.label.localeCompare(b.label));
    maps.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return { renders, maps };
  }

  matchingAssets(ids: string[], scope?: LibraryQuery): AssetRecord[] {
    return this.index.matchingAssets(ids, scope);
  }

  async health(
    force = false,
    onProgress?: (progress: LibraryHealthProgress) => void,
    signal?: AbortSignal
  ): Promise<LibraryHealthReport> {
    const libraryPath = this.getLibraryPath();
    const poliigonLibraryPath = this.getPoliigonLibraryPath();
    const polyhavenLibraryPath = this.getPolyHavenLibraryPath();
    const started = Date.now();
    const scan = await this.scanIndex(false);
    signal?.throwIfAborted();
    this.readSnapshot(scan);
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
      signal?.throwIfAborted();
      const walked = await walkAssetFolder(row.path);
      signal?.throwIfAborted();
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
    const publicPaths = this.getPublicLibraryPaths();
    const report = this.index.healthReport(libraryPath, poliigonLibraryPath, polyhavenLibraryPath, publicPaths);
    this.logger.info("Library health complete", {
      libraryPath,
      poliigonLibraryPath,
      polyhavenLibraryPath,
      checked,
      assets: report.assets,
      issues: report.issues.length,
      milliseconds: Date.now() - started
    });
    return report;
  }

  async removeAssets(assetIds: string[], scope?: LibraryQuery): Promise<{ removed: number }> {
    const records = this.index.matchingAssets(assetIds, scope);
    const roots = [
      this.getLibraryPath(),
      this.getPoliigonLibraryPath(),
      this.getPolyHavenLibraryPath()
    ]
      .filter(Boolean)
      .map(path => resolve(path));
    let removed = 0;
    for (const asset of records) {
      if (asset.repo === "shared") continue;
      const target = resolve(asset.path);
      if (this.getSharedRoots().length) {
        const canonical = await realpath(target).catch(() => target);
        const shared = await Promise.all(this.getSharedRoots().map(root => realpath(root.path).catch(() => root.path)));
        if (shared.some(root => isInside(root, canonical) || isInside(canonical, root))) continue;
      }
      if (!roots.some(root => target === root || target.startsWith(root + sep))) continue;
      await rm(target, { recursive: true, force: true });
      removed += 1;
    }
    if (removed > 0) {
      this.invalidate();
      await this.scan(false, false);
    }
    return { removed };
  }

  invalidate(paths: Iterable<string> = []): void {
    for (const path of paths) this.dirtyFolders.add(libraryFolderKey(path));
    this.scanRevision += 1;
    this.snapshotCache = null;
  }
  storageSummary(): { measuredLibraryBytes: number; measuredAssets: number; totalAssets: number } {
    return this.index.storageSummary();
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
