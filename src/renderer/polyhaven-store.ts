import { create } from "zustand";
import type {
  AssetRecord,
  CategoryNode,
  PolyHavenAssetDetail,
  PolyHavenAssetSummary,
  PolyHavenCatalogQuery,
  PolyHavenCatalogStatus,
  PolyHavenFacets,
  PolyHavenSort
} from "../shared/types";

const PAGE_SIZE = 120;
const FAVORITES_KEY = "openbridge.polyhavenFavorites";
const RECENT_KEY = "openbridge.polyhavenRecentlyViewed";

export interface PolyHavenRecentAsset {
  id: string;
  name: string;
  typeLabel: string;
  thumbnail: string | null;
}

function readRecentAssets(): PolyHavenRecentAsset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PolyHavenRecentAsset =>
      item && typeof item.id === "string" && typeof item.name === "string" &&
      typeof item.typeLabel === "string" &&
      (item.thumbnail === null || typeof item.thumbnail === "string")
    ).slice(0, 20);
  } catch {
    return [];
  }
}

function writeRecentAssets(values: PolyHavenRecentAsset[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(values.slice(0, 20)));
  } catch {
    // ignore
  }
}

function readFavorites(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function writeFavorites(values: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...new Set(values)]));
  } catch {
    // ignore
  }
}

interface Selection {
  summary: PolyHavenAssetSummary;
  detail?: PolyHavenAssetDetail;
  loading: boolean;
  error?: string;
  localPath?: string;
  localPreview?: string;
  localSizeBytes?: number | null;
  related?: PolyHavenAssetSummary[];
}

interface PolyHavenState {
  status: PolyHavenCatalogStatus | null;
  categories: CategoryNode[];
  favorites: string[];
  recentlyViewed: PolyHavenRecentAsset[];
  favoritesOnly: boolean;
  downloadedOnly: boolean;
  localById: Record<string, AssetRecord>;
  query: string;
  type: string;
  categoryPaths: string[];
  categoriesFilter: string[];
  collections: string[];
  resolutions: string[];
  mapTypes: string[];
  attributeFilters: Record<string, string[]>;
  minSize: number | null;
  maxSize: number | null;
  timeStart: number | null;
  timeEnd: number | null;
  sort: PolyHavenSort;
  hits: PolyHavenAssetSummary[];
  total: number;
  facets: PolyHavenFacets | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  selection: Selection | null;
  init(): Promise<void>;
  dispose(): void;
  refresh(): Promise<void>;
  toggleFavorite(id: string): void;
  clearRecentlyViewed(): void;
  openRecent(id: string): Promise<void>;
  setFavoritesOnly(value: boolean): void;
  setDownloadedOnly(value: boolean): void;
  refreshLocal(): Promise<void>;
  loadRelated(hit: PolyHavenAssetSummary): Promise<void>;
  selectAllIds(): Promise<string[]>;
  search(reset?: boolean): Promise<void>;
  loadMore(): Promise<void>;
  setQuery(value: string): void;
  setType(value: string): void;
  setCategoryPaths(value: string[]): void;
  setCategoryByPath(path: string[]): void;
  setCategoriesFilter(value: string[]): void;
  toggleCategory(value: string): void;
  toggleCollection(value: string): void;
  setSort(value: PolyHavenSort): void;
  toggleResolution(value: string): void;
  toggleMapType(value: string): void;
  toggleAttribute(key: string, value: string): void;
  clearAttributeFilters(): void;
  setTimeRange(start: number | null, end: number | null): void;
  setSizeRange(minSize: number | null, maxSize: number | null): void;
  clearFilters(): void;
  openAsset(hit: PolyHavenAssetSummary): Promise<void>;
  openLocal(asset: AssetRecord): Promise<void>;
  stepAsset(delta: number): void;
  closeAsset(): void;
}

let requestId = 0;
let unsubscribeStatus: (() => void) | null = null;
let unsubscribeLibrary: (() => void) | null = null;
let initPromise: Promise<void> | null = null;

