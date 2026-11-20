import type { MapPreview, SharedPresentation, SharedPresentationFact, SharedPresentationMap } from "../../shared/types";
import { assetBoundsFromDimensions } from "../../shared/asset-scale";
import { AssetScaleDiagram } from "./AssetScaleDiagram";
import { RendererMark, SoftwareMark } from "./RendererMark";

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
    <strong className="shared-presentation-stat-value"><SoftwareMarks text={fact.value} />{fact.value}</strong>
  </div>;
}

function Fact({ fact }: { fact: SharedPresentationFact }) {
  return <div className="shared-presentation-fact">
    <span>{fact.label}</span>
    <strong className="shared-presentation-stat-value"><SoftwareMarks text={fact.value} />{fact.value}</strong>
    {fact.detail && <small className="shared-presentation-fact-detail"><SoftwareMarks text={fact.detail} />{fact.detail}</small>}
  </div>;
}

function SoftwareMarks({ text }: { text: string }) {
  const names = ["Arnold", "Maya", "Houdini", "Nuke"];
  const matches = names.filter(name => new RegExp(`\\b${name}\\b`, "i").test(text));
  return <>{matches.map(name => <SoftwareMark key={name} software={name} className="shared-inline-software-mark" />)}</>;
}

function presentationScaleDimensions(presentation: SharedPresentation): string | undefined {
  const fact = presentation.facts.find(item => /dimensions/i.test(item.label));
  const values = fact?.value.match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i);
  if (!values) return undefined;
  // The curated dimension is X × Y × Z with Y-up; the shared scale diagram
  // consumes depth × width × height.
  const dimensions = `${values[3]} × ${values[1]} × ${values[2]} ${values[4]}`;
  return assetBoundsFromDimensions(dimensions) ? dimensions : undefined;
}

export function SharedPresentationPanel({ presentation, onOpenImage }: {
  presentation: SharedPresentation;
  onOpenImage: (items: MapPreview[], index: number) => void;
}) {
  const allGallery = (() => {
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
  const gallery = allGallery.filter(item => !item.group);
  const groupedGallery = [...allGallery.reduce((groups, item) => {
    if (!item.group) return groups;
    const group = groups.get(item.group) ?? [];
    group.push(item);
    groups.set(item.group, group);
    return groups;
  }, new Map<string, typeof allGallery>()).entries()];
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
  const artistFacts = presentation.facts.filter(fact =>
    !/\bpreview\b|\bglb\b/i.test(fact.label));
  const primaryFacts = artistFacts.filter(fact => fact.primary);
  const scaleDimensions = presentationScaleDimensions(presentation);
  const sourceFormatsFact = artistFacts.find(fact => /formats?|model files/i.test(fact.label));
  const formats = presentation.original?.formats?.length
    ? presentation.original.formats : [presentation.original?.format].filter(Boolean);
  const facts = [
    ...(sourceFormatsFact ? [sourceFormatsFact] : formats.length ? [{ label: "Published formats", value: formats.join(" · ") }] : []),
    ...(primaryFacts.length ? primaryFacts : artistFacts).filter(fact => fact !== sourceFormatsFact)
  ];
  facts.splice(4);
  const moreFacts = [
    ...artistFacts.filter(fact => !facts.includes(fact)),
  ].sort((a, b) => {
    const priority = (label: string) => {
      const key = label.toLowerCase();
      if (/formats?|model files?/.test(key)) return 0;
      if (/dimensions|relative size/.test(key)) return 1;
      if (/faces|triangles|vertices|parts|materials/.test(key)) return 2;
      if (/textures?|maps?|udim/.test(key)) return 3;
      if (/renderer|render stack/.test(key)) return 4;
      if (/source|publish/.test(key)) return 5;
      if (/project|asset code/.test(key)) return 6;
      if (/preview glb|preview geometry/.test(key)) return 9;
      return 7;
    };
    return priority(a.label) - priority(b.label);
  });
  const primaryMaps = presentation.maps.filter(map => map.primary);
  const maps = primaryMaps.length ? primaryMaps : presentation.maps;
  const moreMaps = primaryMaps.length ? presentation.maps.filter(map => !map.primary) : [];
  const provenanceTitle = presentation.credits.length
    ? "Sources & credits"
    : presentation.links.length && presentation.notes.length
      ? "Production sources & notes"
      : presentation.links.length ? "Production sources" : "Notes";

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
          {facts.map((fact, index) => /renderer/i.test(fact.label)
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

    {scaleDimensions && <AssetScaleDiagram dimensions={scaleDimensions} />}

    {(gallery.length > 0 || groupedGallery.length > 0) && <section className="shared-presentation-section">
      {gallery.length > 0 && <>
        <h3>Views <span className="hint">({gallery.length})</span></h3>
        <div className="shared-presentation-gallery shared-presentation-gallery-primary">
          {gallery.map((item, index) => <button key={`${item.url}-${index}`} type="button" className="shared-presentation-gallery-card"
            aria-label={`View ${item.label}`} onClick={() => onOpenImage(galleryItems, index)}>
            <img src={item.url} alt={item.alt || item.label} loading="lazy" />
            <span>{item.label.replace(/\s*·\s*Blender preview$/i, "")}</span>
          </button>)}
        </div>
      </>}
      {groupedGallery.map(([group, items]) => {
        const groupViewerItems = items.map(item => preview("Preview", item.label, item.url));
        return <details className="shared-presentation-disclosure" key={group}>
          <summary>{group} <span className="hint">({items.length})</span></summary>
          <div className="shared-presentation-gallery">
            {items.map((item, index) => <button key={`${item.url}-${index}`} type="button" className="shared-presentation-gallery-card"
              aria-label={`View ${item.label}`} onClick={() => onOpenImage(groupViewerItems, index)}>
              <img src={item.url} alt={item.alt || item.label} loading="lazy" />
              <span>{item.label}</span>
            </button>)}
          </div>
        </details>;
      })}
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
                  {part.material && <span>Material slot {part.material}</span>}
                  {part.tile !== undefined && <span>UDIM {part.tile}</span>}
                </div>
              </div>
            </div>
          </li>;
        })}
      </ul>
    </section>}

    {presentation.maps.length > 0 && <section className="shared-presentation-section">
      <h3>Textures &amp; masks <span className="hint">({presentation.maps.length})</span></h3>
      <div className="shared-presentation-maps">
        {maps.map(renderMap)}
      </div>
      {moreMaps.length > 0 && <details className="shared-presentation-disclosure">
        <summary>Other maps ({moreMaps.length})</summary>
        <div className="shared-presentation-maps">
          {moreMaps.map((map, index) => renderMap(map, index))}
        </div>
      </details>}
    </section>}

    {(presentation.links.length > 0 || presentation.credits.length > 0 || presentation.notes.length > 0) &&
      <details className="shared-presentation-disclosure">
        <summary>{provenanceTitle}</summary>
        <div className="shared-presentation-columns">
          {presentation.links.length > 0 && <div>
            <h4>Sources</h4>
            <ul className="shared-presentation-links">
              {presentation.links.map((link, index) => <li key={`${link.label}-${index}`}>
                {link.href ? <button type="button" className="text-btn" onClick={() => void window.openbridge.openExternal(link.href!)}>{link.label}</button>
                  : <strong>{link.label}</strong>}
                {link.value && <span><SoftwareMarks text={link.value} />{link.value}</span>}
                {link.note && <small><SoftwareMarks text={link.note} />{link.note}</small>}
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
