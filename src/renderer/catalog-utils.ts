import type { CatalogHit, ExtendedAsset } from "../shared/types";

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

export function formatPoints(points: number | undefined): string {
  if (!points) return "Free";
  return `${points.toLocaleString()} pts`;
}
