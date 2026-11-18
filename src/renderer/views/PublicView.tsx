import { useEffect, useRef, useState } from "react";
import {
  publicCardThumbnail,
  publicJobId,
  publicProviderLabel,
  publicTypeLabel,
  type PublicAssetSummary,
  type PublicCatalogQuery,
  type PublicProviderId
} from "../../shared/public-providers";
import { skyConditionLabel, skyConditionRank } from "../../shared/sky-conditions";
import { usePublicStore } from "../public-store";
import { PublicCard } from "../components/PublicAsset";
import { VirtualGrid } from "../components/VirtualGrid";
import { useStore } from "../store";
import { TimeOfDaySlider } from "../components/TimeOfDaySlider";
import { AssetList } from "../components/AssetList";
import { DensityControl, FilterWorkbench, type FilterGroup } from "../components/BrowsingTools";
import { readPreference, writePreference } from "../browsing-state";
import { useBrowseScroll } from "../use-browse-scroll";
import { normalizePublicQuery } from "../public-preferences";
import { publicProviderFacts, publicTechnical } from "../public-technical";
import { LoadMore } from "../components/LoadMore";
import { assetCountLabel, resolutionFacetValue } from "../catalog-utils";
import { CloseIcon, SearchIcon } from "../icons";
import { sizeBounds, SIZE_FILTER_LABELS, type SizeFilter } from "../size-filter";

type FacetField = "types" | "licenses" | "resolutions" | "mapTypes" | "modelFormats" | "weather";

const SIZE_VALUES = ["small", "medium", "large", "huge"] as const;

function publicIsHdri(provider: PublicProviderId, query: PublicCatalogQuery): boolean {
  if (provider === "openhdri") return true;
  if (query.types?.length) return query.types.every(type => /^(hdr|hdri|hdri-element)$/i.test(type));
  return Boolean(query.categoryPaths?.some(path => /(^|\/)HDRIs?(\/|$)/i.test(path)));
}

function facetLabel(provider: PublicProviderId, field: FacetField, value: string): string {
  if (field === "types") return publicTypeLabel(provider, value);
  if (field === "resolutions" || field === "modelFormats") return value.toUpperCase();
  if (field === "weather") return skyConditionLabel(value);
  if (field === "mapTypes") return value.replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
  return value;
}

function typeOptionsFor(provider: PublicProviderId): string[] {
  if (provider === "blenderkit") return ["model", "material", "hdr", "brush"];
  if (provider === "openhdri") return ["hdri"];
  return ["material", "hdri", "hdri-element", "3d-model", "substance", "decal", "atlas", "brush", "terrain", "plain-image"];
}

function sizeFilterFor(query: PublicCatalogQuery): SizeFilter {
  if (query.minSize === undefined && query.maxSize === undefined) return "any";
  return (Object.keys(SIZE_FILTER_LABELS) as SizeFilter[]).find(value => {
    const bounds = sizeBounds(value);
    return bounds.minSize === (query.minSize ?? null) && bounds.maxSize === (query.maxSize ?? null);
  }) ?? "any";
}

