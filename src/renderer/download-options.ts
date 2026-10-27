import { assetDefaultsKind } from "../shared/download-defaults";
import type {
  AppSettings,
  DownloadMapFormat,
  DownloadMapOption,
  DownloadOptions,
  ExtendedAsset,
  MeshFormat,
  TextureFormat
} from "../shared/types";

export const DEFAULT_SELECTED_MAPS = new Set([
  "albedo",
  "ao",
  "displacement",
  "fuzz",
  "metalness",
  "normal",
  "opacity",
  "roughness",
  "translucency",
  "transmission",
  "brush"
]);

const CANONICAL = [
  "albedo",
  "ao",
  "normal",
  "normalbump",
  "normalobject",
  "displacement",
  "bump",
  "roughness",
  "metalness",
  "specular",
  "gloss",
  "diffuse",
  "cavity",
  "curvature",
  "opacity",
  "translucency",
  "transmission",
  "fuzz",
  "thickness",
  "mask",
  "brush"
];

export const MAP_FORMAT_OPTIONS: Array<{ value: DownloadMapFormat; label: string }> = [
  { value: "image/jpeg", label: "JPG" },
  { value: "image/x-exr", label: "EXR" },
  { value: "jpeg+exr", label: "JPG+EXR" }
];

export interface LodInfo {
  index: number;
  tris: number;
}

export interface DownloadPreferences {
  resolution?: number;
  textureFormat?: TextureFormat;
  meshFormat?: MeshFormat;
  components?: Record<string, { selected: boolean; mimeType: DownloadMapFormat }>;
  lods?: boolean[];
  downloadAllPlantLods?: boolean;
  uniqueMapsPerLod?: boolean;
  highpoly?: boolean;
  ztool?: boolean;
  brushes?: boolean;
  billboards?: boolean;
  variation?: number;
}

const PREFS_KEY = "openbridge.downloadPreferences.v1";

export function loadPreferences(): DownloadPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DownloadPreferences;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function savePreferences(preferences: DownloadPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
  } catch {
    // ignore quota errors
  }
}

