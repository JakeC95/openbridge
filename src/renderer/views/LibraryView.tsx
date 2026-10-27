import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { typeLabel } from "../catalog-utils";
import { CheckIcon, CloseIcon, FolderIcon, SearchIcon, UploadIcon } from "../icons";
import type { AssetRecord, LibraryHealthReport, RepoKind } from "../../shared/types";
import { VirtualGrid } from "../components/VirtualGrid";
import { Dropdown } from "../components/Dropdown";
import { formatMeasurementText } from "../../shared/measurements";
import { libraryFilterQuery } from "../browsing-state";
import { DensityControl, PackBrowser, RecentBrowsing } from "../components/BrowsingTools";
import { categoryLabel } from "../../shared/browsing";
import { useBrowseScroll } from "../use-browse-scroll";

const REPOS: Array<{ value: "all" | RepoKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "downloaded", label: "Downloaded" },
  { value: "custom", label: "Custom / Mixer" },
  { value: "dhi", label: "MetaHumans" }
];

function formatBytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function localFacts(asset: AssetRecord): string {
  const facts: string[] = [];
  if (asset.sizeBytes != null) facts.push(formatBytes(asset.sizeBytes));
  const technical = asset.technical;
  if (technical?.dimensions) facts.push(formatMeasurementText(technical.dimensions));
  else if (technical?.scanArea) facts.push(formatMeasurementText(technical.scanArea));
  if (technical?.maxTris) facts.push(`${technical.maxTris.toLocaleString()} tris`);
  if (asset.issueCount != null) {
    facts.push(asset.issueCount === 0 ? "Healthy" : `${asset.issueCount} issue${asset.issueCount === 1 ? "" : "s"}`);
  } else if (technical?.resolution) {
    facts.push(`${technical.resolution / 1024}K`);
  }
  if (technical?.lodCount) facts.push(`${technical.lodCount} LOD${technical.lodCount === 1 ? "" : "s"}`);
  if (technical?.mapCount) facts.push(`${technical.mapCount} maps`);
  if (technical?.tileable) facts.push("Tileable");
  return facts.slice(0, 4).join(" · ");
}