export function PublicView({ provider }: { provider: PublicProviderId }) {
  const state = usePublicStore(store => store.providers[provider]);
  const search = usePublicStore(store => store.search);
  const toggleFacet = usePublicStore(store => store.toggleFacet);
  const blenderkit = usePublicStore(store => store.blenderkit);
  const toast = useStore(store => store.toast);
  const density = useStore(store => store.density);
  const localRefs = useStore(store => store.localRefs);
  const favorites = usePublicStore(store => store.favorites);
  const openedId = usePublicStore(store => store.selection?.provider === provider ? store.selection.id : null);
  const [scope, setScope] = useState<"catalog" | "favorites" | "downloaded">("catalog");
  const [listView, setListView] = useState(() => readPreference("publicListView", false));
  const [savedName, setSavedName] = useState("");
  const [savedId, setSavedId] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const anchor = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const favoritesVersion = scope === "favorites" ? favorites.join("|") : "";
  const downloadedVersion = scope === "downloaded" ? localRefs.map(ref => ref.id).join("|") : "";
  const isHdri = publicIsHdri(provider, state.query);
  const localIds = new Set(localRefs.map(ref => ref.id));
  const downloadedCount = state.hits.filter(hit => localIds.has(publicJobId(provider, hit.id))).length;
  const activeCount = facetGroupsFor(state, provider, isHdri).reduce((sum, group) => sum + group.selected.length, 0)
    + (state.query.minResolution !== undefined ? 1 : 0)
    + (state.query.maxTris !== undefined ? 1 : 0)
    + (state.query.timeStart !== undefined ? 1 : 0)
    + (state.query.timeWindows?.length ?? 0)
    + (state.query.tags?.length ?? 0)
    + (state.query.minBytes !== undefined ? 1 : 0)
    + (state.query.maxBytes !== undefined ? 1 : 0)
    + (sizeFilterFor(state.query) !== "any" ? 1 : 0)
    + (state.query.freeOnly ? 1 : 0);
  const querySignature = JSON.stringify({
    query: state.query.query,
    types: state.query.types,
    categoryPaths: state.query.categoryPaths,
    licenses: state.query.licenses,
    resolutions: state.query.resolutions,
    mapTypes: state.query.mapTypes,
    modelFormats: state.query.modelFormats,
    weather: state.query.weather,
    tags: state.query.tags,
    minBytes: state.query.minBytes,
    maxBytes: state.query.maxBytes,
    timeWindows: state.query.timeWindows,
    minResolution: state.query.minResolution,
    maxTris: state.query.maxTris,
    minSize: state.query.minSize,
    maxSize: state.query.maxSize,
    timeStart: state.query.timeStart,
    timeEnd: state.query.timeEnd,
    freeOnly: state.query.freeOnly,
    sort: state.query.sort
  });

  useEffect(() => { if (openedId) anchor.current = openedId; }, [openedId]);
  useEffect(() => {
    setSelected([]); setSelectionMode(false); setSavedId(""); setSavedName("");
    void usePublicStore.getState().init(provider);
  }, [provider]);
  useEffect(() => {
    // A different query can leave selected IDs that are no longer loaded.
    setSelected([]); setSelectionMode(false); anchor.current = null;
  }, [querySignature, scope, provider]);
  useEffect(() => {
    setScope("catalog"); setSavedId(""); setSavedName(""); setFiltersOpen(false);
  }, [state.resetVersion, provider]);
  useEffect(() => {
    const ids = scope === "favorites"
      ? favorites.filter(key => key.startsWith(`${provider}:`)).map(key => key.slice(provider.length + 1))
      : scope === "downloaded"
        ? localRefs.filter(ref => ref.id.startsWith(`${provider}:`)).map(ref => ref.id.slice(provider.length + 1))
        : undefined;
    void search(provider, true, { ids });
  }, [provider, scope, favoritesVersion, downloadedVersion, search]);
  useBrowseScroll(scrollRef, "discover", `${JSON.stringify({ ...state.query, offset: 0 })}:${scope}`, { scope: `public:${provider}`, loaded: !state.loading });

  const open = (hit: PublicAssetSummary): void => {
    anchor.current = hit.id;
    useStore.getState().closeSelection();
    const key = publicJobId(provider, hit.id);
    if (scope === "downloaded" && localIds.has(key)) {
      void window.openbridge.queryLibrary({ ids: [key], limit: 1 }).then(result => {
        const record = result.assets[0];
        if (record) void usePublicStore.getState().openLocal(record);
        else void usePublicStore.getState().open(hit);
      }).catch(() => void usePublicStore.getState().open(hit));
      return;
    }
    void usePublicStore.getState().open(hit);
  };
  const toggle = (id: string, shift = false): void => {
    setSelectionMode(true);
    useStore.getState().closeSelection();
    const from = anchor.current ? state.hits.findIndex(hit => hit.id === anchor.current) : -1;
    const to = state.hits.findIndex(hit => hit.id === id);
    setSelected(previous => {
      const next = new Set(previous);
      if (shift && from >= 0 && to >= 0) for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) next.add(state.hits[index].id);
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return [...next];
    });
    anchor.current = id;
  };
  const update = (patch: Partial<PublicCatalogQuery>): void => {
    setSelected([]);
    setSavedId("");
    void search(provider, true, {
      ...(patch.types ? { weather: [], timeStart: undefined, timeEnd: undefined, timeWindows: [], minTris: undefined, maxTris: undefined, mapTypes: [], modelFormats: [], tags: [] } : {}),
      ...patch
    });
  };
  const clearFilters = (): void => {
    setScope("catalog");
    setSavedId("");
    setSelectionMode(false);
    update(normalizePublicQuery(provider, {}));
  };
  const canDownload = (hit: PublicAssetSummary): boolean => {
    if (provider === "blenderkit") return blenderkit.hasKey && hit.attributes.canDownload !== false;
    return true;
  };
  const downloadReason = (hit: PublicAssetSummary): string => {
    if (provider !== "blenderkit") return "";
    if (!blenderkit.hasKey) return "Add a BlenderKit API key in Settings to download.";
    if (hit.attributes.canDownload === false) return "BlenderKit account or plan required; OpenBridge does not purchase assets.";
    return "";
  };
  const quickDownload = async (hit: PublicAssetSummary): Promise<void> => {
    if (!canDownload(hit)) { toast(downloadReason(hit), true); return; }
    if (provider === "openhdri" && !window.confirm("Download the published original EXR? OpenHDRI currently serves 16K files that can exceed 1 GB.")) return;
    try {
      await window.openbridge.downloads.start(hit.id, undefined, provider);
      toast(`Queued ${hit.name}`);
    } catch (error) { toast(String(error), true); }
  };
  const selectAllFiltered = async (): Promise<void> => {
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      const ids = await window.openbridge.public.ids(state.query);
      setSelected(ids);
      setSelectionMode(true);
      toast(`Selected ${ids.length.toLocaleString()} asset${ids.length === 1 ? "" : "s"}`);
    } catch (error) { toast(String(error), true); }
    finally { setSelectingAll(false); }
  };
  const downloadSelected = async (): Promise<void> => {
    if (!selected.length) return;
    if (provider === "blenderkit" && !blenderkit.hasKey) {
      toast("Add a BlenderKit API key in Settings before downloading.", true);
      return;
    }
    const loaded = new Map(state.hits.map(hit => [hit.id, hit]));
    let skipped = 0;
    const ids = selected.filter(id => {
      if (localIds.has(publicJobId(provider, id))) { skipped += 1; return false; }
      const hit = loaded.get(id);
      if (hit && !canDownload(hit)) { skipped += 1; return false; }
      return true;
    });
    if (!ids.length) { toast("All selected assets are already downloaded or require an account/plan."); return; }
    if (provider === "openhdri" && !window.confirm(`Queue ${ids.length.toLocaleString()} OpenHDRI downloads? These are 16K EXRs and can use many gigabytes.`)) return;
    if (ids.length > 100 && !window.confirm(`Queue ${ids.length.toLocaleString()} ${publicProviderLabel(provider)} downloads? This can use a lot of disk space and time.`)) return;
    setBulkBusy(true);
    try {
      const result = await window.openbridge.downloads.startMany(ids, undefined, provider);
      toast(`Queued ${result.queued}${result.skipped + skipped > 0 ? `; skipped ${result.skipped + skipped}` : ""}`);
      if (result.queued > 0) { setSelected([]); setSelectionMode(false); }
    } catch (error) { toast(String(error), true); }
    finally { setBulkBusy(false); }
  };
  const refresh = async (): Promise<void> => {
    try {
      const status = await window.openbridge.public.refresh(provider);
      if (status.state === "error") toast(status.error ?? "Catalogue refresh failed", true);
      else { await usePublicStore.getState().init(provider); toast(provider === "blenderkit" ? "Categories refreshed" : "Catalogue refreshed"); }
    } catch (error) { toast(String(error), true); }
  };

  const groups = facetGroupsFor(state, provider, isHdri).map(group => ({
    ...group,
    toggle: (value: string) => { setSavedId(""); group.toggle(value); }
  }));
  const sizeFilter = sizeFilterFor(state.query);
  const resultLabel = state.loading
    ? state.hits.length === 0
      ? "Searching…"
      : `${assetCountLabel(state.total)} · updating…`
    : assetCountLabel(state.total);
  const catalogRefreshing = state.status?.state === "refreshing";
  const hasQuery = Boolean(
    state.query.query || state.query.types?.length || state.query.categoryPaths?.length ||
    state.query.licenses?.length || state.query.resolutions?.length || state.query.mapTypes?.length ||
    state.query.modelFormats?.length || state.query.weather?.length || state.query.freeOnly ||
    state.query.minResolution || state.query.maxTris || sizeFilter !== "any" || activeCount > 0 || scope !== "catalog"
  );
  const indexing = catalogRefreshing && state.hits.length === 0;
  const needsIndex = provider !== "blenderkit" && !state.loading && state.hits.length === 0 && !state.error && state.status?.state !== "error" &&
    (state.status?.state === "empty" || !state.status?.count);

  return <div className="view public-provider-view" ref={scrollRef}>
    <div className="public-provider-head">
      <h2>{publicProviderLabel(provider)} <span className="public-count">· {resultLabel}</span></h2>
      <div className="public-provider-head-actions">
        <button type="button" className="text-btn" disabled={catalogRefreshing} onClick={() => void refresh()}>
          {catalogRefreshing ? "Refreshing…" : provider === "blenderkit" ? "Refresh categories" : "Refresh catalogue"}
        </button>
        <button type="button" className="text-btn" onClick={() => setSelectionMode(!selectionMode)}>{selectionMode ? "Done" : "Select"}</button>
      </div>
    </div>
    {provider === "blenderkit" && <p className="hint">
      Online catalogue. Licences and download access are separate. Counts may be capped by the provider.
      {!blenderkit.hasKey && <> <button type="button" className="text-btn" onClick={() => useStore.getState().setView("settings")}>Add an API key</button> to download.</>}
    </p>}
    {provider === "openhdri" && <p className="hint">OpenHDRI publishes 16K EXRs only. Live HDR exposure is disabled because 16K exceeds the safe 8K preview budget for most systems. The 4K panorama preview remains available; download the original EXR for your DCC.</p>}

    <div className="public-provider-controls">
      <div className="public-provider-row">
        <label className="public-field"><span>Browse</span><select className="native-select" aria-label="Public catalogue scope" value={scope} onChange={event => { setSelected([]); setScope(event.target.value as typeof scope); }}><option value="catalog">Catalogue</option><option value="favorites">Favorites</option><option value="downloaded">Downloaded</option></select></label>
        <label className="public-field"><span>Asset type</span><select className="native-select" aria-label="Asset type" value={state.query.types?.length === 1 ? state.query.types[0] : state.query.types && state.query.types.length > 1 ? "__mixed" : ""} onChange={event => update({ types: event.target.value && event.target.value !== "__mixed" ? [event.target.value] : [], categoryPaths: [] })}><option value="">All types</option>{state.query.types && state.query.types.length > 1 && <option value="__mixed">{state.query.types.map(type => publicTypeLabel(provider, type)).join(" + ")}</option>}{[...new Set([...typeOptionsFor(provider), ...(state.facets?.types ?? []).map(bucket => bucket.value), ...(state.query.types ?? [])])].map(type => <option key={type} value={type}>{publicTypeLabel(provider, type)}</option>)}</select></label>
        <label className="public-field"><span>Sort</span><select className="native-select" aria-label="Sort public catalogue" value={state.query.sort ?? "relevance"} onChange={event => update({ sort: event.target.value as PublicCatalogQuery["sort"] })}>
          <option value="relevance">Relevance</option><option value="newest">Newest</option><option value="oldest">Oldest</option>
          {provider !== "blenderkit" && <><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="type">Asset type</option><option value="resolution">Highest resolution</option><option value="downloads">Most downloaded</option><option value="maps">Most texture maps</option>{!isHdri && <option value="size">Largest physical size</option>}</>}
        </select></label>
        {!isHdri && provider !== "blenderkit" && <label className="public-field"><span>Physical size</span><select className="native-select" aria-label="Physical size" value={sizeFilter} onChange={event => {
          const value = event.target.value as SizeFilter, bounds = sizeBounds(value);
          update({ minSize: bounds.minSize ?? undefined, maxSize: bounds.maxSize ?? undefined });
        }}><option value="any">Any size</option>{SIZE_VALUES.map(value => <option key={value} value={value}>{SIZE_FILTER_LABELS[value]}</option>)}</select></label>}
        <label className="public-check"><input type="checkbox" checked={Boolean(state.query.freeOnly)} onChange={event => update({ freeOnly: event.target.checked })} /> Free licence</label>
        <button type="button" className={filtersOpen ? "filter-action active" : "filter-action"} aria-expanded={filtersOpen} aria-controls="public-filter-panel" onClick={() => setFiltersOpen(value => !value)}>
          Filters{activeCount > 0 && <span className="filter-count">{activeCount}</span>}
        </button>
      </div>
      {provider === "blenderkit" && <div className="public-provider-row">
        <label className="public-field"><span>Minimum native resolution</span><select className="native-select" aria-label="Minimum native resolution" value={state.query.minResolution ?? ""} onChange={event => update({ minResolution: event.target.value ? Number(event.target.value) : undefined })}><option value="">Any</option>{[1024,2048,4096,8192].map(value => <option key={value} value={value}>{value / 1024}K or higher</option>)}</select></label>
        {state.query.types?.includes("model") && <label className="public-field"><span>Maximum polygons</span><select className="native-select" aria-label="Maximum model polygons" value={state.query.maxTris ?? ""} onChange={event => update({ maxTris: event.target.value ? Number(event.target.value) : undefined })}><option value="">Any</option>{[1000,10000,50000,100000].map(value => <option key={value} value={value}>{value.toLocaleString()}</option>)}</select></label>}
      </div>}
      <div className="public-browse-tools">
        <details className="public-saved-searches">
          <summary>Saved searches{state.savedSearches.length > 0 && <span> ({state.savedSearches.length})</span>}</summary>
          <div className="public-saved-row">
        <label className="public-field"><span>Saved search</span><select className="native-select" aria-label="Public saved searches" value={savedId} onChange={event => {
          const id = event.target.value; setSavedId(id);
          const saved = state.savedSearches.find(item => item.id === id);
          if (saved) {
            setScope(saved.scope);
            const ids = saved.scope === "favorites"
              ? favorites.filter(key => key.startsWith(`${provider}:`)).map(key => key.slice(provider.length + 1))
              : saved.scope === "downloaded"
                ? localRefs.filter(ref => ref.id.startsWith(`${provider}:`)).map(ref => ref.id.slice(provider.length + 1))
                : undefined;
            setSelected([]);
            void search(provider, true, { ...saved.query, ids });
          }
        }}><option value="">Choose saved search</option>{state.savedSearches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="public-field"><span>Save current search as</span><input aria-label="Save public search as" placeholder="Search name" value={savedName} onChange={event => setSavedName(event.target.value)} /></label>
        <button type="button" className="btn btn-ghost" disabled={!savedName.trim()} onClick={() => { usePublicStore.getState().saveSearch(provider, savedName, scope); setSavedName(""); toast("Search saved"); }}>Save search</button>
        {savedId && <button type="button" className="text-btn" onClick={() => { usePublicStore.getState().removeSavedSearch(provider, savedId); setSavedId(""); }}>Remove saved</button>}
          </div>
        </details>
        <button type="button" className="text-btn" onClick={() => { setListView(value => !value); writePreference("publicListView", !listView); }}>{listView ? "Grid view" : "List / compare"}</button>
        <DensityControl />
        {hasQuery && <button type="button" className="text-btn public-clear" onClick={clearFilters}>Clear search and filters</button>}
      </div>
    </div>

    {filtersOpen && <section className="facet-panel" id="public-filter-panel" aria-label={`${publicProviderLabel(provider)} filters`}>
      <div className="facet-panel-head">
        <div className="facet-panel-heading"><strong>Refine {publicProviderLabel(provider)}</strong><span>{state.facets?.sampleFacets ? "Facet options are sampled from loaded results, not global counts." : "Filters apply instantly"}</span></div>
        <div className="facet-panel-actions">
          <button type="button" className="text-btn" onClick={clearFilters} disabled={activeCount === 0}>Clear filters</button>
          <button type="button" className="icon-btn" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><CloseIcon /></button>
        </div>
      </div>
      {groups.length === 0 ? <p className="hint">No filters are available for this selection.</p> : <FilterWorkbench groups={groups} showCounts={!state.facets?.sampleFacets} />}
    </section>}

    {activeCount > 0 && <div className="active-filters" aria-label="Active filters">
      {groups.flatMap(group => group.selected.map(value => <button type="button" key={`${group.key}:${value}`} className="facet-chip active" onClick={() => toggleFacet(provider, groupKeyToField(group.key), value)}><span>{group.label.replace(/ \(sample\)$/, "")}</span><strong>{group.labels?.[value] ?? facetLabel(provider, groupKeyToField(group.key), value)}</strong><em aria-hidden="true">×</em></button>))}
      {state.query.freeOnly && <button type="button" className="facet-chip active" onClick={() => update({ freeOnly: false })}><span>Licence</span><strong>Free only</strong><em aria-hidden="true">×</em></button>}
      {sizeFilter !== "any" && <button type="button" className="facet-chip active" onClick={() => update({ minSize: undefined, maxSize: undefined })}><span>Size</span><strong>{SIZE_FILTER_LABELS[sizeFilter]}</strong><em aria-hidden="true">×</em></button>}
      {state.query.minResolution !== undefined && <button type="button" className="facet-chip active" onClick={() => update({ minResolution: undefined })}><span>Native resolution</span><strong>{state.query.minResolution / 1024}K+</strong><em aria-hidden="true">×</em></button>}
      {state.query.maxTris !== undefined && <button type="button" className="facet-chip active" onClick={() => update({ maxTris: undefined })}><span>Polygons</span><strong>≤ {state.query.maxTris.toLocaleString()}</strong><em aria-hidden="true">×</em></button>}
      {state.query.timeStart !== undefined && state.query.timeEnd !== undefined && <button type="button" className="facet-chip active" onClick={() => update({ timeStart: undefined, timeEnd: undefined })}><span>Time</span><strong>{String(state.query.timeStart).padStart(2, "0")}:00–{String(state.query.timeEnd).padStart(2, "0")}:00</strong><em aria-hidden="true">×</em></button>}
      {state.query.timeWindows?.map((window, index) => <button type="button" key={`${window.start}:${window.end}:${index}`} className="facet-chip active" onClick={() => update({ timeWindows: state.query.timeWindows!.filter((_, position) => position !== index) })}><span>Time window</span><strong>{String(window.start).padStart(2, "0")}:00–{String(window.end).padStart(2, "0")}:00</strong><em aria-hidden="true">×</em></button>)}
      {state.query.tags?.map(tag => <button type="button" key={`tag:${tag}`} className="facet-chip active" onClick={() => update({ tags: state.query.tags!.filter(value => value !== tag) })}><span>Tag</span><strong>{tag}</strong><em aria-hidden="true">×</em></button>)}
      {state.query.minBytes !== undefined && <button type="button" className="facet-chip active" onClick={() => update({ minBytes: undefined })}><span>File size</span><strong>≥ {(state.query.minBytes / 1048576).toFixed(1)} MB</strong><em aria-hidden="true">×</em></button>}
      {state.query.maxBytes !== undefined && <button type="button" className="facet-chip active" onClick={() => update({ maxBytes: undefined })}><span>File size</span><strong>≤ {(state.query.maxBytes / 1048576).toFixed(1)} MB</strong><em aria-hidden="true">×</em></button>}
      <button type="button" className="text-btn" onClick={clearFilters}>Clear filters</button>
    </div>}

    {isHdri && <div className="public-provider-controls">
      <div className="public-provider-row">{groups.some(group => group.key === "weather") && <span className="hint">Use Filters → Sky condition for clear, cloudy, fog and rain.</span>}</div>
      <TimeOfDaySlider value={state.query.timeStart !== undefined && state.query.timeEnd !== undefined ? { start: state.query.timeStart, end: state.query.timeEnd } : null} onChange={range => update({ timeStart: range?.start, timeEnd: range?.end, timeWindows: [] })} />
      <p className="hint">Sky and time classifications use provider metadata, not image analysis.</p>
    </div>}

    {selectionMode && <div className="bulk-bar">
      <div className="bulk-scope">
        <span className="bulk-count" aria-live="polite">{selected.length} selected</span>
        <span className="bulk-scope-detail">{downloadedCount} loaded asset{downloadedCount === 1 ? " is" : "s are"} already downloaded. Bulk downloads use 2K or the first published tier; adjust individual assets in their drawer.</span>
      </div>
      <div className="bulk-actions">
        <button type="button" className="text-btn" onClick={() => setSelected(state.hits.map(hit => hit.id))}>Select loaded</button>
        <button type="button" className="text-btn" disabled={selectingAll || state.total === 0} onClick={() => void selectAllFiltered()}>{selectingAll ? "Selecting…" : `Select all ${state.total.toLocaleString()}`}</button>
        <button type="button" className="btn btn-primary" disabled={bulkBusy || selected.length === 0} onClick={() => void downloadSelected()}>Download selected</button>
        <button type="button" className="btn btn-ghost" disabled={bulkBusy || selected.length === 0} onClick={() => setSelected([])}>Clear</button>
        <button type="button" className="text-btn" onClick={() => { setSelectionMode(false); setSelected([]); }}>Done</button>
      </div>
    </div>}

    {state.error && <div className="error-box" role="alert">{state.error}<button type="button" className="text-btn" onClick={() => void search(provider)}>Retry</button></div>}
    {!state.error && state.status?.state === "error" && state.hits.length === 0 && <div className="error-box" role="alert">{state.status.error ?? "Catalogue unavailable"}<button type="button" className="text-btn" onClick={() => void refresh()}>Retry</button></div>}
    {state.status?.state === "error" && state.hits.length > 0 && <p className="hint" role="status">Showing the cached catalogue. Refresh failed: {state.status.error}</p>}

    {indexing && <div className="poliigon-indexing" role="status"><span className="spinner" /><div><strong>Indexing {publicProviderLabel(provider)}…</strong><p>Building the local search index. Cached results remain available if previously downloaded.</p></div></div>}
    {needsIndex && !indexing && <div className="empty"><h2>{publicProviderLabel(provider)} catalogue is not indexed</h2><p>Refresh to build the local catalogue before searching. This is required only once and then refreshes in the background.</p><button type="button" className="btn btn-primary" disabled={catalogRefreshing} onClick={() => void refresh()}>{catalogRefreshing ? "Indexing…" : `Index ${publicProviderLabel(provider)} catalogue`}</button></div>}

    {listView ? <AssetList items={state.hits.map(hit => ({
      key: hit.id, id: publicJobId(provider, hit.id), name: hit.name, type: hit.typeLabel, image: publicCardThumbnail(hit, 512),
      crop: hit.provider === "openhdri" ? "top-2-1" : undefined,
      direct: hit.provider === "ambientcg" && /^(hdri|hdri-element)$/i.test(hit.type),
      technical: publicTechnical(hit), dimensions: hit.dimensions,
      resolution: hit.maxResolution ? `${Math.round(hit.maxResolution / 1024)}K` : null,
      status: localIds.has(publicJobId(provider, hit.id)) ? "Downloaded" : hit.provider === "blenderkit" && hit.attributes.canDownload === false ? "Account required" : hit.free ? "Free" : "Plan required",
      category: hit.category, facts: [hit.license, ...publicProviderFacts(hit)].slice(0, 6), onOpen: () => open(hit)
    }))} selectedKeys={new Set(selected)} onToggle={id => toggle(id)} totalSelected={selected.length} /> : <VirtualGrid items={state.hits} itemKey={hit => hit.id} minItemWidth={density === "compact" ? 160 : density === "large" ? 320 : 220} aspectRatio={isHdri ? 2 : 1} renderItem={hit => <PublicCard hit={hit} wide={isHdri} selected={selected.includes(hit.id)} selectionMode={selectionMode} onSelect={event => toggle(hit.id, event.shiftKey)} onOpen={() => open(hit)} onDownload={canDownload(hit) ? () => void quickDownload(hit) : undefined} downloadReason={downloadReason(hit)} />} />}

    {state.loading && state.hits.length === 0 && !indexing && <div className="asset-grid" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <div className="asset-card skeleton" key={index}><div className="asset-thumb" /><div className="asset-meta"><span className="skeleton-line" /><span className="skeleton-line short" /></div></div>)}</div>}
    {!state.loading && !state.hits.length && !state.error && !needsIndex && <div className="empty"><h2>No assets found</h2><p>{hasQuery ? "Try a different search or clear the filters." : "This provider returned no assets."}</p>{hasQuery && <button type="button" className="btn btn-primary" onClick={clearFilters}>Clear search and filters</button>}</div>}
    {state.hasMore && <LoadMore loading={state.loading} remaining={Math.max(0, state.total - state.hits.length)} onLoad={() => void search(provider, false)} />}
  </div>;
}

