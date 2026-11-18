import type { CategoryNode } from "../../shared/types";
import type { PublicAssetSummary, PublicFacetBucket } from "../../shared/public-providers";

export type Dict = Record<string, unknown>;

export function dict(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function safeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\.+$/, "").trim() || "asset";
}

export function publicFtsQuery(value: string): string {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map(token => `${token}*`).join(" AND ");
}

export function resolutionPixels(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)k$/i.exec(value.trim());
  if (match) return Math.round(Number(match[1]) * 1024);
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function resolutionKey(pixels: number | null): string | null {
  if (!pixels || !Number.isFinite(pixels)) return null;
  const k = pixels / 1024;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
}

export function sortResolutionKeys(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => {
    const av = resolutionPixels(a) ?? 0;
    const bv = resolutionPixels(b) ?? 0;
    return av - bv;
  });
}

export function sortFacetBuckets(buckets: PublicFacetBucket[]): PublicFacetBucket[] {
  return [...buckets].sort((a, b) => {
    const av = resolutionPixels(a.value);
    const bv = resolutionPixels(b.value);
    if (av !== null && bv !== null) return av - bv;
    return b.count - a.count || a.value.localeCompare(b.value);
  });
}

export function dimensionsText(values: number[]): string | null {
  if (values.length === 0) return null;
  const largest = Math.max(...values);
  if (largest <= 0) return null;
  const metres = largest >= 1000;
  const parts = values.map(value => (metres ? value / 1000 : value / 10));
  const formatted = parts.map(value => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "")));
  return `${formatted.join(" x ")} ${metres ? "m" : "cm"}`;
}

export function sizeMeters(valuesMm: number[]): number | null {
  const valid = valuesMm.filter(value => Number.isFinite(value) && value > 0);
  return valid.length > 0 ? Math.max(...valid) / 1000 : null;
}

export function buildCategoryTree(rows: Array<{ category: string; id: string }>): CategoryNode[] {
  interface MutableNode extends CategoryNode {
    children: MutableNode[];
  }
  const roots: MutableNode[] = [];
  const index = new Map<string, MutableNode>();
  for (const row of rows) {
    const parts = row.category.split("/").map(part => part.trim()).filter(Boolean);
    let nodes = roots;
    let trail = "";
    for (const part of parts) {
      trail = trail ? `${trail}/${part}` : part;
      let node = index.get(trail);
      if (!node) {
        node = { key: trail, label: part, count: 0, children: [] };
        index.set(trail, node);
        nodes.push(node);
      }
      node.count += 1;
      nodes = node.children;
    }
  }
  const sort = (nodes: MutableNode[]): CategoryNode[] =>
    nodes
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(node => ({ ...node, children: sort(node.children) }));
  return sort(roots);
}

export function summaryCategory(summary: PublicAssetSummary): string {
  return summary.category || summary.categories[0] || "";
}

export function publicDownloadSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}
