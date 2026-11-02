import type { AssetTechnicalSummary } from "./types";

export const REFERENCE_HUMAN_HEIGHT = 1.78;
const UNIT_METERS: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001 };

/** Legacy metadata's unitless measurements are metres. Never infer a height from a scan area. */
function measurement(value: string, defaultUnit = "m"): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?|\.\d+)\s*(m|cm|mm)?$/i);
  if (!match) return null;
  const meters = Number(match[1]) * UNIT_METERS[(match[2] ?? defaultUnit).toLowerCase()];
  return Number.isFinite(meters) && meters > 0 ? meters : null;
}

export interface AssetBounds {
  width: number;
  height: number;
  depth: number;
  variation?: number;
}

export function assetBounds(technical: AssetTechnicalSummary, variation?: number): AssetBounds | null {
  if (technical.variationDimensions.length > 0) {
    const item = variation === undefined ? technical.variationDimensions[0]
      : technical.variationDimensions.find(item => item.variation === variation);
    if (!item) return null;
    const width = measurement(item.width);
    const height = measurement(item.height);
    const depth = measurement(item.length);
    return width !== null && height !== null && depth !== null ? { width, height, depth, variation: item.variation } : null;
  }
  // assetTechnicalFacts serializes named axes in length × width × height order.
  const parts = technical.dimensions?.trim().split(/\s*[x×]\s*/i);
  if (!parts || parts.length !== 3) return null;
  const unit = parts[2].match(/(mm|cm|m)\s*$/i)?.[1].toLowerCase() ?? "m";
  const [depth, width, height] = parts.map(part => measurement(part, unit));
  return width !== null && height !== null && depth !== null ? { width, height, depth } : null;
}

export function scaleDiagramLayout(bounds: AssetBounds, humanHeight = REFERENCE_HUMAN_HEIGHT) {
  const humanWidth = 0.55 * humanHeight / REFERENCE_HUMAN_HEIGHT;
  const gap = 0.4;
  const span = humanWidth + gap + bounds.width;
  const pixelsPerMeter = Math.min(332 / span, 180 / Math.max(humanHeight, bounds.height));
  const left = (420 - span * pixelsPerMeter) / 2;
  const ground = 232;
  return {
    pixelsPerMeter, ground, humanX: left, humanY: ground - humanHeight * pixelsPerMeter,
    humanHeight: humanHeight * pixelsPerMeter,
    boxX: left + (humanWidth + gap) * pixelsPerMeter,
    boxY: ground - bounds.height * pixelsPerMeter,
    boxWidth: bounds.width * pixelsPerMeter, boxHeight: bounds.height * pixelsPerMeter
  };
}

export function scaleMeasurement(meters: number): string {
  const unit = meters < 0.01 ? "mm" : meters < 1 ? "cm" : "m";
  const value = meters * (unit === "mm" ? 1000 : unit === "cm" ? 100 : 1);
  return `${Number(value.toPrecision(4))} ${unit}`;
}
