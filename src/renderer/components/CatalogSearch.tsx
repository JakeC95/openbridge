import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { CloseIcon, SearchIcon } from "../icons";

export function CatalogSearch() {
  const query = useStore(state => state.query);
  const nbHits = useStore(state => state.nbHits);
  const setQuery = useStore(state => state.setQuery);
  const search = useStore(state => state.search);

  const [draft, setDraft] = useState(query);
  const firstRender = useRef(true);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (draft !== useStore.getState().query) {
        setQuery(draft);
        void search(true);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, search, setQuery]);

  useEffect(() => {
    return window.openbridge.onSearchPaste(({ text, search: shouldSearch }) => {
      setDraft(text);
      setQuery(text);
      if (shouldSearch) void search(true);
    });
  }, [search, setQuery]);

  const placeholder = `Search ${nbHits ? nbHits.toLocaleString() : "Megascans"} assets, or paste an asset ID / URL...`;

  return (
    <div className="search-wrap catalog-search">
      <SearchIcon className="search-icon" />
      <input
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            setQuery(draft);
            void search(true);
          }
        }}
        onContextMenu={event => {
          event.preventDefault();
          void window.openbridge.contextMenu.search();
        }}
        placeholder={placeholder}
        spellCheck={false}
        maxLength={256}
        aria-label="Search Megascans"
        autoFocus
      />
      {draft && (
        <button
          type="button"
          className="search-clear"
          onClick={() => {
            setDraft("");
            setQuery("");
            void search(true);
          }}
          aria-label="Clear search"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
