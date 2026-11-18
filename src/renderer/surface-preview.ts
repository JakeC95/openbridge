import {
  MODEL_IMAGE_EXTENSIONS,
  canonicalModelMapType,
  preferredTextureFormat,
  resolutionFromText,
  type ModelManifest,
  type ModelMapType,
  type ModelTextureVariant
} from "../shared/model-preview";

/** A browser-readable map preview supplied by a provider or the local library. */
export interface SurfacePreviewMap {
  url: string;
  type?: string;
  label?: string;
  resolution?: string;
}

const MAP_ORDER: ModelMapType[] = [
  "basecolor", "normal", "roughness", "metalness", "ao", "orm", "opacity",
  "emissive", "specular", "gloss", "displacement", "translucency"
];

function formatFromUrl(url: string): string {
  const data = /^data:image\/(png|jpe?g|webp|tga|x-exr|exr)/i.exec(url);
  if (data) return data[1].toLowerCase().replace("jpeg", "jpg").replace("x-exr", "exr");
  try {
    return (new URL(url).pathname.split(".").pop() ?? "").toLowerCase();
  } catch {
    return (url.split(/[?#]/)[0].split(".").pop() ?? "").toLowerCase();
  }
}

/**
 * Turn provider map previews into a texture-only manifest. The viewer creates
 * the sphere and applies the normal PBR/displacement pipeline, so surfaces use
 * exactly the same map selection and inspection code as 3D assets.
 */
export function surfaceManifest(
  maps: SurfacePreviewMap[],
  details: { assetId: string; provider: string; name: string; source?: "local" | "provider" }
): ModelManifest | null {
  const textures: ModelTextureVariant[] = [];
  const seen = new Set<string>();
  for (const map of maps) {
    if (!map.url) continue;
    const format = formatFromUrl(map.url);
    if (format && !MODEL_IMAGE_EXTENSIONS.has(`.${format}`)) continue;
    const { mapType, normalSpace } = canonicalModelMapType(`${map.type ?? ""} ${map.label ?? ""}`);
    if (mapType === "unknown") continue;
    const identity = `${mapType}:${map.url}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    textures.push({
      url: map.url,
      mapType,
      resolution: resolutionFromText(map.resolution ?? map.label ?? map.url),
      lod: null,
      format,
      bytes: 0,
      ...(normalSpace ? { normalSpace } : {})
    });
  }
  const usable = textures.filter(texture => texture.format && MODEL_IMAGE_EXTENSIONS.has(`.${texture.format}`));
  if (!usable.length) return null;
  const ordered = [...usable].sort((a, b) => {
    const type = MAP_ORDER.indexOf(a.mapType) - MAP_ORDER.indexOf(b.mapType);
    if (type !== 0) return type;
    const resolution = (b.resolution ?? 0) - (a.resolution ?? 0);
    return resolution !== 0 ? resolution : preferredTextureFormat(a.format) - preferredTextureFormat(b.format);
  });
  const qualities = [...new Set(ordered
    .map(texture => texture.resolution)
    .filter((value): value is number => typeof value === "number" && value > 0))]
    .sort((a, b) => a - b);
  const sphere = {
    url: "",
    format: "sphere" as const,
    label: "Sphere",
    lod: null,
    quality: null,
    bytes: 0,
    triangles: null
  };
  return {
    assetId: details.assetId,
    provider: details.provider,
    name: details.name,
    source: details.source ?? "provider",
    meshes: [sphere],
    textures: ordered,
    defaultMesh: sphere,
    availableQualities: qualities,
    availableLods: [],
    alpha: false,
    surface: true,
    notes: ["Displacement strength can be adjusted in the viewer."],
    unsupported: []
  };
}
