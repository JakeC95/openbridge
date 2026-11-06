import type { PolyHavenAssetType } from "./types";
import { hdriTimeOfDay } from "./hdri-time";

/** Human labels for the public Poly Haven asset types. */
export function polyHavenTypeLabel(type: string | undefined): string {
  switch ((type ?? "").toLowerCase()) {
    case "hdris":
      return "HDRI";
    case "textures":
      return "Texture";
    case "models":
      return "Model";
    default:
      return type ? type.toUpperCase() : "Asset";
  }
}

export function polyHavenTypeFromCode(value: unknown): PolyHavenAssetType {
  const numeric = typeof value === "number" ? value : Number(value);
  if (numeric === 0) return "hdris";
  if (numeric === 2) return "models";
  if (numeric === 1) return "textures";
  if (value === "hdris" || value === "textures" || value === "models") return value;
  return "textures";
}

const MAP_LABELS: Record<string, string> = {
  diffuse: "Base Color",
  albedo: "Base Color",
  col: "Base Color",
  basecolor: "Base Color",
  nor_gl: "Normal (OpenGL)",
  nor_dx: "Normal (DirectX)",
  normal: "Normal",
  nrm: "Normal",
  rough: "Roughness",
  roughness: "Roughness",
  rough_ao: "Roughness / AO",
  metal: "Metalness",
  metallic: "Metalness",
  metalness: "Metalness",
  arm: "ARM",
  ao: "Ambient Occlusion",
  ambientocclusion: "Ambient Occlusion",
  displacement: "Displacement",
  disp: "Displacement",
  opacity: "Opacity",
  alpha: "Opacity",
  emission: "Emission",
  emissive: "Emission",
  bump: "Bump",
  mtlx: "MaterialX",
  blend: "Blender",
  gltf: "glTF",
  usd: "USD",
  fbx: "FBX",
  obj: "OBJ",
  hdr: "HDR",
  exr: "EXR",
  jpg: "Tone-mapped JPG",
  png: "PNG",
  tonemapped: "Tone-mapped JPG",
  colorchart: "Colour chart"
};

export function polyHavenMapLabel(code: string): string {
  const key = code.trim().toLowerCase();
  if (MAP_LABELS[key]) return MAP_LABELS[key];
  return code
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, value => value.toUpperCase());
}

const MAP_ORDER = [
  "diffuse",
  "albedo",
  "col",
  "basecolor",
  "nor_gl",
  "normal",
  "nrm",
  "nor_dx",
  "rough",
  "roughness",
  "rough_ao",
  "metal",
  "metalness",
  "arm",
  "ao",
  "displacement",
  "disp",
  "opacity",
  "alpha",
  "emission",
  "emissive",
  "bump"
];

export function polyHavenMapRank(code: string): number {
  const index = MAP_ORDER.indexOf(code.toLowerCase());
  return index >= 0 ? index : MAP_ORDER.length;
}

/** Package keys that are not standalone image maps. */
export function polyHavenIsPackageKey(code: string): boolean {
  return ["blend", "gltf", "usd", "fbx", "obj", "mtlx", "hdri", "tonemapped", "colorchart"].includes(
    code.toLowerCase()
  );
}

export function polyHavenIsImageFormat(format: string): boolean {
  return ["jpg", "jpeg", "png", "exr", "tif", "tiff", "hdr"].includes(format.toLowerCase());
}

export function polyHavenResolutionValue(value: string): number {
  const normal = value.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)k$/.exec(normal);
  if (match) return Math.round(Number(match[1]) * 1024);
  const raw = Number(normal);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

export function polyHavenTimeOfDay(
  attributes: Record<string, unknown> | null | undefined,
  input: { name: string; tags: string[]; categories: string[] }
): number | null {
  const explicit = String(attributes?.time_of_day ?? "").trim().toLowerCase();
  switch (explicit) {
    case "night":
      return 0;
    case "dawn":
      return 5.5;
    case "sunrise":
      return 6.5;
    case "morning":
      return 9;
    case "morning-afternoon":
      return 10.5;
    case "midday":
    case "noon":
      return 12;
    case "afternoon":
      return 15;
    case "sunrise-sunset":
      return 17;
    case "sunset":
      return 18.5;
    case "dusk":
      return 19.5;
    case "evening":
      return 20.5;
    default:
      break;
  }
  return hdriTimeOfDay({
    name: input.name,
    tags: input.tags,
    categories: input.categories
  });
}