function queryFrom(state: PolyHavenState, offset: number): PolyHavenCatalogQuery {
  const idSets: Set<string>[] = [];
  if (state.favoritesOnly) idSets.push(new Set(state.favorites));
  if (state.downloadedOnly) idSets.push(new Set(Object.keys(state.localById)));
  let ids: string[] | undefined;
  if (idSets.length > 0) {
    ids = [...idSets[0]];
    for (const set of idSets.slice(1)) ids = ids.filter(id => set.has(id));
  }
  return {
    query: state.query,
    type: state.type,
    ids,
    categoryPaths: state.categoryPaths.length > 0
      ? [state.categoryPaths[state.categoryPaths.length - 1]]
      : [],
    categories: state.categoriesFilter,
    collections: state.collections,
    resolutions: state.resolutions,
    mapTypes: state.type === "hdris" ? [] : state.mapTypes,
    attributes: state.attributeFilters,
    minSize: state.minSize ?? undefined,
    maxSize: state.maxSize ?? undefined,
    timeStart: state.type === "hdris" && state.timeStart != null ? state.timeStart : undefined,
    timeEnd: state.type === "hdris" && state.timeEnd != null ? state.timeEnd : undefined,
    sort: state.sort,
    limit: PAGE_SIZE,
    offset
  };
}

function toSummaryFromLocal(asset: AssetRecord): PolyHavenAssetSummary {
  const technical = asset.technical;
  const id = asset.id.startsWith("polyhaven:") ? asset.id.slice("polyhaven:".length) : asset.id;
  return {
    id,
    name: asset.name,
    type: asset.type.toLowerCase() === "hdri"
      ? "hdris"
      : asset.type.toLowerCase() === "model"
        ? "models"
        : "textures",
    typeLabel: asset.type,
    categories: asset.categories,
    category: asset.categories[0] ?? "",
    tags: asset.tags,
    description: "",
    authors: {},
    attributes: {},
    maxResolution: technical?.resolution ?? null,
    resolutions: [],
    dimensions: technical?.dimensions ?? null,
    dimensionsMm: null,
    polycount: technical?.maxTris || null,
    texelDensity: technical?.texelDensity ?? null,
    publishedAt: null,
    downloadCount: 0,
    thumbnail: asset.thumb ? window.openbridge.toFileUrl(asset.thumb) : null,
    timeOfDay: null,
    mapCodes: technical?.mapTypes ?? [],
    mapFormats: technical?.mapFormats ?? [],
    modelFormats: [],
    lodCount: technical?.lodCount ?? 0,
    collections: [],
    filesHash: "",
    enriched: true
  };
}

