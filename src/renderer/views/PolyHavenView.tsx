import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { PolyHavenAssetSummary, PolyHavenSort } from "../../shared/types";
import { Dropdown } from "../components/Dropdown";
import { LoadMore } from "../components/LoadMore";
import { PolyHavenCard } from "../components/PolyHavenCard";
import { VirtualGrid } from "../components/VirtualGrid";
import { AssetList } from "../components/AssetList";
import { ChevronDownIcon, CloseIcon } from "../icons";
import { TimeOfDaySlider } from "../components/TimeOfDaySlider";
import { FilterWorkbench, type FilterGroup } from "../components/BrowsingTools";
import { formatClockValue } from "../../shared/hdri-time";
import { SIZE_FILTER_OPTIONS, sizeBounds, sizeFilterFromBounds, type SizeFilter } from "../size-filter";
import { sortBucketsBy, sortResolutionBuckets, resolutionFacetValue } from "../catalog-utils";
import {
  POLYHAVEN_ATTRIBUTE_TYPES,
  polyHavenAttributeLabel,
  polyHavenAttributeValue,
  polyHavenMapLabel,
  polyHavenMapRank,
  polyHavenPrimaryPreview
} from "../../shared/polyhaven";
import { usePolyHavenStore } from "../polyhaven-store";
import { polyHavenTechnical } from "../polyhaven-technical";
import { useStore } from "../store";

const TYPES = [
  { value: "", label: "All Types" },
  { value: "hdris", label: "HDRIs" },
  { value: "textures", label: "Textures" },
  { value: "models", label: "Models" }
];