function groupKeyToField(key: string): FacetField {
  return key.replace(/ \(sample\)$/, "").replace(/^public:/, "") as FacetField;
}

function facetGroupsFor(state: ReturnType<typeof usePublicStore.getState>["providers"][PublicProviderId], provider: PublicProviderId, isHdri: boolean): FilterGroup[] {
  const groups: FilterGroup[] = [];
  const add = (field: FacetField, label: string, buckets: Array<{ value: string; count: number }>, labels?: Record<string, string>, compare?: (a: string, b: string) => number) => {
    const selected = state.query[field] ?? [];
    const values: Record<string, number> = Object.fromEntries(buckets.map(bucket => [bucket.value, bucket.count]));
    for (const value of selected) values[value] ??= 0;
    if (buckets.length === 0 && selected.length === 0) return;
    groups.push({
      key: field,
      label: state.facets?.sampleFacets ? `${label} (sample)` : label,
      values,
      selected,
      toggle: value => usePublicStore.getState().toggleFacet(provider, field, value),
      ...(labels ? { labels } : {}),
      ...(compare ? { compare } : {})
    });
  };
  if (isHdri) add("weather", "Sky condition", [...(state.facets?.weather ?? [])].sort((a, b) => skyConditionRank(a.value) - skyConditionRank(b.value)), Object.fromEntries((state.facets?.weather ?? []).map(bucket => [bucket.value, skyConditionLabel(bucket.value)])), (a, b) => skyConditionRank(a) - skyConditionRank(b));
  add("licenses", "Licence", state.facets?.licenses ?? []);
  if (provider !== "blenderkit") {
    add("resolutions", "Resolution", state.facets?.resolutions ?? [], Object.fromEntries((state.facets?.resolutions ?? []).map(bucket => [bucket.value, bucket.value.toUpperCase()])), (a, b) => resolutionFacetValue(a) - resolutionFacetValue(b));
    add("mapTypes", "Texture maps", state.facets?.mapTypes ?? [], Object.fromEntries((state.facets?.mapTypes ?? []).map(bucket => [bucket.value, facetLabel(provider, "mapTypes", bucket.value)])));
    add("modelFormats", "Model format", state.facets?.modelFormats ?? [], Object.fromEntries((state.facets?.modelFormats ?? []).map(bucket => [bucket.value, bucket.value.toUpperCase()])));
  }
  return groups;
}

