import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Dropdown } from "./Dropdown";
import type { PackSummary } from "../../shared/types";
import { CheckIcon, ChevronDownIcon, CloseIcon, SearchIcon } from "../icons";

export function BrowsingMenu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.querySelector("summary")!.getBoundingClientRect();
    const panel = ref.current.querySelector<HTMLElement>(".browse-menu-panel")!;
    const height = Math.min(panel.scrollHeight, window.innerHeight * 0.55);
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${rect.bottom + 4 + height < window.innerHeight
      ? rect.bottom + 4 : Math.max(8, rect.top - height - 4)}px`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => { if (ref.current) ref.current.open = false; };
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); ref.current?.querySelector("summary")?.focus(); }
    };
    const scroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) close(); };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", keyboard);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("mousedown", outside); window.removeEventListener("keydown", keyboard);
      window.removeEventListener("resize", close); window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  return <details className="browse-menu" name="browsing-menu" ref={ref}
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{label}</summary><div className="browse-menu-panel">{children}</div>
  </details>;
}

export function DensityControl() {
  const density = useStore(state => state.density);
  const setDensity = useStore(state => state.setDensity);
  return <Dropdown className="filter-select" value={density} ariaLabel="Thumbnail size"
    onChange={value => setDensity(value as typeof density)} options={[
      { value: "compact", label: "Compact thumbnails" },
      { value: "comfortable", label: "Comfortable thumbnails" },
      { value: "large", label: "Large thumbnails" }
    ]} />;
}

export function RecentBrowsing() {
  const searches = useStore(state => state.recentSearches);
  const assets = useStore(state => state.recentlyViewed);
  const toast = useStore(state => state.toast);
  return <BrowsingMenu label="Recent">
      <div className="browse-menu-heading"><strong>Recent searches</strong>
        <button type="button" className="text-btn" onClick={() => useStore.getState().clearRecent()}>Clear history</button></div>
      {searches.length === 0 && <p className="hint">Searches you submit appear here.</p>}
      {searches.map(query => <button type="button" className="browse-list-item" key={query}
        onClick={event => {
          useStore.getState().setView("discover");
          useStore.getState().setQuery(query);
          void useStore.getState().search(true);
          event.currentTarget.closest("details")?.removeAttribute("open");
        }}>{query}</button>)}
      <strong>Recently viewed</strong>
      {assets.length === 0 && <p className="hint">Open an asset to start your history.</p>}
      {assets.map(asset => <button type="button" className="browse-list-item" key={`${asset.source}:${asset.id}`}
        onClick={event => {
          void useStore.getState().openRecent(asset).catch(error => toast(String(error), true));
          event.currentTarget.closest("details")?.removeAttribute("open");
        }}>{asset.name}<small>{asset.source === "local" ? "Local" : "Catalogue"}</small></button>)}
  </BrowsingMenu>;
}

export function PackBrowser({ packs, local = false }: { packs: PackSummary[]; local?: boolean }) {
  const [query, setQuery] = useState("");
  const metadata = useStore(state => state.catalogMetadata);
  const browsePack = useStore(state => state.browsePack);
  const matches = packs.filter(pack => pack.name.toLowerCase().includes(query.toLowerCase()));
  return <BrowsingMenu label={`Packs${packs.length > 0 ? ` (${packs.length})` : ""}`}>
      <strong>{local ? "Local packs" : "Catalogue packs"}</strong>
      <p className="hint">Based on recorded pack membership, not curated Bridge collections.
        {!local && metadata?.generatedAt ? ` Metadata: ${new Date(metadata.generatedAt).toLocaleDateString()}.` : ""}</p>
      <input aria-label="Search packs" placeholder="Find a pack..." value={query}
        onChange={event => setQuery(event.target.value)} />
      {matches.map(pack =>
        <button type="button" className="browse-list-item" key={pack.id || pack.name}
          onClick={event => {
            browsePack(pack, local);
            event.currentTarget.closest("details")?.removeAttribute("open");
          }}>{pack.name}<small>{pack.count.toLocaleString()} assets</small></button>)}
      {packs.length === 0 && <p className="hint">{local
        ? "No pack membership is recorded in this library."
        : "Install the optional catalogue metadata pack in Settings to browse recorded packs."}</p>}
      {packs.length > 0 && matches.length === 0 && <p className="hint">No packs match this search.</p>}
  </BrowsingMenu>;
}

export function FacetGroup({ group, label, values, selected, toggle, hidden = false }: {
  group: string; label: string; values: Record<string, number>; selected: string[]; toggle(value: string): void;
  hidden?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const entries = [...new Set([...selected, ...Object.keys(values)])]
    .filter(value => value && value !== "undefined")
    .filter(value => value.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(selected.includes(b)) - Number(selected.includes(a)) || (values[b] ?? 0) - (values[a] ?? 0) || a.localeCompare(b));
  const visible = query || expanded ? entries : entries.slice(0, Math.max(12, selected.length));
  return (
    <section className="facet-group" hidden={hidden} aria-label={`${label} filters`}>
      <div className="facet-group-head">
        <div className="facet-group-title">
          <h3>{label}</h3>
          <p>{selected.length > 0 ? `${selected.length} selected` : `${entries.length} available`}</p>
        </div>
        <div className="facet-group-tools">
          <div className="facet-search">
            <SearchIcon />
            <input
              aria-label={`Search ${label} filters`}
              placeholder={`Search ${label.toLowerCase()}`}
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                className="facet-search-clear"
                aria-label={`Clear ${label} search`}
                onClick={() => setQuery("")}
              >
                <CloseIcon />
              </button>
            )}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              className="text-btn facet-clear-group"
              onClick={() => selected.forEach(value => toggle(value))}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="facet-options" role="group" aria-label={`${label} options`}>
        {visible.map(value => {
          const active = selected.includes(value);
          return (
            <button
              type="button"
              key={value}
              className={active ? "facet-option active" : "facet-option"}
              aria-pressed={active}
              onClick={() => toggle(value)}
            >
              <span className="facet-option-check" aria-hidden="true">
                {active && <CheckIcon />}
              </span>
              <span className="facet-option-label">{value}</span>
              <span className="facet-option-count">{(values[value] ?? 0).toLocaleString()}</span>
            </button>
          );
        })}
        {entries.length === 0 && (
          <p className="hint">
            {query ? "No matching values." : "No values available for this search."}
          </p>
        )}
      </div>
      {entries.length > 12 && !query && (
        <div className="facet-group-foot">
          <button type="button" className="facet-show-all" onClick={() => setExpanded(value => !value)}>
            {expanded ? "Show less" : `Show all ${entries.length}`}
            <ChevronDownIcon className={expanded ? "flipped" : undefined} />
          </button>
        </div>
      )}
    </section>
  );
}
