import type { MapPreview, SharedPresentation, SharedPresentationFact, SharedPresentationMap } from "../../shared/types";
import { RendererMark } from "./RendererMark";

function countLabel(value: number | undefined): string | undefined {
  return value === undefined ? undefined : value.toLocaleString();
}

function preview(type: string, label: string, url: string): MapPreview {
  return { type, label, url };
}

function mapViewerItems(maps: SharedPresentationMap[]): MapPreview[] {
  const items: MapPreview[] = [];
  for (const map of maps) {
    if (map.preview) items.push(preview(map.channel, map.label, map.preview));
    for (const tile of map.tilePreviews ?? []) {
      items.push(preview(map.channel, `${map.label} · ${tile.tile}`, tile.url));
    }
  }
  return items;
}

function Stat({ fact }: { fact: SharedPresentationFact }) {
  return <div className="shared-presentation-stat">
    <span>{fact.label}</span>
    <strong>{fact.value}</strong>
  </div>;
}

function Fact({ fact }: { fact: SharedPresentationFact }) {
  return <div className="shared-presentation-fact">
    <span>{fact.label}</span>
    <strong>{fact.value}</strong>
    {fact.detail && <small>{fact.detail}</small>}
  </div>;
}

export function SharedPresentationPanel({ presentation, onOpenImage }: {
  presentation: SharedPresentation;
  onOpenImage: (items: MapPreview[], index: number) => void;
}) {
  const gallery = (() => {
    const items = [
      ...(presentation.hero?.kind === "image" ? [presentation.hero] : []),
      ...presentation.media.filter(item => item.kind === "image")
    ];
    const seen = new Set<string>();
    return items.filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  })();
  const galleryItems = gallery.map(item => preview("Preview", item.label, item.url));
  const mapItems = mapViewerItems(presentation.maps);
  const partItems = presentation.parts.flatMap(part => part.preview
    ? [preview("Part", part.label ?? part.name, part.preview)]
    : []);
  const totalFaces = presentation.parts.reduce((sum, part) => sum + (part.faces ?? 0), 0);
  const openMap = (url?: string) => {
    if (!url) return;
    const index = mapItems.findIndex(item => item.url === url);
    onOpenImage(mapItems, index >= 0 ? index : 0);
  };
  const openPart = (url?: string) => {
    if (!url) return;
    const index = partItems.findIndex(item => item.url === url);
    onOpenImage(partItems, index >= 0 ? index : 0);
  };

  // Curated manifests choose a small primary set. Older or smaller manifests
  // fall back to four facts and the full map list.
  const primaryFacts = presentation.facts.filter(fact => fact.primary);
  const facts = primaryFacts.length ? primaryFacts : presentation.facts.slice(0, 4);
  const moreFacts = presentation.facts.filter(fact => !facts.includes(fact));
  const primaryMaps = presentation.maps.filter(map => map.primary);
  const maps = primaryMaps.length ? primaryMaps : presentation.maps;
  const moreMaps = primaryMaps.length ? presentation.maps.filter(map => !map.primary) : [];

  function renderMap(map: SharedPresentationMap, index: number) {
    return <div className="shared-presentation-map" key={`${map.channel}-${map.label}-${index}`} title={map.note}>
      {map.preview ? <button type="button" className="shared-presentation-map-image" aria-label={`View ${map.label}`}
        onClick={() => openMap(map.preview)}><img src={map.preview} alt={`${map.label} preview`} loading="lazy" /></button>
        : <div className="shared-map-unavailable">Preview unavailable</div>}
      <strong>{map.label}</strong>
      <span>{[map.resolution, map.format].filter(Boolean).join(" · ")}</span>
      <span>{[map.version, map.tiles?.length ? `${map.tiles.length} tiles` : "", map.part].filter(Boolean).join(" · ")}</span>
      {map.tilePreviews && map.tilePreviews.length > 0 && <div className="shared-presentation-tiles">
        {map.tilePreviews.map(tile => <button key={tile.tile} type="button" aria-label={`View ${map.label} tile ${tile.tile}`}
          onClick={() => openMap(tile.url)}>
          <img src={tile.url} alt={`${map.label} ${tile.tile}`} loading="lazy" />
          <span>{tile.tile}</span>
        </button>)}
      </div>}
    </div>;
  }

  return <section className="shared-presentation" aria-label="Asset details">
    {facts.length > 0 && <section className="shared-presentation-section">
      <h3>Specs</h3>
      <div className="shared-presentation-stats">
        {facts.map((fact, index) => fact.label === "Renderer"
          ? <div className="shared-presentation-stat" key={`${fact.label}-${index}`}>
            <span>{fact.label}</span>
            <strong className="shared-presentation-stat-value"><RendererMark renderer={fact.value} />{fact.value}</strong>
          </div>
          : <Stat fact={fact} key={`${fact.label}-${index}`} />)}
      </div>
      {moreFacts.length > 0 && <details className="shared-presentation-disclosure">
        <summary>More specifications ({moreFacts.length})</summary>
        <div className="shared-presentation-facts">
          {moreFacts.map((fact, index) => <Fact fact={fact} key={`${fact.label}-${index}`} />)}
        </div>
      </details>}
    </section>}

    {presentation.parts.length > 0 && <section className="shared-presentation-section">
      <h3>Anatomy <span className="hint">({presentation.parts.length})</span></h3>
      <ul className="shared-presentation-parts">
        {presentation.parts.map((part, index) => {
          const share = totalFaces && part.faces ? Math.max(1, Math.round(part.faces / totalFaces * 100)) : 0;
          return <li key={`${part.name}-${index}`} title={part.note}>
            <div className="shared-presentation-part-row">
              {part.preview && <button type="button" className="shared-presentation-part-preview"
                aria-label={`View ${part.label ?? part.name}`} onClick={() => openPart(part.preview)}>
                <img src={part.preview} alt={`${part.label ?? part.name} preview`} loading="lazy" />
              </button>}
              <div className="shared-presentation-part-body">
                <div className="shared-presentation-part-head">
                  <strong>{part.color && <i className="shared-presentation-swatch" style={{ background: part.color }} aria-hidden="true" />}
                    {part.label ?? part.name}</strong>
                  <span>{countLabel(part.faces) ? `${countLabel(part.faces)} faces` : ""}</span>
                </div>
                {share > 0 && <div className="shared-presentation-part-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></div>}
                <div className="shared-presentation-part-meta">
                  {countLabel(part.vertices) && <span>{countLabel(part.vertices)} vertices</span>}
                  {part.material && <span>Material {part.material}</span>}
                  {part.tile !== undefined && <span>UDIM {part.tile}</span>}
                </div>
              </div>
            </div>
          </li>;
        })}
      </ul>
    </section>}

    {presentation.maps.length > 0 && <section className="shared-presentation-section">
      <h3>Textures <span className="hint">({presentation.maps.length})</span></h3>
      <div className="shared-presentation-maps">
        {maps.map(renderMap)}
      </div>
      {moreMaps.length > 0 && <details className="shared-presentation-disclosure">
        <summary>Additional channels ({moreMaps.length})</summary>
        <div className="shared-presentation-maps">
          {moreMaps.map((map, index) => renderMap(map, index))}
        </div>
      </details>}
    </section>}

    {gallery.length > 0 && <section className="shared-presentation-section">
      <h3>Media <span className="hint">({gallery.length})</span></h3>
      <div className="shared-presentation-gallery">
        {gallery.map((item, index) => <button key={`${item.url}-${index}`} type="button" className="shared-presentation-gallery-card"
          aria-label={`View ${item.label}`} onClick={() => onOpenImage(galleryItems, index)}>
          <img src={item.url} alt={item.alt || item.label} loading="lazy" />
          <span>{item.label}</span>
        </button>)}
      </div>
    </section>}

    {presentation.versions.length > 0 && <details className="shared-presentation-disclosure">
      <summary>Version history ({presentation.versions.length})</summary>
      <ol className="shared-presentation-timeline">
        {presentation.versions.map((version, index) => <li key={`${version.label}-${index}`} className={version.current ? "current" : undefined}>
          <div>
            <strong>{version.label}{version.current ? <>{ " " }<span className="shared-presentation-current">Current</span></> : null}</strong>
            <span>{[version.kind, version.date].filter(Boolean).join(" · ")}</span>
            {version.note && <p className="hint">{version.note}</p>}
          </div>
        </li>)}
      </ol>
    </details>}

    {(presentation.links.length > 0 || presentation.credits.length > 0 || presentation.notes.length > 0) &&
      <details className="shared-presentation-disclosure">
        <summary>Source &amp; credits</summary>
        <div className="shared-presentation-columns">
          {presentation.links.length > 0 && <div>
            <h4>Sources</h4>
            <ul className="shared-presentation-links">
              {presentation.links.map((link, index) => <li key={`${link.label}-${index}`}>
                {link.href ? <button type="button" className="text-btn" onClick={() => void window.openbridge.openExternal(link.href!)}>{link.label}</button>
                  : <strong>{link.label}</strong>}
                {link.value && <span>{link.value}</span>}
                {link.note && <small>{link.note}</small>}
              </li>)}
            </ul>
          </div>}
          {presentation.credits.length > 0 && <div>
            <h4>Credits</h4>
            <ul className="shared-presentation-credits">
              {presentation.credits.map((credit, index) => <li key={`${credit.role}-${index}`}>
                <span>{credit.role}</span><strong>{credit.name}</strong>
              </li>)}
            </ul>
          </div>}
        </div>
        {presentation.notes.length > 0 && <div>
          <h4>Notes</h4>
          <ul className="shared-presentation-notes">
            {presentation.notes.map((note, index) => <li key={index}>{note}</li>)}
          </ul>
        </div>}
      </details>}

    {presentation.warnings.length > 0 && <details className="shared-presentation-disclosure shared-presentation-warnings">
      <summary>Skipped presentation details ({presentation.warnings.length})</summary>
      <ul>{presentation.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </details>}
  </section>;
}
