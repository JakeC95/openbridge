/** New public, API-backed providers added in 1.6. */
export const PUBLIC_PROVIDER_IDS = ["ambientcg", "blenderkit", "openhdri"] as const;

export type PublicProviderId = (typeof PUBLIC_PROVIDER_IDS)[number];

export const PUBLIC_PROVIDER_LABELS: Record<PublicProviderId, string> = {
  ambientcg: "ambientCG",
  blenderkit: "BlenderKit",
  openhdri: "OpenHDRI"
};

/** The largest OpenHDRI preview width that consistently responds quickly. */
export const OPENHDRI_PREVIEW_WIDTH = 4096;

/**
 * OpenHDRI's preview image is a 4:3 content render: a real 2:1 environment with
 * material balls composited below. The API serves AVIF by default and PNG only
 * when `f=png` is explicit. Build the URL from the slug instead of trusting a
 * previously indexed preview entry, which may predate both requirements.
 */
export function openHdriImageUrl(slug: string, width = 512): string {
  const size = Math.max(256, Math.min(OPENHDRI_PREVIEW_WIDTH, Math.round(width)));
  const quality = size >= 1000 ? 90 : 80;
  return `https://openhdri.org/api/image/${encodeURIComponent(slug)}.jpg?w=${size}&q=${quality}&f=png`;
}

export interface PublicPreview {
  type: string;
  label: string;
  url: string;
  map?: string;
  width?: number;
  height?: number;
}

export interface PublicFile {
  role: "package" | "hdri" | "texture" | "model" | "metadata" | "preview" | "colorchart" | "other";
  name: string;
  url: string;
  bytes: number;
  resolution?: string;
  format?: string;
  map?: string;
  downloadable?: boolean;
  fileType?: string;
}

export interface PublicAssetSummary {
  id: string;
  provider: PublicProviderId;
  name: string;
  type: string;
  typeLabel: string;
  categories: string[];
  category: string;
  tags: string[];
  description: string;
  authors: Record<string, string>;
  attributes: Record<string, unknown>;
  maxResolution: number | null;
  resolutions: string[];
  dimensions: string | null;
  dimensionsMm: number[] | null;
  polycount: number | null;
  texelDensity: string | null;
  publishedAt: number | null;
  downloadCount: number;
  thumbnail: string | null;
  previews: PublicPreview[];
  timeOfDay: number | null;
  weather: string | null;
  mapCodes: string[];
  mapFormats: string[];
  modelFormats: string[];
  lodCount: number;
  license: string;
  free: boolean;
  websiteUrl: string;
  filesHash: string;
  enriched: boolean;
  files: PublicFile[];
}

export interface PublicAssetDetail extends PublicAssetSummary {
  raw: Record<string, unknown>;
}

export interface PublicPreviewSet {
  renders: import("./types").MapPreview[];
  maps: import("./types").MapPreview[];
  hdrAvailable: boolean;
  note?: string;
}

export type PublicSort =
  | "relevance"
  | "newest"
  | "oldest"
  | "name"
  | "name-desc"
  | "type"
  | "resolution"
  | "downloads"
  | "size"
  | "maps";

export interface PublicCatalogQuery {
  includeFacets?: boolean;
  provider: PublicProviderId;
  query?: string;
  types?: string[];
  ids?: string[];
  categoryPaths?: string[];
  tags?: string[];
  licenses?: string[];
  freeOnly?: boolean;
  resolutions?: string[];
  mapTypes?: string[];
  modelFormats?: string[];
  minSize?: number;
  maxSize?: number;
  timeStart?: number;
  timeEnd?: number;
  timeWindows?: Array<{ start: number; end: number }>;
  minResolution?: number;
  maxResolution?: number;
  minTris?: number;
  maxTris?: number;
  minBytes?: number;
  maxBytes?: number;
  weather?: string[];
  sort?: PublicSort;
  limit: number;
  offset: number;
}

export interface PublicFacetBucket {
  value: string;
  count: number;
}

export interface PublicFacets {
  types: PublicFacetBucket[];
  resolutions: PublicFacetBucket[];
  mapTypes: PublicFacetBucket[];
  categories: PublicFacetBucket[];
  licenses: PublicFacetBucket[];
  modelFormats: PublicFacetBucket[];
  weather: PublicFacetBucket[];
  /** Online providers may expose sample-only facets; do not present those as global counts. */
  sampleFacets?: boolean;
  free: number;
}

