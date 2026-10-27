import type {
  AssetDefaultsKind,
  DownloadPreset,
  ExtendedAsset
} from "./types";

const LODS = Array.from({ length: 9 }, () => true);

export const RECOMMENDED_PRESET: DownloadPreset = {
  resolution: 8192,
  textureFormat: "jpg",
  meshFormat: "fbx",
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
    "3d": { ...RECOMMENDED_PRESET, lods: [...LODS] },
    "3dplant": { ...RECOMMENDED_PRESET, lods: [...LODS] },
    surface: { ...RECOMMENDED_PRESET, lods: [...LODS] },
    other: { ...RECOMMENDED_PRESET, lods: [...LODS] }
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
