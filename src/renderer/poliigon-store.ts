import { create } from "zustand";
import type {
  AssetRecord,
  CategoryNode,
  PoliigonAssetDetail,
  PoliigonAssetSummary,
  PoliigonAuthState,
  PoliigonCatalogQuery,
  PoliigonCatalogStatus,
  PoliigonFacets,
  PoliigonSort
} from "../shared/types";

const PAGE_SIZE = 120;
const FAVORITES_KEY = "openbridge.poliigonFavorites";
const RECENT_KEY = "openbridge.poliigonRecentlyViewed";

export interface PoliigonRecentAsset {
  id: number;
  name: string;
  typeLabel: string;
  thumbnail: string | null;
}

function readRecentAssets(): PoliigonRecentAsset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PoliigonRecentAsset =>
      item && typeof item.id === "number" && typeof item.name === "string" &&
      typeof item.typeLabel === "string" && (item.thumbnail === null || typeof item.thumbnail === "string")
    ).slice(0, 20);
  } catch {
    return [];
  }
}

function writeRecentAssets(values: PoliigonRecentAsset[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(values.slice(0, 20)));
  } catch {
    // ignore
  }
}

function readFavorites(): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.map(Number).filter((value): value is number => Number.isFinite(value))
      : [];
  } catch {
    return [];
  }
}

function writeFavorites(values: number[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...new Set(values)]));
  } catch {
    // ignore
  }
}

