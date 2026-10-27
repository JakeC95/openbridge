import { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { AssetCard } from "../components/AssetCard";
import { hitId } from "../catalog-utils";
import { CloseIcon, UserIcon } from "../icons";
import { Dropdown } from "../components/Dropdown";
import { VirtualGrid } from "../components/VirtualGrid";

const TABS: Array<{ label: string; path: string[] }> = [
  { label: "All", path: [] },
  { label: "3D", path: ["3D asset"] },
  { label: "Surfaces", path: ["surface"] },
  { label: "Atlases", path: ["atlas"] },
  { label: "3D Plants", path: ["3D plant"] },
  { label: "Brushes", path: ["brush"] },
  { label: "Decals", path: ["decal"] },
  { label: "Imperfections", path: ["imperfection"] },
  { label: "Displacements", path: ["displacement"] }
];

function titleCase(key: string): string {
  return key
    .split(" ")
    .map(word =>
      word.toLowerCase() === "3d"
        ? "3D"
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

function categoryPathLabel(
  categories: ReturnType<typeof useStore.getState>["categories"],
  path: string[]
): string {
  let nodes = categories;
  const labels: string[] = [];
  for (const key of path) {
    const node = nodes.find(item => item.key === key);
    if (!node) {
      labels.push(titleCase(key));
      break;
    }
    labels.push(node.label);
    nodes = node.children;
  }
  return labels.join(" / ");
}

interface SavedSearch {
  id: string;
  name: string;
  query: string;
  type: string;
  categoryPath: string[];
  freeOnly: boolean;
  favoritesOnly: boolean;
  sizeFilter: "any" | "small" | "medium" | "large" | "huge";
  facetFilters: Record<string, string[]>;
}

function loadSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem("openbridge.savedSearches");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storeSavedSearches(searches: SavedSearch[]): void {
  try {
    localStorage.setItem("openbridge.savedSearches", JSON.stringify(searches));
  } catch {
    // ignore
  }
}

export function DiscoverView() {
  const query = useStore(state => state.query);
  const type = useStore(state => state.type);
  const hasMore = useStore(state => state.hasMore);
  const categoryPath = useStore(state => state.categoryPath);
  const hits = useStore(state => state.hits);
  const nbHits = useStore(state => state.nbHits);
  const loading = useStore(state => state.catalogLoading);
  const error = useStore(state => state.catalogError);
  const categories = useStore(state => state.categories);
  const acquired = useStore(state => state.acquired);
  const favorites = useStore(state => state.favorites);
  const favoritesOnly = useStore(state => state.favoritesOnly);
  const freeOnly = useStore(state => state.freeOnly);
  const sizeFilter = useStore(state => state.sizeFilter);
  const facets = useStore(state => state.facets);
  const facetFilters = useStore(state => state.facetFilters);
  const localRefs = useStore(state => state.localRefs);
  const downloads = useStore(state => state.downloads);
  const auth = useStore(state => state.auth);

  const setCategoryPath = useStore(state => state.setCategoryPath);
  const setStateFilter = useStore(state => state.setStateFilter);
  const setSizeFilter = useStore(state => state.setSizeFilter);
  const toggleFacet = useStore(state => state.toggleFacet);
  const clearFacetFilters = useStore(state => state.clearFacetFilters);
  const clearFilters = useStore(state => state.clearFilters);
  const search = useStore(state => state.search);
  const openHit = useStore(state => state.openHit);
  const login = useStore(state => state.login);
  const toggleFavorite = useStore(state => state.toggleFavorite);
  const downloadHit = useStore(state => state.downloadHit);
  const downloadMany = useStore(state => state.downloadMany);
  const toast = useStore(state => state.toast);

  const [selectMode, setSelectMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => loadSavedSearches());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedPoints, setSelectedPoints] = useState<Map<string, number | undefined>>(
    () => new Map()
  );
  const [selectingAll, setSelectingAll] = useState(false);
  const selectionAnchor = useRef<string | null>(null);

  const ownSet = useMemo(() => new Set(acquired), [acquired]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const localMap = useMemo(
    () => new Map(localRefs.map(ref => [ref.id, ref.path])),
    [localRefs]
  );
  const selectedCategoryLabel = categoryPathLabel(categories, categoryPath);
  const activeTab = TABS.find(isTabActive) ?? TABS[0];
  const stateFilter = freeOnly ? "free" : favoritesOnly ? "favorites" : "all";
  const sizeRange =
    sizeFilter === "small"
      ? { maxSize: 0.5 }
      : sizeFilter === "medium"
        ? { minSize: 0.5, maxSize: 2 }
        : sizeFilter === "large"
          ? { minSize: 2, maxSize: 5 }
          : sizeFilter === "huge"
            ? { minSize: 5 }
            : {};

  function selectTab(tab: (typeof TABS)[number]): void {
    setCategoryPath(tab.path);
  }

  function isTabActive(tab: (typeof TABS)[number]): boolean {
    if (favoritesOnly || freeOnly) return false;
    if (tab.path.length === 0) return categoryPath.length === 0;
    return (
      categoryPath.length >= tab.path.length &&
      tab.path.every((key, index) => categoryPath[index] === key)
    );
  }

  function addSelection(entries: Array<{ id: string; points?: number }>): void {
    if (entries.length === 0) return;
    setSelectedIds(previous => {
      const next = new Set(previous);
      for (const entry of entries) next.add(entry.id);
      return next;
    });
    setSelectedPoints(previous => {
      const next = new Map(previous);
      for (const entry of entries) next.set(entry.id, entry.points);
      return next;
    });
  }

  function clearSelection(): void {
    setSelectedIds(new Set());
    setSelectedPoints(new Map());
    selectionAnchor.current = null;
  }

  function toggleSelection(
    id: string,
    points: number | undefined,
    event?: { shiftKey: boolean }
  ): void {
    if (event?.shiftKey && selectionAnchor.current) {
      const ids = hits.map(hitId);
      const from = ids.indexOf(selectionAnchor.current);
      const to = ids.indexOf(id);
      if (from >= 0 && to >= 0) {
        const start = Math.min(from, to);
        const end = Math.max(from, to);
        addSelection(
          hits.slice(start, end + 1).map(hit => ({
            id: hitId(hit),
            points: hit.points
          }))
        );
        return;
      }
    }

    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectedPoints(previous => {
      const next = new Map(previous);
      if (next.has(id)) next.delete(id);
      else next.set(id, points);
      return next;
    });
    if (!event?.shiftKey) selectionAnchor.current = id;
  }

  function selectLoaded(): void {
    addSelection(hits.map(hit => ({ id: hitId(hit), points: hit.points })));
    if (hits[0]) selectionAnchor.current = hitId(hits[0]);
  }

  async function selectAllInFilter(): Promise<void> {
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      const result = await window.openbridge.catalog.ids({
        query,
        page: 0,
        categoryPath: categoryPath.length ? categoryPath : undefined,
        ids: favoritesOnly ? favorites : undefined,
        points: freeOnly ? 0 : undefined,
        ...sizeRange
      });
      if (result.entries.length === 0) {
        toast("No assets matched this category or filter", true);
        return;
      }
      addSelection(result.entries);
      if (hits[0]) selectionAnchor.current = hitId(hits[0]);
      toast(
        `Selected ${result.entries.length.toLocaleString()} asset${
          result.entries.length === 1 ? "" : "s"
        }`
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setSelectingAll(false);
    }
  }

  async function downloadSelected(): Promise<void> {
    if (!auth.loggedIn) {
      toast("Sign in with Epic to download assets.", true);
      return;
    }
    if (selectedIds.size === 0) {
      toast("Select at least one asset first", true);
      return;
    }

    const localIds = new Set(localRefs.map(ref => ref.id));
    const completed = new Set(
      Object.values(downloads)
        .filter(item => item.status === "complete")
        .map(item => item.assetId)
    );
    const acquiredSet = new Set(acquired);
    const queuedIds: string[] = [];
    let alreadyInLibrary = 0;
    let needsAcquisition = 0;

    for (const id of selectedIds) {
      if (localIds.has(id) || completed.has(id)) {
        alreadyInLibrary += 1;
        continue;
      }
      const points = selectedPoints.get(id);
      if (typeof points === "number" && points > 0 && !acquiredSet.has(id)) {
        needsAcquisition += 1;
        continue;
      }
      queuedIds.push(id);
    }

    if (queuedIds.length === 0) {
      toast(
        needsAcquisition > 0
          ? `${needsAcquisition.toLocaleString()} selected asset(s) require acquisition first`
          : "All selected assets are already in the library",
        true
      );
      return;
    }

    if (
      queuedIds.length > 100 &&
      !window.confirm(
        `Queue ${queuedIds.length.toLocaleString()} downloads?\n\nThey will download sequentially and can use a lot of disk space and time.`
      )
    ) {
      return;
    }

    const result = await downloadMany(queuedIds);

    if (alreadyInLibrary > 0) {
      toast(
        `${alreadyInLibrary.toLocaleString()} selected asset(s) were already in the library`
      );
    }
    if (needsAcquisition > 0) {
      toast(
        `${needsAcquisition.toLocaleString()} selected asset(s) need acquisition and were skipped`,
        true
      );
    }
    if (result.queued > 0) {
      setSelectMode(false);
      clearSelection();
    }
  }

  const activeFacetCount = Object.values(facetFilters).reduce(
    (sum, values) => sum + values.length,
    0
  );

  function saveCurrentSearch(): void {
    const name =
      query.trim() ||
      selectedCategoryLabel ||
      (freeOnly ? "Free assets" : favoritesOnly ? "Favorites" : "All assets");
    const next = [
      {
        id: Date.now().toString(36),
        name,
        query,
        type,
        categoryPath,
        freeOnly,
        favoritesOnly,
        sizeFilter,
        facetFilters
      },
      ...savedSearches
    ].slice(0, 20);
    setSavedSearches(next);
    storeSavedSearches(next);
    toast("Search saved");
  }

  function applySavedSearch(saved: SavedSearch): void {
    useStore.setState({
      query: saved.query,
      type: saved.type,
      categoryPath: saved.categoryPath,
      freeOnly: saved.freeOnly,
      favoritesOnly: saved.favoritesOnly,
      sizeFilter: saved.sizeFilter ?? "any",
      facetFilters: saved.facetFilters
    });
    void search(true);
    setFiltersOpen(false);
  }

  function removeSavedSearch(id: string): void {
    const next = savedSearches.filter(item => item.id !== id);
    setSavedSearches(next);
    storeSavedSearches(next);
  }

  return (
    <div className="view discover">
      <div className="view-header discover-toolbar">
        <div className="filter-row catalog-toolbar">
          <Dropdown
            className="filter-select"
            value={activeTab.label}
            onChange={value => {
              const tab = TABS.find(item => item.label === value);
              if (tab) selectTab(tab);
            }}
            ariaLabel="Filter by asset type"
            options={TABS.map(item => ({
              value: item.label,
              label: item.label === "All" ? "All Types" : item.label
            }))}
          />

          <Dropdown
            className="filter-select"
            value={stateFilter}
            onChange={value =>
              setStateFilter(value as "all" | "free" | "favorites")
            }
            ariaLabel="Filter by ownership or favorites"
            options={[
              { value: "all", label: "All States" },
              { value: "free", label: "Free" },
              {
                value: "favorites",
                label: "Favorites" + (favorites.length > 0 ? " (" + favorites.length + ")" : "")
              }
            ]}
          />

              <Dropdown
            className="filter-select"
            value={sizeFilter}
            onChange={value =>
              setSizeFilter(value as "any" | "small" | "medium" | "large" | "huge")
            }
            ariaLabel="Filter by physical size"
            options={[
              { value: "any", label: "Any Size" },
              { value: "small", label: "Up to 50 cm" },
              { value: "medium", label: "50 cm-2 m" },
              { value: "large", label: "2-5 m" },
              { value: "huge", label: "5 m+" }
            ]}
          />
          <button
                type="button"
                className={selectMode ? "filter-action active" : "filter-action"}
                onClick={() => setSelectMode(value => !value)}
              >
                Select
                {selectedIds.size > 0 && (
                  <span className="filter-count">{selectedIds.size.toLocaleString()}</span>
                )}
              </button>

              <button
                type="button"
                className={filtersOpen ? "filter-action active" : "filter-action"}
                onClick={() => setFiltersOpen(value => !value)}
              >
                Filters
                {activeFacetCount > 0 && (
                  <span className="filter-count">{activeFacetCount}</span>
                )}
              </button>

          <span className="result-count">
            {loading && hits.length === 0
              ? "Searching..."
              : `${nbHits.toLocaleString()} assets`}
          </span>
        </div>

        {filtersOpen && (
          <div className="facet-panel">
            <div className="facet-panel-head">
              <strong>Refine catalogue</strong>
              <div className="facet-panel-actions">
                <button type="button" className="text-btn" onClick={saveCurrentSearch}>
                  Save search
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={clearFacetFilters}
                  disabled={activeFacetCount === 0}
                >
                  Clear facets
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setFiltersOpen(false)}
                  aria-label="Close filters"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div className="facet-groups">
              {(["biome", "region", "resolution", "color", "environment", "theme"] as const).map(
                group => {
                  const values = Object.entries(facets[group] ?? {})
                    .filter(([value]) => value && value !== "undefined")
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10);
                  if (values.length === 0) return null;
                  return (
                    <div className="facet-group" key={group}>
                      <span>{titleCase(group)}</span>
                      <div>
                        {values.map(([value, count]) => (
                          <button
                            type="button"
                            key={value}
                            className={
                              facetFilters[group]?.includes(value)
                                ? "facet-chip active"
                                : "facet-chip"
                            }
                            onClick={() => toggleFacet(group, value)}
                          >
                            {value}
                            <em>{count.toLocaleString()}</em>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }
              )}
              {Object.keys(facets).length === 0 && (
                <span className="hint">Run a search to load available filters.</span>
              )}
            </div>

            {savedSearches.length > 0 && (
              <div className="saved-searches">
                <span>Saved searches</span>
                <div>
                  {savedSearches.map(saved => (
                    <div className="saved-search" key={saved.id}>
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => applySavedSearch(saved)}
                      >
                        {saved.name}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => removeSavedSearch(saved.id)}
                        title="Remove saved search"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {selectMode && (
          <div className="bulk-bar">
            <span className="bulk-count">
              {selectedIds.size.toLocaleString()} selected
            </span>
            <button
              type="button"
              className="text-btn"
              onClick={selectLoaded}
              disabled={hits.length === 0}
            >
              Select loaded ({hits.length.toLocaleString()})
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={() => void selectAllInFilter()}
              disabled={selectingAll || loading || nbHits === 0}
            >
              {selectingAll
                ? "Selecting..."
                : `${selectedIds.size > 0 ? "Add" : "Select"} all ${nbHits.toLocaleString()}`}
            </button>
            <button
              type="button"
              className="btn btn-accent bulk-download"
              disabled={selectedIds.size === 0}
              onClick={() => void downloadSelected()}
            >
              Download selected
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={clearSelection}
              disabled={selectedIds.size === 0}
            >
              Clear
            </button>
            <button type="button" className="text-btn" onClick={() => setSelectMode(false)}>
              Done
            </button>
          </div>
        )}

        {categoryPath.length > 0 && (
          <div className="category-breadcrumb">
            <span>In:</span>
            <strong>{selectedCategoryLabel}</strong>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setCategoryPath([])}
              title="Clear category"
            >
              <CloseIcon />
            </button>
          </div>
        )}

        {!auth.loggedIn && (
          <div className="login-banner">
            <UserIcon />
            <span>Browse is open to everyone. Sign in with Epic to download assets you own.</span>
            <button type="button" className="btn btn-primary" onClick={() => void login()}>
              Sign in
            </button>
          </div>
        )}
      </div>

      <div className="view-body discover-body">
        <div className="asset-area">
          {error && <div className="error-box">{error}</div>}

          <div className="asset-heading">
            {query ? "Search results" : categoryPath.length > 0 ? selectedCategoryLabel : "Catalogue"}
          </div>

          {hits.length > 0 && (
            <VirtualGrid
              items={hits}
              minItemWidth={220}
              gap={28}
              renderItem={hit => {
                const id = hitId(hit);
                const local = localMap.get(id);
                return (
                  <AssetCard
                    key={id}
                    hit={hit}
                    owned={ownSet.has(id)}
                    downloaded={Boolean(local)}
                    favorited={favoriteSet.has(id)}
                    canFavorite={auth.loggedIn}
                    localPath={local ?? null}
                    progress={downloads[id]}
                    selectionMode={selectMode}
                    selected={selectedIds.has(id)}
                    onPauseResume={() => {
                      const active = downloads[id];
                      if (!active) return;
                      if (active.status === "paused")
                        void window.openbridge.downloads.resume(id);
                      else void window.openbridge.downloads.pause(id);
                    }}
                    onSelect={event => toggleSelection(id, hit.points, event)}
                    onOpen={hitToOpen => void openHit(hitToOpen)}
                    onToggleFavorite={() => void toggleFavorite(id)}
                    onDownload={() => void downloadHit(hit)}
                  />
                );
              }}
            />
          )}

          {loading && hits.length === 0 && (
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

          {!loading && !error && hits.length === 0 && (
            <div className="empty">
              <h2>No assets found</h2>
              <p>
                {favoritesOnly
                  ? "You have no favorites yet."
                  : "Try a different search or clear the filters."}
              </p>
              {(favoritesOnly || freeOnly || categoryPath.length > 0) && (
                <button type="button" className="btn btn-ghost" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {hasMore && (
            <div className="load-more">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={loading}
                onClick={() => void search(false)}
              >
                {loading
                  ? "Loading..."
                  : `Load more (${Math.max(0, nbHits - hits.length).toLocaleString()} left)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}






