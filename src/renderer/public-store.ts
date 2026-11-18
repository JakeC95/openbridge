import { create } from "zustand";
import type { AssetRecord, CategoryNode } from "../shared/types";
import { parsePublicJobId, type BlenderKitAuthState, type PublicAssetDetail, type PublicAssetSummary, type PublicCatalogQuery, type PublicFacets, type PublicProviderId, type PublicCatalogStatus } from "../shared/public-providers";
export { publicTypesForRoot, publicCategoryQuery } from "./public-taxonomy";
import { readPreference, writePreference } from "./browsing-state";
import { normalizePublicQuery, normalizePublicRecent, normalizePublicSaved, type PublicRecentAsset, type PublicSavedSearch } from "./public-preferences";

interface ProviderState {
  savedSearches: PublicSavedSearch[];
  recentSearches: string[];
  metadataReady: boolean;
  hits: PublicAssetSummary[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  query: PublicCatalogQuery;
  facets: PublicFacets | null;
  categories: CategoryNode[];
  status: PublicCatalogStatus | null;
  resetVersion: number;
}
const empty = (provider: PublicProviderId): ProviderState => ({ savedSearches: normalizePublicSaved(provider, readPreference(`publicSaved.${provider}`, [])), recentSearches: (() => { const value = readPreference<unknown>(`publicRecent.${provider}`, []); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 12) : []; })(), metadataReady: false, hits: [], total: 0, hasMore: false, loading: false, error: null, query: normalizePublicQuery(provider, readPreference(`publicQuery.${provider}`, {})), facets: null, categories: [], status: null, resetVersion: 0 });
const generations = { ambientcg: 0, blenderkit: 0, openhdri: 0 };
interface PublicStore {
  favorites: string[];
  recentlyViewed: PublicRecentAsset[];
  toggleFavorite(key: string): void;
  rememberViewed(asset: PublicAssetSummary): void;
  openRecent(provider: PublicProviderId, id: string): Promise<void>;
  clearRecentlyViewed(): void;
  providers: Record<PublicProviderId, ProviderState>;
  blenderkit: BlenderKitAuthState;
  selection: PublicAssetSummary | null;
  detail: PublicAssetDetail | null;
  local: AssetRecord | null;
  detailError: string | null;
  patch(provider: PublicProviderId, patch: Partial<ProviderState>): void;
  search(provider: PublicProviderId, reset?: boolean, query?: Partial<PublicCatalogQuery>): Promise<void>;
  init(provider: PublicProviderId): Promise<void>;
  loadMetadata(provider: PublicProviderId): Promise<void>;
  toggleFacet(provider: PublicProviderId, field: "types" | "licenses" | "resolutions" | "mapTypes" | "modelFormats" | "weather", value: string): void;
  clearRecent(provider: PublicProviderId): void;
  rememberSearch(provider: PublicProviderId, term: string): void;
  reset(provider: PublicProviderId): Promise<void>;
  setBlenderkitAuth(state: BlenderKitAuthState): void;
  saveSearch(provider: PublicProviderId, name: string, scope?: "catalog" | "favorites" | "downloaded"): void;
  removeSavedSearch(provider: PublicProviderId, id: string): void;
  open(asset: PublicAssetSummary): Promise<void>;
  openLocal(asset: AssetRecord): Promise<void>;
  close(): void;
}
let selectionGeneration = 0;
export const usePublicStore = create<PublicStore>((set, get) => ({
  favorites: (() => { const value = readPreference<unknown>("publicFavorites", []); return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string" && Boolean(parsePublicJobId(key))) : []; })(),
  recentlyViewed: normalizePublicRecent(readPreference("publicRecentlyViewed", [])),
  toggleFavorite(key) { const favorites = get().favorites.includes(key) ? get().favorites.filter(value => value !== key) : [...get().favorites, key]; writePreference("publicFavorites", favorites); set({ favorites }); },
  clearRecentlyViewed() { writePreference("publicRecentlyViewed", []); set({ recentlyViewed: [] }); },
  rememberViewed(asset) {
    const entry: PublicRecentAsset = { provider: asset.provider, id: asset.id, name: asset.name, typeLabel: asset.typeLabel, thumbnail: asset.thumbnail };
    const recentlyViewed = [entry, ...get().recentlyViewed.filter(item => item.provider !== entry.provider || item.id !== entry.id)].slice(0, 20);
    writePreference("publicRecentlyViewed", recentlyViewed);
    set({ recentlyViewed });
  },
  async openRecent(provider, id) {
    try {
      const generation = ++selectionGeneration;
      const detail = await window.openbridge.public.extended(provider, id);
      if (generation !== selectionGeneration) return;
      set({ selection: detail, detail, local: null, detailError: null });
      get().rememberViewed(detail);
    } catch (error) { set({ detailError: error instanceof Error ? error.message : String(error) }); }
  },
  blenderkit: { hasKey: false },
  setBlenderkitAuth(blenderkit) { set({ blenderkit }); },
  toggleFacet(provider, field, value) {
    const current = get().providers[provider].query[field] ?? [];
    const next = current.includes(value) ? current.filter(entry => entry !== value) : [...current, value];
    void get().search(provider, true, { [field]: next } as Partial<PublicCatalogQuery>);
  },
  clearRecent(provider) {
    writePreference(`publicRecent.${provider}`, []);
    get().patch(provider, { recentSearches: [] });
  },
  rememberSearch(provider, term) {
    const value = term.trim(); if (!value) return;
    const recentSearches = [value, ...get().providers[provider].recentSearches.filter(entry => entry !== value)].slice(0, 12);
    writePreference(`publicRecent.${provider}`, recentSearches);
    get().patch(provider, { recentSearches });
  },
  async reset(provider) {
    get().patch(provider, { resetVersion: get().providers[provider].resetVersion + 1 });
    await get().search(provider, true, normalizePublicQuery(provider, {}));
  },
  providers: { ambientcg: empty("ambientcg"), blenderkit: empty("blenderkit"), openhdri: empty("openhdri") },
  selection: null, detail: null, local: null, detailError: null,
  patch(provider, patch) { set(state => ({ providers: { ...state.providers, [provider]: { ...state.providers[provider], ...patch } } })); },
  async init(provider) {
    if (!window.openbridge.public) return; // Older UI test fixtures do not supply optional providers.
    try {
      await get().loadMetadata(provider);
      await get().search(provider, true, get().providers[provider].query.types?.includes("__none__") ? { types: [], categoryPaths: [], ids: undefined, weather: [], timeStart: undefined, timeEnd: undefined } : {});
    } catch (error) { get().patch(provider, { error: String(error) }); }
  },
  async loadMetadata(provider) {
    // Categories can trigger and wait for the initial index. Read status after they resolve.
    const categories = await window.openbridge.public.categories(provider);
    const previousStatus = get().providers[provider].status;
    const status = await window.openbridge.public.status(provider);
    // A refresh event may have already supplied a newer status while IPC was pending.
    get().patch(provider, {
      categories,
      metadataReady: true,
      ...(get().providers[provider].status === previousStatus ? { status } : {})
    });
  },
  async search(provider, reset = true, patch = {}) {
    if (!window.openbridge.public) return;
    const previous = get().providers[provider];
    if (!reset && previous.loading) return;
    const generation = ++generations[provider];
    const query = { ...previous.query, ...patch, provider, offset: reset ? 0 : previous.query.offset + previous.query.limit };
    if (reset && !query.types?.includes("__none__")) writePreference(`publicQuery.${provider}`, normalizePublicQuery(provider, query));
    get().patch(provider, { loading: true, error: null, query, ...(reset ? { hasMore: false } : {}) });
    try {
      if (!previous.metadataReady) await get().loadMetadata(provider);
      if (generation !== generations[provider]) return;
      const result = await window.openbridge.public.search(query);
      if (generation !== generations[provider]) return;
      const hits = reset ? result.hits : [...previous.hits, ...result.hits];
      get().patch(provider, { hits: [...new Map(hits.map(hit => [hit.id, hit])).values()], total: result.total, hasMore: result.hasMore, facets: result.facets, loading: false });
    } catch (error) {
      if (generation === generations[provider]) get().patch(provider, { error: error instanceof Error ? error.message : String(error), loading: false, query: reset ? query : previous.query });
    }
  },
  saveSearch(provider, name, scope = "catalog") {
    const clean = name.trim().slice(0, 100); if (!clean) return;
    const savedSearches = [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: clean, scope, query: normalizePublicQuery(provider, get().providers[provider].query) }, ...get().providers[provider].savedSearches.filter(item => item.name.toLowerCase() !== clean.toLowerCase())].slice(0, 20);
    writePreference(`publicSaved.${provider}`, savedSearches); get().patch(provider, { savedSearches });
  },
  removeSavedSearch(provider, id) { const savedSearches = get().providers[provider].savedSearches.filter(item => item.id !== id); writePreference(`publicSaved.${provider}`, savedSearches); get().patch(provider, { savedSearches }); },
  async open(asset) {
    const generation = ++selectionGeneration;
    set({ selection: asset, detail: null, local: null, detailError: null });
    get().rememberViewed(asset);
    try {
      const detail = await window.openbridge.public.extended(asset.provider, asset.id);
      if (generation === selectionGeneration) set({ detail });
    } catch (error) { if (generation === selectionGeneration) set({ detailError: String(error) }); }
  },
  async openLocal(asset) {
    const parsed = parsePublicJobId(asset.id);
    if (!parsed) return;
    // Local contents remain inspectable without an account or network catalogue.
    selectionGeneration++;
    set({ local: asset, selection: null, detail: null, detailError: null });
    get().rememberViewed({
      provider: parsed.provider, id: parsed.id, name: asset.name, typeLabel: asset.type,
      thumbnail: asset.preview ? window.openbridge.toFileUrl(asset.preview) : null
    } as PublicAssetSummary);
  },
  close() { selectionGeneration++; set({ selection: null, detail: null, local: null, detailError: null }); }
}));