export function LibraryView() {
  const density = useStore(state => state.density);
  const localType = useStore(state => state.localType);
  const localCategoryPath = useStore(state => state.localCategoryPath);
  const localSort = useStore(state => state.localSort);
  const localFavoritesOnly = useStore(state => state.localFavoritesOnly);
  const favorites = useStore(state => state.favorites);
  const localPack = useStore(state => state.localPack);
  const localPacks = useStore(state => state.localPacks);
  const auth = useStore(state => state.auth);
  const assets = useStore(state => state.libraryAssets);
  const counts = useStore(state => state.libraryCounts);
  const allTotal = useStore(state => state.libraryTotal);
  const total = useStore(state => state.libraryFilteredTotal);
  const loading = useStore(state => state.libraryLoading);
  const hasMore = useStore(state => state.libraryHasMore);
  const query = useStore(state => state.localQuery);
  const repo = useStore(state => state.localRepo);
  const setQuery = useStore(state => state.setLocalQuery);
  const setRepo = useStore(state => state.setLocalRepo);
  const queryLocalLibrary = useStore(state => state.queryLocalLibrary);
  const localReady = useStore(state => state.localReady);
  const localMaxTris = useStore(state => state.localMaxTris);
  const localColor = useStore(state => state.localColor);
  const localState = useStore(state => state.localState);
  const localInterior = useStore(state => state.localInterior);
  const toggleLocalReady = useStore(state => state.toggleLocalReady);
  const setLocalMaxTris = useStore(state => state.setLocalMaxTris);
  const setLocalColor = useStore(state => state.setLocalColor);
  const setLocalState = useStore(state => state.setLocalState);
  const setLocalInterior = useStore(state => state.setLocalInterior);
  const resetLocalFilters = useStore(state => state.resetLocalFilters);
  const openLocal = useStore(state => state.openLocal);
  const importFolder = useStore(state => state.importFolder);
  const importZip = useStore(state => state.importZip);
  const refreshLibrary = useStore(state => state.refreshLibrary);
  const settings = useStore(state => state.settings);
  const toast = useStore(state => state.toast);

  const [selectMode, setSelectMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [health, setHealth] = useState<LibraryHealthReport | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthProgress, setHealthProgress] = useState<{ checked: number; total: number; percent: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useBrowseScroll(bodyRef, "library", JSON.stringify(libraryFilterQuery(useStore.getState())));
  const firstQuery = useRef(true);

  useEffect(() => {
    return window.openbridge.onSearchPaste(({ text }) => {
      if (useStore.getState().view === "library") setQuery(text);
    });
  }, [setQuery]);

  useEffect(() => {
    return window.openbridge.onLibraryHealthProgress(setHealthProgress);
  }, []);

  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    setSelectedIds(new Set());
    const timer = setTimeout(() => {
      bodyRef.current?.scrollTo({ top: 0 });
      void queryLocalLibrary(true);
    }, 140);
    return () => clearTimeout(timer);
  }, [
    query,
    repo,
    localType,
    localCategoryPath,
    localSort,
    localFavoritesOnly,
    favorites,
    localPack,
    localReady,
    localMaxTris,
    localColor,
    localState,
    localInterior,
    queryLocalLibrary
  ]);

  function toggleSelected(id: string): void {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVisible(): void {
    setSelectedIds(new Set(assets.map(asset => asset.id)));
  }
  async function selectAllFiltered(): Promise<void> {
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      const filters = libraryFilterQuery(useStore.getState());
      const ids = await window.openbridge.queryLibraryIds(filters);
      if (JSON.stringify(filters) !== JSON.stringify(libraryFilterQuery(useStore.getState()))) return;
      setSelectedIds(new Set(ids));
      toast(`Selected ${ids.length.toLocaleString()} asset(s)`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setSelectingAll(false);
    }
  }

  async function loadHealth(force = false): Promise<void> {
    setHealthOpen(true);
    setHealthProgress(null);
    setHealthLoading(true);
    try {
      setHealth(await window.openbridge.libraryHealth(force));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setHealthLoading(false);
    }
  }

  async function exportSelected(): Promise<void> {
    if (selectedIds.size === 0) return;
    const folder = await window.openbridge.chooseDirectory();
    if (!folder) return;
    setBusy(true);
    try {
      const written = await window.openbridge.exportLibraryAssets([...selectedIds], folder, libraryFilterQuery(useStore.getState()));
      toast(`Exported ${selectedIds.size} asset JSON record(s) to ${written}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected(): Promise<void> {
    if (selectedIds.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selectedIds.size} local asset folder(s)? This removes files from disk and cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.openbridge.removeLibraryAssets([...selectedIds], libraryFilterQuery(useStore.getState()));
      setSelectedIds(new Set());
      await refreshLibrary(true);
      toast(`Deleted ${result.removed} asset folder(s)`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  }

  const refineFilterCount =
    localReady.length +
    (localMaxTris ? 1 : 0) +
    (localColor ? 1 : 0) +
    (localState ? 1 : 0) +
    (localInterior ? 1 : 0);
  const selectionScope =
    selectedIds.size === 0
      ? `${total.toLocaleString()} assets match current filters`
      : selectedIds.size === total
        ? `All ${total.toLocaleString()} matching assets`
        : selectedIds.size === assets.length
          ? `${assets.length.toLocaleString()} loaded assets`
          : `${selectedIds.size.toLocaleString()} of ${total.toLocaleString()} matching assets`;

  return (
    <div className="view library">
      <div className="view-header">
        <div className="header-line">
          <div className="search-wrap">
            <SearchIcon className="search-icon" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              onContextMenu={event => {
                event.preventDefault();
                void window.openbridge.contextMenu.search();
              }}
              placeholder="Search your local library..."
              spellCheck={false}
              maxLength={256}
              aria-label="Search local library"
            />
          </div>
          <div className="header-actions">
            <button type="button" className="btn btn-ghost" onClick={() => void loadHealth()}>
              Health
            </button>
            <button
              type="button"
              className={selectMode ? "btn btn-ghost active" : "btn btn-ghost"}
              onClick={() => setSelectMode(value => !value)}
            >
              {selectMode ? "Done" : "Select"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void importFolder()}>
              <UploadIcon /> Import folder
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void importZip()}>
              <UploadIcon /> Import zip
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void refreshLibrary(true)}>
              Rescan
            </button>
          </div>
        </div>

        <div className="filter-row">
          <Dropdown className="filter-select" value={localType || "all"} ariaLabel="Local asset type"
            onChange={value => useStore.getState().setLocalType(value === "all" ? "" : value)}
            options={[{ value: "all", label: "All types" }, ...["3d", "3dplant", "surface", "atlas", "brush", "decal", "imperfection", "displacement"]
              .map(value => ({ value, label: categoryLabel(value) }))]} />
          <Dropdown className="filter-select" value={localSort} ariaLabel="Sort local library"
            onChange={value => useStore.getState().setLocalSort(value as typeof localSort)} options={[
              { value: "recent", label: "Recently modified" }, { value: "name", label: "Name A–Z" },
              { value: "type", label: "Asset type" }
            ]} />
          <button
            type="button"
            className={filtersOpen ? "chip active" : "chip"}
            aria-expanded={filtersOpen}
            aria-controls="library-refine-filters"
            onClick={() => setFiltersOpen(value => !value)}
          >
            Filters
            {refineFilterCount > 0 && <span className="filter-count">{refineFilterCount}</span>}
          </button>
          <button type="button" className={localFavoritesOnly ? "chip active" : "chip"}
            disabled={!auth.loggedIn} aria-pressed={localFavoritesOnly}
            onClick={() => useStore.getState().setLocalFavoritesOnly(!localFavoritesOnly)}>Favorites</button>
          <DensityControl />
          <PackBrowser packs={localPacks} local />
          <RecentBrowsing />
          <div className="chips">
            {REPOS.map(item => (
              <button
                type="button"
                key={item.value}
                className={repo === item.value ? "chip active" : "chip"}
                onClick={() => setRepo(item.value)}
              >
                {item.label}
                <span className="chip-count">{counts[item.value] ?? 0}</span>
              </button>
            ))}
          </div>
          <span className="result-count">
            {loading && assets.length === 0
              ? "Searching..."
              : `${total.toLocaleString()} assets${assets.length < total ? `, ${assets.length.toLocaleString()} loaded` : ""}`}
          </span>
        </div>

        <div className="active-filters" aria-label="Active local filters">
          {localCategoryPath.length > 0 && <button type="button" className="facet-chip active"
            onClick={() => useStore.getState().setLocalCategoryPath([])}>{localCategoryPath.map(categoryLabel).join(" / ")} ×</button>}
          {localType && <button type="button" className="facet-chip active" onClick={() => useStore.getState().setLocalType("")}>{categoryLabel(localType)} ×</button>}
          {localPack && <button type="button" className="facet-chip active" onClick={() => useStore.getState().clearPack()}>Pack: {localPack.name} ×</button>}
          {localFavoritesOnly && <button type="button" className="facet-chip active" onClick={() => useStore.getState().setLocalFavoritesOnly(false)}>Favorites ×</button>}
          {localReady.map(value => <button type="button" key={value} className="facet-chip active" onClick={() => toggleLocalReady(value)}>{value} ×</button>)}
          {localMaxTris && <button type="button" className="facet-chip active" onClick={() => setLocalMaxTris(null)}>≤ {localMaxTris.toLocaleString()} tris ×</button>}
          {localColor && <button type="button" className="facet-chip active" onClick={() => setLocalColor("")}>{localColor} ×</button>}
          {localState && <button type="button" className="facet-chip active" onClick={() => setLocalState("")}>{localState} ×</button>}
          {localInterior && <button type="button" className="facet-chip active" onClick={() => setLocalInterior("")}>{localInterior} ×</button>}
        </div>

        {filtersOpen && (
          <div className="library-refine" id="library-refine-filters">
            <div className="library-refine-head">
              <strong>Technical filters</strong>
              <span>{refineFilterCount} active</span>
            </div>
            <div className="refine-chips">
              {[
                ["tileable", "Tileable"],
                ["closed", "Closed mesh"],
                ["scale-fixed", "Scale fixed"],
                ["billboards", "Billboards"],
                ["highpoly", "Highpoly"],
                ["ztool", "ZTool"],
                ["modular", "Modular"]
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={localReady.includes(value) ? "chip active" : "chip"}
                  onClick={() => toggleLocalReady(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="refine-selects">
              <Dropdown
                className="select-dropdown"
                value={localMaxTris ? String(localMaxTris) : "any"}
                onChange={value =>
                  setLocalMaxTris(value === "any" ? null : Number(value))
                }
                ariaLabel="Maximum triangle count"
                options={[
                  { value: "any", label: "Any tris" },
                  { value: "10000", label: "≤ 10k tris" },
                  { value: "25000", label: "≤ 25k tris" },
                  { value: "50000", label: "≤ 50k tris" },
                  { value: "100000", label: "≤ 100k tris" }
                ]}
              />
              <Dropdown
                className="select-dropdown"
                value={localColor || "any"}
                onChange={value => setLocalColor(value === "any" ? "" : value)}
                ariaLabel="Colour"
                options={[
                  { value: "any", label: "Any colour" },
                  { value: "Brown", label: "Brown" },
                  { value: "Gray", label: "Gray" },
                  { value: "Green", label: "Green" },
                  { value: "Red", label: "Red" },
                  { value: "Orange", label: "Orange" },
                  { value: "Yellow", label: "Yellow" },
                  { value: "Blue", label: "Blue" },
                  { value: "White", label: "White" },
                  { value: "Black", label: "Black" }
                ]}
              />
              <Dropdown
                className="select-dropdown"
                value={localState || "any"}
                onChange={value => setLocalState(value === "any" ? "" : value)}
                ariaLabel="Condition"
                options={[
                  { value: "any", label: "Any condition" },
                  { value: "new", label: "New" },
                  { value: "old", label: "Old" }
                ]}
              />
              <Dropdown
                className="select-dropdown"
                value={localInterior || "any"}
                onChange={value => setLocalInterior(value === "any" ? "" : value)}
                ariaLabel="Interior or exterior"
                options={[
                  { value: "any", label: "Any setting" },
                  { value: "interior", label: "Interior" },
                  { value: "exterior", label: "Exterior" }
                ]}
              />
              <button type="button" className="text-btn" onClick={resetLocalFilters}>
                Reset filters
              </button>
            </div>
          </div>
        )}

        {selectMode && (
          <div className="bulk-bar">
            <div className="bulk-scope">
              <span className="bulk-count" aria-live="polite">{selectedIds.size} selected</span>
              <span className="bulk-scope-detail">{selectionScope}</span>
              <span className="bulk-scope-hint">Export writes JSON records. Delete removes local asset folders from disk.</span>
            </div>
            <div className="bulk-actions">
              <button type="button" className="text-btn" onClick={selectVisible}>
                Select loaded
              </button>
              <button
                type="button"
                className="text-btn"
                disabled={selectingAll || total === 0}
                onClick={() => void selectAllFiltered()}
              >
                {selectingAll ? "Selecting..." : `Select all ${total.toLocaleString()}`}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || selectedIds.size === 0}
                onClick={() => void exportSelected()}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="btn btn-ghost bulk-delete"
                disabled={busy || selectedIds.size === 0}
                onClick={() => void deleteSelected()}
              >
                Delete from disk…
              </button>
              <button
                type="button"
                className="text-btn"
                disabled={selectedIds.size === 0}
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="path-line">
          <FolderIcon />
          <span title={settings?.libraryPath}>{settings?.libraryPath}</span>
          <button
            type="button"
            className="text-btn"
            onClick={() => settings && void window.openbridge.openPath(settings.libraryPath)}
          >
            Open
          </button>
        </div>
      </div>

      <div className="view-body" ref={bodyRef}>
        {assets.length > 0 && (
          <VirtualGrid
            items={assets}
            minItemWidth={density === "compact" ? 160 : density === "large" ? 320 : 220}
            gap={28}
            renderItem={asset => {
              const selected = selectedIds.has(asset.id);
              const facts = localFacts(asset);
              return (
                <div
                  role="button"
                  tabIndex={0}
                  className={selected ? "asset-card selected" : "asset-card"}
                  key={`${asset.repo}:${asset.id}`}
                  data-asset-id={asset.id}
                  onClick={() => {
                    if (selectMode) toggleSelected(asset.id);
                    else void openLocal(asset);
                  }}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (selectMode) toggleSelected(asset.id);
                      else void openLocal(asset);
                    }
                  }}
                  onContextMenu={event => {
                    event.preventDefault();
                    void window.openbridge.contextMenu.asset({
                      assetId: asset.id,
                      localPath: asset.path
                    });
                  }}
                  title={asset.name}
                >
                  <div className="asset-thumb">
                    {asset.preview ? (
                      <img
                        src={window.openbridge.toFileUrl(asset.preview)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="asset-placeholder">{typeLabel(asset.type)}</span>
                    )}
                    <span className="asset-type">{typeLabel(asset.type)}</span>
                    <span className="asset-flag owned">LOCAL</span>
                    {!selectMode && auth.loggedIn && <button type="button" className={favorites.includes(asset.id) ? "asset-favorite active" : "asset-favorite"}
                      aria-label={favorites.includes(asset.id) ? "Remove favorite" : "Add favorite"}
                      onClick={event => { event.stopPropagation(); void useStore.getState().toggleFavorite(asset.id); }}>
                      {favorites.includes(asset.id) ? "♥" : "♡"}
                    </button>}

                    {selectMode && (
                      <button
                        type="button"
                        className={selected ? "asset-select selected" : "asset-select"}
                        aria-label={selected ? `Deselect ${asset.name}` : `Select ${asset.name}`}
                        aria-pressed={selected}
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleSelected(asset.id);
                        }}
                      >
                        {selected && <CheckIcon width={14} height={14} />}
                      </button>
                    )}
                  </div>
                  <div className="asset-meta">
                    <strong>{asset.name}</strong>
                    <span>{asset.id}</span>
                    <em>{asset.repo}</em>
                    {facts && <span className="asset-facts">{facts}</span>}
                  </div>
                </div>
              );
            }}
          />
        )}

        {loading && assets.length === 0 && (
          <div className="loading-line">Searching indexed library...</div>
        )}

        {!loading && assets.length === 0 && (
          <div className="empty">
            <h2>{allTotal === 0 ? "No local assets" : "No matching assets"}</h2>
            <p>
              {allTotal === 0
                ? "Point OpenBridge at an existing Megascans library or import a custom asset folder/zip."
                : "Try a different search or repository filter."}
            </p>
            {allTotal === 0 ? (
              <button type="button" className="btn btn-primary" onClick={() => void importFolder()}>
                Import a folder
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={resetLocalFilters}>
                Clear search and filters
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
              onClick={() => void queryLocalLibrary(false)}
            >
              {loading
                ? "Loading..."
                : `Load more (${Math.max(0, total - assets.length).toLocaleString()} left)`}
            </button>
          </div>
        )}
      </div>

      {healthOpen && (
        <div className="health-overlay" onClick={() => setHealthOpen(false)}>
          <div className="health-panel" onClick={event => event.stopPropagation()}>
            <div className="health-head">
              <div>
                <h2>Library health</h2>
                <p>{health?.libraryPath ?? settings?.libraryPath}</p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setHealthOpen(false)}
                aria-label="Close health report"
              >
                <CloseIcon />
              </button>
            </div>

            {healthLoading && (
              <div className="loading-line">
                Scanning library...
                {healthProgress
                  ? ` ${healthProgress.checked.toLocaleString()} / ${healthProgress.total.toLocaleString()} (${healthProgress.percent}%)`
                  : ""}
              </div>
            )}
            {health && !healthLoading && (
              <>
                <div className="health-summary">
                  <div>
                    <strong>{health.assets}</strong>
                    <span>assets</span>
                  </div>
                  <div>
                    <strong>{health.files}</strong>
                    <span>files</span>
                  </div>
                  <div>
                    <strong>{formatBytes(health.totalBytes)}</strong>
                    <span>on disk</span>
                  </div>
                  <div>
                    <strong>{health.issues.length}</strong>
                    <span>issues</span>
                  </div>
                </div>

                <div className="health-types">
                  {Object.entries(health.byType)
                    .sort((a, b) => b[1].bytes - a[1].bytes)
                    .map(([type, stats]) => (
                      <div key={type}>
                        <span>{type}</span>
                        <strong>{formatBytes(stats.bytes)}</strong>
                        <em>{stats.assets} assets</em>
                      </div>
                    ))}
                </div>

                <div className="health-issues">
                  {health.issues.length === 0 ? (
                    <p className="hint">No issues found.</p>
                  ) : (
                    health.issues.slice(0, 200).map((issue, index) => (
                      <div className="health-issue" key={`${issue.path}:${issue.kind}:${index}`}>
                        <span className={`issue-dot ${issue.severity}`} />
                        <div>
                          <strong>{issue.name ?? issue.assetId ?? issue.path}</strong>
                          <p>{issue.message}</p>
                          <code>{issue.path}</code>
                        </div>
                      </div>
                    ))
                  )}
                  {health.issues.length > 200 && (
                    <p className="hint">Showing the first 200 of {health.issues.length} issues.</p>
                  )}
                </div>
                <div className="health-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => void loadHealth(true)}>
                    Rescan
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
