import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { PoliigonAssetSummary, PoliigonSort } from "../../shared/types";
import { Dropdown } from "../components/Dropdown";
import { LoadMore } from "../components/LoadMore";
import { PoliigonCard } from "../components/PoliigonCard";
import { VirtualGrid } from "../components/VirtualGrid";
import { AssetList } from "../components/AssetList";
import { ChevronDownIcon, CloseIcon, UserIcon } from "../icons";
import { TimeOfDaySlider } from "../components/TimeOfDaySlider";
import { FilterWorkbench, type FilterGroup } from "../components/BrowsingTools";
import { formatClockValue } from "../../shared/hdri-time";
import { SIZE_FILTER_OPTIONS, sizeBounds, sizeFilterFromBounds, type SizeFilter } from "../size-filter";
import { assetCountLabel, sortBucketsBy, sortResolutionBuckets, resolutionFacetValue } from "../catalog-utils";
import { assetTypeLabel } from "../asset-visuals";
import { poliigonMapName, poliigonMapRank } from "../poliigon-labels";
import { usePoliigonStore } from "../poliigon-store";
import { poliigonTechnical } from "../poliigon-technical";
import { useStore } from "../store";

const TYPES = [
  { value: "", label: "All Types" },
  { value: "Textures", label: "Textures" },
  { value: "Models", label: "Models" },
  { value: "HDRS", label: "HDRIs" }
];

const SORTS: Array<{ value: PoliigonSort; label: string }> = [
  { value: "relevance", label: "Sort: Relevance" },
  { value: "newest", label: "Sort: Newest" },
  { value: "oldest", label: "Sort: Oldest" },
  { value: "name", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "resolution", label: "Resolution · highest" },
  { value: "triangles", label: "Triangles · most" },
  { value: "maps", label: "Texture maps · most" },
  { value: "lods", label: "LODs · most" },
  { value: "size", label: "Physical size · largest" },
  { value: "credit", label: "Credits · free first" }
];

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function bucketRecord(buckets: Array<{ value: string; count: number }> | undefined): Record<string, number> {
  return Object.fromEntries((buckets ?? []).map(bucket => [bucket.value, bucket.count]));
}

