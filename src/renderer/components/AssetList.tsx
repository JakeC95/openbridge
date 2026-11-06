import { useState } from "react";
import type { AssetTechnicalSummary } from "../../shared/types";
import { assetBounds, scaleMeasurement } from "../../shared/asset-scale";
import { formatMeasurementText } from "../../shared/measurements";
import { SmartThumbImage } from "./SmartThumbImage";
import { poliigonMapName } from "../poliigon-labels";

export interface AssetListItem {
  key: string;
  name: string;
  type: string;
  id?: string;
  image?: string | null;
  technical?: AssetTechnicalSummary;
  dimensions?: string | null;
  resolution?: string | null;
  status?: string;
  category?: string;
  facts?: string[];
  onOpen(): void;
}

export function AssetList({ items, selectedKeys, onToggle, totalSelected, initialCompare = false }: {
  items: AssetListItem[]; selectedKeys?: ReadonlySet<string>; onToggle?(key: string): void;
  totalSelected?: number; initialCompare?: boolean;
}) {
  const [ownSelected, setOwnSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(initialCompare);
  const selected = selectedKeys ?? new Set(ownSelected);
  const matching = items.filter(item => selected.has(item.key));
  const chosen = matching.slice(0, 4);
  const omitted = Math.max(0, (totalSelected ?? matching.length) - chosen.length);
  const toggle = (key: string) => {
    if (onToggle) onToggle(key);
    else setOwnSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  };
  return <div className="asset-list-view">
    <div className="asset-list-actions"><span>{selected.size.toLocaleString()} selected · showing up to 4 in comparison</span>
      <button className="btn btn-ghost" type="button" disabled={chosen.length < 2} onClick={() => setComparing(value => !value)}>{comparing ? "Hide comparison" : "Compare selected"}</button>
      {!onToggle && <button className="text-btn" type="button" disabled={!selected.size} onClick={() => { setOwnSelected([]); setComparing(false); }}>Clear</button>}
    </div>
    {omitted > 0 && <p className="compare-notice" role="status">{omitted.toLocaleString()} selected asset{omitted === 1 ? " is" : "s are"} not shown: comparison displays the first four selected assets currently loaded. Deselect others below or load more results.</p>}
    {comparing && chosen.length < 2 && <p className="compare-notice">Select at least two loaded assets below to compare them.</p>}
    {comparing && chosen.length >= 2 && <section className="comparison-workbench" aria-label="Asset comparison">
      <div className="comparison-header"><div><span className="comparison-eyebrow">SIDE BY SIDE</span><h2>Compare assets</h2>
        <p>Inspect previews and available metadata together. Missing values are not estimated.</p></div><span className="comparison-count">{chosen.length} assets</span></div>
      <div className="comparison-scroll"><div className="comparison-columns" style={{ gridTemplateColumns: `repeat(${chosen.length}, minmax(230px, 1fr))` }}>
        {chosen.map(item => {
          const technical = item.technical;
          const bounds = technical ? assetBounds(technical) : null;
          const isSurface = /surface|atlas|decal|imperfection|displacement|brush/i.test(item.type);
          const max = bounds ? Math.max(bounds.height, 1.78) : 1.78;
          return <article className="comparison-card" key={item.key}>
            <div className="comparison-preview">{item.image ? <SmartThumbImage source={item.image} alt="" /> : <span>No preview available</span>}
              <span className="comparison-status">{item.status || "Unknown status"}</span></div>
            <div className="comparison-card-body"><div className="comparison-title"><div><span>{item.type || "Asset"}</span><h3 title={item.name}>{item.name}</h3></div>
              <button type="button" className="icon-btn" onClick={() => toggle(item.key)} aria-label={`Remove ${item.name} from comparison`}>×</button></div>
              {item.category && <p className="comparison-category">{item.category}</p>}
              {item.id && <p className="comparison-id">Asset ID: {item.id}</p>}
              <div className="comparison-metrics">
                <div><span>Dimensions</span><strong>{item.dimensions ? formatMeasurementText(item.dimensions) : "Not available"}</strong></div>
                <div><span>Max resolution</span><strong>{item.resolution || "Not available"}</strong></div>
                {!isSurface && <><div><span>Triangles</span><strong>{technical?.maxTris ? technical.maxTris.toLocaleString() : "Not available"}</strong></div>
                <div><span>LODs</span><strong>{technical?.lodCount || "Not available"}</strong></div></>}
                <div><span>Maps</span><strong>{technical?.mapCount || "Not available"}</strong></div>
                <div><span>Workflow</span><strong>{technical?.materialWorkflow === "metal-rough" ? "Metal / Rough" : technical?.materialWorkflow === "spec-gloss" ? "Specular / Gloss" : technical?.materialWorkflow === "mixed" ? "Mixed" : "Not available"}</strong></div>
                {isSurface && <><div><span>Tileable</span><strong>{technical?.tileable == null ? "Not available" : technical.tileable ? "Yes" : "No"}</strong></div>
                <div><span>Scan area</span><strong>{technical?.scanArea ? formatMeasurementText(technical.scanArea) : "Not available"}</strong></div></>}
              </div>
              {!isSurface && <div className="comparison-scale"><div className="comparison-scale-label"><span>Height reference</span><strong>{bounds ? scaleMeasurement(bounds.height) : "Not available"}</strong></div>
                {bounds ? <div className="comparison-bars" aria-label={`Asset height ${scaleMeasurement(bounds.height)}; human 1.78 metres`}>
                  <div><i style={{ width: `${Math.max(0, bounds.height / max * 100)}%` }} /><small>Asset</small></div>
                  <div><i style={{ width: `${1.78 / max * 100}%` }} /><small>Human · 1.78 m</small></div>
                </div> : <p className="hint">Complete bounding dimensions unavailable.</p>}
              </div>}
              {technical?.mapTypes && technical.mapTypes.length > 0 && <div className="comparison-tags" aria-label="Available map types">{technical.mapTypes.map(map => <span key={map}>{/^[A-Z0-9_]+$/.test(map) ? poliigonMapName(map) : map}</span>)}</div>}
              {item.facts && item.facts.length > 0 && <div className="comparison-tags">{item.facts.map(fact => <span key={fact}>{fact}</span>)}</div>}
              <button type="button" className="btn btn-ghost comparison-open" onClick={item.onOpen}>Open asset</button>
            </div>
          </article>;
        })}
      </div></div>
      <p className="comparison-footnote">Preview images are not to scale. Where available, height bars are scaled within each card against a 1.78 m reference; compare numerical labels across cards.</p>
    </section>}
    <div className="asset-list-scroll"><table className="asset-list"><thead><tr><th>Select</th><th>Asset</th><th>Type</th><th>Dimensions</th><th>Resolution</th><th>Status</th></tr></thead>
      <tbody>{items.map(item => <tr key={item.key} onClick={item.onOpen}>
        <td onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${item.name} for comparison`} checked={selected.has(item.key)} onChange={() => toggle(item.key)} /></td>
        <td><button type="button" className="text-btn asset-list-name" onClick={event => { event.stopPropagation(); item.onOpen(); }}>{item.name}</button></td>
        <td>{item.type || "Unknown"}</td><td>{item.dimensions ? formatMeasurementText(item.dimensions) : "—"}</td><td>{item.resolution || "—"}</td><td>{item.status || "—"}</td>
      </tr>)}</tbody></table></div>
    <p className="hint">Only loaded assets appear in this list. Comparison uses existing metadata; additional details may require opening an asset.</p>
  </div>;
}