const SORTS: Array<{ value: PolyHavenSort; label: string }> = [
  { value: "relevance", label: "Sort: Relevance" },
  { value: "newest", label: "Sort: Newest" },
  { value: "oldest", label: "Sort: Oldest" },
  { value: "name", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "resolution", label: "Resolution · highest" },
  { value: "triangles", label: "Triangles · most" },
  { value: "maps", label: "Texture maps · most" },
  { value: "size", label: "Physical size · largest" },
  { value: "downloads", label: "Downloads · most" }
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

function quickOptions(hit: PolyHavenAssetSummary): {
  resolution: string;
  format?: string;
  modelFormat?: string;
  maps?: Array<{ type: string; format?: string }>;
} {
  if (hit.type === "hdris") {
    return {
      resolution: hit.resolutions.includes("2k") ? "2k" : hit.resolutions[0] ?? "2k",
      format: "hdr"
    };
  }
  if (hit.type === "models") {
    return {
      resolution: hit.resolutions.includes("2k") ? "2k" : hit.resolutions[0] ?? "2k",
      modelFormat: hit.modelFormats.includes("gltf") ? "gltf" : hit.modelFormats[0]
    };
  }
  return {
    resolution: hit.resolutions.includes("2k") ? "2k" : hit.resolutions[0] ?? "2k",
    maps: hit.mapCodes
      .filter(code => /diffuse|albedo|col|nor_gl|normal|rough|ao|arm|metal/i.test(code))
      .map(type => ({ type, format: hit.mapFormats.includes("jpg") ? "jpg" : hit.mapFormats[0] }))
  };
}

export function PolyHavenView() {
  const status = usePolyHavenStore(state => state.status);
  const query = usePolyHavenStore(state => state.query);
  const type = usePolyHavenStore(state => state.type);
  const categoryPaths = usePolyHavenStore(state => state.categoryPaths);
  const categoriesFilter = usePolyHavenStore(state => state.categoriesFilter);
  const collections = usePolyHavenStore(state => state.collections);
  const resolutions = usePolyHavenStore(state => state.resolutions);
  const mapTypes = usePolyHavenStore(state => state.mapTypes);
  const attributeFilters = usePolyHavenStore(state => state.attributeFilters);
  const minSize = usePolyHavenStore(state => state.minSize);
  const maxSize = usePolyHavenStore(state => state.maxSize);
  const setSizeRange = usePolyHavenStore(state => state.setSizeRange);
  const timeStart = usePolyHavenStore(state => state.timeStart);
  const timeEnd = usePolyHavenStore(state => state.timeEnd);
  const setTimeRange = usePolyHavenStore(state => state.setTimeRange);
  const sort = usePolyHavenStore(state => state.sort);
  const hits = usePolyHavenStore(state => state.hits);
  const total = usePolyHavenStore(state => state.total);
  const facets = usePolyHavenStore(state => state.facets);
  const loading = usePolyHavenStore(state => state.loading);
  const error = usePolyHavenStore(state => state.error);
  const hasMore = usePolyHavenStore(state => state.hasMore);
  const favorites = usePolyHavenStore(state => state.favorites);
  const favoritesOnly = usePolyHavenStore(state => state.favoritesOnly);
  const downloadedOnly = usePolyHavenStore(state => state.downloadedOnly);
  const localById = usePolyHavenStore(state => state.localById);
  const toggleFavorite = usePolyHavenStore(state => state.toggleFavorite);
  const setFavoritesOnly = usePolyHavenStore(state => state.setFavoritesOnly);
  const setDownloadedOnly = usePolyHavenStore(state => state.setDownloadedOnly);
  const selectAllIds = usePolyHavenStore(state => state.selectAllIds);
  const setType = usePolyHavenStore(state => state.setType);
  const setSort = usePolyHavenStore(state => state.setSort);
  const setCategoryPaths = usePolyHavenStore(state => state.setCategoryPaths);
  const toggleCategory = usePolyHavenStore(state => state.toggleCategory);
  const toggleCollection = usePolyHavenStore(state => state.toggleCollection);
  const toggleResolution = usePolyHavenStore(state => state.toggleResolution);
  const toggleMapType = usePolyHavenStore(state => state.toggleMapType);
  const toggleAttribute = usePolyHavenStore(state => state.toggleAttribute);
  const clearFilters = usePolyHavenStore(state => state.clearFilters);
  const refresh = usePolyHavenStore(state => state.refresh);
  const loadMore = usePolyHavenStore(state => state.loadMore);
  const openAsset = usePolyHavenStore(state => state.openAsset);
  const density = useStore(state => state.density);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listView, setListView] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const anchorIndex = useRef<number | null>(null);
  const downloadedCount = Object.keys(localById).length;

  const activeCount =
    (categoryPaths.length > 0 ? 1 : 0) +
    categoriesFilter.length +
    collections.length +
    resolutions.length +
    mapTypes.length +
    Object.values(attributeFilters).reduce((sum, values) => sum + values.length, 0) +
    (favoritesOnly ? 1 : 0) +
    (downloadedOnly ? 1 : 0) +
    (minSize != null || maxSize != null ? 1 : 0) +
    (type === "hdris" && timeStart != null && timeEnd != null ? 1 : 0);

  const isHdri = type === "hdris";
  const sizeValue = sizeFilterFromBounds(minSize, maxSize);
  const showSize = type === "models";
  const setSizePreset = (value: string): void => {
    const bounds = sizeBounds(value as SizeFilter);
    setSizeRange(bounds.minSize, bounds.maxSize);
  };
  const sortOptions = useMemo(
    () => SORTS.filter(option => {
      if (option.value === "size") return type === "models";
      if (isHdri) return !["triangles", "maps"].includes(option.value);
      if (type === "textures") return option.value !== "triangles";
      return true;
    }),
    [isHdri, type]
  );

  useEffect(() => {
    if (!sortOptions.some(option => option.value === sort)) setSort("relevance");
  }, [sort, sortOptions, setSort]);
  useEffect(() => {
    if (type !== "models" && (minSize != null || maxSize != null)) setSizeRange(null, null);
  }, [type, minSize, maxSize, setSizeRange]);

  const ready = status?.state === "ready";
  const indexing = status?.state === "refreshing" || (!ready && loading);
  const empty = !ready && !indexing && status?.state !== "error";
  const categoryLabel = categoryPaths[categoryPaths.length - 1]?.split("/").join(" / ") ?? "";

  const filterGroups = useMemo<FilterGroup[]>(() => {
    const groups: FilterGroup[] = [];
    const resolutionsFacet = facets?.resolutions ?? [];
    if (resolutionsFacet.length > 0 || resolutions.length > 0) {
      groups.push({
        key: "resolution",
        label: "Resolution",
        values: bucketRecord(sortResolutionBuckets(resolutionsFacet)),
        selected: resolutions,
        toggle: toggleResolution,
        compare: (a, b) => resolutionFacetValue(a) - resolutionFacetValue(b)
      });
    }
    const mapFacet = sortBucketsBy(facets?.mapTypes ?? [], polyHavenMapRank);
    if (!isHdri && (mapFacet.length > 0 || mapTypes.length > 0)) {
      groups.push({
        key: "maps",
        label: "Texture maps",
        values: bucketRecord(mapFacet),
        selected: mapTypes,
        toggle: toggleMapType,
        labels: Object.fromEntries(mapFacet.map(bucket => [bucket.value, polyHavenMapLabel(bucket.value)])),
        compare: (a, b) => polyHavenMapRank(a) - polyHavenMapRank(b)
      });
    }
    const categoryFacet = facets?.categories ?? [];
    if (categoryFacet.length > 0 || categoriesFilter.length > 0) {
      groups.push({
        key: "category",
        label: "Category tags",
        values: bucketRecord(categoryFacet),
        selected: categoriesFilter,
        toggle: toggleCategory,
        labels: Object.fromEntries(categoryFacet.map(bucket => [bucket.value, titleCase(bucket.value)]))
      });
    }
    const collectionFacet = facets?.collections ?? [];
    if (collectionFacet.length > 0 || collections.length > 0) {
      groups.push({
        key: "collection",
        label: "Collections",
        values: bucketRecord(collectionFacet),
        selected: collections,
        toggle: toggleCollection,
        labels: Object.fromEntries(collectionFacet.map(bucket => [bucket.value, titleCase(bucket.value.replace(/^collection:\s*/i, ""))]))
      });
    }
    const attributeOrder = [
      "time_of_day", "weather", "light_type", "contrast", "environment", "sky_view",
      "season", "backplates", "surface_use", "condition", "origin", "setting",
      "aerial", "material", "rigged", "lods", "geonodes"
    ];
    const attributes = facets?.attributes ?? {};
    const keys = Object.keys(attributes).sort((a, b) => {
      const ai = attributeOrder.indexOf(a);
      const bi = attributeOrder.indexOf(b);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b);
    });
    for (const key of keys) {
      if (key === "time_of_day" && isHdri) continue;
      const allowed = POLYHAVEN_ATTRIBUTE_TYPES[key];
      if (type && allowed && !allowed.includes(type as "hdris" | "textures" | "models")) continue;
      const values = attributes[key] ?? [];
      const selected = attributeFilters[key] ?? [];
      if (values.length === 0 && selected.length === 0) continue;
      groups.push({
        key: `attribute:${key}`,
        label: polyHavenAttributeLabel(key),
        values: bucketRecord(values),
        selected,
        toggle: value => toggleAttribute(key, value),
        labels: Object.fromEntries(values.map(bucket => [bucket.value, polyHavenAttributeValue(bucket.value)]))
      });
    }
    return groups;
  }, [
    facets,
    type,
    isHdri,
    resolutions,
    mapTypes,
    categoriesFilter,
    collections,
    attributeFilters,
    toggleResolution,
    toggleMapType,
    toggleCategory,
    toggleCollection,
    toggleAttribute
  ]);

  useEffect(() => {
    if (filterGroups.length === 0 && activeCount === 0 && filtersOpen) setFiltersOpen(false);
  }, [filterGroups.length, activeCount, filtersOpen]);

  useEffect(() => {
    setSelectedIds(new Set());
    anchorIndex.current = null;
  }, [
    query,
    type,
    categoryPaths,
    categoriesFilter,
    collections,
    resolutions,
    mapTypes,
    sort,
    favoritesOnly,
    downloadedOnly
  ]);

  const selectHit = (
    hit: PolyHavenAssetSummary,
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

  const quickDownload = async (hit: PolyHavenAssetSummary): Promise<void> => {
    try {
      await window.openbridge.downloads.start(`polyhaven:${hit.id}`, quickOptions(hit), "polyhaven");
      useStore.getState().toast(`Queued ${hit.name}`);
    } catch (error) {
      useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
    }
  };

  const selectAllFiltered = async (): Promise<void> => {
    setBulkBusy(true);
    try {
      const ids = await selectAllIds();
      setSelectedIds(new Set(ids));
      useStore.getState().toast(`Selected ${ids.length.toLocaleString()} Poly Haven asset(s)`);
    } catch (error) {
      useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBulkBusy(false);
    }
  };

  const downloadSelected = async (): Promise<void> => {
    if (selectedIds.size === 0) return;
    if (
      selectedIds.size > 100 &&
      !window.confirm(
        `Queue ${selectedIds.size.toLocaleString()} Poly Haven downloads?\n\nThey will download sequentially and can use a lot of disk space and time.`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const result = await window.openbridge.downloads.startMany(
        [...selectedIds].map(id => `polyhaven:${id}`),
        { resolution: "2k", format: "hdr" },
        "polyhaven"
      );
      useStore.getState().toast(
        `Queued ${result.queued.toLocaleString()} Poly Haven download${result.queued === 1 ? "" : "s"}`
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
    <div className="view discover poliigon-view polyhaven-view">
      <div className="view-header discover-toolbar">
        <div className="filter-row catalog-toolbar">
          <Dropdown
            className="filter-select"
            value={type}
            onChange={setType}
            ariaLabel="Filter by Poly Haven asset type"
            options={TYPES}
          />
          <Dropdown
            className="filter-select"
            value={sort}
            onChange={value => setSort(value as PolyHavenSort)}
            ariaLabel="Sort Poly Haven assets"
            options={sortOptions}
          />
          {showSize && (
            <Dropdown
              className="filter-select"
              value={sizeValue}
              onChange={setSizePreset}
              ariaLabel="Filter Poly Haven assets by physical size"
              options={SIZE_FILTER_OPTIONS}
            />
          )}          <button
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
              aria-controls="polyhaven-filter-panel"
              onClick={() => setFiltersOpen(value => !value)}
            >
              Filters
              {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
              <ChevronDownIcon className={filtersOpen ? "filter-chevron open" : "filter-chevron"} />
            </button>
          )}

          <span className="result-count">
            {indexing
              ? "Indexing Poly Haven…"
              : loading && hits.length === 0
                ? "Searching…"
                : `${total.toLocaleString()} assets`}
          </span>

          <button
            type="button"
            className="btn btn-ghost"
            disabled={status?.state === "refreshing"}
            onClick={() => void refresh()}
            title="Refresh the public Poly Haven catalogue"
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

        <div className="active-filters" aria-label="Active Poly Haven filters">
          {categoryPaths.length > 0 && (
            <button type="button" className="facet-chip active" onClick={() => setCategoryPaths([])}>
              {categoryLabel || "Category"} ×
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
          {!isHdri && mapTypes.map(value => (
            <button type="button" key={`map:${value}`} className="facet-chip active" onClick={() => toggleMapType(value)}>
              <span>Map</span>
              <strong>{polyHavenMapLabel(value)}</strong>
              <em aria-hidden="true">×</em>
            </button>
          ))}
          {categoriesFilter.map(value => (
            <button type="button" key={`category:${value}`} className="facet-chip active" onClick={() => toggleCategory(value)}>
              <span>Category</span>
              <strong>{titleCase(value)}</strong>
              <em aria-hidden="true">×</em>
            </button>
          ))}
          {collections.map(value => (
            <button type="button" key={`collection:${value}`} className="facet-chip active" onClick={() => toggleCollection(value)}>
              <span>Collection</span>
              <strong>{titleCase(value.replace(/^collection:\s*/i, ""))}</strong>
              <em aria-hidden="true">×</em>
            </button>
          ))}
          {Object.entries(attributeFilters).flatMap(([key, values]) => values.map(value => (
            <button type="button" key={`attribute:${key}:${value}`} className="facet-chip active" onClick={() => toggleAttribute(key, value)}>
              <span>{polyHavenAttributeLabel(key)}</span>
              <strong>{polyHavenAttributeValue(value)}</strong>
              <em aria-hidden="true">×</em>
            </button>
          )))}
          {activeCount > 0 && (
            <button type="button" className="text-btn" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        {filtersOpen && (
          <section className="facet-panel" id="polyhaven-filter-panel" aria-label="Poly Haven filters">
            <div className="facet-panel-head">
              <div className="facet-panel-heading">
                <strong>Refine Poly Haven</strong>
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
                Bulk downloads use 2K and the provider defaults. Adjust individual assets in their
                drawer before downloading.
              </span>
            </div>
            <div className="bulk-actions">
              <button type="button" className="text-btn" onClick={() => setSelectedIds(new Set(hits.map(hit => hit.id)))}>
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
          {error && (
            <div className="error-box" role="alert">
              <span>Could not load the Poly Haven catalogue: {error}</span>{" "}
              <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}

          {indexing && (
            <div className="poliigon-indexing" role="status">
              <div className="spinner" />
              <div>
                <strong>Building the Poly Haven catalogue index</strong>
                <p>
                  OpenBridge downloads the public CC0 catalogue once and indexes it locally. No
                  account, credits or API key are required.
                </p>
              </div>
            </div>
          )}

          {empty && (
            <div className="empty">
              <h2>Poly Haven catalogue is not indexed yet</h2>
              <p>{status?.error ?? "Download the public catalogue to browse Poly Haven assets locally."}</p>
              <button type="button" className="btn btn-primary" onClick={() => void refresh()}>
                Index Poly Haven catalogue
              </button>
            </div>
          )}

          <div className="asset-heading">
            {query ? "Search results" : categoryPaths.length > 0 ? categoryLabel : "Poly Haven catalogue"}
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
                key: hit.id,
                id: hit.id,
                name: hit.name,
                type: hit.typeLabel,
                image: hit.type === "hdris"
                  ? polyHavenPrimaryPreview(hit.thumbnail, 512) ?? hit.thumbnail
                  : hit.thumbnail,
                technical: polyHavenTechnical(hit),
                dimensions: hit.dimensions,
                resolution: hit.maxResolution ? `${Math.round(hit.maxResolution / 1024)}K` : null,
                category: hit.category,
                facts: [
                  hit.mapCodes.length > 0 ? `${hit.mapCodes.length} maps` : null,
                  hit.polycount ? `${hit.polycount.toLocaleString()} tris` : null,
                  hit.dimensions
                ].filter((value): value is string => Boolean(value)),
                status: localById[hit.id] ? "Downloaded" : "Free",
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
              itemKey={hit => hit.id}
              minItemWidth={density === "compact" ? 160 : density === "large" ? 320 : 220}
              gap={28}
              aspectRatio={isHdri ? 2 : 1}
              renderItem={hit => (
                <PolyHavenCard
                  key={hit.id}
                  hit={hit}
                  downloaded={Boolean(localById[hit.id])}
                  favorited={favorites.includes(hit.id)}
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
              <h2>No Poly Haven assets found</h2>
              <p>Try a different search or clear the filters.</p>
              {activeCount > 0 && (
                <button type="button" className="btn btn-ghost" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {hasMore && (
            <LoadMore
              loading={loading}
              remaining={Math.max(0, total - hits.length)}
              onLoad={() => void loadMore()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
