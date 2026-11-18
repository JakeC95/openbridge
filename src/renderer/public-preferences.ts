import type { PublicCatalogQuery, PublicProviderId, PublicSort } from "../shared/public-providers";

const SORTS = new Set<PublicSort>(["relevance", "newest", "oldest", "name", "name-desc", "type", "resolution", "downloads", "size", "maps"]);

/** Treat persisted JSON as untrusted; never restore stale ID selections or offsets. */
export function normalizePublicQuery(provider: PublicProviderId, value: unknown): PublicCatalogQuery {
  const query: PublicCatalogQuery = { provider, limit: 60, offset: 0, ids: undefined };
  if (!value || typeof value !== "object" || Array.isArray(value)) return query;
  const record = value as Record<string, unknown>;
  query.query = typeof record.query === "string" ? record.query.slice(0, 512) : "";
  for (const key of ["types", "categoryPaths", "tags", "licenses", "resolutions", "mapTypes", "modelFormats", "weather"] as const) {
    const values = record[key];
    query[key] = Array.isArray(values) ? [...new Set(values.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length < 256 && item !== "__none__"))].slice(0, 100) : [];
  }
  for (const key of ["minSize", "maxSize", "minResolution", "maxResolution", "minTris", "maxTris", "minBytes", "maxBytes", "timeStart", "timeEnd"] as const) {
    query[key] = undefined;
    const number = record[key];
    if (typeof number === "number" && Number.isFinite(number) && number >= 0 && (!key.startsWith("time") || number <= 24)) query[key] = number;
  }
  query.freeOnly = record.freeOnly === true;
  query.timeWindows = Array.isArray(record.timeWindows) ? record.timeWindows.filter(window => window && typeof window.start === "number" && typeof window.end === "number" && Number.isFinite(window.start) && Number.isFinite(window.end) && window.start >= 0 && window.start <= 24 && window.end >= 0 && window.end <= 24).slice(0, 4).map(window => ({ start: window.start, end: window.end })) : [];
  const sort = record.sort as PublicSort;
  query.sort = SORTS.has(sort) && (provider !== "blenderkit" || ["relevance", "newest", "oldest"].includes(sort)) ? sort : "relevance";
  return query;
}

export interface PublicRecentAsset {
  provider: PublicProviderId;
  id: string;
  name: string;
  typeLabel: string;
  thumbnail: string | null;
}

export function normalizePublicRecent(value: unknown): PublicRecentAsset[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && (item.provider === "ambientcg" || item.provider === "blenderkit" || item.provider === "openhdri") && typeof item.id === "string" && typeof item.name === "string").slice(0, 20).map(item => ({
    provider: item.provider,
    id: item.id,
    name: item.name.slice(0, 200),
    typeLabel: typeof item.typeLabel === "string" ? item.typeLabel.slice(0, 80) : "Asset",
    thumbnail: typeof item.thumbnail === "string" ? item.thumbnail : null
  }));
}

export interface PublicSavedSearch {
  id: string;
  name: string;
  scope: "catalog" | "favorites" | "downloaded";
  query: PublicCatalogQuery;
}

export function normalizePublicSaved(provider: PublicProviderId, value: unknown): PublicSavedSearch[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item.id === "string" && typeof item.name === "string" && item.name.trim()).slice(0, 20).map(item => ({
    id: item.id.slice(0, 100),
    name: item.name.slice(0, 100),
    scope: ["catalog", "favorites", "downloaded"].includes(item.scope) ? item.scope : "catalog",
    query: normalizePublicQuery(provider, item.query)
  }));
}
