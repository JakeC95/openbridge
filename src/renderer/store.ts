import { create } from "zustand";
import { sizeBounds, type SizeFilter } from "./size-filter";
import type {
  AppSettings,
  AssetProvider,
  AssetRecord,
  AuthState,
  BatchStartResult,
  CatalogHit,
  CatalogMetadataStatus,
  CategoryNode,
  DownloadOptions,
  DownloadProgress,
  ExtendedAsset,
  LibraryCounts,
  LibrarySort,
  PackRef,
  PackSummary,
  LibraryRef,
  Profile,
  ProviderScope,
  RepoKind,
  SyncStatus,
  UpdateInfo
} from "../shared/types";
import { buildDownloadOptions } from "./download-options";
import { parseSearchQuery } from "./search-utils";
import { catalogFilterQuery, libraryFilterQuery, readPreference, writePreference } from "./browsing-state";
import { recordDownloadProgress } from "./download-history";
import { usePoliigonStore } from "./poliigon-store";
import { usePolyHavenStore } from "./polyhaven-store";
import {
  allSourceCategory,
  isAllSort,
  isAllStateFilter,
  poliigonCategoryIds,
  NONE_TYPE,
  type AllSort,
  type AllStateFilter
} from "./all-sources";

type View = "discover" | "library" | "downloads" | "settings";
type LocalRepo = "all" | RepoKind;

let catalogRequest = 0;
let libraryRequest = 0;

interface Versions {
  app: string;
  electron: string;
  chrome: string;
  node: string;
}

interface Selection {
  hit?: CatalogHit;
  local?: AssetRecord;
  extended?: ExtendedAsset;
  loading: boolean;
  error?: string;
}

interface RecentAsset {
  id: string;
  name: string;
  type: string;
  source: "catalog" | "local";
  hit?: CatalogHit;
}

interface Toast {
  id: number;
  message: string;
  error: boolean;
}

interface State {
  provider: ProviderScope;
  setProvider(value: ProviderScope): void;
  allType: string;
  allStateFilter: AllStateFilter;
  allSort: AllSort;
  setAllType(value: string): void;
  setAllStateFilter(value: AllStateFilter): void;
  setAllSort(value: AllSort): void;
  syncAllSources(): void;
  clearAllFilters(): void;
  density: "compact" | "comfortable" | "large";
  setDensity(value: State["density"]): void;
  catalogPack: PackRef | null;
  localPack: PackRef | null;
  packs: PackSummary[];
  localPacks: PackSummary[];
  localCategories: CategoryNode[];
  localType: string;
  localProvider: AssetProvider | "all";
  localCategoryPath: string[];
  localSort: LibrarySort;
  localFavoritesOnly: boolean;
  setLocalType(value: string): void;
  setLocalProvider(value: AssetProvider | "all"): void;
  setLocalCategoryPath(value: string[]): void;
  setLocalSort(value: LibrarySort): void;
  setLocalFavoritesOnly(value: boolean): void;
  browsePack(pack: PackRef, local?: boolean): void;
  clearPack(): void;
  refreshPacks(): Promise<void>;
  selectionHistory: Selection[];
  backSelection(): void;
  stepSelection(delta: number): void;
  recentSearches: string[];
  recentlyViewed: RecentAsset[];
  rememberSearch(query: string): void;
  openRecent(asset: RecentAsset): Promise<void>;
  clearRecent(): void;
  view: View;
  settings: AppSettings | null;
  auth: AuthState;
  profile: Profile | null;
  versions: Versions | null;
  categories: CategoryNode[];
  categoriesLoading: boolean;
  acquired: string[];
  favorites: string[];
  favoritesOnly: boolean;
  freeOnly: boolean;
  downloadedOnly: boolean;
  sizeFilter: SizeFilter;
  facets: Record<string, Record<string, number>>;
  facetFilters: Record<string, string[]>;
  query: string;
  type: string;
  categoryPath: string[];
  categoryPaths: string[][];
  hits: CatalogHit[];
  page: number;
  nextCursor: string | null;
  hasMore: boolean;
  nbPages: number;
  nbHits: number;
  catalogLoading: boolean;
  catalogError: string | null;
  catalogFacetWarning: boolean;
  localRefs: LibraryRef[];
  libraryAssets: AssetRecord[];
  libraryCounts: LibraryCounts;
  libraryTotal: number;
  libraryFilteredTotal: number;
  libraryLoading: boolean;
  libraryHasMore: boolean;
  libraryScannedAt: number | null;
  localQuery: string;
  localRepo: LocalRepo;
  localReady: string[];
  localMaxTris: number | null;
  localColor: string;
  localState: string;
  localInterior: string;
  selection: Selection | null;
  downloads: Record<string, DownloadProgress>;
  sync: SyncStatus;
  update: UpdateInfo | null;
  catalogMetadata: CatalogMetadataStatus | null;
  toasts: Toast[];
  busy: boolean;
  init(): Promise<void>;
  dispose(): void;
  setView(view: View): void;
  setQuery(query: string): void;
  setType(type: string): void;
  setCategoryPath(path: string[]): void;
  setFavoritesOnly(value: boolean): void;
  setFreeOnly(value: boolean): void;
  setDownloadedOnly(value: boolean): void;
  setSizeFilter(value: SizeFilter): void;
  setStateFilter(value: "all" | "free" | "favorites"): void;
  toggleFacet(group: string, value: string): void;
  clearFacetFilters(): void;
  clearFilters(): void;
  search(reset?: boolean): Promise<void>;
  refreshLibrary(force?: boolean): Promise<void>;
  queryLocalLibrary(reset?: boolean): Promise<void>;
  setLocalQuery(query: string): void;
  setLocalRepo(repo: LocalRepo): void;
  toggleLocalReady(value: string): void;
  setLocalMaxTris(value: number | null): void;
  setLocalColor(value: string): void;
  setLocalState(value: string): void;
  setLocalInterior(value: string): void;
  resetLocalFilters(): void;
  openHit(hit: CatalogHit): Promise<void>;
  openLocal(asset: AssetRecord): Promise<void>;
  closeSelection(): void;
  login(): Promise<void>;
  logout(): Promise<void>;
  startDownload(options: DownloadOptions): Promise<void>;
  downloadMany(
    assetIds: string[],
    options?: Partial<DownloadOptions>
  ): Promise<BatchStartResult>;
  refreshDownloads(): Promise<void>;
  acquire(): Promise<void>;
  cancelDownload(assetId: string): Promise<void>;
  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  runSync(): Promise<void>;
  checkUpdates(): Promise<void>;
  refreshCatalogMetadata(): Promise<void>;
  importCatalogMetadata(): Promise<void>;
  downloadCatalogMetadata(): Promise<void>;
  removeCatalogMetadata(): Promise<void>;
  installUpdate(): Promise<void>;
  importFolder(): Promise<void>;
  importZip(): Promise<void>;
  toast(message: string, error?: boolean): void;
  dismissToast(id: number): void;
  clearFinishedDownloads(): Promise<void>;
  refreshProfile(): Promise<void>;
  refreshAcquired(): Promise<void>;
  refreshFavorites(): Promise<void>;
  toggleFavorite(assetId: string): Promise<void>;
  downloadHit(hit: CatalogHit): Promise<void>;
  validateJson(assetId: string): Promise<void>;
}

