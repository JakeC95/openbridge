/** Shared contracts for the local/provider 3D model previewer. */

export type ModelFormat =
  | "gltf"
  | "glb"
  | "fbx"
  | "obj"
  | "usd"
  | "usda"
  | "usdc"
  | "usdz"
  | "abc"
  | "blend"
  | "max"
  | "c4d"
  | "ma"
  | "mb"
  | "skp"
  | "stl"
  | "ply"
  | "3mf"
  | "dae"
  | "sphere"
  | "other";

export type ModelMapType =
  | "basecolor"
  | "normal"
  | "roughness"
  | "metalness"
  | "ao"
  | "orm"
  | "opacity"
  | "emissive"
  | "specular"
  | "gloss"
  | "displacement"
  | "translucency"
  | "unknown";

export type ModelLodMode = "lowest" | "highest" | number;

export interface ModelMeshPart {
  url: string;
  format: ModelFormat;
  label: string;
  /** Optional MTL sidecar for OBJ. */
  mtlUrl?: string;
  /** Prefix that matches this part's texture set (for provider multi-part sets). */
  materialKey?: string;
}

export interface ModelMeshVariant {
  url: string;
  format: ModelFormat;
  label: string;
  lod: number | null;
  quality: string | null;
  bytes: number;
  triangles: number | null;
  /** Optional MTL sidecar for OBJ. */
  mtlUrl?: string;
  /** Multiple files that must be assembled as one asset (for example a Poliigon set). */
  parts?: ModelMeshPart[];
  /** Collections of variants lose their scene transforms in Generic packages. */
  partsLayout?: "row";
}

export interface ModelTextureVariant {
  url: string;
  mapType: ModelMapType;
  /** Pixel width when known. */
  resolution: number | null;
  /** Mesh LOD this map was authored for, when the provider labels it. */
  lod: number | null;
  format: string;
  bytes: number;
  /** Prefix that matches this map to a multi-part texture set. */
  materialKey?: string;
  /** DX normal maps need their Y axis flipped relative to Three's GL convention. */
  normalSpace?: "gl" | "dx";
}

export interface ModelManifest {
  assetId: string;
  provider: string;
  name: string;
  source: "local" | "provider";
  meshes: ModelMeshVariant[];
  textures: ModelTextureVariant[];
  defaultMesh: ModelMeshVariant | null;
  availableQualities: number[];
  availableLods: number[];
  /** True for assets whose material uses alpha-cutout foliage cards. */
  alpha: boolean;
  /** True when the viewer wraps a 2D surface map set around a sphere. */
  surface?: boolean;
  notes: string[];
  /** Runtime formats that were published but cannot be displayed without conversion/download. */
  unsupported: Array<{ format: ModelFormat; url?: string; reason: string }>;
}

export interface ModelManifestRequest {
  assetId: string;
  provider: string;
  name?: string;
  path?: string;
  type?: string;
  quality?: number;
  lod?: ModelLodMode;
}

const RUNTIME_FORMATS = new Set<ModelFormat>([
  "gltf",
  "glb",
  "fbx",
  "obj",
  "usd",
  "usda",
  "usdc",
  "usdz",
  "stl",
  "ply",
  "3mf",
  "dae"
]);

const MESH_EXTENSIONS: Record<string, ModelFormat> = {
  ".gltf": "gltf",
  ".glb": "glb",
  ".fbx": "fbx",
  ".obj": "obj",
  ".usd": "usd",
  ".usda": "usda",
  ".usdc": "usdc",
  ".usdz": "usdz",
  ".abc": "abc",
  ".blend": "blend",
  ".max": "max",
  ".c4d": "c4d",
  ".ma": "ma",
  ".mb": "mb",
  ".skp": "skp",
  ".stl": "stl",
  ".ply": "ply",
  ".3mf": "3mf",
  ".dae": "dae"
};

export const MODEL_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tga", ".exr"]);

export function modelFormatFromExtension(extension: string): ModelFormat | null {
  return MESH_EXTENSIONS[extension.trim().toLowerCase()] ?? null;
}

export function isRuntimeModelFormat(format: ModelFormat): boolean {
  return RUNTIME_FORMATS.has(format);
}

export function isUnsupportedNativeFormat(format: ModelFormat): boolean {
  return format === "blend" || format === "max" || format === "c4d" || format === "ma" || format === "mb" || format === "skp";
}

export function is3dAssetType(type: string | null | undefined): boolean {
  return Boolean(type && /^(3d|3dplant|3d-model|model|models|terrain|plant|plants)$/i.test(type))
    || Boolean(type && /3d|model|plant|terrain/i.test(type));
}

/** Flat texture sets that benefit from a sphere material preview. */
export function isSurfaceAssetType(type: string | null | undefined): boolean {
  if (!type || is3dAssetType(type)) return false;
  return /^(surface|surface-material|texture|textures|material|materials|atlas|atlases|decal|decals|brush|brushes|imperfection|imperfections|displacement|displacements)$/i.test(type)
    || /surface|texture|material|atlas/i.test(type);
}

