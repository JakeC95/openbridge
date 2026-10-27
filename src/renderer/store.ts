import { create } from "zustand";
import type {
  AppSettings,
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
  LibraryRef,
  Profile,
  RepoKind,
  SyncStatus,
  UpdateInfo
} from "../shared/types";
import { buildDownloadOptions } from "./download-options";
import { parseSearchQuery } from "./search-utils";

type View = "discover" | "library" | "downloads" | "settings";
type LocalRepo = "all" | RepoKind;
type SizeFilter = "any" | "small" | "medium" | "large" | "huge";

const SIZE_FILTERS: Record<Exclude<SizeFilter, "any">, { minSize?: number; maxSize?: number }> = {
  small: { maxSize: 0.5 },
  medium: { minSize: 0.5, maxSize: 2 },
  large: { minSize: 2, maxSize: 5 },
  huge: { minSize: 5 }
};

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

interface Toast {
  id: number;
  message: string;
  error: boolean;
}

interface State {
  view: View;
  settings: AppSettings | null;
  auth: AuthState;
  profile: Profile | null;
  versions: Versions | null;
  categories: CategoryNode[];
  acquired: string[];
  favorites: string[];
  favoritesOnly: boolean;
  freeOnly: boolean;
  sizeFilter: SizeFilter;
  facets: Record<string, Record<string, number>>;
  facetFilters: Record<string, string[]>;
  query: string;
  type: string;
  categoryPath: string[];
  hits: CatalogHit[];
  page: number;
  nextCursor: string | null;
  hasMore: boolean;
  nbPages: number;
  nbHits: number;
  catalogLoading: boolean;
  catalogError: string | null;
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

export const useStore = create<State>((set, get) => ({
  view: "discover",
  settings: null,
  auth: emptyAuth,
  profile: null,
  versions: null,
  categories: [],
  acquired: [],
  favorites: [],
  favoritesOnly: false,
  freeOnly: false,
  sizeFilter: "any",
  facets: {},
  facetFilters: {},
  query: "",
  type: "",
  categoryPath: [],
  hits: [],
  page: -1,
  nextCursor: null,
  hasMore: false,
  nbPages: 0,
  nbHits: 0,
  catalogLoading: false,
  catalogError: null,
  localRefs: [],
  libraryAssets: [],
  libraryCounts: { all: 0, downloaded: 0, custom: 0, dhi: 0 },
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
      const [settings, auth, categories, downloads, sync, versions, catalogMetadata] = await Promise.all([
        window.openbridge.getSettings(),
        window.openbridge.auth.state(),
        window.openbridge.catalog.categories().catch(() => []),
        window.openbridge.downloads.list().catch(() => []),
        window.openbridge.sync.status().catch(() => emptySync),
        window.openbridge.versions(),
        window.openbridge.catalogMetadata().catch(() => null)
      ]);
      const library = await window.openbridge.librarySnapshot(false);
      const firstPage = await window.openbridge.queryLibrary({
        query: "",
        repo: "all",
        limit: 300,
        offset: 0
      });

      const downloadMap: Record<string, DownloadProgress> = {};
      for (const item of downloads) downloadMap[item.assetId] = item;

      set({
        settings,
        auth,
        localRefs: library.refs,
        libraryAssets: firstPage.assets,
        libraryCounts: firstPage.counts,
        libraryTotal: firstPage.counts.all,
        libraryFilteredTotal: firstPage.total,
        libraryHasMore: firstPage.hasMore,
        libraryScannedAt: library.scannedAt,
        categories,
        downloads: downloadMap,
        sync,
        versions,
        catalogMetadata
      });

      if (auth.loggedIn) {
        void get().refreshProfile();
        void get().refreshAcquired();
        void get().refreshFavorites();
      }
      void get().search(true);

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
            set({ acquired: [], favorites: [], favoritesOnly: false, profile: null, selection: null });
          }
        }),
        window.openbridge.downloads.onProgress(progress => {
          const current = get().downloads;
          set({ downloads: { ...current, [progress.assetId]: progress } });
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
    for (const off of unsubscribers) off();
    unsubscribers = [];
    initPromise = null;
  },

  setView(view) {
    set({ view, selection: null });
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
    set({ type, categoryPath: [], favoritesOnly: false });
    void get().search(true);
  },

  setCategoryPath(categoryPath) {
    set({ categoryPath, type: "", favoritesOnly: false });
    void get().search(true);
  },

  setFavoritesOnly(favoritesOnly) {
    set({
      favoritesOnly,
      freeOnly: false,
      type: "",
      categoryPath: [],
      query: favoritesOnly ? "" : get().query
    });
    void get().search(true);
  },

  setFreeOnly(freeOnly) {
    set({
      freeOnly,
      favoritesOnly: false,
      type: "",
      categoryPath: [],
      query: freeOnly ? "" : get().query
    });
    void get().search(true);
  },

  setSizeFilter(sizeFilter) {
    set({ sizeFilter });
    void get().search(true);
  },

  setStateFilter(value) {
    set({
      freeOnly: value === "free",
      favoritesOnly: value === "favorites"
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
      favoritesOnly: false,
      freeOnly: false,
      sizeFilter: "any",
      facetFilters: {}
    });
    void get().search(true);
  },

  async search(reset = true) {
    const requestId = ++catalogRequest;
    const {
      query,
      type,
      categoryPath,
      favoritesOnly,
      favorites,
      freeOnly,
      sizeFilter,
      facetFilters,
      nextCursor
    } = get();
    const page = reset ? 0 : get().page + 1;
    if (reset) {
      set({ hits: [], page: -1, nextCursor: null, hasMore: false, nbHits: 0, nbPages: 0 });
    }
    set({ catalogLoading: true, catalogError: null });
    try {
      const result = await window.openbridge.catalog.search({
        query,
        type: type || undefined,
        categoryPath: categoryPath.length ? categoryPath : undefined,
        ids: favoritesOnly ? favorites : undefined,
        points: freeOnly ? 0 : undefined,
        ...(sizeFilter === "any" ? {} : SIZE_FILTERS[sizeFilter]),
        facetFilters,
        facets: ["biome", "region", "resolution", "color", "environment", "theme"],
        page,
        hitsPerPage: 48
      });
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
    const {
      localQuery,
      localRepo,
      localReady,
      localMaxTris,
      localColor,
      localState,
      localInterior,
      libraryAssets
    } = get();
    const offset = reset ? 0 : libraryAssets.length;
    set({ libraryLoading: true });
    try {
      const result = await window.openbridge.queryLibrary({
        query: localQuery,
        repo: localRepo,
        ready: localReady,
        maxTris: localMaxTris ?? undefined,
        color: localColor || undefined,
        state: localState || undefined,
        interiorExterior: localInterior || undefined,
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
      localReady: [],
      localMaxTris: null,
      localColor: "",
      localState: "",
      localInterior: ""
    });
  },

  async openHit(hit) {
    set({ selection: { hit, loading: Boolean(get().auth.loggedIn) } });
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
      const extended = await window.openbridge.catalog.extended(hit.id);
      set({ selection: { hit, extended, loading: false } });
    } catch (error) {
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
    set({ selection: { local: asset, loading: false } });
  },

  closeSelection() {
    set({ selection: null });
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
    await window.openbridge.auth.logout();
    set({
      auth: emptyAuth,
      acquired: [],
      favorites: [],
      favoritesOnly: false,
      freeOnly: false,
      profile: null,
      selection: null
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
      if (patch.libraryPath !== undefined) {
        await get().refreshLibrary(true);
      }
    } catch (error) {
      get().toast(error instanceof Error ? error.message : String(error), true);
    }
  },

  async runSync() {
    const status = await window.openbridge.sync.run();
    set({ sync: status });
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
    try {
      const profile = await window.openbridge.auth.profile();
      set({ profile });
    } catch {
      // ignore
    }
  },

  async refreshAcquired() {
    try {
      const acquired = await window.openbridge.catalog.acquired();
      set({ acquired });
    } catch {
      // ignore
    }
  },

  async refreshFavorites() {
    try {
      const favorites = await window.openbridge.catalog.favorites();
      set({ favorites });
    } catch {
      // ignore
    }
  },

  async toggleFavorite(assetId) {
    if (!get().auth.loggedIn) {
      get().toast("Sign in with Epic to use favorites", true);
      return;
    }
    const isFavorite = get().favorites.includes(assetId);
    try {
      if (isFavorite) await window.openbridge.catalog.removeFavorite(assetId);
      else await window.openbridge.catalog.addFavorite(assetId);
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