export function PublicSearch({ provider }: { provider: PublicProviderId }) {
  const query = usePublicStore(state => state.providers[provider].query.query ?? "");
  const recent = usePublicStore(state => state.providers[provider].recentSearches);
  const [draft, setDraft] = useState(query);
  const [focused, setFocused] = useState(false);
  useEffect(() => setDraft(query), [query, provider]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft !== usePublicStore.getState().providers[provider].query.query) {
        void usePublicStore.getState().search(provider, true, { query: draft });
      }
    }, 140);
    return () => clearTimeout(timer);
  }, [draft, provider]);
  const submit = (value: string): void => {
    setDraft(value);
    usePublicStore.getState().rememberSearch(provider, value);
    void usePublicStore.getState().search(provider, true, { query: value });
    setFocused(false);
  };
  return <div className="scoped-search poliigon-search">
    <div className="search-scope" role="group" aria-label="Search scope">
      <button type="button" className="active" aria-pressed="true" onClick={() => useStore.getState().setView("discover")}>Catalogue</button>
      <button type="button" aria-pressed="false" onClick={() => { const state = useStore.getState(); state.setLocalProvider(provider); state.setView("library"); }}>Library</button>
    </div>
    <div className="search-wrap catalog-search">
      <SearchIcon className="search-icon" />
      <input
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); submit(draft); }
        }}
        placeholder={`Search ${publicProviderLabel(provider)}…`}
        spellCheck={false}
        maxLength={256}
        aria-label={`Search ${publicProviderLabel(provider)}`}
      />
      {draft && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => { setDraft(""); void usePublicStore.getState().search(provider, true, { query: "" }); }}><CloseIcon /></button>}
      {focused && !draft && recent.length > 0 && <div className="poliigon-recent-searches">
        <div className="poliigon-recent-head"><strong>Recent searches</strong><button type="button" className="text-btn" onMouseDown={event => event.preventDefault()} onClick={() => usePublicStore.getState().clearRecent(provider)}>Clear</button></div>
        {recent.map(item => <button type="button" key={item} onMouseDown={event => event.preventDefault()} onClick={() => submit(item)}>{item}</button>)}
      </div>}
    </div>
  </div>;
}
