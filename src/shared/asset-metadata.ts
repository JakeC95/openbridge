import { canonicalMapType } from "./download-defaults";
import type {
  AssetMapDescriptor,
  AssetModelDescriptor,
  DownloadMapFormat,
  DownloadOptions,
  ExtendedAsset
} from "./types";

export type AssetTechnicalFacts = import("./types").AssetTechnicalSummary;

export interface MapTechnicalDetails {
  resolution: string | null;
  bitDepth: number | null;
  colorSpace: string | null;
  bytes: number;
  files: number;
  formats: string[];
}

export interface DownloadPlan {
  bytes: number;
  textureBytes: number;
  meshBytes: number;
  extraBytes: number;
  mapFiles: number;
  meshFiles: number;
  mapCount: number;
  lodCount: number;
  partial: boolean;
}

type MetaRecord = { key?: string; value?: unknown; [key: string]: unknown };

function metaEntries(asset: ExtendedAsset | undefined): MetaRecord[] {
  return Array.isArray(asset?.meta) ? (asset.meta as MetaRecord[]) : [];
}

export function metaValue(
  asset: ExtendedAsset | undefined,
  key: string
): unknown {
  return metaEntries(asset).find(entry => entry.key === key)?.value;
}

function parseResolution(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/(\d{3,5})(?:\s*[x×]\s*\d{3,5})?/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapDescriptors(asset: ExtendedAsset | undefined): AssetMapDescriptor[] {
  return (
    (asset?.maps && asset.maps.length > 0
      ? asset.maps
      : asset?.components && asset.components.length > 0
        ? asset.components
        : asset?.billboards) ?? []
  );
}

function mapType(entry: AssetMapDescriptor): string {
  return typeof entry.type === "string" ? canonicalMapType(entry.type) : "";
}

function allMapTypes(asset: ExtendedAsset | undefined): string[] {
  const types = new Set<string>();
  for (const entry of mapDescriptors(asset)) {
    const type = mapType(entry);
    if (type) types.add(type);
  }
  for (const entry of asset?.billboards ?? []) {
    const type = mapType(entry);
    if (type) types.add(type);
  }
  return [...types].sort();
}

function modelFiles(
  model: AssetModelDescriptor
): Array<{ mimeType?: string; contentLength?: number; uri?: string }> {
  if (model.uris && model.uris.length > 0) return model.uris;
  if (model.uri) {
    return [
      {
        mimeType: model.mimeType,
        contentLength: model.contentLength,
        uri: model.uri
      }
    ];
  }
  return [];
}
function allModels(asset: ExtendedAsset | undefined): AssetModelDescriptor[] {
  return [...(asset?.meshes ?? []), ...(asset?.models ?? [])];
}

function isoBytes(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatLabel(mimeType: string): string {
  if (mimeType === "image/x-exr") return "EXR";
  if (mimeType === "image/jpeg") return "JPG";
  if (mimeType === "application/x-abc") return "ABC";
  if (mimeType === "application/x-fbx") return "FBX";
  if (mimeType === "application/x-ztl") return "ZTL";
  return mimeType.split("/").pop()?.toUpperCase() ?? mimeType;
}

function dimensionString(width: string, length: string, height: string): string {
  const parts = [length, width, height].filter(Boolean);
  return parts.join(" x ");
}

export function assetTechnicalFacts(
  asset: ExtendedAsset | undefined
): AssetTechnicalFacts {
  const maps = mapDescriptors(asset);
  const resolutions = maps
    .map(entry => {
      if (typeof entry.resolution === "string" || typeof entry.resolution === "number") {
        return parseResolution(entry.resolution);
      }
      const nested = entry.uris?.flatMap(uri => uri.resolutions ?? []) ?? [];
      return nested.reduce(
        (max, item) => Math.max(max, parseResolution(item.resolution) ?? 0),
        0
      );
    })
    .filter((value): value is number => Boolean(value && value > 0));
  const resolution = resolutions.length ? Math.max(...resolutions) : null;

  const models = allModels(asset);
  const lods = new Set<number>();
  let maxTris = 0;
  for (const model of models) {
    if (typeof model.lod === "number") lods.add(model.lod);
    if (typeof model.tris === "number") maxTris = Math.max(maxTris, model.tris);
  }
  if (lods.size === 0) {
    const lodMeshes = (asset?.meshes ?? []).filter(mesh => mesh.type === "lod");
    lodMeshes.forEach((_mesh, index) => lods.add(index));
  }

  const dimensions = metaValue(asset, "dimensions");
  const variationDimensions = Array.isArray(dimensions)
    ? dimensions
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object"
        )
        .map(item => ({
          variation: Number(item.variation ?? 0),
          width: String(item.width ?? ""),
          length: String(item.length ?? ""),
          height: String(item.height ?? "")
        }))
    : [];
  const variationCount = Math.max(
    1,
    variationDimensions.length,
    ...(asset?.models ?? []).map(model =>
      Math.max(
        typeof model.variation === "number" ? model.variation : 0,
        ...(model.variations ?? [])
      )
    )
  );

  const metaLength = metaValue(asset, "length");
  const metaWidth = metaValue(asset, "width");
  const metaHeight = metaValue(asset, "height");
  const dimensionText =
    metaLength || metaWidth
      ? dimensionString(
          String(metaWidth ?? ""),
          String(metaLength ?? ""),
          String(metaHeight ?? "")
        )
      : variationDimensions.length > 0
        ? dimensionString(
            variationDimensions[0].width,
            variationDimensions[0].length,
            variationDimensions[0].height
          )
        : null;

  const tileableValue = metaValue(asset, "tileable");
  const tileable =
    typeof tileableValue === "boolean"
      ? tileableValue
      : typeof tileableValue === "string"
        ? tileableValue.toLowerCase() === "true"
        : null;
  const tiling = metaValue(asset, "tiling_directions");

  const scanAreaValue = metaValue(asset, "scanArea");
  const texelDensityValue = metaValue(asset, "texelDensity");
  const physicalSize =
    typeof asset?.physicalSize === "string" && asset.physicalSize
      ? asset.physicalSize
      : null;
  const meshTypeValue = metaValue(asset, "mesh type") ?? metaValue(asset, "3d_mesh");

  const hasHighpoly = models.some(model => model.type === "original");
  const hasZtool = models.some(model => model.type === "zbrush");
  const brushList = (asset as { brushes?: unknown[] } | undefined)?.brushes;
  const hasBrushes =
    Array.isArray(brushList) &&
    brushList.some(
      item =>
        item !== null &&
        typeof item === "object" &&
        ("uri" in item || "type" in item)
    );

  return {
    resolution,
    mapTypes: allMapTypes(asset),
    mapCount: allMapTypes(asset).length,
    lodCount: lods.size,
    maxTris,
    variationCount,
    billboardCount: asset?.billboards?.length ?? 0,
    tileable,
    tilingDirections: Array.isArray(tiling)
      ? tiling.map(value => String(value))
      : [],
    scanArea: scanAreaValue == null ? null : String(scanAreaValue),
    texelDensity: texelDensityValue == null ? null : String(texelDensityValue),
    physicalSize,
    dimensions: dimensionText || physicalSize,
    height: metaHeight == null ? null : String(metaHeight),
    variationDimensions,
    meshType: meshTypeValue == null ? null : String(meshTypeValue),
    hasHighpoly,
    hasZtool,
    hasBrushes
  };
}

function canRequestExr(asset: ExtendedAsset | undefined, type: string): boolean {
  if ((asset?.points ?? 0) === 0) return true;
  const access = asset?.acl?.exrAccess;
  return access === "full" || (type === "displacement" && access === "displacement");
}

function wantedFormats(
  asset: ExtendedAsset | undefined,
  component: DownloadOptions["components"][number]
): DownloadMapFormat[] {
  const type = canonicalMapType(component.type);
  const access = canRequestExr(asset, type);
  if (type === "displacement") {
    if (component.mimeType === "image/x-exr") {
      return access ? ["image/x-exr"] : ["image/jpeg"];
    }
    return access ? ["image/jpeg", "image/x-exr"] : ["image/jpeg"];
  }
  if (component.mimeType === "image/x-exr") {
    return access ? ["image/x-exr"] : ["image/jpeg"];
  }
  if (component.mimeType === "jpeg+exr") {
    return access ? ["image/jpeg", "image/x-exr"] : ["image/jpeg"];
  }
  return ["image/jpeg"];
}

function flatMapBytes(
  asset: ExtendedAsset | undefined,
  component: DownloadOptions["components"][number],
  resolution: number
): { bytes: number; files: number; found: boolean } {
  const wanted = wantedFormats(asset, component);
  let bytes = 0;
  let files = 0;
  let found = false;
  for (const entry of mapDescriptors(asset)) {
    if (mapType(entry) !== canonicalMapType(component.type)) continue;
    if (!entry.resolution) continue;
    const entryResolution = parseResolution(entry.resolution);
    if (entryResolution !== resolution) continue;
    const mimeType = typeof entry.mimeType === "string" ? entry.mimeType : "";
    if (!wanted.includes(mimeType as DownloadMapFormat)) continue;
    if (typeof entry.contentLength === "number") {
      bytes += entry.contentLength;
      files += 1;
      found = true;
    }
  }
  return { bytes, files, found };
}

function structuredMapBytes(
  asset: ExtendedAsset | undefined,
  component: DownloadOptions["components"][number],
  resolution: number
): { bytes: number; files: number; found: boolean } {
  const wanted = wantedFormats(asset, component);
  let bytes = 0;
  let files = 0;
  let found = false;
  for (const entry of mapDescriptors(asset)) {
    if (mapType(entry) !== canonicalMapType(component.type)) continue;
    for (const uri of entry.uris ?? []) {
      for (const resolutionEntry of uri.resolutions ?? []) {
        if (parseResolution(resolutionEntry.resolution) !== resolution) continue;
        for (const format of resolutionEntry.formats ?? []) {
          if (format.lodType) continue;
          if (!wanted.includes(format.mimeType as DownloadMapFormat)) continue;
          if (typeof format.contentLength === "number") {
            bytes += format.contentLength;
            files += 1;
            found = true;
          }
        }
      }
    }

  }
  return { bytes, files, found };
}

function selectedMeshBytes(
  asset: ExtendedAsset | undefined,
  options: DownloadOptions
): { bytes: number; files: number; lods: number; partial: boolean } {
  const meshMime = options.meshFormat === "abc" ? "application/x-abc" : "application/x-fbx";
  let bytes = 0;
  let files = 0;
  let lods = 0;
  let partial = false;

  const lodMeshes = (asset?.meshes ?? [])
    .filter(mesh => mesh.type === "lod")
    .map(mesh => ({ mesh, tris: typeof mesh.tris === "number" ? mesh.tris : 0 }))
    .sort((a, b) => b.tris - a.tris);
  if (lodMeshes.length > 0) {
    for (let index = 0; index < lodMeshes.length; index += 1) {
      if (!(options.lods[index] ?? false)) continue;
      lods += 1;
      const uris = lodMeshes[index].mesh.uris ?? [];
      if (uris.length === 0) {
        partial = true;
        continue;
      }
      for (const uri of uris) {
        if (uri.mimeType !== meshMime) continue;
        bytes += isoBytes(uri.contentLength);
        files += 1;
      }
    }
  } else {
    const selectedModels = (asset?.models ?? []).filter(model => {
      if (typeof model.variation === "number" && model.variation !== options.variation) {
        return false;
      }
      return typeof model.lod !== "number" || Boolean(options.lods[model.lod]);
    });
    const uniqueLods = new Set<number>();
    for (const model of selectedModels) {
      if (typeof model.lod === "number") uniqueLods.add(model.lod);
      const uris = modelFiles(model);
      if (uris.length === 0) {
        partial = true;
        continue;
      }
      for (const uri of uris) {
        if (uri.mimeType !== meshMime) continue;
        bytes += isoBytes(uri.contentLength);
        files += 1;
      }
    }
    lods = uniqueLods.size;
  }

  return { bytes, files, lods, partial };
}

export function lodMeshBytes(
  asset: ExtendedAsset | undefined,
  meshFormat: "fbx" | "abc"
): Record<number, number> {
  const mime = meshFormat === "abc" ? "application/x-abc" : "application/x-fbx";
  const output: Record<number, number> = {};
  const lodMeshes = (asset?.meshes ?? [])
    .filter(mesh => mesh.type === "lod")
    .map(mesh => ({ mesh, tris: typeof mesh.tris === "number" ? mesh.tris : 0 }))
    .sort((a, b) => b.tris - a.tris);
  if (lodMeshes.length > 0) {
    lodMeshes.forEach((item, index) => {
      output[index] = (item.mesh.uris ?? [])
        .filter(uri => uri.mimeType === mime)
        .reduce((sum, uri) => sum + isoBytes(uri.contentLength), 0);
    });
    return output;
  }
  for (const model of asset?.models ?? []) {
    if (typeof model.lod !== "number") continue;
    const bytes = modelFiles(model)
      .filter(uri => uri.mimeType === mime)
      .reduce((sum, uri) => sum + isoBytes(uri.contentLength), 0);
    output[model.lod] = Math.max(output[model.lod] ?? 0, bytes);
  }
  return output;
}
export function mapTechnicalDetails(
  asset: ExtendedAsset | undefined,
  component: DownloadOptions["components"][number],
  resolution: number
): MapTechnicalDetails {
  const wanted = wantedFormats(asset, component);
  let bytes = 0;
  let files = 0;
  let resolutionText: string | null = null;
  let bitDepth: number | null = null;
  let colorSpace: string | null = null;
  const formats = new Set<string>();

  for (const entry of mapDescriptors(asset)) {
    if (mapType(entry) !== canonicalMapType(component.type)) continue;
    if (entry.resolution && parseResolution(entry.resolution) === resolution) {
      const mimeType = String(entry.mimeType ?? "");
      if (!wanted.includes(mimeType as DownloadMapFormat)) continue;
      resolutionText = String(entry.resolution);
      if (typeof entry.bitDepth === "number") bitDepth = Math.max(bitDepth ?? 0, entry.bitDepth);
      if (typeof entry.colorSpace === "string") colorSpace = entry.colorSpace;
      if (typeof entry.contentLength === "number") {
        bytes += entry.contentLength;
        files += 1;
      }
      if (mimeType) formats.add(formatLabel(mimeType));
    }
    for (const uri of entry.uris ?? []) {
      for (const resolutionEntry of uri.resolutions ?? []) {
        if (parseResolution(resolutionEntry.resolution) !== resolution) continue;
        for (const format of resolutionEntry.formats ?? []) {
          if (format.lodType) continue;
          if (!wanted.includes(format.mimeType as DownloadMapFormat)) continue;
          resolutionText = resolutionEntry.resolution ?? resolutionText;
          if (typeof format.contentLength === "number") {
            bytes += format.contentLength;
            files += 1;
          }
          if (format.mimeType) formats.add(formatLabel(format.mimeType));
        }
      }
    }
  }

  return {
    resolution: resolutionText,
    bitDepth,
    colorSpace,
    bytes,
    files,
    formats: [...formats]
  };
}

export function downloadPlan(
  asset: ExtendedAsset | undefined,
  options: DownloadOptions
): DownloadPlan {
  let textureBytes = 0;
  let mapFiles = 0;
  let mapCount = 0;
  let partial = false;

  for (const component of options.components) {
    if (!component.selected) continue;
    mapCount += 1;
    const flat = flatMapBytes(asset, component, options.resolution);
    if (flat.found) {
      textureBytes += flat.bytes;
      mapFiles += flat.files;
      continue;
    }
    const structured = structuredMapBytes(asset, component, options.resolution);
    if (structured.found) {
      textureBytes += structured.bytes;
      mapFiles += structured.files;
    } else {
      partial = true;
    }
  }

  const meshes = selectedMeshBytes(asset, options);
  let extraBytes = 0;
  let meshFiles = meshes.files;
  let lodCount = meshes.lods;
  let meshBytes = meshes.bytes;

  if (meshes.partial) partial = true;

  if (options.highpoly) {
    const high = (asset?.meshes ?? []).find(mesh => mesh.type === "original");
    const highModels = (asset?.models ?? []).filter(model => model.type === "original");
    const meshMime =
      options.meshFormat === "abc" ? "application/x-abc" : "application/x-fbx";
    const sources = high ? [high] : highModels;
    for (const source of sources) {
      for (const uri of source.uris ?? []) {
        if (uri.mimeType !== meshMime) continue;
        extraBytes += isoBytes(uri.contentLength);
        meshFiles += 1;
      }
    }
  }

  if (options.ztool) {
    const ztool = allModels(asset).find(model => model.type === "zbrush");
    if (ztool) {
      for (const uri of ztool.uris ?? []) {
        extraBytes += isoBytes(uri.contentLength);
        meshFiles += 1;
      }
    } else {
      partial = true;
    }
  }

  return {
    bytes: textureBytes + meshBytes + extraBytes,
    textureBytes,
    meshBytes,
    extraBytes,
    mapFiles,
    meshFiles,
    mapCount,
    lodCount,
    partial
  };
}