export function PoliigonView() {
  const status = usePoliigonStore(state => state.status);
  const categories = usePoliigonStore(state => state.categories);
  const query = usePoliigonStore(state => state.query);
  const type = usePoliigonStore(state => state.type);
  const categoryIds = usePoliigonStore(state => state.categoryIds);
  const freeOnly = usePoliigonStore(state => state.freeOnly);
  const resolutions = usePoliigonStore(state => state.resolutions);
  const creationMethods = usePoliigonStore(state => state.creationMethods);
  const mapTypes = usePoliigonStore(state => state.mapTypes);
  const minSize = usePoliigonStore(state => state.minSize);
  const maxSize = usePoliigonStore(state => state.maxSize);
  const setSizeRange = usePoliigonStore(state => state.setSizeRange);
  const timeStart = usePoliigonStore(state => state.timeStart);
  const timeEnd = usePoliigonStore(state => state.timeEnd);
  const setTimeRange = usePoliigonStore(state => state.setTimeRange);
  const sort = usePoliigonStore(state => state.sort);
  const hits = usePoliigonStore(state => state.hits);
  const total = usePoliigonStore(state => state.total);
  const facets = usePoliigonStore(state => state.facets);
  const loading = usePoliigonStore(state => state.loading);
  const error = usePoliigonStore(state => state.error);
  const hasMore = usePoliigonStore(state => state.hasMore);
  const selection = usePoliigonStore(state => state.selection);
  const auth = usePoliigonStore(state => state.auth);
  const owned = usePoliigonStore(state => state.owned);
  const favorites = usePoliigonStore(state => state.favorites);
  const favoritesOnly = usePoliigonStore(state => state.favoritesOnly);
  const downloadedOnly = usePoliigonStore(state => state.downloadedOnly);
  const localById = usePoliigonStore(state => state.localById);
  const openLogin = usePoliigonStore(state => state.openLogin);
  const toggleFavorite = usePoliigonStore(state => state.toggleFavorite);
  const setFavoritesOnly = usePoliigonStore(state => state.setFavoritesOnly);
  const setDownloadedOnly = usePoliigonStore(state => state.setDownloadedOnly);
  const selectAllIds = usePoliigonStore(state => state.selectAllIds);
  const setType = usePoliigonStore(state => state.setType);
  const setFreeOnly = usePoliigonStore(state => state.setFreeOnly);
  const setSort = usePoliigonStore(state => state.setSort);
  const setCategoryIds = usePoliigonStore(state => state.setCategoryIds);
  const toggleResolution = usePoliigonStore(state => state.toggleResolution);
  const toggleCreationMethod = usePoliigonStore(state => state.toggleCreationMethod);
  const toggleMapType = usePoliigonStore(state => state.toggleMapType);
  const clearFilters = usePoliigonStore(state => state.clearFilters);
  const refresh = usePoliigonStore(state => state.refresh);
  const loadMore = usePoliigonStore(state => state.loadMore);
  const openAsset = usePoliigonStore(state => state.openAsset);
  const density = useStore(state => state.density);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listView, setListView] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const anchorIndex = useRef<number | null>(null);
  const ownedSet = useMemo(() => new Set(owned), [owned]);
  const downloadedCount = Object.keys(localById).length;

  const selectedCategoryLabel = useMemo(() => {
    if (categoryIds.length === 0) return "";
    const target = String(categoryIds[0]);
    const walk = (nodes: typeof categories, trail: string[]): string[] | null => {
      for (const node of nodes) {
        const next = [...trail, node.label];
        if (node.key === target) return next;
        const found = walk(node.children, next);
        if (found) return found;
      }
      return null;
    };
    return (walk(categories, []) ?? []).join(" / ");
  }, [categories, categoryIds]);

  const activeCount =
    (categoryIds.length > 0 ? 1 : 0) +
    (freeOnly ? 1 : 0) +
    (favoritesOnly ? 1 : 0) +
    (downloadedOnly ? 1 : 0) +
    resolutions.length +
    creationMethods.length +
    mapTypes.length +
    (minSize != null || maxSize != null ? 1 : 0) +
    (type === "HDRS" && timeStart != null && timeEnd != null ? 1 : 0);

  const isHdri = type === "HDRS";
  const sizeValue = sizeFilterFromBounds(minSize, maxSize);
  const showSize = !isHdri;
  const setSizePreset = (value: string): void => {
    const bounds = sizeBounds(value as SizeFilter);
    setSizeRange(bounds.minSize, bounds.maxSize);
  };
  const sortOptions = useMemo(
    () => SORTS.filter(option => {
      if (option.value === "size") return !isHdri;
      if (isHdri) return !["triangles", "maps", "lods"].includes(option.value);
      if (type === "Textures") return !["triangles", "lods"].includes(option.value);
      return true;
    }),
    [isHdri, type]
  );

  useEffect(() => {
    if (!sortOptions.some(option => option.value === sort)) setSort("relevance");
  }, [sort, sortOptions, setSort]);
  useEffect(() => {
    if (isHdri && (minSize != null || maxSize != null)) setSizeRange(null, null);
  }, [isHdri, minSize, maxSize, setSizeRange]);

  const filterGroups = useMemo<FilterGroup[]>(() => {
    const groups: FilterGroup[] = [];
    const resolutionFacet = facets?.resolutions ?? [];
    if (resolutionFacet.length > 0 || resolutions.length > 0) {
      groups.push({
        key: "resolution",
        label: "Resolution",
        values: bucketRecord(sortResolutionBuckets(resolutionFacet)),
        selected: resolutions,
        toggle: toggleResolution,
        compare: (a, b) => resolutionFacetValue(a) - resolutionFacetValue(b)
      });
    }
    if (!isHdri) {
      const methodFacet = facets?.creationMethods ?? [];
      if (methodFacet.length > 0 || creationMethods.length > 0) {
        groups.push({
          key: "creation",
          label: "Creation method",
          values: bucketRecord(methodFacet),
          selected: creationMethods,
          toggle: toggleCreationMethod,
          labels: Object.fromEntries(methodFacet.map(bucket => [bucket.value, titleCase(bucket.value)]))
        });
      }
      const mapFacet = sortBucketsBy(facets?.mapTypes ?? [], poliigonMapRank);
      if (mapFacet.length > 0 || mapTypes.length > 0) {
        groups.push({
          key: "maps",
          label: "Texture maps",
          values: bucketRecord(mapFacet),
          selected: mapTypes,
          toggle: toggleMapType,
          labels: Object.fromEntries(mapFacet.map(bucket => [bucket.value, poliigonMapName(bucket.value)])),
          compare: (a, b) => poliigonMapRank(a) - poliigonMapRank(b)
        });
      }
    }
    return groups;
  }, [
    facets,
    isHdri,
    resolutions,
    creationMethods,
    mapTypes,
    toggleResolution,
    toggleCreationMethod,
    toggleMapType
  ]);

  const ready = status?.state === "ready";
  const indexing = status?.state === "refreshing" || (!ready && loading);
  const empty = !ready && !indexing && status?.state !== "error";

  useEffect(() => {
    setSelectedIds(new Set());
    anchorIndex.current = null;
  }, [query, type, categoryIds, freeOnly, favoritesOnly, downloadedOnly, resolutions, creationMethods, mapTypes, sort]);

  useEffect(() => {
    if (filterGroups.length === 0 && activeCount === 0 && filtersOpen) setFiltersOpen(false);
  }, [filterGroups.length, activeCount, filtersOpen]);

  const selectHit = (
    hit: (typeof hits)[number],
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>
  ): void => {
    const index = hits.findIndex(item => item.id === hit.id);
    if (index < 0) return;
    setSelectedIds(current => {
      const next = new Set(current);
      if (event.shiftKey && anchorIndex.current !== null) {
        const start = Math.min(anchorIndex.current, index);
        const end = Math.max(anchorIndex.current, index);
        for (let position = start; position <= end; position += 1) {
          const item = hits[position];
          if (item) next.add(item.id);
        }
      } else {
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        anchorIndex.current = index;
      }
      return next;
    });
  };

  const selectLoaded = (): void => {
    setSelectedIds(new Set(hits.map(hit => hit.id)));
  };

  const selectAllFiltered = async (): Promise<void> => {
    setBulkBusy(true);
    try {
      const ids = await selectAllIds();
      setSelectedIds(new Set(ids));
      useStore.getState().toast(`Selected ${ids.length.toLocaleString()} Poliigon asset(s)`);
    } catch (error) {
      useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBulkBusy(false);
    }
  };

  const quickDownload = async (hit: PoliigonAssetSummary): Promise<void> => {
    try {
      await window.openbridge.downloads.start(
        `poliigon:${hit.id}`,
        {
          resolution: "2K",
          maps: [],
          lods: [],
          nativeMesh: true,
          renderer: "Cycles",
          software: "Blender"
        },
        "poliigon"
      );
      useStore.getState().toast(`Queued ${hit.name}`);
    } catch (error) {
      useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
    }
  };

  const downloadSelected = async (): Promise<void> => {
    if (!auth.loggedIn) {
      openLogin();
      return;
    }
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const result = await window.openbridge.downloads.startMany(
        [...selectedIds].map(id => `poliigon:${id}`),
        {
          resolution: "2K",
          maps: [],
          lods: [],
          nativeMesh: true,
          renderer: "Cycles",
          software: "Blender"
        },
        "poliigon"
      );
      useStore.getState().toast(
        `Queued ${result.queued.toLocaleString()} Poliigon download${result.queued === 1 ? "" : "s"}`
      );
      setSelectedIds(new Set());
      setSelectMode(false);
    } catch (error) {
      useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="view discover poliigon-view">
      <div className="view-header discover-toolbar">
        <div className="filter-row catalog-toolbar">
          <Dropdown
            className="filter-select"
            value={type}
            onChange={setType}
            ariaLabel="Filter by Poliigon asset type"
            options={TYPES}
          />
          <Dropdown
            className="filter-select"
            value={sort}
            onChange={value => setSort(value as PoliigonSort)}
            ariaLabel="Sort Poliigon assets"
            options={sortOptions}
          />
          {showSize && (
            <Dropdown
              className="filter-select"
              value={sizeValue}
              onChange={setSizePreset}
              ariaLabel="Filter Poliigon assets by physical size"
              options={SIZE_FILTER_OPTIONS}
            />
          )}          <button
            type="button"
            className={freeOnly ? "filter-action active" : "filter-action"}
            aria-pressed={freeOnly}
            onClick={() => setFreeOnly(!freeOnly)}
          >
            Free only
          </button>
          <button
            type="button"
            className={favoritesOnly ? "filter-action active" : "filter-action"}
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly(!favoritesOnly)}
          >
            Favorites
            {favorites.length > 0 && <span className="filter-count">{favorites.length}</span>}
          </button>
          <button
            type="button"
            className={downloadedOnly ? "filter-action active" : "filter-action"}
            aria-pressed={downloadedOnly}
            onClick={() => setDownloadedOnly(!downloadedOnly)}
          >
            Downloaded
            {downloadedCount > 0 && <span className="filter-count">{downloadedCount}</span>}
          </button>
          <button
            type="button"
            className={selectMode ? "filter-action active" : "filter-action"}
            aria-pressed={selectMode}
            onClick={() => {
              setSelectMode(value => !value);
              setSelectedIds(new Set());
            }}
          >
            Select
            {selectedIds.size > 0 && <span className="filter-count">{selectedIds.size}</span>}
          </button>
          {(filterGroups.length > 0 || activeCount > 0) && (
            <button
              type="button"
              className={filtersOpen ? "filter-action active" : "filter-action"}
              aria-expanded={filtersOpen}
              aria-controls="poliigon-filter-panel"
              onClick={() => setFiltersOpen(value => !value)}
            >
              Filters
              {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
              <ChevronDownIcon className={filtersOpen ? "filter-chevron open" : "filter-chevron"} />
            </button>
          )}

          <span className="result-count">
            {indexing
              ? "Indexing Poliigon…"
              : loading && hits.length === 0
                ? "Searching…"
                : assetCountLabel(total)}
          </span>

          <button
            type="button"
            className="btn btn-ghost"
            disabled={status?.state === "refreshing"}
            onClick={() => void refresh()}
            title="Refresh the public Poliigon catalogue"
          >
            {status?.state === "refreshing" ? "Refreshing…" : "Refresh catalogue"}
          </button>
        </div>

        {isHdri && (
          <TimeOfDaySlider
            value={timeStart != null && timeEnd != null ? { start: timeStart, end: timeEnd } : null}
            onChange={value => setTimeRange(value?.start ?? null, value?.end ?? null)}
          />
        )}

        <div className="active-filters" aria-label="Active Poliigon filters">
          {categoryIds.length > 0 && (
            <button type="button" className="facet-chip active" onClick={() => setCategoryIds([])}>
              {selectedCategoryLabel || "Category"} ×
            </button>
          )}
          {freeOnly && (
            <button type="button" className="facet-chip active" onClick={() => setFreeOnly(false)}>
              Free ×
            </button>
          )}
          {favoritesOnly && (
            <button type="button" className="facet-chip active" onClick={() => setFavoritesOnly(false)}>
              Favorites ×
            </button>
          )}
          {downloadedOnly && (
            <button type="button" className="facet-chip active" onClick={() => setDownloadedOnly(false)}>
              Downloaded ×
            </button>
          )}
          {showSize && sizeValue !== "any" && (
            <button type="button" className="facet-chip active" onClick={() => setSizeRange(null, null)}>
              <span>Size</span>
              <strong>{SIZE_FILTER_OPTIONS.find(option => option.value === sizeValue)?.label ?? sizeValue}</strong>
              <em aria-hidden="true">×</em>
            </button>
          )}
          {resolutions.map(value => (
            <button type="button" key={`resolution:${value}`} className="facet-chip active" onClick={() => toggleResolution(value)}>
              <span>Resolution</span>
              <strong>{value}</strong>
              <em aria-hidden="true">×</em>
            </button>
          ))}
          {isHdri && timeStart != null && timeEnd != null && (
            <button type="button" className="facet-chip active" onClick={() => setTimeRange(null, null)}>
              <span>Time</span>
              <strong>{formatClockValue(timeStart)}–{formatClockValue(timeEnd)}</strong>
              <em aria-hidden="true">×</em>
            </button>
          )}
          {!isHdri && creationMethods.map(value => (
            <button type="button" key={`method:${value}`} className="facet-chip active" onClick={() => toggleCreationMethod(value)}>
              <span>Method</span>
              <strong>{titleCase(value)}</strong>
              <em aria-hidden="true">×</em>
            </button>
          ))}
          {!isHdri && mapTypes.map(value => (
            <button type="button" key={`map:${value}`} className="facet-chip active" onClick={() => toggleMapType(value)}>
              <span>Map</span>
              <strong>{titleCase(value)}</strong>
              <em aria-hidden="true">×</em>
            </button>
          ))}
          {activeCount > 0 && (
            <button type="button" className="text-btn" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        {filtersOpen && (
          <section className="facet-panel" id="poliigon-filter-panel" aria-label="Poliigon filters">
            <div className="facet-panel-head">
              <div className="facet-panel-heading">
                <strong>Refine Poliigon</strong>
                <span>Filters apply instantly</span>
              </div>
              <div className="facet-panel-actions">
                <button type="button" className="text-btn" onClick={clearFilters} disabled={activeCount === 0}>
                  Clear filters
                </button>
                <button type="button" className="icon-btn" onClick={() => setFiltersOpen(false)} aria-label="Close filters">
                  <CloseIcon />
                </button>
              </div>
            </div>
            {filterGroups.length === 0 ? (
              <p className="hint">No filters are available for this selection.</p>
            ) : (
              <FilterWorkbench groups={filterGroups} />
            )}
          </section>
        )}

        {selectMode && (
          <div className="bulk-bar">
            <div className="bulk-scope">
              <span className="bulk-count" aria-live="polite">{selectedIds.size} selected</span>
              <span className="bulk-scope-detail">
                Bulk downloads use 2K, all maps and the native Blender mesh. Adjust individual
                assets in their drawer before downloading.
              </span>
            </div>
            <div className="bulk-actions">
              <button type="button" className="text-btn" onClick={selectLoaded}>
                Select loaded
              </button>
              <button
                type="button"
                className="text-btn"
                disabled={bulkBusy || total === 0}
                onClick={() => void selectAllFiltered()}
              >
                {bulkBusy ? "Selecting…" : `Select all ${total.toLocaleString()}`}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={bulkBusy || selectedIds.size === 0}
                onClick={() => void downloadSelected()}
              >
                Download selected
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={bulkBusy || selectedIds.size === 0}
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  setSelectMode(false);
                  setSelectedIds(new Set());
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="view-body discover-body">
        <div className="asset-area">
          {!auth.loggedIn && (
            <div className="login-banner">
              <UserIcon />
              <span>Browse is open to everyone. Sign in to Poliigon to download free and owned assets.</span>
              <button type="button" className="btn btn-primary" onClick={openLogin}>
                Sign in
              </button>
            </div>
          )}

          {error && (
            <div className="error-box" role="alert">
              <span>Could not load the Poliigon catalogue: {error}</span>{" "}
              <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}

          {indexing && (
            <div className="poliigon-indexing" role="status">
              <div className="spinner" />
              <div>
                <strong>Building the Poliigon catalogue index</strong>
                <p>
                  OpenBridge downloads the public catalogue once and indexes it locally. This can take a
                  moment on first run and does not need a Poliigon account.
                </p>
              </div>
            </div>
          )}

          {empty && (
            <div className="empty">
              <h2>Poliigon catalogue is not indexed yet</h2>
              <p>{status?.error ?? "Download the public catalogue to browse Poliigon assets locally."}</p>
              <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
                Index Poliigon catalogue
              </button>
            </div>
          )}

          <div className="asset-heading">
            {query ? "Search results" : categoryIds.length > 0 ? selectedCategoryLabel || "Category" : "Poliigon catalogue"}
          </div>
          {hits.length > 0 && !selectMode && (
            <button
              type="button"
              className="btn btn-ghost view-mode"
              onClick={() => setListView(value => !value)}
            >
              {listView ? "Grid view" : "List / compare view"}
            </button>
          )}

          {hits.length > 0 && listView && !selectMode && (
            <AssetList
              items={hits.map(hit => ({
                key: String(hit.id),
                id: String(hit.id),
                name: hit.name,
                type: assetTypeLabel(hit.typeLabel),
                image: hit.thumbnail,
                technical: poliigonTechnical(hit),
                dimensions: hit.physicalSize,
                resolution: hit.maxResolution ? `${Math.round(hit.maxResolution / 1024)}K` : null,
                category: hit.categories[0],
                facts: [
                  `${hit.mapCodes.length} map${hit.mapCodes.length === 1 ? "" : "s"}`,
                  hit.lodCount > 0 ? `${hit.lodCount} LOD${hit.lodCount === 1 ? "" : "s"}` : null,
                  hit.physicalSize
                ].filter((value): value is string => Boolean(value)),
                status: localById[hit.id]
                  ? "Downloaded"
                  : ownedSet.has(hit.id)
                    ? "Owned"
                    : hit.free
                      ? "Free"
                      : auth.isUnlimited
                        ? "Included"
                        : `${hit.credit} credit${hit.credit === 1 ? "" : "s"}`,
                onOpen: () => {
                  useStore.getState().closeSelection();
                  void openAsset(hit);
                }
              }))}
            />
          )}

          {hits.length > 0 && (!listView || selectMode) && (
            <VirtualGrid
              items={hits}
              itemKey={hit => String(hit.id)}
              minItemWidth={density === "compact" ? 160 : density === "large" ? 320 : 220}
              gap={28}
              aspectRatio={isHdri ? 2 : 1}
              renderItem={hit => (
                <PoliigonCard
                  key={hit.id}
                  hit={hit}
                  owned={ownedSet.has(hit.id)}
                  included={auth.isUnlimited}
                  downloaded={Boolean(localById[hit.id])}
                  favorited={favorites.includes(hit.id)}
                  canDownload={Boolean(
                    !localById[hit.id] &&
                    auth.loggedIn &&
                    (auth.isUnlimited || ownedSet.has(hit.id) || hit.free)
                  )}
                  selectionMode={selectMode}
                  selected={selectedIds.has(hit.id)}
                  wide={isHdri}
                  onSelect={event => selectHit(hit, event)}
                  onToggleFavorite={() => toggleFavorite(hit.id)}
                  onDownload={() => void quickDownload(hit)}
                  onOpen={selected => {
                    useStore.getState().closeSelection();
                    void openAsset(selected);
                  }}
                />
              )}
            />
          )}

          {loading && hits.length === 0 && !indexing && (
            <div className="asset-grid">
              {Array.from({ length: 18 }, (_, index) => (
                <div className="asset-card skeleton" key={index}>
                  <div className="asset-thumb" />
                  <div className="asset-meta">
                    <span className="skeleton-line" />
                    <span className="skeleton-line short" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && ready && hits.length === 0 && (
            <div className="empty">
              <h2>No Poliigon assets found</h2>
              <p>Try a different search or clear the filters.</p>
              {activeCount > 0 || query ? (
                <button type="button" className="btn btn-ghost" onClick={clearFilters}>
                  {query ? "Clear search and filters" : "Clear filters"}
                </button>
              ) : null}
            </div>
          )}

          {hasMore && (
            <LoadMore
              loading={loading}
              remaining={Math.max(0, total - hits.length)}
              onLoad={() => void loadMore()}
            />
          )}

          {selection && <div className="poliigon-selection-spacer" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}
