import { useMemo } from "react";
import { useStore } from "../store";
import { usePoliigonStore } from "../poliigon-store";
import { usePolyHavenStore } from "../polyhaven-store";
import { usePublicStore } from "../public-store";
import { publicTypeForCategory } from "../public-taxonomy";
import { PUBLIC_PROVIDER_IDS, isPublicProviderId, publicProviderLabel } from "../../shared/public-providers";
import type { AssetProvider, CategoryNode } from "../../shared/types";
import { allCategoryNodes, allSourcePath, polyHavenHdriCategoryRoots } from "../all-sources";
import {
  DiscoverIcon,
  DownloadIcon,
  LibraryIcon,
  LogoutIcon,
  SettingsIcon
} from "../icons";
import { CategoryTree } from "./CategoryTree";
import { formatTransferBytes, summarizeDownloads } from "../download-summary";

/**
 * Poliigon's provider Sky > Clear/Partly Cloudy/Overcast buckets are not
 * reliable weather filters. Hide those entry points; the curated Sky condition
 * facet and the unified Discover tree use normalised data instead.
 */
function poliigonCategoryLabel(label: string): string {
  const lower = label.trim().toLowerCase();
  if (lower === "hdris") return "HDRIs";
  if (lower === "fields") return "Fields";
  return label;
}

function formatPoliigonCategories(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.map(node => ({
    ...node,
    label: poliigonCategoryLabel(node.label),
    children: formatPoliigonCategories(node.children)
  }));
}

function poliigonHdriCategoryRoot(root: CategoryNode): CategoryNode {
  const hiddenWeather = new Set(["clear", "partly cloudy", "overcast"]);
  return {
    ...root,
    children: root.children
      .filter(node => node.label.trim().toLowerCase() !== "free")
      .map(node => node.label.trim().toLowerCase() === "sky"
        ? {
            ...node,
            children: node.children.filter(child => !hiddenWeather.has(child.label.trim().toLowerCase()))
          }
        : node)
  };
}

