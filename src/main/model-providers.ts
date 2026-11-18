import { readdir, readFile, rm, stat, utimes, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { downloadFile, extractZip } from "./downloader";
import { buildDownloadPayload } from "./download-manager";
import { signedFileUrl } from "./map-previews";
import { scanLocalModel } from "./model-preview";
import type { DownloadOptions } from "../shared/types";
import {
  canonicalModelMapType,
  modelFormatFromExtension,
  modelPartMaterialKey,
  modelTextureMaterialKey,
  normalizeModelMaterialKey,
  resolutionFromText,
  type ModelManifest,
  type ModelManifestRequest,
  type ModelLodMode,
  type ModelMapType,
  type ModelMeshPart,
  type ModelMeshVariant
} from "../shared/model-preview";

const CACHE_LIMIT = 2 * 1024 * 1024 * 1024;
const inflight = new Map<string, Promise<ModelManifest>>();

export interface ModelProviderContext {
  cacheRoot: string;
  megascans?: {
    extended(id: string): Promise<any>;
    signedMapsUrl(): Promise<string>;
    requestDownload(payload: Record<string, unknown>): Promise<any>;
  };
  polyhaven?: { extended(id: string): Promise<any> };
  ambientcg?: { extended(id: string): any };
  blenderkit?: {
    extended(id: string): Promise<any>;
    resolveDownload(url: string): Promise<string>;
  };
  poliigon?: {
    extended(id: string): any;
    modelPreview(id: string, resolution: string, lod?: string): Promise<{
      resolution: string;
      lod: string;
      files: Array<{ url: string; name: string; bytes: number; resolution?: string }>;
      dynamicFiles: Array<{ name: string; contents: string }>;
    }>;
  };
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

let context: ModelProviderContext | null = null;

export function configureModelProviders(next: ModelProviderContext): void {
  context = next;
}

function safe(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "_").slice(0, 160) || "asset";
}

function cacheFolder(provider: string, id: string, key: string): string {
  if (!context) throw new Error("3D model service is not ready");
  return join(context.cacheRoot, safe(provider), safe(id), safe(key));
}

async function readyFolder(folder: string): Promise<boolean> {
  const marker = await stat(join(folder, ".ready")).catch(() => null);
  return Boolean(marker?.isFile());
}

async function markReady(folder: string): Promise<void> {
  await writeFile(join(folder, ".ready"), new Date().toISOString(), "utf8");
}

async function previewExtras(folder: string): Promise<{ qualities?: number[]; lods?: number[]; notes?: string[]; name?: string } | null> {
  try {
    const parsed = JSON.parse(await readFile(join(folder, ".preview-meta.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function touchFolder(folder: string): Promise<void> {
  const now = new Date();
  await utimes(folder, now, now).catch(() => undefined);
}

async function download(url: string, destination: string, signal?: AbortSignal): Promise<string> {
  await mkdir(join(destination, ".."), { recursive: true });
  return downloadFile(url, destination, undefined, 120, signal, undefined, undefined, 512 * 1024 * 1024);
}

async function packageManifest(
  folder: string,
  request: ModelManifestRequest,
  provider: string,
  extras: { name?: string; qualities?: number[]; lods?: number[]; notes?: string[] }
): Promise<ModelManifest> {
  const scanned = await scanLocalModel(folder, request.assetId, provider, request.type ?? "");
  return {
    ...scanned,
    source: "provider",
    name: extras.name ?? scanned.name,
    availableQualities: extras.qualities ?? scanned.availableQualities,
    availableLods: extras.lods ?? scanned.availableLods,
    notes: [...(extras.notes ?? []), ...scanned.notes],
    unsupported: scanned.unsupported
  };
}

function nearestQuality(values: number[], requested: number | undefined): number | null {
  if (!values.length) return null;
  const target = requested && requested > 0 ? requested : values[0];
  const lower = [...values].reverse().find(value => value <= target);
  return lower ?? values[0];
}

function resolutionKeys(quality: number): string[] {
  if (quality >= 8192) return ["8k", "4k", "2k", "1k"];
  if (quality >= 4096) return ["4k", "2k", "1k"];
  if (quality >= 2048) return ["2k", "1k"];
  return ["1k", "2k", "4k", "8k"];
}

async function pruneCache(): Promise<void> {
  if (!context) return;
  try {
    const providers = await readdir(context.cacheRoot, { withFileTypes: true }).catch(() => []);
    const folders: Array<{ path: string; at: number; bytes: number }> = [];
    const size = async (folder: string): Promise<number> => {
      let total = 0;
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const target = join(folder, entry.name);
        if (entry.isDirectory()) total += await size(target);
        else total += (await stat(target).catch(() => null))?.size ?? 0;
      }
      return total;
    };
    for (const provider of providers) {
      if (!provider.isDirectory()) continue;
      const base = join(context.cacheRoot, provider.name);
      const assets = await readdir(base, { withFileTypes: true }).catch(() => []);
      for (const asset of assets) {
        if (!asset.isDirectory()) continue;
        const path = join(base, asset.name);
        folders.push({ path, at: (await stat(path).catch(() => null))?.mtimeMs ?? 0, bytes: await size(path) });
      }
    }
    let total = folders.reduce((sum, folder) => sum + folder.bytes, 0);
    const ordered = folders.sort((a, b) => a.at - b.at);
    for (let index = 0; index < ordered.length; index++) {
      const folder = ordered[index];
      if (total <= CACHE_LIMIT) break;
      // Keep the most recently used package even when a single 8K set is
      // larger than the cache budget; otherwise it would be deleted right
      // after a successful download and never become reusable.
      if (index === ordered.length - 1) break;
      await rm(folder.path, { recursive: true, force: true });
      total -= folder.bytes;
    }
  } catch (error) {
    context?.logger?.warn("3D preview cache cleanup failed", { error });
  }
}

async function withCache(
  key: string,
  request: ModelManifestRequest,
  folder: string,
  cachedExtras: { qualities?: number[]; lods?: number[]; notes?: string[]; name?: string },
  prepare: () => Promise<{ qualities?: number[]; lods?: number[]; notes?: string[]; name?: string }>,
  customize?: (manifest: ModelManifest) => ModelManifest
): Promise<ModelManifest> {
  const cached = inflight.get(key);
  if (cached) return cached;
  const promise = (async () => {
    if (!(await readyFolder(folder))) {
      await rm(folder, { recursive: true, force: true });
      await mkdir(folder, { recursive: true });
      const extras = await prepare();
      await markReady(folder);
      void pruneCache();
      const manifest = await packageManifest(folder, request, request.provider, { ...cachedExtras, ...extras });
      await touchFolder(folder);
      return customize ? customize(manifest) : manifest;
    }
    const fallbackMeta = await previewExtras(folder);
    const manifest = await packageManifest(
      folder,
      request,
      request.provider,
      fallbackMeta ? { ...cachedExtras, ...fallbackMeta } : cachedExtras
    );
    await touchFolder(folder);
    return customize ? customize(manifest) : manifest;
  })();
  inflight.set(key, promise);
  try { return await promise; }
  finally { inflight.delete(key); }
}

interface MegascansMapCandidate {
  mapType: ModelMapType;
  resolution: number;
  lod: number | null;
  uri: string;
  bytes: number;
  format: string;
  componentType: string;
  reference: boolean;
  normalSpace?: "gl" | "dx";
}

interface MegascansLodFile {
  number: number;
  uri: string;
  bytes: number;
  reference: boolean;
}

function megascansLodFromUri(uri: string): number | null {
  const match = /_lod(\d+)(?=[._-]|$)/i.exec(uri);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function megascansVariationFromName(name: string): number | null {
  const match = /(?:^|[\\/_\-\s])var(\d+)(?=[_\-.\s]|$)/i.exec(name);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function megascansDescriptorName(descriptor: any): string {
  const saveAs = String(descriptor?.saveAs ?? "").replace(/\\/g, "/");
  if (saveAs) return basename(saveAs);
  try {
    return basename(new URL(String(descriptor?.uri ?? "")).pathname);
  } catch {
    return "";
  }
}

function megascansLodFiles(asset: any): MegascansLodFile[] {
  const output = new Map<number, MegascansLodFile>();
  for (const model of Array.isArray(asset?.models) ? asset.models : []) {
    if (model?.type !== "lod") continue;
    if (!/\.fbx$/i.test(String(model?.uri ?? "")) && !/fbx/i.test(String(model?.mimeType ?? ""))) continue;
    const number = Number(model?.lod ?? megascansLodFromUri(String(model?.uri ?? "")));
    if (!Number.isFinite(number) || output.has(number)) continue;
    output.set(number, {
      number,
      uri: String(model.uri),
      bytes: Number(model?.contentLength) || 0,
      reference: false
    });
  }
  for (const mesh of Array.isArray(asset?.meshes) ? asset.meshes : []) {
    if (mesh?.type !== "lod") continue;
    const fbx = (Array.isArray(mesh?.uris) ? mesh.uris : []).find((item: any) =>
      /fbx/i.test(String(item?.mimeType ?? "")) || /\.fbx$/i.test(String(item?.uri ?? ""))
    );
    if (!fbx?.uri) continue;
    const number = megascansLodFromUri(String(fbx.uri));
    if (number === null) continue;
    output.set(number, {
      number,
      uri: String(fbx.uri),
      bytes: Number(fbx.contentLength) || 0,
      reference: false
    });
  }
  for (const raw of Array.isArray(asset?.referencePreviews?.models) ? asset.referencePreviews.models : []) {
    const uri = String(raw?.uri ?? "");
    if (!/\.fbx$/i.test(uri)) continue;
    const number = megascansLodFromUri(uri);
    if (number === null || output.has(number)) continue;
    output.set(number, {
      number,
      uri,
      bytes: Number(raw?.contentLength) || 0,
      reference: true
    });
  }
  return [...output.values()].sort((a, b) => a.number - b.number);
}

function megascansMapCandidates(asset: any): MegascansMapCandidate[] {
  const candidates: MegascansMapCandidate[] = [];
  for (const component of Array.isArray(asset?.components) ? asset.components : []) {
    const componentType = String(component?.type ?? "");
    for (const group of Array.isArray(component?.uris) ? component.uris : []) {
      for (const resolution of Array.isArray(group?.resolutions) ? group.resolutions : []) {
        const pixels = resolutionFromText(String(resolution?.resolution ?? "")) ?? 1024;
        for (const format of Array.isArray(resolution?.formats) ? resolution.formats : []) {
          const uri = String(format?.uri ?? "");
          const extension = extname(uri).toLowerCase();
          if (!uri || ![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) continue;
          const parsed = canonicalModelMapType(`${componentType} ${uri}`);
          if (parsed.mapType === "unknown") continue;
          candidates.push({
            mapType: parsed.mapType,
            resolution: pixels,
            lod: megascansLodFromUri(uri),
            uri,
            bytes: Number(format?.contentLength) || 0,
            format: extension.slice(1),
            componentType,
            reference: false,
            ...(parsed.normalSpace ? { normalSpace: parsed.normalSpace } : {})
          });
        }
      }
    }
  }
  for (const raw of Array.isArray(asset?.maps) ? asset.maps : []) {
    const uri = String(raw?.uri ?? "");
    const extension = extname(uri).toLowerCase();
    if (!uri || ![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) continue;
    const parsed = canonicalModelMapType(`${raw?.type ?? ""} ${uri}`);
    if (parsed.mapType === "unknown") continue;
    candidates.push({
      mapType: parsed.mapType,
      resolution: resolutionFromText(String(raw?.resolution ?? "")) ?? 1024,
      lod: megascansLodFromUri(uri),
      uri,
      bytes: Number(raw?.contentLength) || 0,
      format: extension.slice(1),
      componentType: String(raw?.type ?? ""),
      reference: false,
      ...(parsed.normalSpace ? { normalSpace: parsed.normalSpace } : {})
    });
  }
  for (const raw of Array.isArray(asset?.referencePreviews?.maps) ? asset.referencePreviews.maps : []) {
    const uri = String(raw?.uri ?? "");
    const extension = extname(uri).toLowerCase();
    if (!uri || ![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) continue;
    const parsed = canonicalModelMapType(`${raw?.type ?? ""} ${uri}`);
    if (parsed.mapType === "unknown") continue;
    candidates.push({
      mapType: parsed.mapType,
      resolution: resolutionFromText(String(raw?.resolution ?? "")) ?? 1024,
      lod: megascansLodFromUri(uri),
      uri,
      bytes: Number(raw?.contentLength) || 0,
      format: extension.slice(1),
      componentType: String(raw?.type ?? ""),
      reference: true,
      ...(parsed.normalSpace ? { normalSpace: parsed.normalSpace } : {})
    });
  }
  const unique = new Map<string, MegascansMapCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.mapType}:${candidate.resolution}:${candidate.lod ?? "none"}:${candidate.uri}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

function megascansPreviewOptions(asset: any, quality: number, lod: number | null): DownloadOptions {
  const componentTypes = new Set<string>();
  for (const component of Array.isArray(asset?.components) ? asset.components : []) {
    const type = String(component?.type ?? "").trim();
    if (type) componentTypes.add(type);
  }
  for (const map of Array.isArray(asset?.maps) ? asset.maps : []) {
    const type = String(map?.type ?? "").trim();
    if (type) componentTypes.add(type);
  }
  for (const map of Array.isArray(asset?.referencePreviews?.maps) ? asset.referencePreviews.maps : []) {
    const type = String(map?.type ?? "").trim();
    if (type) componentTypes.add(type);
  }
  const types = componentTypes.size
    ? [...componentTypes]
    : ["albedo", "normal", "roughness", "metalness", "ao", "displacement"];
  return {
    resolution: quality,
    textureFormat: "jpg",
    components: types.map(type => ({ type, selected: true, mimeType: "image/jpeg" })),
    meshFormat: "fbx",
    lods: Array.from({ length: 9 }, (_, index) => lod === null ? true : index === lod),
    downloadAllPlantLods: false,
    highpoly: false,
    ztool: false,
    brushes: false,
    uniqueMapsPerLod: true,
    billboards: false,
    variation: 1
  };
}

async function downloadMegascansResponse(response: any, folder: string): Promise<void> {
  const descriptors = [
    ...(Array.isArray(response?.meshes) ? response.meshes : []),
    ...(Array.isArray(response?.components) ? response.components : [])
  ];
  const isMeshName = (name: string): boolean =>
    [".fbx", ".obj", ".glb", ".gltf", ".usd", ".usda", ".usdc", ".usdz"].includes(extname(name).toLowerCase());
  const variations = descriptors
    .map(descriptor => megascansDescriptorName(descriptor))
    .filter(name => isMeshName(name))
    .map(name => megascansVariationFromName(name))
    .filter((value): value is number => value !== null);
  const keepVariation = variations.length > 1 ? Math.min(...variations) : null;
  const used = new Set<string>();
  let meshCount = 0;
  for (const descriptor of descriptors) {
    const uri = String(descriptor?.uri ?? "");
    if (!/^https?:/i.test(uri)) continue;
    const name = megascansDescriptorName(descriptor);
    if (!name) continue;
    const extension = extname(name).toLowerCase();
    const mesh = isMeshName(name);
    const image = [".jpg", ".jpeg", ".png", ".webp", ".tga", ".exr"].includes(extension);
    if (!mesh && !image) continue;
    if (mesh && keepVariation !== null) {
      const variation = megascansVariationFromName(name);
      if (variation !== null && variation !== keepVariation) continue;
    }
    let unique = name;
    let suffix = 2;
    while (used.has(unique)) {
      unique = `${suffix}_${name}`;
      suffix += 1;
    }
    used.add(unique);
    await download(uri, join(folder, unique));
    if (mesh) meshCount += 1;
  }
  if (meshCount === 0) throw new Error("Megascans returned no runtime mesh for the selected LOD.");
}

async function megascansReferenceFallback(
  folder: string,
  asset: any,
  signedBase: string,
  name: string,
  fallbackNote: string
): Promise<{ qualities: number[]; lods: number[]; notes: string[]; name: string }> {
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const reference = asset?.referencePreviews ?? {};
  const rawMeshes = Array.isArray(reference.models) ? reference.models : [];
  const rawMaps = Array.isArray(reference.maps) ? reference.maps : [];
  const variations = rawMeshes
    .map((raw: any) => megascansVariationFromName(String(raw?.uri ?? "")))
    .filter((value: number | null): value is number => value !== null);
  const keepVariation = variations.length > 1 ? Math.min(...variations) : null;
  const lods = new Set<number>();
  let meshCount = 0;
  for (const raw of rawMeshes) {
    const uri = String(raw?.uri ?? "");
    const extension = extname(uri).toLowerCase();
    const format = modelFormatFromExtension(extension);
    if (!uri || !format || (format !== "fbx" && format !== "obj" && format !== "gltf" && format !== "glb" && format !== "usd" && format !== "usdc" && format !== "usdz")) continue;
    if (keepVariation !== null) {
      const variation = megascansVariationFromName(uri);
      if (variation !== null && variation !== keepVariation) continue;
    }
    const lod = megascansLodFromUri(uri);
    if (lod !== null) lods.add(lod);
    await download(signedFileUrl(signedBase, uri), join(folder, basename(uri)));
    meshCount += 1;
  }
  for (const raw of rawMaps) {
    const uri = String(raw?.uri ?? "");
    if (!uri || !/\.(jpe?g|png|webp)$/i.test(uri)) continue;
    await download(signedFileUrl(signedBase, uri), join(folder, basename(uri)));
  }
  if (!meshCount) throw new Error("Megascans did not publish a runtime preview mesh for this asset.");
  const extras = {
    name,
    qualities: [1024],
    lods: [...lods].sort((a, b) => a - b),
    notes: [fallbackNote]
  };
  await writeFile(join(folder, ".preview-meta.json"), JSON.stringify(extras), "utf8");
  return extras;
}

async function megascansManifest(request: ModelManifestRequest): Promise<ModelManifest> {
  const megascans = context?.megascans;
  if (!megascans) throw new Error("Megascans preview service is not available.");
  const [asset, signedBase] = await Promise.all([
    megascans.extended(request.assetId),
    megascans.signedMapsUrl()
  ]);
  const lods = megascansLodFiles(asset);
  const lodNumbers = lods.map(item => item.number);
  const candidates = megascansMapCandidates(asset);
  const qualities = [...new Set(candidates.map(candidate => candidate.resolution))].sort((a, b) => a - b);
  const aclResolution = Number(asset?.acl?.resolution);
  const allowedQualities = aclResolution > 0
    ? qualities.filter(value => value <= aclResolution)
    : qualities;
  const availableQualities = allowedQualities.length ? allowedQualities : [1024];
  const targetQuality = request.quality && request.quality > 0 ? request.quality : 1024;
  const chosenQuality = [...availableQualities].filter(value => value <= targetQuality).sort((a, b) => b - a)[0]
    ?? availableQualities[0];
  const chosenLod = lodNumbers.length === 0
    ? null
    : typeof request.lod === "number"
      ? lodNumbers.includes(request.lod) ? request.lod : lodNumbers[0]
      : request.lod === "highest" ? lodNumbers[0] : lodNumbers[lodNumbers.length - 1];
  const qualityLabel = chosenQuality >= 1024 ? `${chosenQuality / 1024}K` : `${chosenQuality}px`;
  const folder = cacheFolder(
    "megascans",
    request.assetId,
    `preview-${chosenQuality}${chosenLod === null ? "" : `-lod${chosenLod}`}`
  );
  const key = `megascans:${request.assetId}:${chosenQuality}:${chosenLod ?? "mesh"}`;
  const name = String(asset?.name ?? request.name ?? request.assetId);
  const notes = [
    `Megascans catalog preview uses a ${qualityLabel}${chosenLod === null ? "" : ` LOD${chosenLod}`} runtime mesh and matching JPEG maps. The provider request may count as a download.`
  ];
  return withCache(key, request, folder, {
    name,
    qualities: availableQualities,
    lods: lodNumbers,
    notes
  }, async () => {
    try {
      const payload = buildDownloadPayload(asset, request.assetId, megascansPreviewOptions(asset, chosenQuality, chosenLod));
      const response = await megascans.requestDownload(payload);
      await downloadMegascansResponse(response, folder);
      return { name, qualities: availableQualities, lods: lodNumbers, notes };
    } catch (error) {
      context?.logger?.warn("Megascans requested preview tier failed; falling back to reference maps", {
        assetId: request.assetId,
        quality: chosenQuality,
        lod: chosenLod,
        error
      });
      return megascansReferenceFallback(
        folder,
        asset,
        signedBase,
        name,
        `The provider could not supply the ${qualityLabel} ${chosenLod === null ? "" : `LOD${chosenLod} `}preview for this account; showing the 1K reference preview instead.`
      );
    }
  });
}

async function polyhavenManifest(request: ModelManifestRequest): Promise<ModelManifest> {
  if (!context?.polyhaven) throw new Error("Poly Haven preview service is not available.");
  const detail = await context.polyhaven.extended(request.assetId);
  const formats = Array.isArray(detail?.modelFormats) ? detail.modelFormats.map((value: string) => value.toLowerCase()) : [];
  const format = ["gltf", "glb", "fbx", "obj", "usd"].find(value => formats.includes(value));
  if (!format) throw new Error("Poly Haven did not publish a runtime glTF/FBX/OBJ/USD model for this asset.");
  const files = detail?.files ?? {};
  const resolutions = Array.isArray(detail?.resolutions) ? detail.resolutions.map((value: string) => resolutionFromText(value)).filter((value: number | null): value is number => Boolean(value)) : [];
  const quality = nearestQuality(resolutions, request.quality) ?? 1024;
  const resKeys = resolutionKeys(quality);
  let packageUrl = "";
  let packageName = "";
  let packageEntry: any = null;
  let chosenResKey = "";
  for (const resKey of resKeys) {
    const entry = files?.[format]?.[resKey]?.[format];
    if (entry?.url) {
      packageEntry = entry;
      packageUrl = String(entry.url);
      packageName = `${format}-${resKey}`;
      chosenResKey = resKey;
      break;
    }
  }
  if (!packageUrl) throw new Error("Poly Haven has no model package at the requested quality.");
  const folder = cacheFolder("polyhaven", request.assetId, packageName);
  const key = `polyhaven:${request.assetId}:${packageName}`;
  const notes = [`Poly Haven ${format.toUpperCase()} package at ${resKey(packageName)}.`];
  return withCache(key, request, folder, {
    name: String(detail?.name ?? request.name ?? request.assetId),
    qualities: resolutions,
    lods: [],
    notes
  }, async () => {
    const fileName = basename(new URL(packageUrl).pathname) || `model.${format}`;
    await download(packageUrl, join(folder, fileName));
    const include = packageEntry?.include && typeof packageEntry.include === "object" ? packageEntry.include : {};
    for (const [relative, raw] of Object.entries(include)) {
      const target = join(folder, relative);
      if (!target.startsWith(folder + sep)) continue;
      const url = typeof raw === "string" ? raw : raw && typeof raw === "object" ? String((raw as any).url ?? "") : "";
      if (!url) continue;
      await mkdir(dirname(target), { recursive: true });
      await download(url, target);
    }
    // Poly Haven glTF packages do not always include the separate alpha sheet
    // used by foliage cards. Pull it alongside the package so the viewer can
    // patch the embedded material without changing the glTF.
    const alphaUrls = new Set<string>();
    for (const [key, entry] of Object.entries(files)) {
      if (!/alpha|opacity|mask/i.test(key)) continue;
      const resolutionEntry = entry && typeof entry === "object" ? (entry as any)[chosenResKey] : null;
      if (!resolutionEntry || typeof resolutionEntry !== "object") continue;
      for (const format of ["png", "jpg", "jpeg", "exr"]) {
        const file = (resolutionEntry as any)[format];
        if (file?.url) { alphaUrls.add(String(file.url)); break; }
      }
    }
    for (const url of alphaUrls) {
      const name = basename(new URL(url).pathname);
      if (name) await download(url, join(folder, name));
    }
    return {
      name: String(detail?.name ?? request.name ?? request.assetId),
      qualities: resolutions,
      lods: [],
      notes
    };
  });
}

function resKey(value: string): string {
  const match = /-(1k|2k|4k|8k)$/i.exec(value);
  return match ? match[1].toUpperCase() : value;
}

async function ambientCgManifest(request: ModelManifestRequest): Promise<ModelManifest> {
  const ambientcg = context?.ambientcg;
  if (!ambientcg) throw new Error("ambientCG preview service is not available.");
  const detail = ambientcg.extended(request.assetId.replace(/^ambientcg:/i, ""));
  const files = Array.isArray(detail?.files) ? detail.files : [];
  const packages: any[] = files.filter((file: any) => /\.zip$/i.test(String(file?.name ?? "")) && /(?:LQ|SQ|HQ)-\d+K-(?:JPG|PNG)\.zip$/i.test(String(file?.name ?? "")));
  const packageQualities = packages
    .map((file: any) => resolutionFromText(String(file.name)))
    .filter((value): value is number => typeof value === "number" && value > 0);
  const qualities = [...new Set<number>(packageQualities)].sort((a, b) => a - b);
  const quality = nearestQuality(qualities, request.quality) ?? 1024;
  const wanted = packages.find((file: any) => new RegExp(`^LQ-${quality / 1024}K-JPG\\.zip$`, "i").test(file.name))
    ?? packages.find((file: any) => new RegExp(`^LQ-${quality / 1024}K-PNG\\.zip$`, "i").test(file.name))
    ?? packages.find((file: any) => new RegExp(`^${quality / 1024}K-JPG\\.zip$`, "i").test(file.name))
    ?? packages.find((file: any) => new RegExp(`${quality / 1024}K`, "i").test(file.name));
  if (!wanted) throw new Error("ambientCG has no runtime OBJ package at the requested quality.");
  const folder = cacheFolder("ambientcg", request.assetId, String(wanted.name).replace(/\.zip$/i, ""));
  const key = `ambientcg:${request.assetId}:${wanted.name}`;
  const notes = [`ambientCG ${wanted.name} package.`];
  return withCache(key, request, folder, {
    name: String(detail?.name ?? request.name ?? request.assetId),
    qualities,
    lods: [],
    notes
  }, async () => {
    const archive = join(folder, "package.zip");
    await download(String(wanted.url), archive);
    await extractZip(archive, folder);
    await rm(archive, { force: true });
    return {
      name: String(detail?.name ?? request.name ?? request.assetId),
      qualities,
      lods: [],
      notes
    };
  });
}

async function blenderkitManifest(request: ModelManifestRequest): Promise<ModelManifest> {
  const blenderkit = context?.blenderkit;
  if (!blenderkit) throw new Error("BlenderKit preview service is not available.");
  const detail = await blenderkit.extended(request.assetId);
  const files = Array.isArray(detail?.files) ? detail.files : [];
  const candidates = files.filter((file: any) => {
    const format = String(file?.format ?? "").toLowerCase();
    const name = String(file?.name ?? "").toLowerCase();
    return ["glb", "gltf", "fbx", "obj", "usd", "usdz"].includes(format) || /\.(glb|gltf|fbx|obj|usd|usdz)$/.test(name);
  });
  const file = candidates.find((item: any) => String(item.format).toLowerCase() === "glb")
    ?? candidates.find((item: any) => String(item.format).toLowerCase() === "gltf")
    ?? candidates.find((item: any) => String(item.format).toLowerCase() === "fbx")
    ?? candidates[0];
  if (!file?.url) throw new Error("BlenderKit did not publish a runtime glTF/FBX/OBJ file for this asset.");
  const extension = (String(file.format ?? "").toLowerCase() || extname(String(file.name ?? "")).replace(/^\./, "")) || "bin";
  const folder = cacheFolder("blenderkit", request.assetId, `runtime-${safe(extension)}`);
  const key = `blenderkit:${request.assetId}:${extension}`;
  const notes = ["BlenderKit runtime file downloaded through the provider resolver."];
  return withCache(key, request, folder, {
    name: String(detail?.name ?? request.name ?? request.assetId),
    qualities: [],
    lods: [],
    notes
  }, async () => {
    const target = join(folder, safe(basename(String(file.name ?? `model.${extension}`))));
    const resolved = await blenderkit.resolveDownload(String(file.url));
    await download(resolved, target);
    return {
      name: String(detail?.name ?? request.name ?? request.assetId),
      qualities: [],
      lods: [],
      notes
    };
  });
}

const POLIIGON_TEXTURE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tga", ".exr"]);
const POLIIGON_SIDECAR_EXTENSIONS = new Set([".mtl", ".bin"]);
const POLIIGON_PREVIEW_NAME = /(?:^|[_\-\s])(?:preview|thumb|thumbnail)\d*(?:[_\-\s.]|$)/i;
const POLIIGON_RUNTIME_EXTENSIONS = new Set([".fbx", ".obj", ".glb", ".gltf", ".usd", ".usda", ".usdc", ".usdz"]);
const POLIIGON_RUNTIME_ORDER = [".fbx", ".obj", ".glb", ".gltf", ".usdz", ".usdc", ".usda", ".usd"];

function safeRelativePath(value: string): string {
  const parts = value
    .replace(/\\/g, "/")
    .split("/")
    .filter(part => part && part !== "." && part !== "..");
  return parts.length > 0 ? parts.join(sep) : "file.bin";
}

function packageTarget(folder: string, relative: string): string {
  const base = resolve(folder);
  const target = resolve(join(base, safeRelativePath(relative)));
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Poliigon preview path escapes the cache folder: ${relative}`);
  }
  return target;
}

function poliigonResolutionTiers(resolutions: unknown[]): Array<{ label: string; pixels: number }> {
  return resolutions
    .map(label => ({ label: String(label), pixels: resolutionFromText(String(label)) ?? 0 }))
    .filter(item => item.pixels > 0);
}

function poliigonChooseResolution(
  resolutions: unknown[],
  quality: number | undefined
): { label: string; pixels: number } {
  const tiers = poliigonResolutionTiers(resolutions);
  if (!tiers.length) return { label: "1K", pixels: 1024 };
  const requested = quality && quality > 0 ? quality : 1024;
  const lower = [...tiers].filter(item => item.pixels <= requested).sort((a, b) => b.pixels - a.pixels)[0];
  return lower ?? [...tiers].sort((a, b) => a.pixels - b.pixels)[0];
}

function poliigonLods(lods: unknown[]): Array<{ label: string; number: number }> {
  return lods
    .map(label => {
      const number = Number(/(\d+)/.exec(String(label))?.[1] ?? NaN);
      return Number.isFinite(number) ? { label: String(label), number } : null;
    })
    .filter((item): item is { label: string; number: number } => item !== null)
    .sort((a, b) => a.number - b.number);
}

function poliigonChooseLod(
  lods: Array<{ label: string; number: number }>,
  mode: ModelLodMode | undefined
): { label: string; number: number } | null {
  if (!lods.length) return null;
  if (typeof mode === "number") return lods.find(item => item.number === mode) ?? lods[0];
  return mode === "highest" ? lods[lods.length - 1] : lods[0];
}

function poliigonLodPattern(lod: number): RegExp {
  return new RegExp(`(?:^|[_-])lod${lod}(?=[_-]|\\.|$)`, "i");
}

function poliigonRuntimeFiles<T extends { name: string }>(files: T[], lod: number | null): T[] {
  const runtime = files.filter(file => POLIIGON_RUNTIME_EXTENSIONS.has(extname(file.name).toLowerCase()));
  if (lod !== null) {
    const matches = runtime.filter(file => poliigonLodPattern(lod).test(basename(file.name)));
    if (matches.length) return matches;
  }
  const base = runtime.filter(file => !/(?:^|[_-])lod\d+(?=[_-]|\.|$)/i.test(basename(file.name)));
  return base.length ? base : runtime;
}

export function applyPoliigonMeshLayout(manifest: ModelManifest, expectedMeshes?: number): ModelManifest {
  const existing = manifest.meshes.filter(mesh => mesh.parts?.length);
  if (!existing.length) return manifest;
  const row = !expectedMeshes || existing.some(mesh => (mesh.parts?.length ?? 0) > expectedMeshes);
  return {
    ...manifest,
    meshes: manifest.meshes.map(mesh => mesh.parts?.length
      ? { ...mesh, partsLayout: row ? "row" : undefined }
      : mesh
    )
  };
}

function poliigonAssembly(manifest: ModelManifest, lod: number | null, expectedMeshes?: number): ModelManifest {
  const laidOut = applyPoliigonMeshLayout(manifest, expectedMeshes);
  if (laidOut.meshes.some(mesh => mesh.parts?.length)) return laidOut;
  const runtime = manifest.meshes.filter(mesh =>
    !mesh.parts && POLIIGON_RUNTIME_EXTENSIONS.has(`.${mesh.format}`)
  );
  if (runtime.length <= 1) return manifest;
  const format = POLIIGON_RUNTIME_ORDER.find(extension => runtime.some(mesh => mesh.format === extension.slice(1)))?.slice(1)
    ?? runtime[0].format;
  const sameFormat = runtime.filter(mesh => mesh.format === format);
  const lodMatched = lod === null ? [] : sameFormat.filter(mesh => mesh.lod === lod);
  let selected = lodMatched.length ? lodMatched : sameFormat.filter(mesh => mesh.lod === null);
  if (!selected.length) selected = sameFormat;
  const unique = [...new Map(selected.map(mesh => [mesh.url, mesh])).values()];
  if (!unique.length) return manifest;
  if (unique.length === 1) {
    return { ...manifest, meshes: [unique[0]], defaultMesh: unique[0] };
  }
  const parts: ModelMeshPart[] = unique.map(mesh => ({
    url: mesh.url,
    format: mesh.format,
    label: mesh.label,
    materialKey: modelPartMaterialKey(mesh.label),
    ...(mesh.mtlUrl ? { mtlUrl: mesh.mtlUrl } : {})
  }));
  const variant: ModelMeshVariant = {
    ...unique[0],
    label: `${unique.length} parts`,
    lod,
    bytes: unique.reduce((sum, mesh) => sum + mesh.bytes, 0),
    triangles: unique.reduce((sum, mesh) => sum + (mesh.triangles ?? 0), 0) || null,
    parts,
    ...(!expectedMeshes || parts.length > expectedMeshes ? { partsLayout: "row" as const } : {})
  };
  return { ...manifest, meshes: [variant], defaultMesh: variant };
}

async function poliigonManifest(request: ModelManifestRequest): Promise<ModelManifest> {
  const poliigon = context?.poliigon;
  if (!poliigon) throw new Error("Poliigon preview service is not available.");
  const detail = await poliigon.extended(request.assetId);
  const quality = poliigonChooseResolution(Array.isArray(detail?.resolutions) ? detail.resolutions : [], request.quality);
  const lods = poliigonLods(Array.isArray(detail?.lods) ? detail.lods : []);
  const chosenLod = poliigonChooseLod(lods, request.lod);
  const qualities = [...new Set(poliigonResolutionTiers(Array.isArray(detail?.resolutions) ? detail.resolutions : []).map(item => item.pixels))]
    .sort((a, b) => a - b);
  const folder = cacheFolder(
    "poliigon",
    request.assetId,
    `generic-${safe(quality.label)}${chosenLod ? `-lod${chosenLod.number}` : "-mesh"}`
  );
  const key = `poliigon:${request.assetId}:${quality.label}:${chosenLod?.label ?? "mesh"}`;
  const lodsAvailable = lods.map(item => item.number);
  const specMeshes = Number(detail?.specifications?.meshes);
  const expectedMeshes = Number.isFinite(specMeshes) && specMeshes > 0 ? specMeshes : undefined;
  const notes = [
    `Poliigon catalog 3D preview uses a Generic ${quality.label}${chosenLod ? ` ${chosenLod.label}` : ""} runtime package. The provider request may count as a download.`
  ];
  return withCache(key, request, folder, {
    name: String(detail?.name ?? request.name ?? request.assetId),
    qualities,
    lods: lodsAvailable,
    notes
  }, async () => {
    const preview = await poliigon.modelPreview(request.assetId, quality.label, chosenLod?.label);
    const runtimeFiles = poliigonRuntimeFiles(preview.files, chosenLod?.number ?? null);
    const format = POLIIGON_RUNTIME_ORDER.find(extension =>
      runtimeFiles.some(file => extname(file.name).toLowerCase() === extension)
    );
    const parts = format
      ? runtimeFiles.filter(file => extname(file.name).toLowerCase() === format)
      : [];
    if (!parts.length) throw new Error("Poliigon returned no Generic FBX/OBJ/glTF runtime mesh for this model.");
    // A Poliigon set ships one FBX per object and a texture set per object.
    // Download the maps for every selected part so each assembly part can use
    // its own material; fall back to all images when names do not match.
    const partKeys = new Set(parts
      .map(part => normalizeModelMaterialKey(modelPartMaterialKey(basename(part.name))))
      .filter(Boolean));
    const images = preview.files.filter(file =>
      POLIIGON_TEXTURE_EXTENSIONS.has(extname(file.name).toLowerCase())
      && !POLIIGON_PREVIEW_NAME.test(basename(file.name))
    );
    const matching = partKeys.size
      ? images.filter(file => {
          const key = modelTextureMaterialKey(basename(file.name));
          return Boolean(key && partKeys.has(normalizeModelMaterialKey(key)));
        })
      : [];
    const partImages = matching.length ? matching : images;
    const resolutionOf = (file: { name: string; resolution?: string }): number | null =>
      (file.resolution ? resolutionFromText(file.resolution) : null)
      ?? resolutionFromText(basename(file.name));
    const lodOf = (file: { name: string }): number | null =>
      megascansLodFromUri(basename(file.name));
    const availableResolutions = [...new Set(partImages
      .map(resolutionOf)
      .filter((value): value is number => value !== null))]
      .sort((a, b) => a - b);
    const targetResolution = availableResolutions.filter(value => value <= quality.pixels).sort((a, b) => b - a)[0]
      ?? availableResolutions[0]
      ?? null;
    let chosenImages = targetResolution === null
      ? partImages
      : partImages.filter(file => resolutionOf(file) === targetResolution || resolutionOf(file) === null);
    if (chosenLod?.number !== undefined) {
      const lodImages = chosenImages.filter(file =>
        lodOf(file) === chosenLod.number || lodOf(file) === null
      );
      if (lodImages.length) chosenImages = lodImages;
    }
    if (!chosenImages.length) chosenImages = partImages;
    const selected = [
      ...parts,
      ...preview.files.filter(file => POLIIGON_SIDECAR_EXTENSIONS.has(extname(file.name).toLowerCase())),
      ...chosenImages
    ];
    for (const file of [...new Map(selected.map(item => [item.name, item])).values()]) {
      const target = packageTarget(folder, file.name);
      await download(file.url, target);
    }
    for (const dynamic of preview.dynamicFiles) {
      const target = packageTarget(folder, dynamic.name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, dynamic.contents, "utf8");
    }
    return {
      name: String(detail?.name ?? request.name ?? request.assetId),
      qualities,
      lods: lodsAvailable,
      notes
    };
  }, manifest => poliigonAssembly(manifest, chosenLod?.number ?? null, expectedMeshes));
}

export async function prepareProviderModel(request: ModelManifestRequest): Promise<ModelManifest> {
  if (!context) throw new Error("3D model service is not ready");
  await mkdir(context.cacheRoot, { recursive: true });
  switch (request.provider) {
    case "megascans": return megascansManifest(request);
    case "polyhaven": return polyhavenManifest(request);
    case "ambientcg": return ambientCgManifest(request);
    case "blenderkit": return blenderkitManifest(request);
    case "poliigon": return poliigonManifest(request);
    default: throw new Error(`3D preview is not supported for ${request.provider}.`);
  }
}