function deepestCategoryId(nodes: CategoryNode[], ids: number[]): number | null {
  const wanted = new Set(ids.map(String));
  const best = { id: -1, depth: -1 };
  const visit = (list: CategoryNode[], depth: number): void => {
    for (const node of list) {
      if (wanted.has(node.key) && depth > best.depth) {
        best.id = Number(node.key);
        best.depth = depth;
      }
      visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return best.id >= 0 ? best.id : null;
}

export const emptyPoliigonAuth: PoliigonAuthState = {
  loggedIn: false,
  userName: "",
  userId: null,
  planName: "",
  planPaused: false,
  isUnlimited: false,
  credits: null,
  onDemandCredits: null,
  ownedCount: 0,
  expiresAt: null
};

interface Selection {
  summary: PoliigonAssetSummary;
  detail?: PoliigonAssetDetail;
  loading: boolean;
  error?: string;
  localPath?: string;
  localPreview?: string;
  localSizeBytes?: number | null;
  related?: PoliigonAssetSummary[];
}

interface PoliigonState {
  status: PoliigonCatalogStatus | null;
  categories: CategoryNode[];
  auth: PoliigonAuthState;
  owned: number[];
  favorites: number[];
  recentlyViewed: PoliigonRecentAsset[];
  favoritesOnly: boolean;
  downloadedOnly: boolean;
  localById: Record<number, AssetRecord>;
  loginOpen: boolean;
  loginBusy: boolean;
  loginBrowser: boolean;
  loginError: string | null;
  query: string;
  type: string;
  categoryIds: number[];
  freeOnly: boolean;
  minSize: number | null;
  maxSize: number | null;
  resolutions: string[];
  creationMethods: string[];
  mapTypes: string[];
  timeStart: number | null;
  timeEnd: number | null;
  sort: PoliigonSort;
  hits: PoliigonAssetSummary[];
  total: number;
  facets: PoliigonFacets | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  selection: Selection | null;
  init(): Promise<void>;
  dispose(): void;
  refresh(): Promise<void>;
  openLogin(): void;
  closeLogin(): void;
  loginPassword(email: string, password: string): Promise<void>;
  loginBrowserFlow(): Promise<void>;
  cancelBrowserLogin(): Promise<void>;
  logout(): Promise<void>;
  refreshAccount(): Promise<void>;
  syncOwned(): Promise<void>;
  toggleFavorite(id: number): void;
  clearRecentlyViewed(): void;
  openRecent(id: number): Promise<void>;
  setFavoritesOnly(value: boolean): void;
  setDownloadedOnly(value: boolean): void;
  refreshLocal(): Promise<void>;
  loadRelated(hit: PoliigonAssetSummary): Promise<void>;
  selectAllIds(): Promise<number[]>;
  search(reset?: boolean): Promise<void>;
  loadMore(): Promise<void>;
  setQuery(value: string): void;
  setType(value: string): void;
  setCategoryIds(value: number[]): void;
  setCategoryByPath(path: string[]): void;
  setFreeOnly(value: boolean): void;
  setSort(value: PoliigonSort): void;
  toggleResolution(value: string): void;
  toggleCreationMethod(value: string): void;
  toggleMapType(value: string): void;
  setTimeRange(start: number | null, end: number | null): void;
  setSizeRange(minSize: number | null, maxSize: number | null): void;
  clearFilters(): void;
  openAsset(hit: PoliigonAssetSummary): Promise<void>;
  openLocal(asset: AssetRecord): Promise<void>;
  stepAsset(delta: number): void;
  closeAsset(): void;
}

let requestId = 0;
let unsubscribeStatus: (() => void) | null = null;
let unsubscribeAuth: (() => void) | null = null;
let unsubscribeLibrary: (() => void) | null = null;
let initPromise: Promise<void> | null = null;

function queryFrom(state: PoliigonState, offset: number): PoliigonCatalogQuery {
  const idSets: Set<number>[] = [];
  if (state.favoritesOnly) idSets.push(new Set(state.favorites));
  if (state.downloadedOnly) {
    idSets.push(new Set(Object.keys(state.localById).map(value => Number(value)).filter(Number.isFinite)));
  }
  let ids: number[] | undefined;
  if (idSets.length > 0) {
    ids = [...idSets[0]];
    for (const set of idSets.slice(1)) ids = ids.filter(id => set.has(id));
  }
  return {
    query: state.query,
    type: state.type,
    ids,
    categoryIds: state.categoryIds,
    freeOnly: state.freeOnly,
    minSize: state.minSize ?? undefined,
    maxSize: state.maxSize ?? undefined,
    resolutions: state.resolutions,
    creationMethods: state.type === "HDRS" ? [] : state.creationMethods,
    mapTypes: state.type === "HDRS" ? [] : state.mapTypes,
    timeStart: state.type === "HDRS" && state.timeStart != null ? state.timeStart : undefined,
    timeEnd: state.type === "HDRS" && state.timeEnd != null ? state.timeEnd : undefined,
    sort: state.sort,
    limit: PAGE_SIZE,
    offset
  };
}

export const usePoliigonStore = create<PoliigonState>((set, get) => ({
  status: null,
  categories: [],
  auth: emptyPoliigonAuth,
  owned: [],
  favorites: readFavorites(),
  recentlyViewed: readRecentAssets(),
  favoritesOnly: false,
  downloadedOnly: false,
  localById: {},
  loginOpen: false,
  loginBusy: false,
  loginBrowser: false,
  loginError: null,
  query: "",
  type: "",
  categoryIds: [],
  freeOnly: false,
  minSize: null,
  maxSize: null,
  resolutions: [],
  creationMethods: [],
  mapTypes: [],
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
      const [status, categories, auth, owned] = await Promise.all([
        window.openbridge.poliigon.status().catch(() => null),
        window.openbridge.poliigon.categories().catch(() => []),
        window.openbridge.poliigon.auth.state().catch(() => emptyPoliigonAuth),
        window.openbridge.poliigon.auth.owned().catch(() => [])
      ]);
      set({ status, categories, auth, owned });
      await get().refreshLocal();
      await get().search(true);
      unsubscribeStatus?.();
      unsubscribeStatus = window.openbridge.poliigon.onStatus(status => {
        const before = get().status;
        set({ status });
        if (status.state === "ready" && status.refreshedAt !== before?.refreshedAt) {
          void window.openbridge.poliigon.categories().then(categories => set({ categories })).catch(() => undefined);
          void get().search(true);
        }
      });
      unsubscribeAuth?.();
      unsubscribeAuth = window.openbridge.poliigon.auth.onChanged(auth => {
        const before = get().auth;
        set({ auth });
        if (auth.loggedIn) {
          void window.openbridge.poliigon.auth.owned().then(owned => set({ owned })).catch(() => undefined);
        } else {
          set({ owned: [] });
        }
        if (auth.loggedIn && !before.loggedIn) {
          set({ loginOpen: false, loginBusy: false, loginBrowser: false, loginError: null });
        }
      });
      unsubscribeLibrary?.();
      unsubscribeLibrary = window.openbridge.onLibraryUpdated(() => {
        void get().refreshLocal();
      });
      const currentAuth = await window.openbridge.poliigon.auth.state().catch(() => null);
      if (currentAuth) set({ auth: currentAuth });
      void window.openbridge.poliigon.auth.refresh().then(auth => {
        if (auth) set({ auth });
      }).catch(() => undefined);
    })();
    return initPromise;
  },

  dispose() {
    unsubscribeStatus?.();
    unsubscribeStatus = null;
    unsubscribeAuth?.();
    unsubscribeAuth = null;
    unsubscribeLibrary?.();
    unsubscribeLibrary = null;
    initPromise = null;
  },

  openLogin() {
    set({ loginOpen: true, loginError: null, loginBusy: false, loginBrowser: false });
  },

  closeLogin() {
    if (get().loginBrowser) void window.openbridge.poliigon.auth.cancelBrowserLogin();
    set({ loginOpen: false, loginBusy: false, loginBrowser: false, loginError: null });
  },

  async loginPassword(email, password) {
    set({ loginBusy: true, loginBrowser: false, loginError: null });
    try {
      const auth = await window.openbridge.poliigon.auth.login(email, password);
      set({ auth, loginBusy: false, loginOpen: false });
    } catch (error) {
      set({
        loginBusy: false,
        loginError: error instanceof Error ? error.message : String(error)
      });
    }
  },

  async loginBrowserFlow() {
    set({ loginBusy: true, loginBrowser: true, loginError: null });
    try {
      const auth = await window.openbridge.poliigon.auth.loginBrowser();
      set({ auth, loginBusy: false, loginBrowser: false, loginOpen: false });
    } catch (error) {
      set({
        loginBusy: false,
        loginBrowser: false,
        loginError: error instanceof Error ? error.message : String(error)
      });
    }
  },

  async cancelBrowserLogin() {
    await window.openbridge.poliigon.auth.cancelBrowserLogin().catch(() => undefined);
    set({ loginBusy: false, loginBrowser: false });
  },

  async logout() {
    await window.openbridge.poliigon.auth.logout().catch(() => undefined);
    set({ auth: emptyPoliigonAuth, owned: [] });
  },

  async refreshAccount() {
    const auth = await window.openbridge.poliigon.auth.refresh().catch(() => null);
    if (auth) set({ auth });
  },

  async syncOwned() {
    const owned = await window.openbridge.poliigon.auth.syncOwned().catch(() => []);
    set({ owned });
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
    const result = await window.openbridge.poliigon.search({ ids: [id], limit: 1 });
    const hit = result.hits[0];
    if (!hit) throw new Error("This Poliigon asset is no longer in the catalogue");
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
      const result = await window.openbridge.queryLibrary({ provider: "poliigon", limit: 2000 });
      const localById: Record<number, AssetRecord> = {};
      for (const asset of result.assets) {
        const match = /^poliigon:(\d+)$/.exec(asset.id);
        if (match) localById[Number(match[1])] = asset;
      }
      set({ localById });
    } catch {
      // library may not be ready yet
    }
  },

  async loadRelated(hit) {
    try {
      const categoryId = deepestCategoryId(get().categories, hit.categoryIds);
      const result = await window.openbridge.poliigon.search({
        categoryIds: categoryId !== null ? [categoryId] : undefined,
        type: categoryId === null ? hit.type : undefined,
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
    return window.openbridge.poliigon.ids(queryFrom(get(), 0)).catch(() => []);
  },

  async refresh() {
    set({ error: null });
    const status = await window.openbridge.poliigon.refresh();
    set({ status });
    if (status.state === "ready") {
      const categories = await window.openbridge.poliigon.categories().catch(() => []);
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
      const result = await window.openbridge.poliigon.search(queryFrom(current, offset));
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
      ...(type === "HDRS" ? { creationMethods: [], mapTypes: [], minSize: null, maxSize: null } : {})
    });
    void get().search(true);
  },
  setCategoryIds(categoryIds) {
    set({ categoryIds });
    void get().search(true);
  },
  setCategoryByPath(path) {
    let nodes = get().categories;
    let id: number | null = null;
    for (const label of path) {
      const node = nodes.find(item => item.label.toLowerCase() === label.trim().toLowerCase());
      if (!node) {
        id = null;
        break;
      }
      id = Number(node.key);
      nodes = node.children;
    }
    set({ categoryIds: id !== null ? [id] : [], type: "" });
    void get().search(true);
  },
  setFreeOnly(freeOnly) {
    set({ freeOnly });
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
  toggleCreationMethod(value) {
    set(state => ({
      creationMethods: state.creationMethods.includes(value)
        ? state.creationMethods.filter(item => item !== value)
        : [...state.creationMethods, value]
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
      categoryIds: [],
      freeOnly: false,
      favoritesOnly: false,
      downloadedOnly: false,
      resolutions: [],
      creationMethods: [],
      mapTypes: [],
      minSize: null,
      maxSize: null,
      timeStart: null,
      timeEnd: null
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
      const detail = await window.openbridge.poliigon.extended(hit.id);
      const selection = get().selection;
      if (!selection || selection.summary.id !== hit.id) return;
      const local = get().localById[hit.id];
      set({
        selection: {
          summary: hit,
          detail,
          loading: false,
          localPath: local?.path,
          localPreview: local?.preview ?? undefined,
          localSizeBytes: local?.sizeBytes ?? null
        }
      });
      void get().loadRelated(hit);
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
    const numeric = asset.id.startsWith("poliigon:") && !asset.id.startsWith("poliigon:local:")
      ? Number(asset.id.slice("poliigon:".length))
      : Number.NaN;
    if (Number.isFinite(numeric)) {
      try {
        const detail = await window.openbridge.poliigon.extended(numeric);
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
    const technical = asset.technical;
    const summary: PoliigonAssetSummary = {
      id: Number.isFinite(numeric) ? numeric : 0,
      name: asset.name,
      assetName: asset.name,
      type: asset.type === "Model" ? "Models" : asset.type === "HDRI" ? "HDRS" : "Textures",
      typeLabel: asset.type,
      slug: "",
      websiteUrl: "",
      description: "",
      tags: asset.tags,
      categoryIds: [],
      categories: asset.categories,
      credit: 0,
      free: true,
      convention: 1,
      publishedAt: null,
      updatedAt: null,
      releaseStatus: null,
      resolutions: [],
      maxResolution: technical?.resolution ?? null,
      defaultResolution: null,
      thumbnail: null,
      previews: [],
      toolboxPreviews: [],
      videoPreviews: [],
      physicalSize: technical?.physicalSize ?? null,
      physicalSizeCm: null,
      creationMethod: null,
      mapCodes: technical?.mapTypes ?? [],
      mapFormats: [],
      lodCount: technical?.lodCount ?? 0,
      maxTris: technical?.maxTris ?? null,
      hasModel: asset.type === "Model",
      software: []
    };
    set({
      selection: {
        summary,
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
