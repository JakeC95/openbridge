import { useEffect, useState } from "react";
import { CloseIcon, SearchIcon } from "../icons";
import { usePolyHavenStore } from "../polyhaven-store";
import { useStore } from "../store";

const RECENT_KEY = "openbridge.polyhavenRecentSearches";

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function writeRecent(values: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(values));
  } catch {
    // ignore
  }
}

export function PolyHavenSearch() {
  const query = usePolyHavenStore(state => state.query);
  const setQuery = usePolyHavenStore(state => state.setQuery);
  const [draft, setDraft] = useState(query);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [focused, setFocused] = useState(false);

  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft !== usePolyHavenStore.getState().query) setQuery(draft);
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, setQuery]);

  const remember = (text: string): void => {
    const value = text.trim();
    if (!value) return;
    const next = [value, ...recent.filter(item => item !== value)].slice(0, 8);
    setRecent(next);
    writeRecent(next);
  };

  return (
    <div className="scoped-search poliigon-search">
      <div className="search-scope" role="group" aria-label="Search scope">
        <button
          type="button"
          className="active"
          aria-pressed="true"
          onClick={() => useStore.getState().setView("discover")}
        >
          Catalogue
        </button>
        <button
          type="button"
          aria-pressed="false"
          onClick={() => {
            const state = useStore.getState();
            state.setLocalProvider("polyhaven");
            state.setView("library");
          }}
        >
          Library
        </button>
      </div>
      <div className="search-wrap catalog-search">
        <SearchIcon className="search-icon" />
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              remember(draft);
              setQuery(draft);
              setFocused(false);
            }
          }}
          placeholder="Search Poly Haven HDRIs, textures, models or IDs…"
          spellCheck={false}
          maxLength={256}
          aria-label="Search Poly Haven"
        />
        {draft && (
          <button
            type="button"
            className="search-clear"
            onClick={() => {
              setDraft("");
              setQuery("");
            }}
            aria-label="Clear search"
          >
            <CloseIcon />
          </button>
        )}
        {focused && !draft && recent.length > 0 && (
          <div className="poliigon-recent-searches">
            <div className="poliigon-recent-head">
              <strong>Recent searches</strong>
              <button
                type="button"
                className="text-btn"
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  setRecent([]);
                  writeRecent([]);
                }}
              >
                Clear
              </button>
            </div>
            {recent.map(item => (
              <button
                type="button"
                key={item}
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  setDraft(item);
                  setQuery(item);
                  setFocused(false);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
