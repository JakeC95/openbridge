import { useEffect, useState } from "react";
import { useStore } from "../store";
import { usePoliigonStore } from "../poliigon-store";
import { usePolyHavenStore } from "../polyhaven-store";
import { CloseIcon, SearchIcon } from "../icons";

/** One search surface; each scope retains its own query and filters. */
export function CatalogSearch() {
  const view = useStore(state => state.view);
  const provider = useStore(state => state.provider);
  const query = useStore(state => state.query);
  const localQuery = useStore(state => state.localQuery);
  const local = view === "library";
  const allSources = provider === "all" && !local;
  const value = local ? localQuery : query;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, local]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const state = useStore.getState();
      if (state.view !== view) return;
      if (local) {
        if (draft !== state.localQuery) state.setLocalQuery(draft);
      } else {
        if (draft !== state.query) {
          state.setQuery(draft);
          void state.search(true);
        }
        if (allSources && draft !== usePoliigonStore.getState().query) {
          usePoliigonStore.getState().setQuery(draft);
        }
        if (allSources && draft !== usePolyHavenStore.getState().query) {
          usePolyHavenStore.getState().setQuery(draft);
        }
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [allSources, draft, local, view]);
  useEffect(() => window.openbridge.onSearchPaste(({ text, search }) => {
    const state = useStore.getState();
    if (state.view !== "discover" && state.view !== "library") return;
    setDraft(text);
    if (state.view === "library") state.setLocalQuery(text);
    else {
      state.setQuery(text);
      if (state.provider === "all") {
        usePoliigonStore.getState().setQuery(text);
        usePolyHavenStore.getState().setQuery(text);
      }
      if (search) { state.rememberSearch(text); void state.search(true); }
    }
  }), []);
  const submit = (text: string) => {
    const state = useStore.getState();
    setDraft(text);
    if (local) state.setLocalQuery(text);
    else {
      state.setQuery(text);
      if (state.provider === "all") {
        usePoliigonStore.getState().setQuery(text);
        usePolyHavenStore.getState().setQuery(text);
      }
      state.rememberSearch(text);
      void state.search(true);
    }
  };
  const placeholder = local
    ? "Search your local library…"
    : provider === "all"
      ? "Search all sources, asset ID or URL…"
      : "Search Megascans, asset ID or URL…";
  const ariaLabel = local
    ? "Search local library"
    : provider === "all"
      ? "Search all asset sources"
      : "Search Megascans";
  return <div className="scoped-search">
    <div className="search-scope" role="group" aria-label="Search scope">
      {(["discover", "library"] as const).map(scope => <button key={scope} type="button"
        aria-pressed={view === scope} className={view === scope ? "active" : ""}
        onClick={() => {
          const state = useStore.getState();
          if (scope === "library" && state.provider === "all") state.setLocalProvider("all");
          state.setView(scope);
        }}>{scope === "discover" ? "Catalogue" : "Library"}</button>)}
    </div>
    <div className="search-wrap catalog-search">
      <SearchIcon className="search-icon" />
      <input value={draft} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); submit(draft); } }}
        onContextMenu={event => { event.preventDefault(); void window.openbridge.contextMenu.search(); }}
        placeholder={placeholder}
        spellCheck={false} maxLength={256} aria-label={ariaLabel} />
      {draft && <button type="button" className="search-clear" onClick={() => submit("")} aria-label="Clear search"><CloseIcon /></button>}
    </div>
  </div>;
}
