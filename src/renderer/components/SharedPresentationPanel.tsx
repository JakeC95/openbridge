import type { MapPreview, SharedPresentation, SharedPresentationMap } from "../../shared/types";

function countLabel(value: number | undefined): string | undefined {
  return value === undefined ? undefined : value.toLocaleString();
}

function preview(type: string, label: string, url: string): MapPreview {
  return { type, label, url };
}

function mapViewerItems(maps: SharedPresentationMap[]): MapPreview[] {
  const items: MapPreview[] = [];
  for (const map of maps) {
    if (map.preview) items.push(preview(map.channel, `${map.label}${map.version ? ` · ${map.version}` : ""}`, map.preview));
    for (const tile of map.tilePreviews ?? []) {
      items.push(preview(map.channel, `${map.label} · ${tile.tile}`, tile.url));
    }
  }
  return items;
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
  const openMap = (map: SharedPresentationMap, url?: string) => {
    if (!url) return;
    const index = mapItems.findIndex(item => item.url === url);
    onOpenImage(mapItems, index >= 0 ? index : 0);
  };
  const openPart = (url?: string) => {
    if (!url) return;
    const index = partItems.findIndex(item => item.url === url);
    onOpenImage(partItems, index >= 0 ? index : 0);
  };

  return <section className="shared-presentation" aria-label="Asset details">
    {presentation.facts.length > 0 && <section className="shared-presentation-section">
      <h3>At a glance</h3>
      <div className="shared-presentation-facts">
        {presentation.facts.map((fact, index) => <div className="shared-presentation-fact" key={`${fact.label}-${index}`}>
          <span>{fact.label}</span>
          <strong>{fact.value}</strong>
          {fact.detail && <small>{fact.detail}</small>}
        </div>)}
      </div>
    </section>}

    {gallery.length > 0 && <section className="shared-presentation-section">
      <h3>Media <span className="hint">({gallery.length})</span></h3>
      <div className="shared-presentation-gallery">
        {gallery.map((item, index) => <button key={`${item.url}-${index}`} type="button" className="shared-presentation-gallery-card"
          aria-label={`View ${item.label}`} onClick={() => onOpenImage(galleryItems, index)}>
          <img src={item.url} alt={item.alt || item.label} loading="lazy" />
          <span>{item.label}</span>
          {item.caption && <small>{item.caption}</small>}
        </button>)}
      </div>
    </section>}

    {presentation.parts.length > 0 && <section className="shared-presentation-section">
      <h3>Anatomy <span className="hint">({presentation.parts.length} parts)</span></h3>
      <ul className="shared-presentation-parts">
        {presentation.parts.map((part, index) => {
          const share = totalFaces && part.faces ? Math.max(1, Math.round(part.faces / totalFaces * 100)) : 0;
          return <li key={`${part.name}-${index}`}>
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
                {part.note && <p className="hint">{part.note}</p>}
              </div>
            </div>
          </li>;
        })}
      </ul>
    </section>}

    {presentation.maps.length > 0 && <section className="shared-presentation-section">
      <h3>Texture set <span className="hint">({presentation.maps.length} channels)</span></h3>
      <div className="shared-presentation-maps">
        {presentation.maps.map((map, index) => <div className="shared-presentation-map" key={`${map.channel}-${index}`}>
          {map.preview ? <button type="button" className="shared-presentation-map-image" aria-label={`View ${map.label}`}
            onClick={() => openMap(map, map.preview)}><img src={map.preview} alt={`${map.label} preview`} loading="lazy" /></button>
            : <div className="shared-map-unavailable">Preview unavailable</div>}
          <strong>{map.label}</strong>
          <span>{[map.channel, map.resolution, map.format].filter(Boolean).join(" · ")}</span>
          <span>{[map.version, map.tiles?.length ? `${map.tiles.length} tiles` : "", map.part].filter(Boolean).join(" · ")}</span>
          {map.note && <small>{map.note}</small>}
          {map.tilePreviews && map.tilePreviews.length > 0 && <div className="shared-presentation-tiles">
            {map.tilePreviews.map(tile => <button key={tile.tile} type="button" aria-label={`View ${map.label} tile ${tile.tile}`}
              onClick={() => openMap(map, tile.url)}>
              <img src={tile.url} alt={`${map.label} ${tile.tile}`} loading="lazy" />
              <span>{tile.tile}</span>
            </button>)}
          </div>}
        </div>)}
      </div>
    </section>}

    {presentation.versions.length > 0 && <section className="shared-presentation-section">
      <h3>Version history</h3>
      <ol className="shared-presentation-timeline">
        {presentation.versions.map((version, index) => <li key={`${version.label}-${index}`} className={version.current ? "current" : undefined}>
          <div>
            <strong>{version.label}{version.current ? <>{ " " }<span className="shared-presentation-current">Current</span></> : null}</strong>
            <span>{[version.kind, version.date].filter(Boolean).join(" · ")}</span>
            {version.note && <p className="hint">{version.note}</p>}
          </div>
        </li>)}
      </ol>
    </section>}

    {(presentation.links.length > 0 || presentation.credits.length > 0) && <section className="shared-presentation-section">
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
    </section>}

    {presentation.notes.length > 0 && <section className="shared-presentation-section">
      <h3>Curator notes</h3>
      <ul className="shared-presentation-notes">
        {presentation.notes.map((note, index) => <li key={index}>{note}</li>)}
      </ul>
    </section>}

    {presentation.warnings.length > 0 && <details className="shared-presentation-warnings">
      <summary>Skipped presentation details ({presentation.warnings.length})</summary>
      <ul>{presentation.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </details>}
  </section>;
}
