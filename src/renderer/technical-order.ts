/**
 * Canonical technical fact grouping shared by every provider drawer, so the
 * same information always appears under the same heading and in the same order
 * regardless of asset type/source.
 */
export type TechnicalFact = readonly [key: string, label: string, value: string];

export interface TechnicalGroup {
  title: string;
  rows: Array<[string, string]>;
}

const GROUP_DEFS: Array<{ title: string; keys: string[] }> = [
  {
    title: "Geometry",
    keys: [
      "dimensions",
      "scanArea",
      "height",
      "texelDensity",
      "lods",
      "maxTriangles",
      "meshes",
      "meshType",
      "meshClosed",
      "scaleFixed",
      "assembly",
      "modular",
      "variations",
      "billboards",
      "tileable"
    ]
  },
  {
    title: "Maps",
    keys: ["mapTypes", "mapFormats", "materialWorkflow", "alpha"]
  },
  {
    title: "Delivery",
    keys: ["resolutions", "maxResolution", "defaultResolution", "layoutConvention"]
  },
  {
    title: "Metadata",
    keys: [
      "pack",
      "creationMethod",
      "releaseStatus",
      "timeOfDay",
      "attributes",
      "dateTaken",
      "coordinates",
      "evsCap",
      "whiteBalance",
      "vault",
      "versionRequired",
      "categoryId",
      "filesHash",
      "displacementHeight",
      "sunPosition",
      "catalogueId",
      "published",
      "updated",
      "revision",
      "revised"
    ]
  }
];

const RANK = new Map<string, number>(
  GROUP_DEFS.flatMap(group => group.keys).map((key, index) => [key, index])
);

export function groupTechnicalFacts(facts: TechnicalFact[]): TechnicalGroup[] {
  return GROUP_DEFS.map(group => ({
    title: group.title,
    rows: facts
      .filter(fact => group.keys.includes(fact[0]))
      .sort((a, b) => (RANK.get(a[0]) ?? 999) - (RANK.get(b[0]) ?? 999))
      .map(([, label, value]) => [label, value] as [string, string])
  })).filter(group => group.rows.length > 0);
}
