/**
 * Poliigon map codes appear in two generations of catalogue data: legacy
 * uppercase tokens (COL, NRM, METALNESS) and newer PascalCase names
 * (BaseColor, Normal, Metallic). Both refer to the same map, so the catalogue
 * stores one canonical code per map to keep facets and filters meaningful.
 */
const MAP_CODE_ALIASES: Record<string, string> = {
  COL: "BaseColor",
  BASECOLOR: "BaseColor",
  ALBEDO: "BaseColor",
  NRM: "Normal",
  NORMAL: "Normal",
  NRM16: "Normal",
  AO: "AmbientOcclusion",
  AMBIENTOCCLUSION: "AmbientOcclusion",
  ROUGH: "Roughness",
  ROUGHNESS: "Roughness",
  METALNESS: "Metalness",
  METALLIC: "Metalness",
  DISP: "Displacement",
  DISP16: "Displacement",
  DISPLACEMENT: "Displacement",
  BUMP: "Bump",
  BUMP16: "Bump",
  GLOSS: "Gloss",
  REFL: "Reflection",
  REFLECTION: "Reflection",
  SPECULAR: "Specular",
  ORM: "ORM",
  ID: "ID",
  IDMAP: "ID",
  SSS: "SSS",
  HDR: "HDR",
  JPG: "JPG",
  TRANSMISSION: "Transmission",
  TRANSLUCENCY: "Translucency",
  EMISSION: "Emission",
  EMISSIVE: "Emission",
  OPACITY: "Opacity",
  ALPHA: "Alpha",
  MASK: "Mask",
  ALPHAMASKED: "AlphaMasked",
  OVERLAY: "Overlay",
  FUZZ: "Fuzz",
  SHEENCOLOR: "SheenColor",
  SCATTERINGCOLOR: "ScatteringColor",
  BASECOLOROPACITY: "BaseColorOpacity"
};

export function canonicalPoliigonMapCode(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return trimmed;
  const key = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return MAP_CODE_ALIASES[key] ?? trimmed;
}
