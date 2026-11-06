import type { AssetTechnicalSummary, PoliigonAssetSummary } from "../shared/types";

/** Project a Poliigon catalogue record into the shared technical shape used by cards and drawers. */
export function poliigonTechnical(hit: PoliigonAssetSummary): AssetTechnicalSummary {
  const codes = hit.mapCodes;
  const workflow: AssetTechnicalSummary["materialWorkflow"] =
    hit.convention === 1
      ? "metal-rough"
      : codes.some(code => ["Gloss", "Reflection", "Specular"].includes(code))
        ? "spec-gloss"
        : codes.some(code => ["Metalness", "Metallic"].includes(code))
          ? "metal-rough"
          : null;
  return {
    resolution: hit.maxResolution,
    mapTypes: codes,
    mapCount: codes.length,
    mapFormats: hit.mapFormats.map(value => value.toUpperCase()),
    lodCount: hit.lodCount,
    lodTriangles: [],
    maxTris: hit.maxTris ?? 0,
    variationCount: 0,
    billboardCount: 0,
    tileable: null,
    tilingDirections: [],
    scanArea: null,
    texelDensity: null,
    physicalSize: hit.physicalSize,
    // AssetScaleDiagram expects length x width x height, while Poliigon publishes
    // named width/height/depth values in centimetres.
    dimensions: poliigonScaleDimensions(hit),
    height: null,
    variationDimensions: [],
    meshType: null,
    hasHighpoly: false,
    hasZtool: false,
    hasBrushes: hit.type === "Brushes",
    closedMesh: null,
    scaleFixed: null,
    assembly: null,
    smallAsset: null,
    splitSubmeshes: null,
    modular: false,
    hasAlpha: codes.some(code =>
      ["ALPHA", "ALPHAMASKED", "OPACITY", "Opacity", "BaseColorOpacity"].includes(code)
    ),
    materialWorkflow: workflow,
    averageColor: null,
    packId: null,
    packName: null,
    revision: null,
    revised: null,
    semantic: {
      subjectMatter: null,
      color: [],
      state: [],
      interiorExterior: [],
      industry: [],
      theme: [],
      descriptive: [],
      contains: [],
      orientation: []
    }
  };
}

/**
 * `AssetScaleDiagram` expects depth x width x height with one unit at the end.
 * Poliigon stores named axes in centimetres, so reorder them explicitly.
 */
export function poliigonScaleDimensions(hit: PoliigonAssetSummary): string | null {
  const size = hit.physicalSizeCm;
  if (!size || size.width === undefined || size.height === undefined || size.depth === undefined) {
    return null;
  }
  return `${size.depth} x ${size.width} x ${size.height} cm`;
}