export function canonicalModelMapType(value: string): { mapType: ModelMapType; normalSpace?: "gl" | "dx" } {
  // Provider packages sometimes append the workflow to every filename, for
  // example `..._AO_1K_METALNESS.png`. Drop that trailing workflow token only
  // when another map token already identifies the file; otherwise a plain
  // `..._1K_Specular` map would be erased.
  const hasEarlierMapToken = (text: string): boolean =>
    /col|basecolor|albedo|diffuse|diff|normal|nrm|nor|bump|rough|metal|ao|occlusion|orm|arm|opacity|alpha|mask|emissive|emission|spec|reflect|gloss|disp|height|sss|translucen|transmission|sheen/i.test(text);
  const cleaned = value.replace(
    /((?:_\d+k)|(?:_lod\d+))_(?:metalness|metallic|specular|specgloss)(?=[_\-\s.]|$)/gi,
    (match, prefix: string, offset: number, whole: string) =>
      hasEarlierMapToken(whole.slice(0, offset)) ? prefix : match
  );
  const lower = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (/normal.*dx|nor_dx|nrm_dx/.test(lower)) return { mapType: "normal", normalSpace: "dx" };
  if (/normal|nor_gl|nrm|bump/.test(lower)) return { mapType: "normal", normalSpace: "gl" };
  if (/basecolor|base_color|albedo|diffuse|diff|_col(?:or)?|color/.test(lower)) return { mapType: "basecolor" };
  if (/(?:^|_)(?:orm|arm)(?:_|$)|rough.*ao|ao.*rough/.test(lower)) return { mapType: "orm" };
  if (/rough/.test(lower)) return { mapType: "roughness" };
  if (/metal/.test(lower)) return { mapType: "metalness" };
  if (/ambient.*occlusion|_ao|occlusion|cavity/.test(lower)) return { mapType: "ao" };
  if (/opacity|alpha|mask/.test(lower)) return { mapType: "opacity" };
  if (/emissive|emission/.test(lower)) return { mapType: "emissive" };
  if (/specular|spec|reflect/.test(lower)) return { mapType: "specular" };
  if (/gloss/.test(lower)) return { mapType: "gloss" };
  if (/displacement|disp|height/.test(lower)) return { mapType: "displacement" };
  if (/sss|subsurface|translucen|transmission|scattering|sheen/.test(lower)) return { mapType: "translucency" };
  return { mapType: "unknown" };
}

const MATERIAL_MAP_TOKENS = new Set([
  "col", "basecolor", "base", "albedo", "diffuse", "diff", "color",
  "nrm", "normal", "nor", "bump",
  "roughness", "rough", "metalness", "metal", "metallic",
  "ao", "occlusion", "orm", "arm",
  "opacity", "alpha", "mask", "emissive", "emission",
  "specular", "spec", "refl", "reflect", "gloss",
  "disp", "displacement", "height",
  "sss", "translucency", "transmission", "sheen"
]);

function cleanMaterialKey(value: string): string {
  return value
    .replace(/(?:^|[_\-\s]+)(?:\d+k|lod\d+|source)(?=[_\-\s]|$)/gi, " ")
    .replace(/[_\-\s]+/g, " ")
    .trim();
}

export function normalizeModelMaterialKey(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Derive the material/part prefix from a provider texture filename. */
export function modelTextureMaterialKey(name: string): string | undefined {
  const base = name.replace(/\.[^.]+$/, "");
  const tokens = base.split(/[_\-\s]+/).filter(Boolean);
  const isMapToken = (token: string): boolean => {
    const lower = token.toLowerCase();
    if (MATERIAL_MAP_TOKENS.has(lower)) return true;
    // 16-bit data maps are commonly `NRM16`/`DISP16`/`COL16`. Strip a bit-depth
    // suffix before checking, otherwise the material key swallows the map token
    // and splits one texture set into several phantom material groups.
    const depth = /^(.+?)(?:8|16|32)$/.exec(lower);
    return Boolean(depth && MATERIAL_MAP_TOKENS.has(depth[1]));
  };
  const index = tokens.findIndex(isMapToken);
  if (index <= 0) return undefined;
  const key = cleanMaterialKey(tokens.slice(0, index).join("_"));
  return key || undefined;
}

/** Derive the material/part prefix from a mesh filename. */
export function modelPartMaterialKey(name: string): string | undefined {
  const base = name.replace(/\.[^.]+$/, "");
  const stripped = base.replace(/(?:[_\-\s]+(?:geo|mesh|model))?(?:[_\-\s]+lod\d+)?$/i, "");
  const key = cleanMaterialKey(stripped);
  return key || undefined;
}

export function resolutionFromText(value: string): number | null {
  const match = /(?:^|[^0-9])(\d{2,5})\s*[xX]\s*(\d{2,5})(?:[^0-9]|$)/.exec(value);
  if (match) {
    const width = Number(match[1]), height = Number(match[2]);
    return Number.isFinite(width) && Number.isFinite(height) ? Math.max(width, height) : null;
  }
  const tier = /(?:^|[^0-9])(\d+(?:\.\d+)?)k(?:[^a-z0-9]|$)/i.exec(value);
  if (tier) {
    const amount = Number(tier[1]);
    return Number.isFinite(amount) ? Math.round(amount * 1024) : null;
  }
  const bare = /(?:^|[^0-9])(256|512|1024|2048|4096|8192|16384)(?:[^0-9]|$)/.exec(value);
  return bare ? Number(bare[1]) : null;
}

export function modelQualityLabel(value: number | null): string {
  if (!value) return "Original";
  if (value >= 1024 && value % 1024 === 0) return `${value / 1024}K`;
  return `${value}px`;
}

export function modelLodLabel(lod: number | null): string {
  return lod === null ? "Single mesh" : `LOD${lod}`;
}

export function preferredTextureFormat(format: string): number {
  const lower = format.toLowerCase();
  if (["jpg", "jpeg"].includes(lower)) return 0;
  if (lower === "png") return 1;
  if (lower === "webp") return 2;
  if (lower === "tif" || lower === "tiff") return 3;
  if (lower === "exr") return 4;
  return 5;
}
