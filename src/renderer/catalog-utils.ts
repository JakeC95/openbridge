import { formatMeasurementText } from "../shared/measurements";
import type { AssetTechnicalSummary, CatalogHit, ExtendedAsset, MapPreview } from "../shared/types";

export function renderPreviews(hit?: CatalogHit, extended?: ExtendedAsset): MapPreview[] {
  const urls = new Set<string>();
  const primary = hit ? hitPreview(hit) : null;
  if (primary) urls.add(primary);
  // Only inspect render/image containers, never map descriptors or signed download payloads.
  const collect = (value: unknown, depth = 0): void => {
    if (depth > 5 || !value) return;
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.add(value);
    } else if (Array.isArray(value)) value.forEach(item => collect(item, depth + 1));
    else if (typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (/^(images?|renders?|url|uri|preview|full|large|original)$/i.test(key)) collect(item, depth + 1);
      }
    }
  };
  collect(extended?.previews);
  collect(extended?.referencePreviews?.images);
  return [...urls].map((url, index) => ({ type: "render", label: `Render ${index + 1}`, url }));
}

export function hitId(hit: CatalogHit): string {
  return hit.id || hit.objectID;
}

export function hitThumb(hit: CatalogHit): string | null {
  const images = hit.previews?.images;
  return (
    images?.thumbJpg ??
    images?.thumb ??
    images?.thumbGridJpg ??
    images?.thumbRetinaJpg ??
    images?.preview ??
    images?.thumbRetina ??
    null
  );
}

export function hitPreview(hit: CatalogHit): string | null {
  const images = hit.previews?.images;
  return (
    images?.preview ??
    images?.thumbRetinaJpg ??
    images?.thumbJpg ??
    images?.thumb ??
    null
  );
}

export function typeLabel(type: string | undefined): string {
  switch ((type ?? "").toLowerCase()) {
    case "3d":
      return "3D";
    case "3dplant":
      return "3D Plant";
    case "surface":
      return "Surface";
    case "atlas":
      return "Atlas";
    case "brush":
      return "Brush";
    case "decal":
      return "Decal";
    default:
      return type ? type.toUpperCase() : "ASSET";
  }
}

function formatResolution(resolution: unknown): string | null {
  if (typeof resolution === "number" && Number.isFinite(resolution)) {
    return resolution >= 1024 ? `${Math.round(resolution / 1024)}K` : `${resolution}px`;
  }
  if (typeof resolution === "string" && resolution.trim()) return resolution;
  return null;
}

export function readinessBadges(technical: AssetTechnicalSummary | undefined): string[] {
  if (!technical) return [];
  const badges: string[] = [];
  if (technical.closedMesh) badges.push("Closed");
  if (technical.tileable) badges.push("Tileable");
  if (technical.billboardCount > 0) badges.push("Billboards");
  if (technical.materialWorkflow === "metal-rough") badges.push("Metal/Rough");
  if (technical.materialWorkflow === "spec-gloss") badges.push("Spec/Gloss");
  if (technical.hasHighpoly) badges.push("Highpoly");
  if (technical.maxTris > 0) badges.push(`${technical.maxTris.toLocaleString()} tris`);
  return badges.slice(0, 3);
}
export function galleryFacts(hit: CatalogHit): string[] {
  const facts: string[] = [];
  const hasRange =
    typeof hit.minSize === "number" || typeof hit.maxSize === "number";
  const size = hasRange
    ? hit.minSize === hit.maxSize
      ? `${hit.minSize ?? hit.maxSize}m`
      : `${hit.minSize ?? "?"}-${hit.maxSize ?? "?"}m`
    : hit.physicalSize && hit.physicalSize !== "undefined"
      ? hit.physicalSize
      : null;
  if (size) facts.push(formatMeasurementText(size));
  const resolution = formatResolution(hit.resolution);
  if (resolution) facts.push(resolution);
  const environment =
    hit.biome && hit.biome !== "undefined"
      ? hit.biome
      : hit.region && hit.region !== "undefined"
        ? hit.region
        : null;
  if (environment) facts.push(environment);
  return facts.slice(0, 3);
}
export function hitBadges(hit: CatalogHit, owned: boolean): string[] {
  const badges: string[] = [];
  if (owned) badges.push("OWNED");
  if ((hit.points ?? 0) === 0) badges.push("FREE");
  return badges;
}

export function maxLod(asset: ExtendedAsset | undefined): number {
  if (!asset) return 0;
  const models = asset.models ?? asset.meshes ?? [];
  let max = 0;
  for (const model of models) {
    if (typeof model.lod === "number" && model.lod > max) max = model.lod;
  }
  return max;
}

export function aclResolution(asset: ExtendedAsset | undefined): number | null {
  const value = asset?.acl?.resolution;
  if (typeof value === "number" && value > 0) return value;
  return null;
}

export function mapTypes(asset: ExtendedAsset | undefined): string[] {
  if (!asset) return [];
  const maps = asset.maps ?? asset.components ?? asset.billboards ?? [];
  const types = new Set<string>();
  for (const map of maps) {
    if (typeof map.type === "string") types.add(map.type);
  }
  return [...types].sort();
}

