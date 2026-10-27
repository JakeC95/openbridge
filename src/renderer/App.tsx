import { useEffect } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { CatalogSearch } from "./components/CatalogSearch";
import { CommandPalette } from "./components/CommandPalette";
import { AssetDrawer } from "./components/AssetDrawer";
import { DiscoverView } from "./views/DiscoverView";
import { LibraryView } from "./views/LibraryView";
import { DownloadsView } from "./views/DownloadsView";
import { SettingsView } from "./views/SettingsView";
import { CloseIcon, SyncIcon, UserIcon } from "./icons";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  discover: { title: "Discover", subtitle: "Megascans catalogue" },
  library: { title: "Library", subtitle: "Local assets on disk" },
  downloads: { title: "Downloads", subtitle: "Queue and history" },
  settings: { title: "Settings", subtitle: "Configuration" }
};

export function App() {
  const init = useStore(state => state.init);
  const dispose = useStore(state => state.dispose);
  const view = useStore(state => state.view);
  const auth = useStore(state => state.auth);
  const profile = useStore(state => state.profile);
  const sync = useStore(state => state.sync);
  const busy = useStore(state => state.busy);
  const toasts = useStore(state => state.toasts);
  const dismissToast = useStore(state => state.dismissToast);
  const login = useStore(state => state.login);
  const runSync = useStore(state => state.runSync);

  useEffect(() => {
    void init();
    return () => dispose();
  }, [dispose, init]);

  const meta = TITLES[view] ?? TITLES.discover;

  return (
    <div className="shell">
      <Sidebar />

      <main className="main">
        <header className={view === "discover" ? "topbar topbar-catalog" : "topbar"}>
          {view === "discover" ? (
            <CatalogSearch />
          ) : (
            <div className="topbar-title">
              <h1>{meta.title}</h1>
              <span>{meta.subtitle}</span>
            </div>
          )}

          <div className="topbar-actions">
            {auth.loggedIn && (
              <button
                type="button"
                className="sync-button"
                onClick={() => void runSync()}
                title={
                  sync.missing > 0
                    ? `Sync acquired assets — ${sync.missing.toLocaleString()} not in library`
                    : "Sync acquired assets"
                }
              >
                <SyncIcon className={sync.running ? "spin" : ""} />
                <span>{sync.running ? "Syncing" : "Sync"}</span>
                {sync.missing > 0 && <i className="sync-dot" />}
              </button>
            )}

            {auth.loggedIn ? (
              <div
                className="user-pill"
                title={`${auth.email} — ${profile?.subscription?.planId || auth.planId || "Epic"}`}
              >
                <div className="avatar small">{auth.email.slice(0, 1).toUpperCase() || "?"}</div>
                <div>
                  <strong>{auth.email.split("@")[0]}</strong>
                  <span>{profile?.subscription?.planId || "Epic"}</span>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void login()}>
                <UserIcon /> Sign in
              </button>
            )}
          </div>
        </header>

        <div className="content">
          <div className="view-slot" hidden={view !== "discover"}><DiscoverView /></div>
          <div className="view-slot" hidden={view !== "library"}><LibraryView /></div>
          {view === "downloads" && <DownloadsView />}
          {view === "settings" && <SettingsView />}
        </div>
      </main>

      <AssetDrawer />
      <CommandPalette />

      <div className="toasts">
        {toasts.map(toast => (
          <div key={toast.id} className={toast.error ? "toast error" : "toast"}>
            <span>{toast.message}</span>
            <button type="button" className="icon-btn" onClick={() => dismissToast(toast.id)}>
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>

      {busy && (
        <div className="busy-overlay">
          <div className="busy-card">
            <div className="spinner" />
            <h2>Waiting for Epic sign-in...</h2>
            <p>Complete the login in the Epic Games window. This screen closes automatically.</p>
          </div>
        </div>
      )}
    </div>
  );
}