export const usePolyHavenStore = create<PolyHavenState>((set, get) => ({
  status: null,
  categories: [],
  favorites: readFavorites(),
  recentlyViewed: readRecentAssets(),
  favoritesOnly: false,
  downloadedOnly: false,
  localById: {},
  query: "",
  type: "",
  categoryPaths: [],
  categoriesFilter: [],
  collections: [],
  resolutions: [],
  mapTypes: [],
  attributeFilters: {},
  minSize: null,
  maxSize: null,
  timeStart: null,
  timeEnd: null,
  sort: "relevance",
  hits: [],
  total: 0,
  facets: null,
  loading: false,
  error: null,
  hasMore: false,
  selection: null,

  async init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const [status, categories] = await Promise.all([
        window.openbridge.polyhaven.status().catch(() => null),
        window.openbridge.polyhaven.categories().catch(() => [])
      ]);
      set({ status, categories });
      await get().refreshLocal();
      await get().search(true);
      unsubscribeStatus?.();
      unsubscribeStatus = window.openbridge.polyhaven.onStatus(status => {
        const before = get().status;
        set({ status });
        if (status.state !== "ready") return;
        const categoryChanged = status.refreshedAt !== before?.refreshedAt;
        const enrichmentFinished =
          status.count > 0 &&
          status.enriched >= status.count &&
          (!before || before.enriched < before.count);
        if (categoryChanged || enrichmentFinished) {
          void window.openbridge.polyhaven.categories().then(categories => set({ categories })).catch(() => undefined);
        }
        if (categoryChanged || enrichmentFinished) void get().search(true);
      });
      unsubscribeLibrary?.();
      unsubscribeLibrary = window.openbridge.onLibraryUpdated(() => {
        void get().refreshLocal();
      });
    })();
    return initPromise;
  },

  dispose() {
    unsubscribeStatus?.();
    unsubscribeStatus = null;
    unsubscribeLibrary?.();
    unsubscribeLibrary = null;
    initPromise = null;
  },

  toggleFavorite(id) {
    set(state => {
      const favorites = state.favorites.includes(id)
        ? state.favorites.filter(item => item !== id)
        : [...state.favorites, id];
      writeFavorites(favorites);
      return { favorites };
    });
    if (get().favoritesOnly) void get().search(true);
  },

  clearRecentlyViewed() {
    set({ recentlyViewed: [] });
    writeRecentAssets([]);
  },

  async openRecent(id) {
    const result = await window.openbridge.polyhaven.search({ ids: [id], limit: 1 });
    const hit = result.hits[0];
    if (!hit) throw new Error("This Poly Haven asset is no longer in the catalogue");
    await get().openAsset(hit);
  },

  setFavoritesOnly(value) {
    set({ favoritesOnly: value });
    void get().search(true);
  },

  setDownloadedOnly(value) {
    set({ downloadedOnly: value });
    void get().search(true);
  },

  async refreshLocal() {
    try {
      const result = await window.openbridge.queryLibrary({ provider: "polyhaven", limit: 2000 });
      const localById: Record<string, AssetRecord> = {};
      for (const asset of result.assets) {
        const match = /^polyhaven:(.+)$/.exec(asset.id);
        if (match) localById[match[1]] = asset;
        else localById[asset.name] = asset;
      }
      set({ localById });
    } catch {
      // library may not be ready yet
    }
  },

  async loadRelated(hit) {
    try {
      const result = await window.openbridge.polyhaven.search({
        type: hit.type,
        categories: hit.categories.slice(0, 2),
        limit: 10,
        sort: "newest"
      });
      const selection = get().selection;
      if (!selection || selection.summary.id !== hit.id) return;
      set({
        selection: {
          ...selection,
          related: result.hits.filter(item => item.id !== hit.id).slice(0, 6)
        }
      });
    } catch {
      // related content is optional
    }
  },

  async selectAllIds() {
    return window.openbridge.polyhaven.ids(queryFrom(get(), 0)).catch(() => []);
  },

  async refresh() {
    set({ error: null });
    const status = await window.openbridge.polyhaven.refresh();
    set({ status });
    if (status.state === "ready") {
      const categories = await window.openbridge.polyhaven.categories().catch(() => []);
      set({ categories });
      await get().search(true);
    }
  },

  async search(reset = true) {
    const current = get();
    const offset = reset ? 0 : current.hits.length;
    const id = ++requestId;
    set({
      loading: true,
      error: null,
      ...(reset ? { hits: [], total: 0, hasMore: false } : {})
    });
    try {
      const result = await window.openbridge.polyhaven.search(queryFrom(current, offset));
      if (id !== requestId) return;
      set(state => ({
        hits: reset ? result.hits : [...state.hits, ...result.hits],
        total: result.total,
        facets: result.facets,
        hasMore: result.hasMore,
        loading: false
      }));
    } catch (error) {
      if (id !== requestId) return;
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  },

  async loadMore() {
    if (get().loading || !get().hasMore) return;
    await get().search(false);
  },

  setQuery(query) {
    set({ query });
    void get().search(true);
  },
  setType(type) {
    set({
      type,
      categoryPaths: [],
      attributeFilters: {},
      ...(type === "hdris" ? { mapTypes: [], timeStart: null, timeEnd: null } : { timeStart: null, timeEnd: null }),
      ...(type === "models" ? {} : { minSize: null, maxSize: null })
    });
    void get().search(true);
  },
  setCategoryPaths(categoryPaths) {
    set({ categoryPaths, type: "" });
    void get().search(true);
  },
  setCategoryByPath(path) {
    set({ categoryPaths: path.length > 0 ? [path[path.length - 1]] : [], type: "" });
    void get().search(true);
  },
  setCategoriesFilter(categoriesFilter) {
    set({ categoriesFilter });
    void get().search(true);
  },
  toggleCategory(value) {
    set(state => ({
      categoriesFilter: state.categoriesFilter.includes(value)
        ? state.categoriesFilter.filter(item => item !== value)
        : [...state.categoriesFilter, value]
    }));
    void get().search(true);
  },
  toggleCollection(value) {
    set(state => ({
      collections: state.collections.includes(value)
        ? state.collections.filter(item => item !== value)
        : [...state.collections, value]
    }));
    void get().search(true);
  },
  setSort(sort) {
    set({ sort });
    void get().search(true);
  },
  toggleResolution(value) {
    set(state => ({
      resolutions: state.resolutions.includes(value)
        ? state.resolutions.filter(item => item !== value)
        : [...state.resolutions, value]
    }));
    void get().search(true);
  },
  toggleMapType(value) {
    set(state => ({
      mapTypes: state.mapTypes.includes(value)
        ? state.mapTypes.filter(item => item !== value)
        : [...state.mapTypes, value]
    }));
    void get().search(true);
  },
  toggleAttribute(key, value) {
    set(state => {
      const current = state.attributeFilters[key] ?? [];
      const next = current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value];
      const attributeFilters = { ...state.attributeFilters };
      if (next.length === 0) delete attributeFilters[key];
      else attributeFilters[key] = next;
      return { attributeFilters };
    });
    void get().search(true);
  },
  clearAttributeFilters() {
    set({ attributeFilters: {} });
    void get().search(true);
  },
  setTimeRange(start, end) {
    set({ timeStart: start, timeEnd: end });
    void get().search(true);
  },
  setSizeRange(minSize, maxSize) {
    set({ minSize, maxSize });
    void get().search(true);
  },
  clearFilters() {
    set({
      query: "",
      type: "",
      categoryPaths: [],
      categoriesFilter: [],
      collections: [],
      resolutions: [],
      mapTypes: [],
      attributeFilters: {},
      minSize: null,
      maxSize: null,
      timeStart: null,
      timeEnd: null,
      favoritesOnly: false,
      downloadedOnly: false
    });
    void get().search(true);
  },

  async openAsset(hit) {
    const recentlyViewed = [
      { id: hit.id, name: hit.name, typeLabel: hit.typeLabel, thumbnail: hit.thumbnail },
      ...get().recentlyViewed.filter(item => item.id !== hit.id)
    ].slice(0, 20);
    writeRecentAssets(recentlyViewed);
    set({ selection: { summary: hit, loading: true }, recentlyViewed });
    try {
      const detail = await window.openbridge.polyhaven.extended(hit.id);
      const selection = get().selection;
      if (!selection || selection.summary.id !== hit.id) return;
      const local = get().localById[hit.id];
      set({
        selection: {
          summary: detail,
          detail,
          loading: false,
          localPath: local?.path,
          localPreview: local?.preview ?? undefined,
          localSizeBytes: local?.sizeBytes ?? null
        }
      });
      void get().loadRelated(detail);
    } catch (error) {
      const selection = get().selection;
      if (!selection || selection.summary.id !== hit.id) return;
      set({
        selection: {
          summary: hit,
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  },

  async openLocal(asset) {
    const rawId = asset.id.startsWith("polyhaven:")
      ? asset.id.slice("polyhaven:".length)
      : asset.id;
    const catalogueId = rawId.startsWith("local:") ? rawId.slice("local:".length) : rawId;
    if (catalogueId) {
      try {
        const detail = await window.openbridge.polyhaven.extended(catalogueId);
        set({
          selection: {
            summary: detail,
            detail,
            loading: false,
            localPath: asset.path,
            localPreview: asset.preview ?? undefined,
            localSizeBytes: asset.sizeBytes ?? null
          }
        });
        void get().loadRelated(detail);
        return;
      } catch {
        // Fall through to a local-only summary.
      }
    }
    set({
      selection: {
        summary: {
          ...toSummaryFromLocal(asset),
          thumbnail: asset.thumb ? window.openbridge.toFileUrl(asset.thumb) : null
        },
        loading: false,
        error: "Catalogue metadata is unavailable for this local asset.",
        localPath: asset.path,
        localPreview: asset.preview ?? undefined,
        localSizeBytes: asset.sizeBytes ?? null
      }
    });
  },

  stepAsset(delta) {
    const { hits, selection } = get();
    if (!selection) return;
    const index = hits.findIndex(hit => hit.id === selection.summary.id);
    if (index < 0) return;
    const next = hits[index + delta];
    if (next) void get().openAsset(next);
  },

  closeAsset() {
    set({ selection: null });
  }
}));