function categoryPathFor(nodes: CategoryNode[], id: number | string | undefined): string[] {
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
  const publicStates = usePublicStore(state => state.providers);
  const setProvider = useStore(state => state.setProvider);
  const disabledProviders = useStore(state => state.disabledProviders);
  const toggleProviderEnabled = useStore(state => state.toggleProviderEnabled);
  const enableAllProviders = useStore(state => state.enableAllProviders);
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
  const poliigonType = usePoliigonStore(state => state.type);
  const poliigonCategoryIds = usePoliigonStore(state => state.categoryIds);
  const setPoliigonCategoryIds = usePoliigonStore(state => state.setCategoryIds);
  const polyHavenCategories = usePolyHavenStore(state => state.categories);
  const polyHavenType = usePolyHavenStore(state => state.type);
  const polyHavenCategoryPaths = usePolyHavenStore(state => state.categoryPaths);
  const setPolyHavenCategoryPaths = usePolyHavenStore(state => state.setCategoryPaths);
  const openLogs = window.openbridge.openLogs;
  const allTypeNodes = useMemo(() => allCategoryNodes(polyHavenCategories), [polyHavenCategories]);
  const poliigonHdriRoot = useMemo(
    () => poliigonCategories.find(node => node.label.trim().toLowerCase() === "hdris"),
    [poliigonCategories]
  );
  const poliigonHdriScope = poliigonType === "HDRS";
  const visiblePoliigonCategories = useMemo(
    () => poliigonHdriScope && poliigonHdriRoot
      ? formatPoliigonCategories([poliigonHdriCategoryRoot(poliigonHdriRoot)])
      : formatPoliigonCategories(poliigonCategories),
    [poliigonHdriScope, poliigonHdriRoot, poliigonCategories]
  );
  const polyHavenHdriRoots = useMemo(
    () => polyHavenHdriCategoryRoots(polyHavenCategories),
    [polyHavenCategories]
  );
  const selectedPolyHavenRoot = polyHavenCategoryPaths[0]?.split("/")[0] ?? "";
  const polyHavenHdriScope = polyHavenType === "hdris" ||
    polyHavenHdriRoots.some(root => root.key === selectedPolyHavenRoot);
  const visiblePolyHavenCategories = polyHavenHdriScope
    ? polyHavenHdriRoots
    : polyHavenCategories;
  const hdriScope = allType === "hdri" || allType.startsWith("hdri:");
  const discoverCount = provider === "all"
    ? nbHits + poliigonTotal + polyHavenTotal + PUBLIC_PROVIDER_IDS.reduce((sum, id) => sum + publicStates[id].total, 0)
    : isPublicProviderId(provider) ? publicStates[provider].total : provider === "poliigon"
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
        <>
        <div className="provider-switch" role="group" aria-label="Asset sources">
          <button
            type="button"
            className={`provider-all${provider === "all" && disabledProviders.length === 0 ? " active" : ""}`}
            aria-pressed={provider === "all" && disabledProviders.length === 0}
            title="Show every source"
            onClick={() => { enableAllProviders(); setProvider("all"); }}
          >
            All
          </button>
          {([
            ["megascans", "Megascans"],
            ["poliigon", "Poliigon"],
            ["polyhaven", "Poly Haven"],
            ...PUBLIC_PROVIDER_IDS.map(id => [id, publicProviderLabel(id)] as const)
          ] as Array<[AssetProvider, string]>).map(([id, label]) => {
            const enabled = !disabledProviders.includes(id);
            return <button
              key={id}
              type="button"
              className={`provider-${id}${provider === id ? " active" : ""}${enabled ? "" : " disabled"}`}
              aria-pressed={enabled}
              title={`${label} ${enabled ? "enabled" : "disabled"} · click to ${enabled ? "disable" : "enable"}`}
              onClick={() => { if (provider === id && enabled) setProvider("all"); else toggleProviderEnabled(id); }}
            >
              {label}
            </button>;
          })}
        </div>
        {view === "discover" && provider === "all" && disabledProviders.length > 0 && (
          <p className="provider-switch-note">
            {disabledProviders.length} {disabledProviders.length === 1 ? "source" : "sources"} hidden
            <button type="button" className="text-btn" onClick={enableAllProviders}>Restore all</button>
          </p>
        )}
        </>
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
            <div className="sidebar-section-title">{hdriScope ? "HDRI categories" : "All categories"}</div>
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
            <div className="sidebar-section-title">
              {poliigonHdriScope ? "Poliigon HDRI categories" : "Poliigon categories"}
            </div>
            <CategoryTree
              nodes={visiblePoliigonCategories}
              selectedPath={categoryPathFor(poliigonCategories, poliigonCategoryIds[0])}
              onSelect={path => {
                const id = path.length > 0 ? Number(path[path.length - 1]) : NaN;
                setPoliigonCategoryIds(Number.isFinite(id) ? [id] : []);
              }}
            />
            {poliigonHdriScope && (
              <p className="hint">Use Filters → Sky condition for clear, cloudy and overcast.</p>
            )}
          </div>
        )}
        {view === "discover" && provider === "polyhaven" && (
          <div className="sidebar-categories">
            <div className="sidebar-section-title">
              {polyHavenHdriScope ? "Poly Haven HDRI categories" : "Poly Haven categories"}
            </div>
            <CategoryTree
              nodes={visiblePolyHavenCategories}
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
        {view === "discover" && isPublicProviderId(provider) && (
          <div className="sidebar-categories">
            <div className="sidebar-section-title">{publicProviderLabel(provider)} categories</div>
            <CategoryTree
              nodes={publicStates[provider].categories}
              selectedPath={categoryPathFor(publicStates[provider].categories, publicStates[provider].query.categoryPaths?.[0])}
              onSelect={path => {
                const category = path.at(-1) ?? "";
                const type = category ? publicTypeForCategory(provider, category) : null;
                void usePublicStore.getState().search(provider, true, { categoryPaths: category ? [category] : [], ...(type ? { types: [type] } : {}) });
              }}
            />
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