export function mapTypeLabel(type: string): string {
  switch (type.toLowerCase()) {
    case "ao":
      return "AO";
    case "normalbump":
      return "Normal Bump";
    case "normalobject":
      return "Normal Object";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

export function availableMapTypes(asset: ExtendedAsset | undefined): string[] {
  const definitions =
    (asset?.components && asset.components.length > 0
      ? asset.components
      : asset?.maps && asset.maps.length > 0
        ? asset.maps
        : asset?.billboards) ?? [];
  const types = new Set(
    definitions
      .map(definition => (typeof definition?.type === "string" ? definition.type.toLowerCase() : ""))
      .filter(Boolean)
  );
  if (types.size === 0) CANONICAL.forEach(type => types.add(type));
  return [...types].sort((a, b) => {
    const ai = CANONICAL.indexOf(a);
    const bi = CANONICAL.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export function exrAccess(asset: ExtendedAsset | undefined): string {
  if (!asset) return "none";
  if ((asset.points ?? 0) === 0) return "full";
  return typeof asset.acl?.exrAccess === "string" ? asset.acl.exrAccess : "none";
}

export function canUseExr(asset: ExtendedAsset | undefined, type: string): boolean {
  const access = exrAccess(asset);
  if (access === "full") return true;
  return type === "displacement" && access === "displacement";
}

export function lodInfo(asset: ExtendedAsset | undefined, is3d: boolean): LodInfo[] {
  if (!asset || !is3d) return [];

  const usesModelLods =
    asset.version === 2 || (!asset.meshes?.length && Boolean(asset.models?.length));

  if (usesModelLods) {
    const byLod = new Map<number, number>();
    for (const model of asset.models ?? []) {
      if (typeof model.lod !== "number") continue;
      const tris = typeof model.tris === "number" ? model.tris : 0;
      byLod.set(model.lod, Math.max(byLod.get(model.lod) ?? 0, tris));
    }
    const result = [...byLod.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, tris]) => ({ index, tris }));
    if (result.length) return result;
  }

  const meshes = (asset.meshes ?? []).filter(
    mesh => mesh.type === "lod" && typeof mesh.tris === "number"
  );
  const sorted = meshes
    .map(mesh => mesh.tris as number)
    .sort((a, b) => b - a)
    .map((tris, index) => ({ index, tris }));
  return sorted.length ? sorted : [{ index: 0, tris: 0 }];
}

export function variationCount(asset: ExtendedAsset | undefined): number {
  const variations = asset?.variations;
  if (Array.isArray(variations)) return Math.max(1, variations.length);
  const models = asset?.models ?? [];
  const max = models.reduce((value, model) => {
    const variations = Array.isArray(model.variations) ? model.variations : [];
    const variation = typeof model.variation === "number" ? model.variation : 0;
    return Math.max(value, variation, ...variations);
  }, 1);
  return Math.max(1, max);
}

function textureMime(format: TextureFormat | undefined): DownloadMapFormat {
  return format === "exr" ? "image/x-exr" : "image/jpeg";
}

export function buildDownloadOptions(
  asset: ExtendedAsset | undefined,
  settings: AppSettings | null,
  preferences: DownloadPreferences = {}
): DownloadOptions {
  const preset = settings?.downloadDefaults?.[assetDefaultsKind(asset)];
  const textureFormat: TextureFormat =
    preferences.textureFormat ?? preset?.textureFormat ?? "jpg";
  const baseMime = textureMime(textureFormat);
  const types = availableMapTypes(asset);
  const components: DownloadMapOption[] = types.map(type => {
    const saved = preferences.components?.[type];
    let mimeType: DownloadMapFormat =
      saved?.mimeType ?? (type === "displacement" ? "jpeg+exr" : baseMime);
    if (mimeType !== "image/jpeg" && !canUseExr(asset, type)) mimeType = "image/jpeg";
    return {
      type,
      selected: saved?.selected ?? DEFAULT_SELECTED_MAPS.has(type),
      mimeType
    };
  });

  const threeD = (asset?.categories ?? [])[0]?.toLowerCase().startsWith("3d") ?? false;
  const availableLods = new Set(lodInfo(asset, threeD).map(lod => lod.index));
  const lods = Array.from({ length: 9 }, (_, index) =>
    availableLods.has(index) ? preferences.lods?.[index] ?? true : false
  );
  const acl = asset?.acl?.resolution;
  const allowedResolutions = [1024, 2048, 4096, 8192].filter(value => !acl || value <= acl);
  const requestedResolution = preferences.resolution ?? preset?.resolution ?? 8192;
  const maxAllowed = allowedResolutions[allowedResolutions.length - 1] ?? 1024;
  const resolution = Math.min(requestedResolution, maxAllowed);

  return {
    resolution,
    textureFormat,
    components,
    meshFormat: preferences.meshFormat ?? preset?.meshFormat ?? "fbx",
    lods,
    downloadAllPlantLods:
      preferences.downloadAllPlantLods ?? preset?.downloadAllPlantLods ?? true,
    highpoly: preferences.highpoly ?? preset?.highpoly ?? false,
    ztool: preferences.ztool ?? preset?.ztool ?? false,
    brushes: preferences.brushes ?? preset?.brushes ?? false,
    uniqueMapsPerLod: preferences.uniqueMapsPerLod ?? preset?.uniqueMapsPerLod ?? true,
    billboards: preferences.billboards ?? preset?.billboards ?? true,
    variation: preferences.variation ?? 1
  };
}

export function preferencesFromOptions(options: DownloadOptions): DownloadPreferences {
  const components: DownloadPreferences["components"] = {};
  for (const component of options.components) {
    components[component.type] = {
      selected: component.selected,
      mimeType: component.mimeType
    };
  }
  return {
    resolution: options.resolution,
    textureFormat: options.textureFormat,
    meshFormat: options.meshFormat,
    components,
    lods: options.lods,
    downloadAllPlantLods: options.downloadAllPlantLods,
    uniqueMapsPerLod: options.uniqueMapsPerLod,
    highpoly: options.highpoly,
    ztool: options.ztool,
    brushes: options.brushes,
    billboards: options.billboards,
    variation: options.variation
  };
}

function resolutionBytes(
  formats: Array<{ mimeType?: string; contentLength?: number }> | undefined,
  wanted: DownloadMapFormat[]
): number {
  if (!formats) return 0;
  let total = 0;
  for (const format of formats) {
    if (!format.mimeType || !wanted.includes(format.mimeType as DownloadMapFormat)) continue;
    if (typeof format.contentLength === "number") total += format.contentLength;
  }
  return total;
}

export function estimateBytes(asset: ExtendedAsset | undefined, options: DownloadOptions): number {
  if (!asset) return 0;
  const resolution = `${options.resolution}x${options.resolution}`;
  const definitions =
    (asset.components && asset.components.length > 0
      ? asset.components
      : asset.maps && asset.maps.length > 0
        ? asset.maps
        : asset.billboards) ?? [];
  let total = 0;

  for (const component of options.components) {
    if (!component.selected) continue;
    const definition = definitions.find(item => item.type.toLowerCase() === component.type);
    if (!definition) continue;
    const resolutionEntry = definition.uris
      ?.flatMap(uri => uri.resolutions ?? [])
      .find(item => item.resolution === resolution);
    const formats = resolutionEntry?.formats ?? [];
    let wanted: DownloadMapFormat[] = [component.mimeType];
    if (component.mimeType === "jpeg+exr" || component.type === "displacement") {
      wanted = ["image/jpeg", "image/x-exr"];
    }
    if (!canUseExr(asset, component.type)) wanted = ["image/jpeg"];
    total += resolutionBytes(formats, wanted);
  }

  const is3d = (asset.categories ?? [])[0]?.toLowerCase().startsWith("3d");
  if (is3d) {
    const lods = selectedLodInfo(asset, options);
    for (const lod of lods) {
      const mesh = (asset.meshes ?? []).find(
        item => item.type === "lod" && item.tris === lod.tris
      );
      const meshMime = options.meshFormat === "abc" ? "application/x-abc" : "application/x-fbx";
      const formats = mesh?.uris?.filter(uri => uri.mimeType === meshMime) ?? [];
      total += formats.reduce(
        (sum, uri) => sum + (typeof uri.contentLength === "number" ? uri.contentLength : 0),
        0
      );
    }
    if (options.highpoly) {
      const meshSource =
        asset.meshes && asset.meshes.length > 0 ? asset.meshes : asset.models ?? [];
      const high = meshSource.find(item => item.type === "original");
      const meshMime = options.meshFormat === "abc" ? "application/x-abc" : "application/x-fbx";
      total +=
        high?.uris
          ?.filter(uri => uri.mimeType === meshMime)
          .reduce(
            (sum, uri) => sum + (typeof uri.contentLength === "number" ? uri.contentLength : 0),
            0
          ) ?? 0;
    }
  }

  return total;
}

function selectedLodInfo(asset: ExtendedAsset, options: DownloadOptions): LodInfo[] {
  const info = lodInfo(asset, true);
  const isPlant = (asset.categories ?? [])[0]?.toLowerCase() === "3dplant";
  return info.filter(lod => {
    if (isPlant && options.downloadAllPlantLods) return true;
    return options.lods[lod.index] ?? true;
  });
}

export function formatBytes(value: number): string {
  if (!value) return "unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

