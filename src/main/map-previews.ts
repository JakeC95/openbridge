import type { DownloadResponse } from "./legacy-api";
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

function billboardMapType(descriptor: {
  type?: unknown;
  uri?: unknown;
}): string {
  if (typeof descriptor.type === "string" && descriptor.type) {
    return descriptor.type.toLowerCase();
  }
  const uri = typeof descriptor.uri === "string" ? descriptor.uri : "";
  const match = uri.match(/Billboard_\d+K_([A-Za-z0-9]+)\./i);
  return match?.[1]?.toLowerCase() ?? "";
}

export function buildBillboardPreviews(
  response: DownloadResponse | undefined
): MapPreview[] {
  const seen = new Set<string>();
  const output: MapPreview[] = [];
  for (const descriptor of response?.billboards ?? []) {
    const uri = typeof descriptor.uri === "string" ? descriptor.uri : "";
    const mimeType =
      typeof descriptor.mimeType === "string" ? descriptor.mimeType : "";
    if (!uri || !mimeType.startsWith("image/") || mimeType.includes("exr")) continue;
    const type = billboardMapType(descriptor);
    if (!type || seen.has(type)) continue;
    seen.add(type);
    output.push({
      type: `billboard:${type}`,
      label: `Billboard / ${mapLabel(type)}`,
      url: uri,
      map: { type, billboard: true, referenceUri: uri },
      resolution:
        typeof descriptor.resolution === "number"
          ? String(descriptor.resolution)
          : typeof descriptor.resolution === "string"
            ? descriptor.resolution
            : undefined
    });
  }
  return output.sort((a, b) => a.label.localeCompare(b.label));
}
export function buildMapPreviews(asset: ExtendedAsset, signedBase: string): MapPreview[] {
  const maps = asset.referencePreviews?.maps ?? [];

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
    const uri = typeof map.uri === "string" ? map.uri : null;
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
        map: { type, textureSet: set || undefined, referenceUri: uri },
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
