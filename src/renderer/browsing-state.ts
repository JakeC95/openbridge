import type { CatalogQuery, LibraryQuery, LibrarySort, PackRef, RepoKind } from "../shared/types";

export function readPreference<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(`openbridge.${key}`) ?? "null") ?? fallback; }
  catch { return fallback; }
}

export function writePreference(key: string, value: unknown): void {
  try { localStorage.setItem(`openbridge.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export interface LocalFilters {
  localQuery: string;
  localRepo: "all" | RepoKind;
  localType: string;
  localCategoryPath: string[];
  localSort: LibrarySort;
  localFavoritesOnly: boolean;
  favorites: string[];
  localPack: PackRef | null;
  localReady: string[];
  localMaxTris: number | null;
  localColor: string;
  localState: string;
  localInterior: string;
}

export function libraryFilterQuery(state: LocalFilters): LibraryQuery {
  return {
    query: state.localQuery, repo: state.localRepo, type: state.localType || undefined,
    categoryPath: state.localCategoryPath, sort: state.localSort,
    ids: state.localFavoritesOnly ? state.favorites : undefined,
    packId: state.localPack?.id, pack: state.localPack?.name,
    ready: state.localReady, maxTris: state.localMaxTris ?? undefined,
    color: state.localColor || undefined, state: state.localState || undefined,
    interiorExterior: state.localInterior || undefined
  };
}

export interface CatalogFilters {
  query: string;
  type: string;
  categoryPath: string[];
  favoritesOnly: boolean;
  favorites: string[];
  freeOnly: boolean;
  sizeFilter: "any" | "small" | "medium" | "large" | "huge";
  facetFilters: Record<string, string[]>;
  catalogPack: PackRef | null;
}

export function catalogFilterQuery(state: CatalogFilters): CatalogQuery {
  const ranges = { any: {}, small: { maxSize: 0.5 }, medium: { minSize: 0.5, maxSize: 2 },
    large: { minSize: 2, maxSize: 5 }, huge: { minSize: 5 } };
  return {
    query: state.query, type: state.type || undefined, categoryPath: state.categoryPath,
    ids: state.favoritesOnly ? state.favorites : undefined, points: state.freeOnly ? 0 : undefined,
    ...ranges[state.sizeFilter], facetFilters: state.facetFilters, pack: state.catalogPack ?? undefined,
    facets: ["biome", "region", "resolution", "color", "environment", "theme"], page: 0
  };
}
