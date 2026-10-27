import type {
  AssetDefaultsKind,
  DownloadPreset,
  ExtendedAsset
} from "./types";

const LODS = Array.from({ length: 9 }, () => true);

export const KNOWN_MAP_TYPES = [
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

export const DEFAULT_MAP_TYPES = [
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
];

export const RECOMMENDED_PRESET: DownloadPreset = {
  resolution: 8192,
  textureFormat: "jpg",
  meshFormat: "fbx",
  selectedMaps: DEFAULT_MAP_TYPES,
  lods: LODS,
  highpoly: false,
  ztool: false,
  brushes: false,
  uniqueMapsPerLod: true,
  billboards: true,
  downloadAllPlantLods: true
};

export function recommendedDownloadDefaults(): Record<AssetDefaultsKind, DownloadPreset> {
  return {
    "3d": { ...RECOMMENDED_PRESET, selectedMaps: [...DEFAULT_MAP_TYPES], lods: [...LODS] },
    "3dplant": { ...RECOMMENDED_PRESET, selectedMaps: [...DEFAULT_MAP_TYPES], lods: [...LODS] },
    surface: { ...RECOMMENDED_PRESET, selectedMaps: [...DEFAULT_MAP_TYPES], lods: [...LODS] },
    other: { ...RECOMMENDED_PRESET, selectedMaps: [...DEFAULT_MAP_TYPES], lods: [...LODS] }
  };
}

export function assetDefaultsKind(
  asset: Pick<ExtendedAsset, "categories" | "type" | "asset_type"> | null | undefined
): AssetDefaultsKind {
  const value = (
    asset?.categories?.[0] ??
    asset?.type ??
    asset?.asset_type ??
    ""
  ).toLowerCase();
  if (value === "3dplant" || value === "3d plant") return "3dplant";
  if (value.startsWith("3d")) return "3d";
  if (value === "surface") return "surface";
  return "other";
}