export interface PublicQueryResult {
  hits: PublicAssetSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  tookMs: number;
  facets: PublicFacets;
}

export type PublicCatalogState = "empty" | "refreshing" | "ready" | "error";

export interface PublicCatalogStatus {
  state: PublicCatalogState;
  count: number;
  published?: number;
  refreshedAt: number | null;
  error?: string;
}

export interface PublicDownloadOptions {
  resolution?: string;
  format?: string;
  maps?: string[];
  fileType?: string;
  /** OpenHDRI publishes an optional color-checker EXR alongside the HDRI. */
  includeColorChecker?: boolean;
}

export interface PublicAuthState {
  hasKey: boolean;
}

export interface BlenderKitAuthState extends PublicAuthState {
  userName?: string;
  plan?: string;
}

export interface BlenderKitKeyTest {
  ok: boolean;
  userName?: string;
  plan?: string;
  error?: string;
}

export function isPublicProviderId(value: unknown): value is PublicProviderId {
  return typeof value === "string" && (PUBLIC_PROVIDER_IDS as readonly string[]).includes(value);
}

export function publicProviderLabel(provider: PublicProviderId): string {
  return PUBLIC_PROVIDER_LABELS[provider] ?? provider;
}

/**
 * ambientCG's `thumbnails` are sphere renders, but its PBR viewer previews
 * include LQ/HQ EXR panoramas. The same preview folder publishes matching JPG
 * panoramas next to each EXR; derive those instead of showing the sphere.
 */
export function ambientCgPanoramaUrl(previews: readonly PublicPreview[], quality: "LQ" | "HQ" = "LQ"): string | null {
  const source = previews.find(preview => preview.type === "hdr-source" && new RegExp(`_${quality}\\.exr`, "i").test(preview.url));
  // The JPG preview is a plain public file; the EXR query is only a version
  // token, so drop it to keep the thumbnail stable across catalogue refreshes.
  return source ? source.url.replace(/\.exr(?:\?.*)?$/i, ".jpg") : null;
}

/** The real content thumbnail used by cards and local library previews. */
export function publicCardThumbnail(
  hit: Pick<PublicAssetSummary, "provider" | "id" | "type" | "previews" | "thumbnail">,
  width = 512
): string | null {
  if (hit.provider === "openhdri") return openHdriImageUrl(hit.id, width);
  if (hit.provider === "ambientcg" && /^(hdri|hdri-element)$/i.test(hit.type)) {
    return ambientCgPanoramaUrl(hit.previews, "LQ") ?? hit.thumbnail;
  }
  return hit.thumbnail;
}

export function publicJobId(provider: PublicProviderId, id: string): string {
  return `${provider}:${id}`;
}

export function parsePublicJobId(value: string): { provider: PublicProviderId; id: string } | null {
  const match = /^(ambientcg|blenderkit|openhdri):(.+)$/.exec(value);
  return match ? { provider: match[1] as PublicProviderId, id: match[2] } : null;
}

export function publicTypeLabel(provider: PublicProviderId, type: string): string {
  const value = type.trim().toLowerCase();
  if (provider === "ambientcg") {
    switch (value) {
      case "material": return "Material";
      case "hdri": return "HDRI";
      case "hdri-element": return "HDRI Element";
      case "3d-model": return "3D Model";
      case "decal": return "Decal";
      case "atlas": return "Atlas";
      case "brush": return "Brush";
      case "terrain": return "Terrain";
      case "substance": return "Substance";
      case "plain-image": return "Photo Texture";
      default: return type || "Asset";
    }
  }
  if (provider === "blenderkit") {
    switch (value) {
      case "model": return "3D Model";
      case "material": return "Material";
      case "hdr": return "HDRI";
      case "brush": return "Brush";
      case "scene": return "Scene";
      default: return type || "Asset";
    }
  }
  return "HDRI";
}

/** Stable job/library prefix for a provider. */
export function publicTypeRoot(provider: PublicProviderId, type: string): string {
  const label = publicTypeLabel(provider, type).toLowerCase();
  if (label.includes("hdri")) return "hdri";
  if (label.includes("model") || label.includes("terrain")) return "3d";
  if (label.includes("material") || label.includes("substance") || label.includes("photo")) return "surface";
  if (label.includes("brush")) return "brush";
  if (label.includes("decal")) return "decal";
  if (label.includes("atlas")) return "atlas";
  return label;
}
