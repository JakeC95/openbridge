import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { assetCountLabel, readinessBadges, typeLabel } from "../catalog-utils";
import { assetTypeClass } from "../asset-visuals";
import { CheckIcon, CloseIcon, FolderIcon, UploadIcon } from "../icons";
import type { AssetProvider, AssetRecord, LibraryHealthReport, LibrarySort, RepoKind } from "../../shared/types";
import { VirtualGrid } from "../components/VirtualGrid";
import { Dropdown } from "../components/Dropdown";
import { formatMeasurementText } from "../../shared/measurements";
import { libraryFilterQuery } from "../browsing-state";
import { DensityControl, FilterWorkbench, PackBrowser, RecentBrowsing, type FilterGroup } from "../components/BrowsingTools";
import { categoryLabel } from "../../shared/browsing";
import { useBrowseScroll } from "../use-browse-scroll";
import { LoadMore } from "../components/LoadMore";
import { AssetList } from "../components/AssetList";
import { SmartThumbImage } from "../components/SmartThumbImage";
import { ProviderLogo } from "../components/ProviderLogo";

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
  const localProvider = useStore(state => state.localProvider);
  const setLocalProvider = useStore(state => state.setLocalProvider);
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
  const [listView, setListView] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [health, setHealth] = useState<LibraryHealthReport | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthFilter, setHealthFilter] = useState("all");
  const cancellingHealth = useRef(false);
  const [healthProgress, setHealthProgress] = useState<{ checked: number; total: number; percent: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useBrowseScroll(bodyRef, "library", JSON.stringify(libraryFilterQuery(useStore.getState())));
  const firstQuery = useRef(true);

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
    localProvider,
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
    cancellingHealth.current = false;
    try {
      setHealth(await window.openbridge.libraryHealth(force));
    } catch (error) {
      if (cancellingHealth.current) toast("Health scan cancelled. Completed batches remain cached.");
      else toast(error instanceof Error ? error.message : String(error), true);
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
      ? `${assetCountLabel(total)} matching current filters`
      : selectedIds.size === total
        ? `All ${total.toLocaleString()} matching assets`
        : selectedIds.size === assets.length
          ? `${assets.length.toLocaleString()} loaded assets`
           : `${selectedIds.size.toLocaleString()} of ${total.toLocaleString()} matching assets`;

  const readyLabels: Record<string, string> = { tileable: "Tileable", closed: "Closed mesh", "scale-fixed": "Scale fixed",
    billboards: "Billboards", highpoly: "Highpoly", ztool: "ZTool", modular: "Modular" };
  const singleGroup = (key: string, label: string, values: string[], selected: string, change: (value: string) => void,
    labels?: Record<string, string>, compare?: (a: string, b: string) => number): FilterGroup => ({
    key, label, values: Object.fromEntries(values.map(value => [value, 0])),
    selected: selected ? [selected] : [], toggle: value => change(value === selected ? "" : value), labels,
    compare: compare ?? ((a, b) => values.indexOf(a) - values.indexOf(b))
  });
  const showTriangles = localType === "" || ["3d", "3dplant", "model"].includes(localType);
  const showMaps = !["hdri", "brush", "imperfection", "displacement"].includes(localType);
  const showReadiness =
    (localProvider === "megascans" || localProvider === "all") &&
    !["hdri", "texture", "model", "decal", "brush", "imperfection", "displacement"].includes(localType);
  const readinessKeys = localType === ""
    ? Object.keys(readyLabels)
    : ["3d", "3dplant"].includes(localType)
      ? ["closed", "scale-fixed", "modular", "highpoly", "ztool", "billboards"]
      : ["tileable"];
  const showSemanticSource =
    (localProvider === "megascans" || localProvider === "all") &&
    !["hdri", "texture", "model"].includes(localType);
  const showColour = showSemanticSource && localType !== "displacement";
  const showCondition = showSemanticSource && !["brush", "decal", "imperfection", "displacement"].includes(localType);
  const showSetting = showCondition;
  const filterGroups = useMemo<FilterGroup[]>(() => {
    const groups: FilterGroup[] = [];
    if (showReadiness) {
      groups.push({
        key: "ready",
        label: localProvider === "all" ? "Readiness (Megascans)" : "Readiness",
        values: Object.fromEntries(readinessKeys.map(value => [value, 0])),
        selected: localReady,
        toggle: toggleLocalReady,
        labels: readyLabels,
        compare: (a, b) => readinessKeys.indexOf(a) - readinessKeys.indexOf(b)
      });
    }
    if (showTriangles) {
      groups.push(singleGroup("tris", "Triangles", ["10000", "25000", "50000", "100000"], localMaxTris ? String(localMaxTris) : "",
        value => setLocalMaxTris(value ? Number(value) : null),
        { "10000": "Up to 10k tris", "25000": "Up to 25k tris", "50000": "Up to 50k tris", "100000": "Up to 100k tris" },
        (a, b) => Number(a) - Number(b)));
    }
    if (showColour) {
      groups.push(singleGroup("colour", "Colour", ["Brown", "Gray", "Green", "Red", "Orange", "Yellow", "Blue", "White", "Black"], localColor, setLocalColor));
    }
    if (showCondition) {
      groups.push(singleGroup("condition", "Condition", ["new", "old"], localState, setLocalState, { new: "New", old: "Old" }));
    }
    if (showSetting) {
      groups.push(singleGroup("setting", "Setting", ["interior", "exterior"], localInterior, setLocalInterior, { interior: "Interior", exterior: "Exterior" }));
    }
    return groups;
  }, [
    showReadiness,
    showTriangles,
    showColour,
    showCondition,
    showSetting,
    readinessKeys,
    localReady,
    localMaxTris,
    localColor,
    localState,
    localInterior,
    toggleLocalReady,
    setLocalMaxTris,
    setLocalColor,
    setLocalState,
    setLocalInterior,
    readyLabels
  ]);

  useEffect(() => {
    if (filterGroups.length === 0 && filtersOpen) setFiltersOpen(false);
  }, [filterGroups.length, filtersOpen]);

  const sortOptions = useMemo(() => {
    const options: Array<{ value: LibrarySort; label: string }> = [
      { value: "recent", label: "Recently modified" },
      { value: "name", label: "Name A–Z" },
      { value: "name-desc", label: "Name Z–A" },
      { value: "type", label: "Asset type" },
      { value: "size", label: "Library size · largest first" },
      { value: "issues", label: "Health issues · most first" }
    ];
    if (localType !== "hdri") {
      options.splice(4, 0,
        { value: "resolution", label: "Resolution · highest first" },
        ...(showMaps ? [{ value: "maps" as LibrarySort, label: "Texture maps · most first" }] : [])
      );
    }
    if (showTriangles) {
      options.splice(options.length - 1, 0,
        { value: "triangles", label: "Triangles · most first" },
        { value: "lods", label: "LODs · most first" },
        ...(localProvider === "poliigon" || localProvider === "polyhaven"
          ? []
          : [{ value: "variations" as LibrarySort, label: "Variations · most first" }])
      );
    }
    return options;
  }, [localProvider, localType, showMaps, showTriangles]);
  useEffect(() => {
    if (!sortOptions.some(option => option.value === localSort)) {
      useStore.getState().setLocalSort("recent");
    }
  }, [localSort, sortOptions]);
  useEffect(() => {
    if (!showReadiness && localReady.length > 0) useStore.setState({ localReady: [] });
  }, [localReady.length, showReadiness]);
  useEffect(() => {
    if (!showReadiness) return;
    const allowed = new Set(readinessKeys);
    const next = localReady.filter(value => allowed.has(value));
    if (next.length !== localReady.length) useStore.setState({ localReady: next });
  }, [localReady, readinessKeys, showReadiness]);
  useEffect(() => {
    if (!showTriangles && localMaxTris !== null) setLocalMaxTris(null);
  }, [localMaxTris, setLocalMaxTris, showTriangles]);
  useEffect(() => {
    if (!showColour && localColor) setLocalColor("");
  }, [localColor, setLocalColor, showColour]);
  useEffect(() => {
    if (!showCondition && localState) setLocalState("");
  }, [localState, setLocalState, showCondition]);
  useEffect(() => {
    if (!showSetting && localInterior) setLocalInterior("");
  }, [localInterior, setLocalInterior, showSetting]);

  const megascansTypes = ["3d", "3dplant", "surface", "atlas", "brush", "decal", "imperfection", "displacement"];
  const poliigonTypes = ["texture", "model", "hdri"];
  const typeOptions = localProvider === "poliigon" || localProvider === "polyhaven"
    ? poliigonTypes
    : localProvider === "megascans"
      ? megascansTypes
      : [...megascansTypes, ...poliigonTypes];

  const libraryPath = localProvider === "poliigon"
    ? settings?.poliigonLibraryPath
    : localProvider === "polyhaven"
      ? settings?.polyhavenLibraryPath
      : localProvider === "megascans"
        ? settings?.libraryPath
        : settings?.libraryRoot || settings?.libraryPath;

  return (
    <div className="view library">
      <div className="view-header">
        <div className="header-line">
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
            {localProvider !== "poliigon" && localProvider !== "polyhaven" && (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => void importFolder()}>
                  <UploadIcon /> Import folder
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void importZip()}>
                  <UploadIcon /> Import zip
                </button>
              </>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => void refreshLibrary(true)}>
              Rescan
            </button>
          </div>
        </div>
        <p className="hint library-scope-note">
          Local files only. Everything here is already on this computer, available offline, and
          independent of catalogue subscriptions.
        </p>

        <div className="filter-row">
          <Dropdown className="filter-select" value={localProvider} ariaLabel="Local asset source"
            onChange={value => setLocalProvider(value as AssetProvider | "all")}
            options={[
              { value: "all", label: "All sources" },
              { value: "megascans", label: "Megascans" },
              { value: "poliigon", label: "Poliigon" },
              { value: "polyhaven", label: "Poly Haven" }
            ]} />
          <Dropdown className="filter-select" value={localType || "all"} ariaLabel="Local asset type"
            onChange={value => useStore.getState().setLocalType(value === "all" ? "" : value)}
            options={[{ value: "all", label: "All types" }, ...typeOptions
              .map(value => ({ value, label: categoryLabel(value) }))]} />
          <Dropdown className="filter-select" value={localSort} ariaLabel="Sort local library"
            onChange={value => useStore.getState().setLocalSort(value as typeof localSort)} options={sortOptions} />
          {filterGroups.length > 0 && (
            <button
              type="button"
              className={filtersOpen ? "filter-action active" : "filter-action"}
              aria-expanded={filtersOpen}
              aria-controls="library-refine-filters"
              onClick={() => setFiltersOpen(value => !value)}
            >
              Filters
              {refineFilterCount > 0 && <span className="filter-count">{refineFilterCount}</span>}
            </button>
          )}
          {localProvider !== "poliigon" && localProvider !== "polyhaven" && <button type="button" className={localFavoritesOnly ? "chip active" : "chip"}
            disabled={!auth.loggedIn} aria-pressed={localFavoritesOnly}
            onClick={() => useStore.getState().setLocalFavoritesOnly(!localFavoritesOnly)}>Favorites</button>}
          <DensityControl />
          {localProvider !== "poliigon" && localProvider !== "polyhaven" && <PackBrowser packs={localPacks} local />}
          <RecentBrowsing />
          <div className="chips">
            {localProvider !== "poliigon" && localProvider !== "polyhaven" && REPOS.map(item => (
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
              : `${assetCountLabel(total)}${assets.length < total ? `, ${assets.length.toLocaleString()} loaded` : ""}`}
          </span>
        </div>

        <div className="active-filters" aria-label="Active local filters">
          {localCategoryPath.length > 0 && <button type="button" className="facet-chip active"
            onClick={() => useStore.getState().setLocalCategoryPath([])}>{localCategoryPath.map(categoryLabel).join(" / ")} ×</button>}
          {localType && <button type="button" className="facet-chip active" onClick={() => useStore.getState().setLocalType("")}>{categoryLabel(localType)} ×</button>}
          {localPack && <button type="button" className="facet-chip active" onClick={() => useStore.getState().clearPack()}>Pack: {localPack.name} ×</button>}
          {localFavoritesOnly && <button type="button" className="facet-chip active" onClick={() => useStore.getState().setLocalFavoritesOnly(false)}>Favorites ×</button>}
          {localReady.map(value => <button type="button" key={value} className="facet-chip active" onClick={() => toggleLocalReady(value)}>{readyLabels[value] ?? value} ×</button>)}
          {localMaxTris && <button type="button" className="facet-chip active" onClick={() => setLocalMaxTris(null)}>≤ {localMaxTris.toLocaleString()} tris ×</button>}
          {localColor && <button type="button" className="facet-chip active" onClick={() => setLocalColor("")}>{localColor} ×</button>}
          {localState && <button type="button" className="facet-chip active" onClick={() => setLocalState("")}>{localState} ×</button>}
          {localInterior && <button type="button" className="facet-chip active" onClick={() => setLocalInterior("")}>{localInterior} ×</button>}
          {(refineFilterCount > 0 || localCategoryPath.length > 0 || localType || localPack || localFavoritesOnly || repo !== "all") &&
            <button type="button" className="text-btn" onClick={resetLocalFilters}>Clear filters</button>}
        </div>

        {filtersOpen && (
          <section className="facet-panel" id="library-refine-filters" aria-label="Library filters">
            <div className="facet-panel-head">
              <div className="facet-panel-heading"><strong>Refine library</strong><span>{refineFilterCount} active · filters apply instantly</span></div>
              <div className="facet-panel-actions">
                <button type="button" className="text-btn" onClick={resetLocalFilters}>Clear filters</button>
                <button type="button" className="icon-btn" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><CloseIcon /></button>
              </div>
            </div>
            {filterGroups.length === 0 ? (
              <p className="hint">No additional filters apply to this asset type.</p>
            ) : (
              <FilterWorkbench groups={filterGroups} showCounts={false} />
            )}
          </section>
        )}

        {selectMode && (
          <div className="bulk-bar">
            <div className="bulk-scope">
              <span className="bulk-count" aria-live="polite">{selectedIds.size} selected</span>
              <span className="bulk-scope-detail">{selectionScope}</span>
              <span className="bulk-scope-hint">Export writes JSON records. Delete removes local asset folders from disk.</span>
            </div>
            <div className="bulk-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setListView(value => !value)}>{listView ? "Grid view" : "List / compare view"}</button>
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
          <span title={libraryPath}>{libraryPath}</span>
          <button
            type="button"
            className="text-btn"
            onClick={() => libraryPath && void window.openbridge.openPath(libraryPath)}
          >
            Open
          </button>
        </div>
      </div>

      <div className="view-body" ref={bodyRef}>
        {assets.length > 0 && !selectMode && <button type="button" className="btn btn-ghost view-mode" onClick={() => setListView(value => !value)}>{listView ? "Grid view" : "List / compare view"}</button>}
        {assets.length > 0 && listView && <AssetList key={selectMode ? "bulk" : "browse"}
          selectedKeys={selectMode ? new Set(assets.filter(asset => selectedIds.has(asset.id)).map(asset => asset.path)) : undefined}
          totalSelected={selectMode ? selectedIds.size : undefined} initialCompare={selectMode && selectedIds.size >= 2}
          onToggle={selectMode ? path => { const asset = assets.find(item => item.path === path); if (asset) toggleSelected(asset.id); } : undefined}
          items={assets.map(asset => ({
          key: asset.path, id: asset.id, name: asset.name, type: typeLabel(asset.type), dimensions: asset.technical?.dimensions,
          image: asset.preview ? window.openbridge.toFileUrl(asset.preview) : null, technical: asset.technical,
          category: asset.categories?.slice(0, 2).join(" / "), facts: readinessBadges(asset.technical),
          resolution: asset.technical?.resolution ? `${asset.technical.resolution / 1024}K` : null,
          status: asset.repo, onOpen: () => void openLocal(asset)
        }))} />}
        {assets.length > 0 && !listView && (
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
                    if (asset.provider === "poliigon" || asset.provider === "polyhaven") return;
                    void window.openbridge.contextMenu.asset({
                      assetId: asset.id,
                      localPath: asset.path
                    });
                  }}
                  title={asset.name}
                >
                  <div className="asset-thumb">
                    {asset.preview ? (
                      <SmartThumbImage
                        source={window.openbridge.toFileUrl(asset.preview)}
                        direct={typeLabel(asset.type) === "HDRI"}
                        alt=""
                        className={typeLabel(asset.type) === "HDRI" ? "asset-thumb-img hdri-panorama" : "asset-thumb-img"}
                      />
                    ) : (
                      <span className="asset-placeholder">{typeLabel(asset.type)}</span>
                    )}
                    <span className={`asset-type ${assetTypeClass(typeLabel(asset.type))}`}>{typeLabel(asset.type)}</span>
                    {!selectMode && (
                      <ProviderLogo
                        provider={asset.provider ?? "megascans"}
                        className="asset-provider-mark"
                      />
                    )}
                    <span className="asset-flag owned">LOCAL</span>
                    {!selectMode && auth.loggedIn && asset.provider !== "poliigon" && asset.provider !== "polyhaven" && <button type="button" className={favorites.includes(asset.id) ? "asset-favorite active" : "asset-favorite"}
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
                    <em>{asset.provider === "poliigon" ? "Poliigon" : asset.provider === "polyhaven" ? "Poly Haven" : asset.repo}</em>
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
                ? localProvider === "poliigon"
                  ? "No Poliigon assets are indexed yet. Download an asset or check the Poliigon library path in Settings."
                  : localProvider === "polyhaven"
                    ? "No Poly Haven assets are indexed yet. Download an asset or check the Poly Haven library path in Settings."
                    : "Point OpenBridge at an existing Megascans, Poliigon or Poly Haven library, or import a custom asset folder/zip."
                : "Try a different search or source filter."}
            </p>
            {allTotal === 0 ? (
              localProvider === "poliigon" || localProvider === "polyhaven" ? (
                <button type="button" className="btn btn-primary" onClick={() => useStore.getState().setView("settings")}>
                  Check {localProvider === "poliigon" ? "Poliigon" : "Poly Haven"} library path
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void importFolder()}>
                  Import a folder
                </button>
              )
            ) : (
              <button type="button" className="btn btn-ghost" onClick={resetLocalFilters}>
                Clear search and filters
              </button>
            )}
            {allTotal === 0 && <button type="button" className="btn btn-ghost" onClick={() => useStore.getState().setView("settings")}>Choose an existing library</button>}
          </div>
        )}

        {hasMore && (
          <LoadMore loading={loading} remaining={Math.max(0, total - assets.length)} onLoad={() => void queryLocalLibrary(false)} />
        )}
      </div>

      {healthOpen && (
        <div className="health-overlay" onClick={() => setHealthOpen(false)}>
          <div className="health-panel" onClick={event => event.stopPropagation()}>
            <div className="health-head">
              <div>
                <h2>Library health</h2>
                <p>
                  {health?.libraryPath ?? settings?.libraryPath}
                  {health?.poliigonLibraryPath ? ` + ${health.poliigonLibraryPath}` : ""}
                  {health?.polyhavenLibraryPath ? ` + ${health.polyhavenLibraryPath}` : ""}
                </p>
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
                <button type="button" className="btn btn-ghost" onClick={() => { cancellingHealth.current = true; void window.openbridge.cancelLibraryHealth(); }}>Cancel scan</button>
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

                {health.duplicates.length > 0 && <section className="duplicate-review">
                  <h3>Review duplicate IDs</h3>
                  <p className="hint">No files are selected or deleted. Open each folder and verify which copy you want to keep before using Windows to remove anything.</p>
                  {health.duplicates.map(duplicate => <div className="duplicate-group" key={duplicate.assetId}>
                    <strong>{duplicate.assetId}</strong>
                    {duplicate.paths.map(path => <div key={path} className="duplicate-path"><code>{path}</code>
                      <button type="button" className="text-btn" onClick={() => void window.openbridge.openPath(path).catch(error => toast(String(error), true))}>Open folder</button></div>)}
                  </div>)}
                </section>}

                <div className="health-issues">
                  <label>Show issues <select value={healthFilter} onChange={event => setHealthFilter(event.target.value)}>
                    <option value="all">All</option><option value="duplicate-id">Duplicate IDs</option>
                    <option value="error">Errors</option><option value="warning">Warnings</option>
                  </select></label>
                  {health.issues.length === 0 ? (
                    <p className="hint">No issues found.</p>
                  ) : (
                    health.issues.filter(issue => healthFilter === "all" || issue.kind === healthFilter || issue.severity === healthFilter).slice(0, 200).map((issue, index) => (
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
