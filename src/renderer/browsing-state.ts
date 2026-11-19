import type { LibrarySource, CatalogQuery, LibraryQuery, LibraryRef, LibrarySort, PackRef, RepoKind } from "../shared/types";

export function readPreference<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(`openbridge.${key}`) ?? "null") ?? fallback; }
  catch { return fallback; }
}

export function writePreference(key: string, value: unknown): void {
  try { localStorage.setItem(`openbridge.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export interface LocalFilters {
  localProvider: LibrarySource;
  localQuery: string;
  localRepo: "all" | RepoKind;
  localType: string;
  localCategoryPath: string[];
  localSort: LibrarySort;
  localFavoritesOnly: boolean;
  favorites: string[];
  sharedFavorites?: string[];
  sharedTag?: string;
  sharedCollection?: string;
  localPack: PackRef | null;
  localReady: string[];
  localMaxTris: number | null;
  localColor: string;
  localState: string;
  localInterior: string;
}

export function libraryFilterQuery(state: LocalFilters): LibraryQuery {
  return {
    provider: state.localProvider === "all" ? undefined : state.localProvider,
    query: state.localQuery, repo: state.localRepo, type: state.localType || undefined,
    categoryPath: state.localCategoryPath, sort: state.localSort,
    sharedTag: state.localProvider === "shared" ? state.sharedTag || undefined : undefined,
    sharedCollection: state.localProvider === "shared" ? state.sharedCollection || undefined : undefined,
    ids: state.localFavoritesOnly
      ? state.localProvider === "shared" ? state.sharedFavorites ?? []
        : state.localProvider === "all" ? [...state.favorites, ...(state.sharedFavorites ?? [])] : state.favorites
      : undefined,
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
  categoryPaths?: string[][];
  favoritesOnly: boolean;
  favorites: string[];
  downloadedOnly?: boolean;
  downloadedIds?: string[];
  localRefs?: LibraryRef[];
  freeOnly: boolean;
  sizeFilter: "any" | "small" | "medium" | "large" | "huge";
  facetFilters: Record<string, string[]>;
  catalogPack: PackRef | null;
}

export function catalogFilterQuery(state: CatalogFilters): CatalogQuery {
  const ranges = { any: {}, small: { maxSize: 0.5 }, medium: { minSize: 0.5, maxSize: 2 },
    large: { minSize: 2, maxSize: 5 }, huge: { minSize: 5 } };
  let ids: string[] | undefined = state.favoritesOnly ? state.favorites : undefined;
  if (state.downloadedOnly) {
    const downloaded = state.downloadedIds
      ?? state.localRefs?.filter(ref => !ref.id.startsWith("poliigon:") && !ref.id.startsWith("polyhaven:") && !ref.id.startsWith("shared:")).map(ref => ref.id)
      ?? [];
    ids = ids
      ? ids.filter(id => downloaded.includes(id))
      : downloaded;
  }
  return {
    query: state.query, type: state.type || undefined, categoryPath: state.categoryPath,
    categoryPaths: state.categoryPaths && state.categoryPaths.length > 0 ? state.categoryPaths : undefined,
    ids, points: state.freeOnly ? 0 : undefined,
    ...ranges[state.sizeFilter], facetFilters: state.facetFilters, pack: state.catalogPack ?? undefined,
    facets: ["biome", "region", "resolution", "color", "environment", "theme"], page: 0
  };
}