const emptyAuth: AuthState = {
  loggedIn: false,
  email: "",
  roles: [],
  planId: "",
  expiresAt: null
};

const emptySync: SyncStatus = {
  running: false,
  lastSynced: null,
  acquired: 0,
  missing: 0
};

let unsubscribers: Array<() => void> = [];
let toastId = 0;
let initPromise: Promise<void> | null = null;
let restoreSubscription: (() => void) | null = null;

function readBrowsingRestore(authenticated: boolean): Partial<State> {
  const saved = readPreference<unknown>("browsingSession", null);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const data = saved as Record<string, unknown>;
  const text = (key: string) => typeof data[key] === "string" ? String(data[key]).slice(0, 256) : "";
  const list = (key: string) => Array.isArray(data[key]) ? (data[key] as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 30) : [];
  const facets: Record<string, string[]> = {};
  const pack = (key: string): PackRef | null => {
    const value = data[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    return typeof item.name === "string" && item.name.length <= 256
      ? { name: item.name, id: typeof item.id === "string" ? item.id.slice(0, 256) : undefined } : null;
  };
  if (data.facetFilters && typeof data.facetFilters === "object" && !Array.isArray(data.facetFilters)) {
    for (const [key, value] of Object.entries(data.facetFilters)) if (["biome", "region", "resolution", "color", "environment", "theme"].includes(key) && Array.isArray(value))
      facets[key] = value.filter((v): v is string => typeof v === "string").slice(0, 30);
  }
  const localProvider = ["megascans", "poliigon", "polyhaven"].includes(text("localProvider"))
    ? text("localProvider") as AssetProvider
    : "all";
  let localType = text("localType");
  const megascansTypes = ["3d", "3dplant", "surface", "atlas", "brush", "decal", "imperfection", "displacement"];
  const poliigonTypes = ["texture", "model", "hdri"];
  if (localProvider === "poliigon" && !poliigonTypes.includes(localType)) localType = "";
  if (localProvider === "polyhaven" && !poliigonTypes.includes(localType)) localType = "";
  if (localProvider === "megascans" && !megascansTypes.includes(localType)) localType = "";
  return {
    view: data.view === "library" || data.view === "downloads" || data.view === "settings" ? data.view : "discover",
    query: text("query"), type: text("type"), categoryPath: list("categoryPath"), facetFilters: facets, catalogPack: pack("catalogPack"), localPack: pack("localPack"),
    freeOnly: data.freeOnly === true, favoritesOnly: authenticated && data.favoritesOnly === true,
    sizeFilter: ["small", "medium", "large", "huge"].includes(text("sizeFilter")) ? text("sizeFilter") as SizeFilter : "any",
    localQuery: text("localQuery"), localType, localCategoryPath: list("localCategoryPath"),
    localProvider,
    localRepo: ["downloaded", "custom", "dhi"].includes(text("localRepo")) ? text("localRepo") as LocalRepo : "all",
    localFavoritesOnly: authenticated && data.localFavoritesOnly === true,
    localReady: list("localReady"), localMaxTris: typeof data.localMaxTris === "number" && data.localMaxTris > 0 ? data.localMaxTris : null,
    localColor: text("localColor"), localState: text("localState"), localInterior: text("localInterior")
  };
}

function browsingSnapshot(state: State) {
  const { view, query, type, categoryPath, facetFilters, freeOnly, favoritesOnly, sizeFilter, catalogPack, localPack,
    localQuery, localType, localProvider, localCategoryPath, localRepo, localFavoritesOnly, localReady,
    localMaxTris, localColor, localState, localInterior } = state;
  return { view, query, type, categoryPath, facetFilters, freeOnly, favoritesOnly, sizeFilter, catalogPack, localPack,
    localQuery, localType, localProvider, localCategoryPath, localRepo, localFavoritesOnly, localReady,
    localMaxTris, localColor, localState, localInterior };
}

export const useStore = create<State>((set, get) => ({
  provider: (() => {
    try {
      // Introduce combined Discover once; afterwards the user's choice is kept.
      if (!localStorage.getItem("openbridge.allSourcesDefault")) {
        localStorage.setItem("openbridge.allSourcesDefault", "1");
        localStorage.setItem("openbridge.provider", "all");
        localStorage.removeItem("openbridge.browsingSession");
        return "all";
      }
      const stored = localStorage.getItem("openbridge.provider");
      return stored === "megascans" || stored === "poliigon" || stored === "polyhaven" ? stored : "all";
    } catch {
      return "all";
    }
  })(),
  setProvider(value) {
    const previous = get().provider;
    const focusedQuery = previous === "poliigon"
      ? usePoliigonStore.getState().query
      : previous === "polyhaven"
        ? usePolyHavenStore.getState().query
        : get().query;
    const query = value === "all" && previous !== "megascans" ? focusedQuery : get().query;
    set({ provider: value, query, categoryPaths: [], downloadedOnly: false });
    if (value === "all") set({ catalogPack: null });
    if (value !== "all") {
      usePoliigonStore.setState({ minSize: null, maxSize: null, downloadedOnly: false });
      usePolyHavenStore.setState({ downloadedOnly: false });
    }
    if (value === "megascans") {
      const type = get().type;
      if (type === NONE_TYPE) set({ type: "", categoryPath: [], categoryPaths: [] });
      void get().search(true);
    }
    if (value === "poliigon") {
      const poliigon = usePoliigonStore.getState();
      if (poliigon.type === NONE_TYPE) usePoliigonStore.setState({ type: "", categoryIds: [] });
      usePolyHavenStore.getState().closeAsset();
    }
    if (value === "polyhaven") {
      const polyhaven = usePolyHavenStore.getState();
      if (polyhaven.type === NONE_TYPE) {
        usePolyHavenStore.setState({ type: "", categoryPaths: [], categoriesFilter: [] });
      }
      usePoliigonStore.getState().closeAsset();
      get().closeSelection();
    }
    try {
      localStorage.setItem("openbridge.provider", value);
    } catch {
      // ignore
    }
    if (value === "all") {
      const poliigon = usePoliigonStore.getState();
      if (poliigon.query !== query) poliigon.setQuery(query);
      const polyhaven = usePolyHavenStore.getState();
      if (polyhaven.query !== query) polyhaven.setQuery(query);
      get().syncAllSources();
    }
  },
  allType: (() => {
    const saved = readPreference<string>("allType", "");
    return allSourceCategory(saved).value;
  })(),
  allStateFilter: (() => {
    const saved = readPreference<unknown>("allStateFilter", "all");
    return isAllStateFilter(saved) ? saved : "all";
  })(),
  allSort: (() => {
    const saved = readPreference<unknown>("allSort", "relevance");
    return isAllSort(saved) ? saved : "relevance";
  })(),
  setAllType(value) {
    const option = allSourceCategory(value);
    const previousRoot = get().allType.split(":")[0];
    const nextRoot = option.value.split(":")[0];
    set({ allType: option.value });
    writePreference("allType", option.value);
    if (previousRoot !== nextRoot) {
      usePolyHavenStore.setState({ attributeFilters: {} });
    }
    const root = option.value.split(":")[0];
    if (["atlas", "brush", "decal", "imperfection", "displacement"].includes(root)) {
      const allowed = new Set(["resolution", "color", "theme"]);
      const current = get().facetFilters;
      const next = Object.fromEntries(Object.entries(current).filter(([key]) => allowed.has(key)));
      if (Object.keys(next).length !== Object.keys(current).length) set({ facetFilters: next });
    }
    if (!option.value.startsWith("hdri")) {
      usePoliigonStore.setState({ timeStart: null, timeEnd: null });
      usePolyHavenStore.setState({ timeStart: null, timeEnd: null });
    }
    get().syncAllSources();
  },
  setAllStateFilter(value) {
    set({ allStateFilter: value });
    writePreference("allStateFilter", value);
    get().syncAllSources();
  },
  setAllSort(value) {
    set({ allSort: value });
    writePreference("allSort", value);
    const poliigon = usePoliigonStore.getState();
    const polyhaven = usePolyHavenStore.getState();
    const target = value === "name" ? "name" : "relevance";
    if (poliigon.sort !== target) poliigon.setSort(target);
    if (polyhaven.sort !== target) polyhaven.setSort(target);
  },
  syncAllSources() {
    const option = allSourceCategory(get().allType);
    const stateFilter = get().allStateFilter;
    const bounds = sizeBounds(get().sizeFilter);
    set({
      type: option.megascansType ?? "",
      categoryPath: [],
      categoryPaths: option.megascansPaths ?? [],
      freeOnly: stateFilter === "free",
      favoritesOnly: stateFilter === "favorites",
      downloadedOnly: stateFilter === "downloaded"
    });
    const poliigon = usePoliigonStore.getState();
    let poliigonType = option.poliigonType ?? "";
    let poliigonIds = option.poliigonPaths?.length
      ? poliigonCategoryIds(poliigon.categories, option.poliigonPaths)
      : [];
    // If a mapped Poliigon path has not loaded yet, return no Poliigon results
    // rather than accidentally falling back to the whole provider.
    if ((option.poliigonPaths?.length ?? 0) > 0 && poliigonIds.length === 0) {
      poliigonType = NONE_TYPE;
      poliigonIds = [];
    }
    usePoliigonStore.setState({
      query: get().query,
      type: poliigonType,
      categoryIds: poliigonIds,
      freeOnly: stateFilter === "free",
      favoritesOnly: stateFilter === "favorites",
      downloadedOnly: stateFilter === "downloaded",
      minSize: bounds.minSize,
      maxSize: bounds.maxSize,
      ...(poliigonType === "HDRS" ? { creationMethods: [], mapTypes: [] } : {})
    });
    const polyMapped = option.polyhavenType !== undefined || (option.polyhavenCategories?.length ?? 0) > 0;
    const polyType = option.value === ""
      ? ""
      : option.polyhavenType === NONE_TYPE
        ? NONE_TYPE
        : option.polyhavenType ?? (polyMapped ? "" : NONE_TYPE);
    usePolyHavenStore.setState({
      query: get().query,
      type: polyType,
      categoryPaths: [],
      categoriesFilter: option.polyhavenCategories ?? [],
      collections: [],
      favoritesOnly: stateFilter === "favorites",
      downloadedOnly: stateFilter === "downloaded",
      minSize: bounds.minSize,
      maxSize: bounds.maxSize,
      ...(polyType === "hdris" ? { mapTypes: [] } : {})
    });
    void get().search(true);
    void usePoliigonStore.getState().search(true);
    void usePolyHavenStore.getState().search(true);
  },
  clearAllFilters() {
    set({
      allType: "",
      allStateFilter: "all",
      type: "",
      categoryPath: [],
      categoryPaths: [],
      freeOnly: false,
      favoritesOnly: false,
      downloadedOnly: false,
      sizeFilter: "any",
      facetFilters: {},
      catalogPack: null
    });
    writePreference("allType", "");
    writePreference("allStateFilter", "all");
    usePoliigonStore.setState({
      type: "",
      categoryIds: [],
      minSize: null,
      maxSize: null,
      freeOnly: false,
      favoritesOnly: false,
      downloadedOnly: false,
      resolutions: [],
      creationMethods: [],
      mapTypes: [],
      timeStart: null,
      timeEnd: null
    });
    usePolyHavenStore.setState({
      type: "",
      categoryPaths: [],
      categoriesFilter: [],
      collections: [],
      resolutions: [],
      mapTypes: [],
      attributeFilters: {},
      favoritesOnly: false,
      downloadedOnly: false,
      timeStart: null,
      timeEnd: null
    });
    void get().search(true);
    void usePoliigonStore.getState().search(true);
    void usePolyHavenStore.getState().search(true);
  },
  density: (() => {
    const saved = readPreference<string>("density", "comfortable");
    return saved === "compact" || saved === "large" ? saved : "comfortable";
  })(),
  setDensity(value) { set({ density: value }); writePreference("density", value); },
  catalogPack: null,
  localPack: null,
  packs: [],
  localPacks: [],
  localCategories: [],
  localType: "",
  localProvider: "all",
  localCategoryPath: [],
  localSort: (() => {
    const sort = readPreference<string>("localSort", "recent");
    return sort === "name" || sort === "type" ? sort : "recent";
  })(),
  localFavoritesOnly: false,
  setLocalType(localType) { set({ localType, localCategoryPath: [] }); },
  setLocalProvider(localProvider) { set({ localProvider, localType: "", localCategoryPath: [] }); },
  setLocalCategoryPath(localCategoryPath) { set({ localCategoryPath, localType: "" }); },
  setLocalSort(localSort) { set({ localSort }); writePreference("localSort", localSort); },
  setLocalFavoritesOnly(localFavoritesOnly) { set({ localFavoritesOnly }); },
  browsePack(pack, local = false) {
    get().closeSelection();
    if (local) {
      set({ view: "library", localPack: pack, localProvider: "all", localQuery: "", localType: "", localCategoryPath: [],
        localRepo: "all", localFavoritesOnly: false, localReady: [], localMaxTris: null,
        localColor: "", localState: "", localInterior: "" });
    } else {
      set({ view: "discover", catalogPack: pack, query: "", type: "", categoryPath: [], categoryPaths: [],
        favoritesOnly: false, freeOnly: false, sizeFilter: "any", facetFilters: {} });
      void get().search(true);
    }
  },
  clearPack() {
    if (get().view === "library") set({ localPack: null });
    else { set({ catalogPack: null }); void get().search(true); }
  },
  async refreshPacks() {
    try { set({ packs: await window.openbridge.catalogPacks() }); }
    catch { set({ packs: [] }); }
  },
  selectionHistory: [],
  backSelection() {
    const history = get().selectionHistory;
    const previous = history.at(-1);
    if (!previous) return;
    if (previous.loading && previous.hit) {
      set({ selection: null });
      void get().openHit(previous.hit);
      set({ selectionHistory: history.slice(0, -1) });
    } else set({ selection: previous, selectionHistory: history.slice(0, -1) });
  },
  stepSelection(delta) {
    const { selection, hits, libraryAssets } = get();
    if (selection?.local) {
      const index = libraryAssets.findIndex(asset => asset.path === selection.local?.path);
      const next = libraryAssets[index + delta];
      if (index >= 0 && next) void get().openLocal(next);
    } else if (selection?.hit) {
      const index = hits.findIndex(hit => (hit.id || hit.objectID) === (selection.hit?.id || selection.hit?.objectID));
      const next = hits[index + delta];
      if (index >= 0 && next) void get().openHit(next);
    }
  },
  recentSearches: (() => {
    const saved = readPreference<unknown>("recentSearches", []);
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string").slice(0, 10) : [];
  })(),
  recentlyViewed: (() => {
    const saved = readPreference<unknown>("recentlyViewed", []);
    return Array.isArray(saved) ? saved.filter((item): item is RecentAsset => item &&
      typeof item.id === "string" && typeof item.name === "string" &&
      (item.source === "local" || (item.source === "catalog" && item.hit))).slice(0, 20) : [];
  })(),
  rememberSearch(query) {
    const text = query.trim();
    if (!text) return;
    const recentSearches = [text, ...get().recentSearches.filter(value => value !== text)].slice(0, 10);
    set({ recentSearches }); writePreference("recentSearches", recentSearches);
  },
  async openRecent(asset) {
    if (asset.source === "catalog" && asset.hit) await get().openHit(asset.hit);
    else {
      const result = await window.openbridge.queryLibrary({ ids: [asset.id], limit: 1 });
      if (result.assets[0]) await get().openLocal(result.assets[0]);
      else get().toast("This asset is no longer in the local library", true);
    }
  },
  clearRecent() {
    set({ recentSearches: [], recentlyViewed: [] });
    writePreference("recentSearches", []); writePreference("recentlyViewed", []);
  },
  view: "discover",
  settings: null,
  auth: emptyAuth,
  profile: null,
  versions: null,
  categories: [],
  categoriesLoading: true,
  acquired: [],
  favorites: [],
  favoritesOnly: false,
  freeOnly: false,
  downloadedOnly: false,
  sizeFilter: "any",
  facets: {},
  facetFilters: {},
  query: "",
  type: "",
  categoryPath: [],
  categoryPaths: [],
  hits: [],
  page: -1,
  nextCursor: null,
  hasMore: false,
  nbPages: 0,
  nbHits: 0,
  catalogLoading: false,
  catalogError: null,
  catalogFacetWarning: false,
  localRefs: [],
  libraryAssets: [],
  libraryCounts: { all: 0, megascans: 0, poliigon: 0, polyhaven: 0, downloaded: 0, custom: 0, dhi: 0 },
  libraryTotal: 0,
  libraryFilteredTotal: 0,
  libraryLoading: false,
  libraryHasMore: false,
  libraryScannedAt: null,
  localQuery: "",
  localRepo: "all",
  localReady: [],
  localMaxTris: null,
  localColor: "",
  localState: "",
  localInterior: "",
  selection: null,
  downloads: {},
  sync: emptySync,
  update: null,
  catalogMetadata: null,
  toasts: [],
  busy: false,

  async init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const categoryRequest = window.openbridge.catalog.categories().catch(() => []);
      const [settings, auth, downloads, sync, versions, catalogMetadata] = await Promise.all([
        window.openbridge.getSettings(),
        window.openbridge.auth.state(),
        window.openbridge.downloads.list().catch(() => []),
        window.openbridge.sync.status().catch(() => emptySync),
        window.openbridge.versions(),
        window.openbridge.catalogMetadata().catch(() => null)
      ]);
      set(readBrowsingRestore(auth.loggedIn));
      const library = await window.openbridge.librarySnapshot(false);
      const firstPage = await window.openbridge.queryLibrary({
        ...libraryFilterQuery(get()),
        limit: 300,
        offset: 0
      });

      const downloadMap: Record<string, DownloadProgress> = {};
      for (const item of downloads) {
        downloadMap[item.assetId] = item;
        recordDownloadProgress(item);
      }

      set({
        settings,
        auth,
        localRefs: library.refs,
        libraryAssets: firstPage.assets,
        libraryCounts: firstPage.counts,
        libraryTotal: firstPage.counts.all,
        libraryFilteredTotal: firstPage.total,
        libraryHasMore: firstPage.hasMore,
        localCategories: firstPage.categories,
        localPacks: firstPage.packs,
        libraryScannedAt: library.scannedAt,
        downloads: downloadMap,
        sync,
        versions,
        catalogMetadata
      });
      void categoryRequest.then(categories => set({ categories, categoriesLoading: false }));

      if (auth.loggedIn) {
        void get().refreshProfile();
        void get().refreshAcquired();
        void get().refreshFavorites();
      }
      void get().search(true);
      void get().refreshPacks();
      restoreSubscription?.();
      let previous = JSON.stringify(browsingSnapshot(get()));
      restoreSubscription = useStore.subscribe(state => {
        const current = JSON.stringify(browsingSnapshot(state));
        if (current !== previous) { previous = current; writePreference("browsingSession", browsingSnapshot(state)); }
      });

      unsubscribers = [
        window.openbridge.onLibraryUpdated(result => {
          set({
            localRefs: result.refs,
            libraryCounts: result.counts,
            libraryTotal: result.total,
            libraryFilteredTotal: 0,
            libraryScannedAt: result.scannedAt
          });
          void get().queryLocalLibrary(true);
        }),
        window.openbridge.onNotification(payload => {
          get().toast(payload.message, payload.error);
        }),
        window.openbridge.auth.onChanged(state => {
          set({ auth: state });
        if (state.loggedIn) {
            void get().refreshProfile();
            void get().refreshAcquired();
            void get().refreshFavorites();
          } else {
            set({ acquired: [], favorites: [], favoritesOnly: false, localFavoritesOnly: false,
              profile: null, selection: null, selectionHistory: [] });
          }
        }),
        window.openbridge.downloads.onProgress(progress => {
          const current = get().downloads;
          set({ downloads: { ...current, [progress.assetId]: progress } });
          recordDownloadProgress(progress);
          if (progress.preview) {
            if (["complete", "error", "cancelled"].includes(progress.status)) {
              const key = progress.assetId;
              window.setTimeout(() => {
                const latest = get().downloads;
                if (latest[key] !== progress) return;
                const next = { ...latest };
                delete next[key];
                set({ downloads: next });
              }, 3000);
            }
            return;
          }
          if (progress.status === "complete") {
            get().toast(`${progress.name ?? progress.assetId} downloaded`);
            void get().refreshLibrary(true);
          }
          if (progress.status === "error" && progress.message) {
            get().toast(progress.message, true);
          }
        }),
        window.openbridge.sync.onStatus(status => set({ sync: status }))
      ];
    })();
    return initPromise;
  },

  dispose() {
    restoreSubscription?.(); restoreSubscription = null;
    for (const off of unsubscribers) off();
    unsubscribers = [];
    initPromise = null;
  },

  setView(view) {
    get().closeSelection();
    set({ view, selection: null, selectionHistory: [] });
  },

  setQuery(query) {
    const parsed = parseSearchQuery(query);
    if (parsed.direct) {
      set({
        query: parsed.text,
        type: "",
        categoryPath: [],
        favoritesOnly: false,
        freeOnly: false,
        nextCursor: null,
        hasMore: false
      });
      return;
    }
    set({ query: parsed.text });
  },

  setType(type) {
    set({ type, categoryPath: [], categoryPaths: [], favoritesOnly: false });
    void get().search(true);
  },

  setCategoryPath(categoryPath) {
    set({ categoryPath, categoryPaths: [], type: "", favoritesOnly: false });
    void get().search(true);
  },

  setFavoritesOnly(favoritesOnly) {
    set({
      favoritesOnly,
      freeOnly: false,
      downloadedOnly: false,
      type: "",
      categoryPath: [],
      categoryPaths: [],
      query: favoritesOnly ? "" : get().query
    });
    void get().search(true);
  },

  setFreeOnly(freeOnly) {
    set({
      freeOnly,
      favoritesOnly: false,
      downloadedOnly: false,
      type: "",
      categoryPath: [],
      categoryPaths: [],
      query: freeOnly ? "" : get().query
    });
    void get().search(true);
  },

  setDownloadedOnly(downloadedOnly) {
    set({ downloadedOnly, favoritesOnly: false, freeOnly: false });
    void get().search(true);
  },

  setSizeFilter(sizeFilter) {
    set({ sizeFilter });
    void get().search(true);
  },

  setStateFilter(value) {
    set({
      freeOnly: value === "free",
      favoritesOnly: value === "favorites",
      downloadedOnly: false
    });
    void get().search(true);
  },

  toggleFacet(group, value) {
    const current = get().facetFilters;
    const values = current[group] ?? [];
    const next = values.includes(value)
      ? values.filter(item => item !== value)
      : [...values, value];
    set({ facetFilters: { ...current, [group]: next } });
    void get().search(true);
  },

  clearFacetFilters() {
    set({ facetFilters: {} });
    void get().search(true);
  },

  clearFilters() {
    set({
      type: "",
      categoryPath: [],
      categoryPaths: [],
      favoritesOnly: false,
      freeOnly: false,
      downloadedOnly: false,
      sizeFilter: "any",
      facetFilters: {},
      catalogPack: null
    });
    void get().search(true);
  },

  async search(reset = true) {
    const requestId = ++catalogRequest;
    const page = reset ? 0 : get().page + 1;
    if (reset) {
      set({ hits: [], page: -1, nextCursor: null, hasMore: false, nbHits: 0, nbPages: 0 });
    }
    set({ catalogLoading: true, catalogError: null });
    try {
      const result = await window.openbridge.catalog.search({
        ...catalogFilterQuery(get()),
        page,
        hitsPerPage: 48
      }, "discover");
      if (requestId !== catalogRequest) return;
      let hits = result.hits;
      if (hits.length > 0 && get().catalogMetadata?.available) {
        const records = await window.openbridge
          .catalogMetadataLookup(hits.map(hit => hit.id || hit.objectID))
          .catch(() => []);
        if (requestId !== catalogRequest) return;
        const meta = new Map(records.map(record => [record.id, record]));
        hits = hits.map(hit => ({
          ...hit,
          metadata: meta.get(hit.id || hit.objectID) ?? hit.metadata
        }));
      }
      const current = get();
      set({
        hits: reset ? hits : [...current.hits, ...hits],
        page: result.page,
        nbPages: result.nbPages,
        nbHits: result.nbHits,
        nextCursor: null,
        hasMore: result.page + 1 < result.nbPages,
        facets: result.facets ?? {},
        catalogFacetWarning: Boolean(result.facetCountsPartial),
        catalogLoading: false
      });
    } catch (error) {
      if (requestId !== catalogRequest) return;
      set({
        catalogLoading: false,
        catalogError: error instanceof Error ? error.message : String(error)
      });
    }
  },

  async refreshLibrary(force = false) {
    try {
      const result = await window.openbridge.librarySnapshot(force);
      set({
        localRefs: result.refs,
        libraryCounts: result.counts,
        libraryTotal: result.counts.all,
        libraryScannedAt: result.scannedAt
      });
      await get().queryLocalLibrary(true);
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async queryLocalLibrary(reset = true) {
    const requestId = ++libraryRequest;
    const { libraryAssets } = get();
    const offset = reset ? 0 : libraryAssets.length;
    set({ libraryLoading: true });
    try {
      const result = await window.openbridge.queryLibrary({
        ...libraryFilterQuery(get()),
        limit: 300,
        offset
      });
      if (requestId !== libraryRequest) return;
      set(state => ({
        libraryAssets: reset ? result.assets : [...state.libraryAssets, ...result.assets],
        libraryCounts: result.counts,
        libraryTotal: result.counts.all,
        libraryFilteredTotal: result.total,
        libraryHasMore: result.hasMore,
        localCategories: result.categories,
        localPacks: result.packs,
        libraryLoading: false
      }));
    } catch (error) {
      if (requestId !== libraryRequest) return;
      set({ libraryLoading: false });
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  setLocalQuery(localQuery) {
    set({ localQuery });
  },

  setLocalRepo(localRepo) {
    set({ localRepo });
  },

  toggleLocalReady(value) {
    set(state => ({
      localReady: state.localReady.includes(value)
        ? state.localReady.filter(item => item !== value)
        : [...state.localReady, value]
    }));
  },

  setLocalMaxTris(localMaxTris) {
    set({ localMaxTris });
  },

  setLocalColor(localColor) {
    set({ localColor });
  },

  setLocalState(localState) {
    set({ localState });
  },

  setLocalInterior(localInterior) {
    set({ localInterior });
  },

  resetLocalFilters() {
    set({
      localQuery: "", localRepo: "all", localType: "", localCategoryPath: [],
      localFavoritesOnly: false, localPack: null,
      localReady: [],
      localMaxTris: null,
      localColor: "",
      localState: "",
      localInterior: ""
    });
  },

  async openHit(hit) {
    usePoliigonStore.getState().closeAsset();
    usePolyHavenStore.getState().closeAsset();
    get().rememberSearch(get().query);
    const previous = get().selection;
    const id = hit.id || hit.objectID;
    const recent: RecentAsset = { id, name: hit.name, type: hit.type, source: "catalog",
      hit: { id, objectID: id, name: hit.name, type: hit.type, previews: hit.previews,
        tags: hit.tags, categories: hit.categories, points: hit.points } };
    const recentlyViewed = [recent, ...get().recentlyViewed.filter(item => item.id !== id || item.source !== "catalog")].slice(0, 20);
    writePreference("recentlyViewed", recentlyViewed);
    set({ selection: { hit, loading: Boolean(get().auth.loggedIn) }, recentlyViewed,
      selectionHistory: previous ? [...get().selectionHistory, previous].slice(-30) : [] });
    const pending = get().selection;
    if (!get().auth.loggedIn) {
      set({
        selection: {
          hit,
          loading: false,
          error: "Sign in with Epic to load maps, LODs and download access."
        }
      });
      return;
    }
    try {
      const extended = await window.openbridge.catalog.extended(id, "drawer");
      if (get().selection !== pending) return;
      set({ selection: { hit, extended, loading: false } });
    } catch (error) {
      if (get().selection !== pending) return;
      set({
        selection: {
          hit,
          loading: false,
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  },

  async openLocal(asset) {
    if (asset.provider === "poliigon") {
      set({ selection: null, selectionHistory: [] });
      usePolyHavenStore.getState().closeAsset();
      await usePoliigonStore.getState().openLocal(asset);
      return;
    }
    if (asset.provider === "polyhaven") {
      set({ selection: null, selectionHistory: [] });
      usePoliigonStore.getState().closeAsset();
      await usePolyHavenStore.getState().openLocal(asset);
      return;
    }
    usePoliigonStore.getState().closeAsset();
    usePolyHavenStore.getState().closeAsset();
    void window.openbridge.catalog.cancel("drawer").catch(() => undefined);
    void window.openbridge.catalog.cancel("related").catch(() => undefined);
    const recent: RecentAsset = { id: asset.id, name: asset.name, type: asset.type, source: "local" };
    const recentlyViewed = [recent, ...get().recentlyViewed.filter(item => item.id !== asset.id || item.source !== "local")].slice(0, 20);
    writePreference("recentlyViewed", recentlyViewed);
    set({ selection: { local: asset, loading: false }, recentlyViewed,
      selectionHistory: get().selection ? [...get().selectionHistory, get().selection!].slice(-30) : [] });
  },

  closeSelection() {
    set({ selection: null, selectionHistory: [] });
    void window.openbridge.catalog.cancel("drawer").catch(() => undefined);
    void window.openbridge.catalog.cancel("related").catch(() => undefined);
    usePoliigonStore.getState().closeAsset();
    usePolyHavenStore.getState().closeAsset();
  },

  async login() {
    if (get().busy) return;
    set({ busy: true });
    try {
      const state = await window.openbridge.auth.login();
      set({ auth: state, busy: false });
      await get().refreshProfile();
      await get().refreshAcquired();
      await get().refreshFavorites();
      await get().runSync();
    } catch (error) {
      set({ busy: false });
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async logout() {
    const session = get().auth;
    await window.openbridge.auth.logout();
    if (get().auth !== session) return;
    set({
      auth: emptyAuth,
      acquired: [],
      favorites: [],
      favoritesOnly: false,
      freeOnly: false,
      profile: null,
      localFavoritesOnly: false,
      selection: null, selectionHistory: []
    });
  },

  async startDownload(options) {
    const selection = get().selection;
    const assetId = selection?.hit?.id ?? selection?.local?.id;
    if (!assetId) return;
    if (!get().auth.loggedIn) {
      get().toast("Sign in with Epic to download assets.", true);
      return;
    }
    try {
      await window.openbridge.downloads.start(assetId, options);
      get().toast(`Queued ${selection?.hit?.name ?? assetId}`);
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async acquire() {
    const assetId = get().selection?.hit?.id ?? get().selection?.local?.id;
    if (!assetId) return;
    try {
      await window.openbridge.downloads.acquire(assetId);
      await get().refreshAcquired();
      get().toast(`Acquired ${assetId}`);
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async downloadMany(assetIds, options) {
    if (!get().auth.loggedIn) {
      get().toast("Sign in with Epic to download assets.", true);
      return { queued: 0, skipped: 0 };
    }
    try {
      const result = await window.openbridge.downloads.startMany(assetIds, options);
      await get().refreshDownloads();
      if (result.queued > 0) {
        get().toast(
          `Queued ${result.queued.toLocaleString()} download${result.queued === 1 ? "" : "s"}`
        );
      }
      if (result.skipped > 0) {
        get().toast(
          `${result.skipped.toLocaleString()} selected item${
            result.skipped === 1 ? " was" : "s were"
          } already queued or downloaded`
        );
      }
      return result;
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
      return { queued: 0, skipped: 0 };
    }
  },

  async refreshDownloads() {
    try {
      const list = await window.openbridge.downloads.list();
      const map: Record<string, DownloadProgress> = {};
      for (const item of list) map[item.assetId] = item;
      set({ downloads: map });
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async cancelDownload(assetId) {
    await window.openbridge.downloads.cancel(assetId);
  },

  async saveSettings(patch) {
    try {
      const settings = await window.openbridge.updateSettings(patch);
      set({ settings });
      get().toast("Settings saved");
      if (patch.libraryPath !== undefined || patch.poliigonLibraryPath !== undefined || patch.polyhavenLibraryPath !== undefined) {
        await get().refreshLibrary(true);
      }
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async runSync() {
    const status = await window.openbridge.sync.run();
    set({ sync: status });
    if (!status.running) {
      if (status.missing > 0) {
        get().toast(
          `Library check: ${status.missing.toLocaleString()} acquired asset${
            status.missing === 1 ? " is" : "s are"
          } not on disk. Nothing was downloaded.`
        );
      } else {
        get().toast("Library check complete: all acquired assets are already on disk.");
      }
    }
  },

  async installUpdate() {
    const info = await window.openbridge.updates.check();
    set({ update: info });
    if (!info.available || !info.url) {
      get().toast(
        info.error ?? (info.available ? "No update package available" : "OpenBridge is up to date"),
        Boolean(info.error)
      );
      return;
    }
    get().toast(`Downloading OpenBridge ${info.latest}...`);
    try {
      await window.openbridge.updates.install(info);
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async refreshCatalogMetadata() {
    try {
      set({ catalogMetadata: await window.openbridge.catalogMetadata() });
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async importCatalogMetadata() {
    try {
      get().toast("Importing catalogue metadata...");
      const status = await window.openbridge.importCatalogMetadata();
      set({ catalogMetadata: status });
      await get().refreshPacks();
      get().toast(
        status.available
          ? `Catalogue metadata ready for ${status.count.toLocaleString()} assets`
          : "Catalogue metadata pack was not imported"
      );
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async downloadCatalogMetadata() {
    try {
      get().toast("Downloading catalogue metadata pack...");
      const status = await window.openbridge.downloadCatalogMetadata();
      set({ catalogMetadata: status });
      await get().refreshPacks();
      get().toast(
        `Catalogue metadata ready for ${status.count.toLocaleString()} assets`
      );
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async removeCatalogMetadata() {
    try {
      set({ catalogMetadata: await window.openbridge.removeCatalogMetadata() });
      set({ catalogPack: null });
      await get().refreshPacks();
      await get().search(true);
      get().toast("Catalogue metadata pack removed");
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async checkUpdates() {
    const update = await window.openbridge.updates.check();
    set({ update });
    get().toast(
      update.error
        ? update.error
        : update.available
          ? `Version ${update.latest} is available`
          : "OpenBridge is up to date",
      Boolean(update.error)
    );
  },

  async importFolder() {
    const path = await window.openbridge.importFolder();
    if (path) {
      await get().refreshLibrary(true);
      get().toast(`Imported ${path}`);
    }
  },

  async importZip() {
    const path = await window.openbridge.importZip();
    if (path) {
      await get().refreshLibrary(true);
      get().toast(`Imported ${path}`);
    }
  },

  toast(message, error = false) {
    const id = ++toastId;
    set(state => ({ toasts: [...state.toasts, { id, message, error }].slice(-4) }));
    setTimeout(() => get().dismissToast(id), 5000);
  },

  dismissToast(id) {
    set(state => ({ toasts: state.toasts.filter(toast => toast.id !== id) }));
  },

  async clearFinishedDownloads() {
    try {
      await window.openbridge.downloads.clearFinished();
      const current = get().downloads;
      const next: Record<string, DownloadProgress> = {};
      for (const [id, item] of Object.entries(current)) {
        if (item.status !== "complete" && item.status !== "error" && item.status !== "cancelled") {
          next[id] = item;
        }
      }
      set({ downloads: next });
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async refreshProfile() {
    const session = get().auth;
    try {
      const profile = await window.openbridge.auth.profile();
      if (get().auth !== session || !session.loggedIn) return;
      set({ profile });
    } catch {
      // ignore
    }
  },

  async refreshAcquired() {
    const session = get().auth;
    try {
      const acquired = await window.openbridge.catalog.acquired();
      if (get().auth !== session || !session.loggedIn) return;
      set({ acquired });
    } catch {
      // ignore
    }
  },

  async refreshFavorites() {
    const session = get().auth;
    try {
      const favorites = await window.openbridge.catalog.favorites();
      if (get().auth !== session || !session.loggedIn) return;
      set({ favorites });
    } catch {
      // ignore
    }
  },

  async toggleFavorite(assetId) {
    const session = get().auth;
    if (!get().auth.loggedIn) {
      get().toast("Sign in with Epic to use favorites", true);
      return;
    }
    const isFavorite = get().favorites.includes(assetId);
    try {
      if (isFavorite) await window.openbridge.catalog.removeFavorite(assetId);
      else await window.openbridge.catalog.addFavorite(assetId);
      if (get().auth !== session || !session.loggedIn) return;
      set(state => ({
        favorites: isFavorite
          ? state.favorites.filter(id => id !== assetId)
          : [...state.favorites, assetId]
      }));
      get().toast(isFavorite ? "Removed from favorites" : "Added to favorites");
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async downloadHit(hit) {
    const assetId = hit.id || hit.objectID;
    if (!get().auth.loggedIn) {
      get().toast("Sign in with Epic to download assets", true);
      return;
    }
    const owned = get().acquired.includes(assetId);
    if (!owned && (hit.points ?? 0) > 0) {
      await get().openHit(hit);
      get().toast("Acquire this asset before downloading");
      return;
    }
    try {
      const extended = await window.openbridge.catalog.extended(assetId);
      const options = buildDownloadOptions(extended, get().settings);
      await window.openbridge.downloads.start(assetId, options);
      get().toast(`Queued ${hit.name}`);
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async validateJson(assetId) {
    const report = await window.openbridge.validateAssetJson(assetId);
    if (report.ok) {
      const warnings = report.warnings?.length ? ` - ${report.warnings.length} warning(s)` : "";
      get().toast(
        `JSON OK - ${report.components ?? 0} maps - ${report.meshes ?? 0} meshes - ${
          report.lods ?? 0
        } LODs${warnings}`
      );
    } else {
      get().toast(report.error ?? "Asset JSON validation failed", true);
    }
  }
}));




