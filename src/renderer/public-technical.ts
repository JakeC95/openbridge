import type { AssetTechnicalSummary } from "../shared/types";
import { publicProviderLabel, type PublicAssetSummary } from "../shared/public-providers";
import { assetTechnicalFacts } from "../shared/asset-metadata";

function humanise(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

/** Concise provider facts for list/comparison chips across every source. */
export function publicProviderFacts(hit: PublicAssetSummary): string[] {
  const attributes = hit.attributes;
  const facts = [publicProviderLabel(hit.provider)];
  const authors = Object.keys(hit.authors).filter(name => name && name !== "Unknown").join(", ");
  if (authors) facts.push(authors);
  const rating = typeof attributes.rating === "number" && Number.isFinite(attributes.rating) ? `${attributes.rating.toFixed(1)}/10` : "";
  if (rating) facts.push(rating);
  if (attributes.verification === "validated") facts.push("Verified");
  const technique = typeof attributes.technique === "string" && attributes.technique ? humanise(attributes.technique) : "";
  if (technique) facts.push(technique);
  const collections = Array.isArray(attributes.collections) ? attributes.collections.filter((value): value is string => typeof value === "string" && value.length > 0) : [];
  if (collections.length) facts.push(collections.slice(0, 2).join(", "));
  const downloadBytes = typeof attributes.downloadBytes === "number" && Number.isFinite(attributes.downloadBytes)
    ? attributes.downloadBytes
    : hit.files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  const sizeLabel = typeof attributes.downloadSize === "string" && attributes.downloadSize
    ? attributes.downloadSize
    : downloadBytes > 0 ? `${(downloadBytes / 1048576).toFixed(1)} MB` : "";
  if (sizeLabel) facts.push(sizeLabel);
  if (hit.downloadCount > 0) facts.push(`${hit.downloadCount.toLocaleString()} ${hit.provider === "blenderkit" ? "bookmarks" : "downloads"}`);
  return facts;
}

/** Keep the shared technical/scale shape, without relabelling provider faces as triangles. */
export function publicTechnical(hit: PublicAssetSummary): AssetTechnicalSummary {
  const output: AssetTechnicalSummary = {
    ...assetTechnicalFacts(undefined),
    resolution: hit.maxResolution,
    mapCount: hit.mapCodes.length,
    mapTypes: hit.mapCodes.map(code => code.replace(/[-_]/g, " ").replace(/\b\w/g, value => value.toUpperCase())),
    mapFormats: hit.mapFormats.map(format => format.toUpperCase()),
    lodCount: hit.lodCount,
    maxTris: hit.provider === "blenderkit" ? 0 : hit.polycount ?? 0,
    dimensions: hit.dimensions,
    physicalSize: hit.dimensions,
    texelDensity: hit.texelDensity,
    meshType: /model|terrain/.test(hit.type) ? "mesh" : null
  };
  const axes = hit.dimensionsMm;
  if (axes?.length === 3 && axes.every(value => value > 0)) {
    // Blender: X=width, Y=depth, Z=height. ambientCG: width,height,depth.
    const [width, depth, height] = hit.provider === "blenderkit" ? axes : [axes[0], axes[2], axes[1]];
    output.dimensions = `${depth / 1000} x ${width / 1000} x ${height / 1000} m`;
  }
  return output;
}
