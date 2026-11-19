import { useState } from "react";
import { readPreference, writePreference } from "../browsing-state";
import { useStore } from "../store";
import type { LibrarySort } from "../../shared/types";

const validSorts = new Set<LibrarySort>(["recent", "name", "name-desc", "type", "resolution", "triangles", "maps", "lods", "variations", "size", "issues"]);

interface SavedSearch {
  id: string;
  name: string;
  query: string;
  type: string;
  group: boolean;
  root: string;
  format: string;
  collection: string;
  tag: string;
  category: string[];
  sort: LibrarySort;
  favorites: boolean;
}

function loadSearches(): SavedSearch[] {
  const raw = readPreference<unknown>("sharedSavedSearches", []);
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).flatMap(value => {
    if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.name !== "string" || !value.name.trim()) return [];
    const text = (key: keyof SavedSearch): string => typeof value[key] === "string" ? value[key].slice(0, 300) : "";
    return [{
      id: value.id, name: text("name"), query: text("query"),
      type: ["3d", "hdri"].includes(value.type) ? value.type : "",
      group: value.group === true, root: text("root"), format: text("format"), collection: text("collection"), tag: text("tag"),
      category: Array.isArray(value.category) ? value.category.filter((entry: unknown): entry is string => typeof entry === "string").slice(0, 64) : [],
      sort: validSorts.has(value.sort) ? value.sort : "recent" as const,
      favorites: value.favorites === true
    }];
  });
}

export function SharedSavedSearches() {
  const [searches, setSearches] = useState(loadSearches);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const existing = searches.find(entry => entry.id === selected);

  function setList(next: SavedSearch[]) {
    setSearches(next);
    writePreference("sharedSavedSearches", next);
  }

  function save() {
    const label = name.trim();
    if (!label) return;
    const state = useStore.getState();
    const entry: SavedSearch = {
      id: crypto.randomUUID(), name: label, query: state.localQuery,
      type: state.localType, group: state.groupSharedVariants, root: state.sharedRoot, format: state.sharedFormat, collection: state.sharedCollection, tag: state.sharedTag,
      category: [...state.localCategoryPath], sort: state.localSort, favorites: state.localFavoritesOnly
    };
    setList([entry, ...searches.filter(item => item.name.toLowerCase() !== label.toLowerCase())].slice(0, 30));
    setSelected(entry.id);
    setName("");
  }

  function restore(search: SavedSearch) {
    const store = useStore.getState();
    store.closeSelection();
    store.resetLocalFilters();
    store.setGroupSharedVariants(search.group);
    useStore.setState({
      localQuery: search.query, localType: search.type, localSort: search.sort,
      localCategoryPath: search.category, localFavoritesOnly: search.favorites,
      sharedRoot: search.root, sharedFormat: search.format, sharedCollection: search.collection, sharedTag: search.tag
    });
  }

  return <details className="browse-menu">
    <summary>Saved searches</summary>
    <div className="browse-menu-panel shared-organization">
      <label>Saved shared search
        <select aria-label="Saved shared search" value={selected} onChange={event => setSelected(event.target.value)}>
          <option value="">Choose a saved search</option>
          {searches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="button-row horizontal">
        <button type="button" className="btn btn-ghost" disabled={!existing}
          onClick={() => { if (existing) restore(existing); }}>Apply</button>
        <button type="button" className="text-btn" disabled={!existing}
          onClick={() => { setList(searches.filter(item => item.id !== selected)); setSelected(""); }}>Remove</button>
      </div>
      <form className="shared-organization" onSubmit={event => { event.preventDefault(); save(); }}>
        <label>Save current search <input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
        <button type="submit" className="btn btn-ghost" disabled={!name.trim()}>Save search</button>
      </form>
    </div>
  </details>;
}
