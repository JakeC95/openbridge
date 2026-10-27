import type { ExtendedAsset, MapPreview } from "../shared/types";

const MAP_LABELS: Record<string, string> = {
  albedo: "Albedo",
  ao: "AO",
  bump: "Bump",
  cavity: "Cavity",
  displacement: "Displacement",
  fuzz: "Fuzz",
  gloss: "Gloss",
  mask: "Mask",
  metalness: "Metalness",
  normal: "Normal",
  normalbump: "Normal Bump",
  normalobject: "Normal Object",
  opacity: "Opacity",
  roughness: "Roughness",
  specular: "Specular",
  thickness: "Thickness",
  translucency: "Translucency",
  transmission: "Transmission"
};

const MAP_ORDER = [
  "albedo",
  "ao",
  "normal",
  "normalbump",
  "normalobject",
  "roughness",
  "metalness",
  "specular",
  "gloss",
  "displacement",
  "bump",
  "cavity",
  "opacity",
  "translucency",
  "transmission",
  "fuzz",
  "thickness",
  "mask"
];

function mapLabel(type: string): string {
  return MAP_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function signedFileUrl(base: string, uri: string): string {
  if (/^https?:\/\//i.test(uri)) return uri;
  const file = uri.replace(/^\/+/, "");
  const marker = ".com/*?";
  const index = base.indexOf(marker);
  if (index >= 0) {
    return `${base.slice(0, index + 5)}${file}${base.slice(index + 6)}`;
  }
  if (base.includes("*")) return base.replace("*", file);
  return `${base.replace(/\/+$/, "")}/${file}`;
}

export function buildMapPreviews(asset: ExtendedAsset, signedBase: string): MapPreview[] {
  const maps = asset.referencePreviews?.maps ?? [];
  if (maps.length === 0) return [];

  const textureSets = new Set<string>();
  for (const map of maps) {
    for (const set of map.textureSets ?? []) {
      if (set) textureSets.add(set);
    }
  }
  const showTextureSet = textureSets.size > 1;

  const seen = new Set<string>();
  const output: Array<MapPreview & { set: string }> = [];

  for (const map of maps) {
    const type = map.type?.toLowerCase();
    const uri = map.uri;
    if (!type || !uri || !map.mimeType?.startsWith("image/")) continue;
    const sets = map.textureSets?.length ? map.textureSets : [""];
    for (const set of sets) {
      const key = `${set}\u0000${type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        type,
        label: showTextureSet && set ? `${set} / ${mapLabel(type)}` : mapLabel(type),
        url: signedFileUrl(signedBase, uri),
        resolution: map.resolution,
        set
      });
    }
  }

  return output
    .sort((a, b) => {
      if (a.set !== b.set) return a.set.localeCompare(b.set);
      const ai = MAP_ORDER.indexOf(a.type);
      const bi = MAP_ORDER.indexOf(b.type);
      if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(({ set: _set, ...preview }) => preview);
}
