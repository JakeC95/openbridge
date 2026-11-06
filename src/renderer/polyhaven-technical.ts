import type { AssetTechnicalSummary, PolyHavenAssetSummary } from "../shared/types";
import { polyHavenMapLabel } from "../shared/polyhaven";

/** Project a Poly Haven catalogue record into the shared technical shape. */
export function polyHavenTechnical(hit: PolyHavenAssetSummary): AssetTechnicalSummary {
  const codes = hit.mapCodes;
  const workflow: AssetTechnicalSummary["materialWorkflow"] =
    codes.some(code => /metal|arm|rough/i.test(code)) ? "metal-rough" : null;
  return {
    resolution: hit.maxResolution,
    mapTypes: codes.map(code => polyHavenMapLabel(code)),
    mapCount: codes.length,
    mapFormats: hit.mapFormats.map(value => value.toUpperCase()),
    lodCount: hit.lodCount,
    lodTriangles: [],
    maxTris: hit.polycount ?? 0,
    variationCount: 0,
    billboardCount: 0,
    tileable: hit.type === "textures" ? true : null,
    tilingDirections: [],
    scanArea: null,
    texelDensity: hit.texelDensity,
    physicalSize: hit.dimensions,
    dimensions: hit.dimensions,
    height: null,
    variationDimensions: [],
    meshType: hit.type === "models" ? "mesh" : null,
    hasHighpoly: false,
    hasZtool: false,
    hasBrushes: false,
    closedMesh: null,
    scaleFixed: null,
    assembly: null,
    smallAsset: null,
    splitSubmeshes: null,
    modular: false,
    hasAlpha: codes.some(code => /alpha|opacity|mask/i.test(code)),
    materialWorkflow: workflow,
    averageColor: null,
    packId: null,
    packName: hit.collections[0] ?? null,
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