export function polyHavenCollectionLabel(value: string): string {
  const withoutPrefix = value.replace(/^collection:\s*/i, "");
  return withoutPrefix
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  time_of_day: "Time of day",
  weather: "Weather",
  light_type: "Lighting",
  contrast: "Contrast",
  environment: "Environment",
  sky_view: "Sky visibility",
  season: "Season",
  backplates: "Backplates",
  surface_use: "Surface use",
  condition: "Condition",
  origin: "Origin",
  setting: "Setting",
  aerial: "Aerial scan",
  material: "Material",
  rigged: "Rigged",
  lods: "LODs",
  geonodes: "Geometry nodes"
};

const ATTRIBUTE_VALUES: Record<string, string> = {
  natural: "Natural",
  artificial: "Artificial",
  mixed: "Mixed",
  partly_cloudy: "Partly cloudy",
  man_made: "Man-made",
  natural_light: "Natural light",
  open: "Open",
  obstructed: "Obstructed",
  ground: "Ground",
  object: "Object",
  indoor: "Indoor",
  outdoor: "Outdoor",
  either: "Indoor or outdoor",
  clear: "Clear",
  fog: "Fog",
  rain: "Rain",
  snow: "Snow",
  storm: "Storm",
  overcast: "Overcast",
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
  low: "Low",
  medium: "Medium",
  high: "High",
  clean: "Clean",
  worn: "Worn",
  weathered: "Weathered",
  cracked: "Cracked",
  damaged: "Damaged",
  new: "New",
  old: "Old",
  yes: "Yes",
  no: "No",
  wood: "Wood",
  metal: "Metal",
  stone: "Stone",
  concrete: "Concrete",
  fabric: "Fabric",
  leather: "Leather",
  plastic: "Plastic",
  glass: "Glass",
  ceramic: "Ceramic",
  paper: "Paper",
  plant: "Plant matter",
  organic: "Organic",
  other: "Other"
};

export function polyHavenAttributeLabel(key: string): string {
  return ATTRIBUTE_LABELS[key] ?? polyHavenCollectionLabel(key);
}

/** Attributes that materially differ by Poly Haven asset type. */
export const POLYHAVEN_ATTRIBUTE_TYPES: Record<string, Array<"hdris" | "textures" | "models">> = {
  time_of_day: ["hdris"],
  weather: ["hdris"],
  light_type: ["hdris"],
  contrast: ["hdris"],
  environment: ["hdris"],
  sky_view: ["hdris"],
  season: ["hdris"],
  backplates: ["hdris"],
  surface_use: ["textures"],
  origin: ["textures"],
  setting: ["textures", "models"],
  aerial: ["textures"],
  condition: ["textures", "models"],
  material: ["models"],
  rigged: ["models"],
  lods: ["models"],
  geonodes: ["models"]
};

export function polyHavenAttributeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.map(item => polyHavenAttributeValue(item)).filter(Boolean).join(", ");
  }
  const raw = String(value);
  return ATTRIBUTE_VALUES[raw] ?? polyHavenCollectionLabel(raw);
}

/**
 * Poly Haven's square `thumbs` composition adds preview spheres and a checker
 * floor. The `primary` render is the clean panorama, so HDRIs use it at a small
 * height and crop naturally inside the square card.
 */
export function polyHavenPrimaryPreview(
  thumbnail: string | null | undefined,
  height = 512
): string | null {
  if (!thumbnail) return null;
  try {
    const url = new URL(thumbnail);
    if (!/cdn\.polyhaven\.com$/i.test(url.hostname)) return thumbnail;
    url.pathname = url.pathname.replace("/asset_img/thumbs/", "/asset_img/primary/");
    url.searchParams.delete("width");
    url.searchParams.delete("height");
    url.searchParams.delete("format");
    url.searchParams.set("height", String(height));
    return url.href;
  } catch {
    return thumbnail;
  }
}
