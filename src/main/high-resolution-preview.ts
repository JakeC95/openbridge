import { basename } from "node:path";
import type { ExtendedAsset, MapPreview, MapPreviewRequest } from "../shared/types";
import type { LegacyApi } from "./legacy-api";

interface JpegCandidate {
  uri?: string;
  resolution: number;
  textureSets: string[];
  type?: string;
  lod?: number;
}

export function previewResolution(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const kilo = value.match(/(?:^|_)(\d+)K(?:_|\b)/i);
  if (kilo) return Number(kilo[1]) * 1024;
  const dimensions = value.match(/(?:^|\b)(\d{3,5})(?:\s*x\s*\d+)?(?:\b|$)/i);
  return dimensions ? Number(dimensions[1]) : 0;
}

function filename(uri: string): string {
  try { return decodeURIComponent(new URL(uri, "https://preview.invalid/").pathname.split("/").at(-1) ?? ""); }
  catch { return basename(uri.split("?")[0]); }
}

function identity(uri: string): string {
  return filename(uri).toLowerCase().replace(/_(\d+k|\d{3,5}x\d{3,5})(?=_|\.)/g, "")
    .replace(/_lod0(?=_|\.)/g, "").replace(/\.(jpg|jpeg)$/i, "");
}

function jpegCandidates(value: unknown, inherited: Partial<JpegCandidate> = {}): JpegCandidate[] {
  if (Array.isArray(value)) return value.flatMap(item => jpegCandidates(item, inherited));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const uri = typeof record.uri === "string" ? record.uri : undefined;
  const mime = typeof record.mimeType === "string" ? record.mimeType.toLowerCase() : "";
  const context: Partial<JpegCandidate> = {
    resolution: previewResolution(record.resolution) || inherited.resolution || previewResolution(uri),
    textureSets: Array.isArray(record.textureSets) ? record.textureSets.filter((set): set is string => typeof set === "string") : inherited.textureSets,
    type: typeof record.type === "string" ? record.type.toLowerCase() : inherited.type,
    lod: typeof record.lod === "number" ? record.lod : inherited.lod
  };
  const jpeg = !/\.exr(?:\?|$)/i.test(uri ?? "") &&
    (mime === "image/jpeg" || (!mime && /\.jpe?g(?:\?|$)/i.test(uri ?? "")));
  const output: JpegCandidate[] = jpeg ? [{ ...context, uri,
    resolution: context.resolution || 0, textureSets: context.textureSets ?? [] }] : [];
  for (const key of ["uris", "resolutions", "formats", "components", "billboards"]) {
    if (record[key]) output.push(...jpegCandidates(record[key], context));
  }
  return output;
}

function matches(candidate: JpegCandidate, map: MapPreviewRequest): boolean {
  if (candidate.type && candidate.type !== map.type.toLowerCase()) return false;
  if (map.textureSet && candidate.textureSets.length && !candidate.textureSets.includes(map.textureSet)) return false;
  const requestedLod = map.referenceUri?.match(/_LOD(\d+)/i)?.[1] ?? "0";
  const actualLod = candidate.lod ?? candidate.uri?.match(/_LOD(\d+)/i)?.[1];
  return actualLod === undefined || String(actualLod) === requestedLod;
}

export function highResolutionPreviewPayload(asset: ExtendedAsset, assetId: string, map: MapPreviewRequest): {
  payload: Record<string, unknown>; resolution: number;
} {
  const definitions = map.billboard ? asset.billboards ?? [] : [...(asset.components ?? []), ...(asset.maps ?? [])];
  const matching = definitions.filter(item => item.type?.toLowerCase() === map.type.toLowerCase());
  if (!matching.length) throw new Error("This map is not available as a full-resolution texture");
  const candidates = jpegCandidates(matching).filter(candidate => matches(candidate, map));
  const limit = typeof asset.acl?.resolution === "number" && asset.acl.resolution > 0 ? asset.acl.resolution : Infinity;
  const sizes = candidates.map(candidate => candidate.resolution).filter(value => value > 0 && value <= limit);
  if (candidates.length > 0 && !sizes.length && candidates.some(candidate => candidate.resolution > 0)) {
    throw new Error("No full-resolution JPG is available within your account's resolution limit");
  }
  // Sparse legacy descriptors sometimes omit JPEG format lists. Ask the service for its maximum
  // supported tier in that case; the authenticated endpoint remains authoritative about access.
  const resolution = sizes.length ? Math.max(...sizes) : Math.min(8192, limit);
  const component = { type: map.type, resolution: `${resolution}x${resolution}`, mimeType: "image/jpeg" };
  const payload: Record<string, unknown> = { asset: assetId, components: map.billboard ? [] : [component] };
  const is3d = (asset.type ?? asset.categories?.[0] ?? "").toLowerCase().startsWith("3d");
  if (is3d) {
    if (asset.version === 2) payload.meshes = [];
    else payload.config = { highpoly: false, ztool: false, brushes: false, lowerlod_normals: false,
      albedo_lods: false, meshMimeType: "application/x-fbx", lods: [] };
  }
  if (map.billboard) payload.billboards = [component];
  else if (asset.billboards?.length) payload.billboards = false;
  return { payload, resolution };
}

export async function highResolutionPreview(
  api: Pick<LegacyApi, "extended" | "requestDownload">, assetId: string, map: MapPreviewRequest, callerSignal?: AbortSignal
): Promise<MapPreview> {
  if (typeof assetId !== "string" || !/^[\w-]{1,128}$/.test(assetId) || !map || typeof map.type !== "string" || !/^[\w-]{1,64}$/.test(map.type) ||
    (map.textureSet !== undefined && typeof map.textureSet !== "string") ||
    (map.referenceUri !== undefined && typeof map.referenceUri !== "string")) {
    throw new Error("Invalid map preview request");
  }
  const signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const asset = await api.extended(assetId, signal);
  const { payload, resolution } = highResolutionPreviewPayload(asset, assetId, map);
  // This signs one JPEG only. It never enters DownloadManager, writes a file, or finalizes a library asset.
  const response = await api.requestDownload(payload, signal);
  let candidates = jpegCandidates(map.billboard ? response.billboards : response.components)
    .filter(candidate => candidate.uri && matches(candidate, map));
  if (map.referenceUri) {
    const exact = candidates.filter(candidate => identity(candidate.uri!) === identity(map.referenceUri!));
    if (exact.length) candidates = exact;
    else if (map.textureSet && candidates.length > 1) {
      const named = candidates.filter(candidate => candidate.textureSets.includes(map.textureSet!));
      if (!named.length) throw new Error("The full-resolution texture set could not be matched safely");
      candidates = named;
    }
  }
  candidates.sort((a, b) => (b.resolution || previewResolution(b.uri)) - (a.resolution || previewResolution(a.uri)));
  const selected = candidates[0];
  if (!selected?.uri || !/^https:\/\//i.test(selected.uri)) throw new Error("The service did not return a full-resolution JPG");
  const actualResolution = selected.resolution || previewResolution(selected.uri) || resolution;
  return { type: map.type, label: map.type, url: selected.uri,
    resolution: String(actualResolution), map };
}
