import { useStore } from "../store";
import { usePoliigonStore } from "../poliigon-store";
import { usePolyHavenStore } from "../polyhaven-store";
import type { CategoryNode } from "../../shared/types";
import { allCategoryNodes, allSourcePath } from "../all-sources";
import {
  DiscoverIcon,
  DownloadIcon,
  LibraryIcon,
  LogoutIcon,
  SettingsIcon
} from "../icons";
import { CategoryTree } from "./CategoryTree";
import { formatTransferBytes, summarizeDownloads } from "../download-summary";

function categoryPathFor(nodes: CategoryNode[], id: number | undefined): string[] {
  if (id === undefined) return [];
  const visit = (list: CategoryNode[], trail: string[]): string[] | null => {
    for (const node of list) {
      const next = [...trail, node.key];
      if (node.key === String(id)) return next;
      const found = visit(node.children, next);
      if (found) return found;
    }
    return null;
  };
  return visit(nodes, []) ?? [];
}

export function Sidebar() {
  const view = useStore(state => state.view);
  const setView = useStore(state => state.setView);
  const provider = useStore(state => state.provider);
  const setProvider = useStore(state => state.setProvider);
  const allType = useStore(state => state.allType);
  const setAllType = useStore(state => state.setAllType);
  const auth = useStore(state => state.auth);
  const versions = useStore(state => state.versions);
  const logout = useStore(state => state.logout);
  const categories = useStore(state => state.categories);
  const categoriesLoading = useStore(state => state.categoriesLoading);
  const categoryPath = useStore(state => state.categoryPath);
  const setCategoryPath = useStore(state => state.setCategoryPath);
  const nbHits = useStore(state => state.nbHits);
  const poliigonTotal = usePoliigonStore(state => state.total);
  const polyHavenTotal = usePolyHavenStore(state => state.total);
  const libraryTotal = useStore(state => state.libraryTotal);
  const downloads = useStore(state => state.downloads);
  const downloadSummary = summarizeDownloads(Object.values(downloads));
  const localCategories = useStore(state => state.localCategories);
  const localCategoryPath = useStore(state => state.localCategoryPath);
  const setLocalCategoryPath = useStore(state => state.setLocalCategoryPath);
  const poliigonCategories = usePoliigonStore(state => state.categories);
  const poliigonCategoryIds = usePoliigonStore(state => state.categoryIds);
  const setPoliigonCategoryIds = usePoliigonStore(state => state.setCategoryIds);
  const polyHavenCategories = usePolyHavenStore(state => state.categories);
  const polyHavenCategoryPaths = usePolyHavenStore(state => state.categoryPaths);
  const setPolyHavenCategoryPaths = usePolyHavenStore(state => state.setCategoryPaths);
  const openLogs = window.openbridge.openLogs;
  const allTypeNodes = allCategoryNodes();
  const discoverCount = provider === "all"
    ? nbHits + poliigonTotal + polyHavenTotal
    : provider === "poliigon"
      ? poliigonTotal
      : provider === "polyhaven"
        ? polyHavenTotal
        : nbHits;

  const items = [
    {
      id: "discover" as const,
      label: "Discover",
      icon: <DiscoverIcon />,
      count: discoverCount
    },
    {
      id: "library" as const,
      label: "Library",
      icon: <LibraryIcon />,
      count: libraryTotal
    },
    {
      id: "downloads" as const,
      label: "Downloads",
      icon: <DownloadIcon />,
      count: Object.keys(downloads).length
    },
    { id: "settings" as const, label: "Settings", icon: <SettingsIcon />, count: 0 }
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <span>O</span>
          <span>B</span>
        </div>
        <div className="brand-text">
          <strong>OPENBRIDGE</strong>
          <span>CONTENT BRIDGE</span>
        </div>
      </div>

      {view === "discover" && (
        <div className="provider-switch" role="group" aria-label="Asset source">
          <button
            type="button"
            className={`provider-all${provider === "all" ? " active" : ""}`}
            aria-pressed={provider === "all"}
            onClick={() => setProvider("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`provider-megascans${provider === "megascans" ? " active" : ""}`}
            aria-pressed={provider === "megascans"}
            onClick={() => setProvider("megascans")}
          >
            Megascans
          </button>
          <button
            type="button"
            className={`provider-poliigon${provider === "poliigon" ? " active" : ""}`}
            aria-pressed={provider === "poliigon"}
            onClick={() => setProvider("poliigon")}
          >
            Poliigon
          </button>
          <button
            type="button"
            className={`provider-polyhaven${provider === "polyhaven" ? " active" : ""}`}
            aria-pressed={provider === "polyhaven"}
            onClick={() => setProvider("polyhaven")}
          >
            Poly Haven
          </button>
        </div>
      )}

      <div className="sidebar-scroll">
        <nav className="nav" aria-label="Main navigation">
          {items.map(item => (
            <button
              type="button"
              key={item.id}
              className={`${view === item.id ? "nav-item active" : "nav-item"}${item.id === "downloads" && downloadSummary.active.length ? " nav-downloading" : ""}`}
              title={item.id === "library" ? "Local files on disk — available offline." : undefined}
              onClick={() => setView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.count > 0 && (
                <span className="nav-count">{item.count.toLocaleString()}</span>
              )}
              {item.id === "downloads" && downloadSummary.active.length > 0 && <span className="nav-transfer">
                <span className="progress"><span className="progress-fill" style={{ width: `${(downloadSummary.ratio ?? 0) * 100}%` }} /></span>
                <small>{downloadSummary.active.length} active · {formatTransferBytes(downloadSummary.rate)}/s</small>
              </span>}
            </button>
          ))}
        </nav>

        {view === "discover" && provider === "all" && (
          <div className="sidebar-categories">
            <div className="sidebar-section-title">All categories</div>
            <CategoryTree
              nodes={allTypeNodes}
              selectedPath={allSourcePath(allType)}
              allLabel="All content"
              onSelect={path => setAllType(path.at(-1) ?? "")}
            />
          </div>
        )}
        {view === "discover" && provider === "megascans" && (
          <div className="sidebar-categories">
            <div className="sidebar-section-title">Megascans categories</div>
            {categoriesLoading && <p className="hint">Loading categories…</p>}
            <CategoryTree
              nodes={categories}
              selectedPath={categoryPath}
              onSelect={setCategoryPath}
            />
          </div>
        )}
        {view === "discover" && provider === "poliigon" && (
          <div className="sidebar-categories">
            <div className="sidebar-section-title">Poliigon categories</div>
            <CategoryTree
              nodes={poliigonCategories}
              selectedPath={categoryPathFor(poliigonCategories, poliigonCategoryIds[0])}
              onSelect={path => {
                const id = path.length > 0 ? Number(path[path.length - 1]) : NaN;
                setPoliigonCategoryIds(Number.isFinite(id) ? [id] : []);
              }}
            />
          </div>
        )}
        {view === "discover" && provider === "polyhaven" && (
          <div className="sidebar-categories">
            <div className="sidebar-section-title">Poly Haven categories</div>
            <CategoryTree
              nodes={polyHavenCategories}
              selectedPath={polyHavenCategoryPaths}
              onSelect={path => setPolyHavenCategoryPaths(path)}
            />
          </div>
        )}
        {view === "library" && (
          <div className="sidebar-categories">
            <div className="sidebar-section-title">Local categories</div>
            <CategoryTree nodes={localCategories} selectedPath={localCategoryPath}
              onSelect={setLocalCategoryPath} />
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button type="button" className="text-btn" onClick={() => void openLogs()}>
          Open log
        </button>
        {auth.loggedIn && (
          <button type="button" className="text-btn" onClick={() => void logout()}>
            <LogoutIcon /> Sign out
          </button>
        )}
        {versions && (
          <span className="version">
            v{versions.app} - Electron {versions.electron}
          </span>
        )}
      </div>
    </aside>
  );
}
