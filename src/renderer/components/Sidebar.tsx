import { useStore } from "../store";
import {
  DiscoverIcon,
  DownloadIcon,
  LibraryIcon,
  LogoutIcon,
  SettingsIcon
} from "../icons";
import { CategoryTree } from "./CategoryTree";

export function Sidebar() {
  const view = useStore(state => state.view);
  const setView = useStore(state => state.setView);
  const auth = useStore(state => state.auth);
  const versions = useStore(state => state.versions);
  const logout = useStore(state => state.logout);
  const categories = useStore(state => state.categories);
  const categoryPath = useStore(state => state.categoryPath);
  const setCategoryPath = useStore(state => state.setCategoryPath);
  const nbHits = useStore(state => state.nbHits);
  const localAssets = useStore(state => state.localAssets);
  const downloads = useStore(state => state.downloads);
  const openLogs = window.openbridge.openLogs;

  const items = [
    {
      id: "discover" as const,
      label: "Discover",
      icon: <DiscoverIcon />,
      count: nbHits
    },
    {
      id: "library" as const,
      label: "Library",
      icon: <LibraryIcon />,
      count: localAssets.length
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
          <span>MEGASCANS MANAGER</span>
        </div>
      </div>

      <div className="sidebar-scroll">
        <nav className="nav" aria-label="Main navigation">
          {items.map(item => (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.count > 0 && (
                <span className="nav-count">{item.count.toLocaleString()}</span>
              )}
            </button>
          ))}
        </nav>

        {view === "discover" && (
          <div className="sidebar-categories">
            <div className="sidebar-section-title">Categories</div>
            <CategoryTree
              nodes={categories}
              selectedPath={categoryPath}
              onSelect={setCategoryPath}
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
