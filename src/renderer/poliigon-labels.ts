const MAP_NAME_ALIASES: Record<string, string> = {
  COL: "Base Color",
  BASECOLOR: "Base Color",
  ALBEDO: "Base Color",
  NRM: "Normal",
  NORMAL: "Normal",
  AO: "Ambient Occlusion",
  AMBIENTOCCLUSION: "Ambient Occlusion",
  ROUGH: "Roughness",
  ROUGHNESS: "Roughness",
  METALNESS: "Metalness",
  METALLIC: "Metalness",
  DISP: "Displacement",
  DISP16: "Displacement",
  DISPLACEMENT: "Displacement",
  GLOSS: "Gloss",
  REFL: "Reflection",
  REFLECTION: "Reflection",
  SPECULAR: "Specular",
  SSS: "Subsurface",
  ORM: "ORM",
  HDR: "HDR",
  JPG: "Tone-mapped JPG",
  BASECOLOROPACITY: "Base Color + Opacity",
  ALPHAMASKED: "Alpha Masked",
  SHEENCOLOR: "Sheen Color",
  SCATTERINGCOLOR: "Scattering Color"
};

const MAP_RANK = [
  "BASECOLOR",
  "NORMAL",
  "ROUGHNESS",
  "METALNESS",
  "GLOSS",
  "REFLECTION",
  "SPECULAR",
  "ORM",
  "AMBIENTOCCLUSION",
  "DISPLACEMENT",
  "BUMP",
  "OPACITY",
  "ALPHA",
  "MASK",
  "EMISSION",
  "TRANSMISSION",
  "TRANSLUCENCY",
  "HDR",
  "JPG"
];

export function poliigonMapName(code: string): string {
  const key = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const alias = MAP_NAME_ALIASES[key];
  if (alias) return alias;
  return code
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

/** Canonical display order for Poliigon map codes and labels. */
export function poliigonMapRank(code: string): number {
  const key = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const index = MAP_RANK.indexOf(key);
  return index >= 0 ? index : MAP_RANK.length;
}
