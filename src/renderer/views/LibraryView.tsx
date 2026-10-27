import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { typeLabel } from "../catalog-utils";
import { CheckIcon, CloseIcon, FolderIcon, SearchIcon, UploadIcon } from "../icons";
import type { LibraryHealthReport, RepoKind } from "../../shared/types";
import { VirtualGrid } from "../components/VirtualGrid";

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

export function LibraryView() {
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
  const openLocal = useStore(state => state.openLocal);
  const importFolder = useStore(state => state.importFolder);
  const importZip = useStore(state => state.importZip);
  const refreshLibrary = useStore(state => state.refreshLibrary);
  const settings = useStore(state => state.settings);
  const toast = useStore(state => state.toast);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [health, setHealth] = useState<LibraryHealthReport | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthProgress, setHealthProgress] = useState<{ checked: number; total: number; percent: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const firstQuery = useRef(true);

  useEffect(() => {
    return window.openbridge.onSearchPaste(({ text }) => setQuery(text));
  }, [setQuery]);

  useEffect(() => {
    return window.openbridge.onLibraryHealthProgress(setHealthProgress);
  }, []);

  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    const timer = setTimeout(() => {
      bodyRef.current?.scrollTo({ top: 0 });
      void queryLocalLibrary(true);
    }, 140);
    return () => clearTimeout(timer);
  }, [query, repo, queryLocalLibrary]);

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
      const ids = await window.openbridge.queryLibraryIds({ query, repo });
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
      const written = await window.openbridge.exportLibraryAssets([...selectedIds], folder);
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
      const result = await window.openbridge.removeLibraryAssets([...selectedIds]);
      setSelectedIds(new Set());
      await refreshLibrary(true);
      toast(`Deleted ${result.removed} asset folder(s)`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  }

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

        {selectMode && (
          <div className="bulk-bar">
            <span className="bulk-count">{selectedIds.size} selected</span>
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
              className="btn btn-ghost"
              disabled={busy || selectedIds.size === 0}
              onClick={() => void deleteSelected()}
            >
              Delete
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
            minItemWidth={220}
            gap={28}
            renderItem={asset => {
              const selected = selectedIds.has(asset.id);
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
              <button type="button" className="btn btn-ghost" onClick={() => setQuery("")}>
                Clear search
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
