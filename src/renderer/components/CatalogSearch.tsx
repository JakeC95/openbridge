import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { usePoliigonStore } from "../poliigon-store";
import { usePolyHavenStore } from "../polyhaven-store";
import { CloseIcon, SearchIcon } from "../icons";
import { useGlobalSuggestions, type GlobalSuggestion } from "../use-global-suggestions";
import { usePublicStore } from "../public-store";
import { SmartThumbImage } from "./SmartThumbImage";

const STARTERS = [
  { label: "Trees", query: "tree" },
  { label: "Plants", query: "plant" },
  { label: "HDRIs", query: "hdri" },
  { label: "Brick", query: "brick" },
  { label: "Wood", query: "wood" },
  { label: "Furniture", query: "chair" }
];
const SEARCH_ACTION = "full-search";

function providerInitials(label: string): string {
  return label.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

/** One search surface; each scope retains its own query and filters. */
export function CatalogSearch() {
  const view = useStore(state => state.view);
  const provider = useStore(state => state.provider);
  const query = useStore(state => state.query);
  const localQuery = useStore(state => state.localQuery);
  const recentSearches = useStore(state => state.recentSearches);
  const filtersActive = useStore(state => Boolean(
    state.type ||
    state.allType ||
    state.allStateFilter !== "all" ||
    state.categoryPath.length ||
    state.categoryPaths.length ||
    Object.keys(state.facetFilters).length ||
    state.favoritesOnly ||
    state.freeOnly ||
    state.downloadedOnly ||
    state.sizeFilter !== "any" ||
    state.catalogPack
  ));
  const localFiltersActive = useStore(state => Boolean(
    state.localType ||
    state.localProvider !== "all" ||
    state.localCategoryPath.length ||
    state.localRepo !== "all" ||
    state.localReady.length ||
    state.localMaxTris ||
    state.localColor ||
    state.localState ||
    state.localInterior ||
    state.localFavoritesOnly ||
    state.localPack
  ));
  const local = view === "library";
  const allSources = provider === "all" && !local;
  const poliRefined = usePoliigonStore(state => allSources && Boolean(state.resolutions.length || state.creationMethods.length ||
    state.mapTypes.length || state.weather.length || state.timeStart != null || state.timeEnd != null));
  const polyRefined = usePolyHavenStore(state => allSources && Boolean(state.resolutions.length || state.mapTypes.length ||
    state.categoriesFilter.length || state.collections.length || Object.values(state.attributeFilters).some(values => values.length) ||
    state.timeStart != null || state.timeEnd != null));
  const publicRefined = usePublicStore(state => allSources && Object.values(state.providers).some(({ query }) =>
    Boolean(query.licenses?.length || query.resolutions?.length || query.mapTypes?.length || query.modelFormats?.length ||
      query.weather?.length || query.tags?.length || query.minResolution != null || query.maxTris != null ||
      query.minBytes != null || query.maxBytes != null || query.timeWindows?.length)));
  const value = local ? localQuery : query;
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsEnabled = focused && (local ? !localFiltersActive : allSources && !filtersActive && !poliRefined && !polyRefined && !publicRefined);
  const suggestions = useGlobalSuggestions(draft, suggestionsEnabled, local ? "local" : "all");
  const panelOpen = focused && suggestionsEnabled;
  const hasQuery = Boolean(draft.trim());
  const actionIndex = suggestions.items.length;
  const activeMax = suggestions.items.length + (hasQuery ? 1 : 0);
  const activeSuggestion = activeKey === SEARCH_ACTION ? actionIndex : suggestions.items.findIndex(item => item.key === activeKey);

  useEffect(() => setDraft(value), [value, local]);
  useEffect(() => setActiveKey(null), [draft, local]);
  useEffect(() => {
    if (!panelOpen || !hasQuery || activeSuggestion < 0) return;
    document.getElementById(`global-suggestion-${activeSuggestion}`)?.scrollIntoView({ block: "nearest" });
  }, [panelOpen, hasQuery, activeSuggestion]);
  useEffect(() => {
    // Fast enough to feel like typeahead, slow enough to avoid a provider
    // request for every keypress. Enter still submits immediately.
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
    }, 140);
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1 || event.key === " ") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return;
      if (document.querySelector(".drawer, .palette, .model-viewer.fullscreen, .image-viewer")) return;
      if (!inputRef.current) return;
      event.preventDefault();
      setDraft(event.key);
      setFocused(true);
      inputRef.current.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const submit = (text: string) => {
    setFocused(false);
    setActiveKey(null);
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
  const chooseSuggestion = (suggestion: GlobalSuggestion) => {
    const state = useStore.getState();
    const text = draft.trim();
    if (local) {
      if (state.localQuery !== draft) submit(draft);
    } else if (state.query !== draft) {
      submit(draft);
    } else if (text) {
      state.rememberSearch(text);
    }
    setFocused(false);
    setActiveKey(null);
    inputRef.current?.blur();
    suggestion.open();
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
    <div className="search-wrap catalog-search" onKeyDown={event => {
      if (event.key !== "Escape" || !panelOpen || event.nativeEvent.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.focus();
      setFocused(false);
      setActiveKey(null);
    }} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setFocused(false);
        setActiveKey(null);
      }
    }}>
      <SearchIcon className="search-icon" />
      <input ref={inputRef} value={draft} onChange={event => { setDraft(event.target.value); setFocused(true); }}
        onFocus={() => setFocused(true)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && panelOpen && activeMax > 0) {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const next = activeSuggestion < 0
              ? direction > 0 ? 0 : activeMax - 1
              : (activeSuggestion + direction + activeMax) % activeMax;
            setActiveKey(suggestions.items[next]?.key ?? SEARCH_ACTION);
            return;
          }
          if (event.key === "Escape" && panelOpen) {
            event.preventDefault();
            event.stopPropagation();
            setFocused(false);
            setActiveKey(null);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (panelOpen && activeSuggestion >= 0 && activeSuggestion < suggestions.items.length) {
              chooseSuggestion(suggestions.items[activeSuggestion]);
              return;
            }
            submit(draft);
          }
        }}
        onContextMenu={event => { event.preventDefault(); void window.openbridge.contextMenu.search(); }}
        placeholder={placeholder}
        spellCheck={false} maxLength={256} aria-label={ariaLabel} role="combobox"
        aria-haspopup="listbox" aria-autocomplete="list" aria-expanded={panelOpen && hasQuery}
        aria-controls={panelOpen && hasQuery ? "global-search-suggestions" : undefined}
        aria-activedescendant={panelOpen && hasQuery && activeSuggestion >= 0 ? `global-suggestion-${activeSuggestion}` : undefined} />
      {draft && <button type="button" className="search-clear" onClick={() => submit("")} aria-label="Clear search"><CloseIcon /></button>}
      {panelOpen && (
        <div className="global-search-panel">
          {hasQuery ? (
            <>
              <div className="global-search-head">
                <span>Quick matches</span>
                {suggestions.loading && <span className="spinner" aria-label="Loading suggestions" />}
              </div>
              {suggestions.items.length === 0 && <div className="global-search-empty" role="status">
                {suggestions.loading ? (local ? "Searching your library…" : "Searching local catalogues…")
                  : local ? "No quick matches in your library." : "No quick matches. Press Enter to search all sources."}
              </div>}
              <div id="global-search-suggestions" role="listbox" aria-label="Search suggestions">
              {suggestions.items.map((item, index) => (
                <button
                  key={item.key}
                  id={`global-suggestion-${index}`}
                  type="button"
                  tabIndex={-1}
                  role="option"
                  aria-selected={activeSuggestion === index}
                  className={`global-search-item${activeSuggestion === index ? " active" : ""}`}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => chooseSuggestion(item)}
                >
                  <span className="global-search-thumb" data-provider={item.provider}>
                    {item.thumbnail
                      ? <SmartThumbImage source={item.thumbnail} direct fallbackContent={providerInitials(item.providerLabel)} />
                      : providerInitials(item.providerLabel)}
                  </span>
                  <span className="global-search-copy">
                    <strong>{item.name}</strong>
                    <small>{item.providerLabel} · {item.typeLabel}</small>
                  </span>
                  {item.free && <em>Free</em>}
                </button>
              ))}
              <button
                type="button"
                id={`global-suggestion-${actionIndex}`}
                role="option"
                aria-selected={activeSuggestion === actionIndex}
                tabIndex={-1}
                className={`global-search-action${activeSuggestion === actionIndex ? " active" : ""}`}
                onMouseDown={event => event.preventDefault()}
                onClick={() => submit(draft)}
              >
                <span>{local ? "Search your library" : "Search all sources"} for “{draft.trim()}”</span>
                <kbd>Enter</kbd>
              </button>
              </div>
            </>
          ) : (
            <>
              {!local && recentSearches.length > 0 && (
                <div className="global-search-section">
                  <div className="global-search-head"><span>Recent searches</span></div>
                  <div className="global-search-chips">
                    {recentSearches.slice(0, 6).map(term => (
                      <button key={term} type="button" onMouseDown={event => event.preventDefault()} onClick={() => submit(term)}>{term}</button>
                    ))}
                  </div>
                </div>
              )}
              {!local && (
                <div className="global-search-section">
                  <div className="global-search-head"><span>Try searching for</span></div>
                  <div className="global-search-chips">
                    {STARTERS.map(item => (
                      <button key={item.query} type="button" onMouseDown={event => event.preventDefault()} onClick={() => submit(item.query)}>{item.label}</button>
                    ))}
                  </div>
                </div>
              )}
              {local && (
                <div className="global-search-empty">Start typing to search your downloaded library.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  </div>;
}
