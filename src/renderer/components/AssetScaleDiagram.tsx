import { useId, useState } from "react";
import type { AssetTechnicalSummary } from "../../shared/types";
import { assetBounds, REFERENCE_HUMAN_HEIGHT, scaleDiagramLayout, scaleMeasurement } from "../../shared/asset-scale";

export function AssetScaleDiagram({ technical, variation }: { technical: AssetTechnicalSummary; variation?: number }) {
  const id = useId();
  const [units, setUnits] = useState<"metric" | "imperial">(() => localStorage.getItem("openbridge.scaleUnits") === "imperial" ? "imperial" : "metric");
  const [reference, setReference] = useState(() => {
    const value = Number(localStorage.getItem("openbridge.referenceHeight"));
    return [1.5, 1.6, 1.7, 1.78, 1.85, 2].includes(value) ? value : REFERENCE_HUMAN_HEIGHT;
  });
  const format = (value: number) => units === "imperial" ? `${Number((value / 0.0254).toPrecision(4))} in` : scaleMeasurement(value);
  const bounds = assetBounds(technical, variation);
  const layout = bounds ? scaleDiagramLayout(bounds, reference) : null;
  return <section className="asset-scale-panel" aria-labelledby={`${id}-heading`}>
    <div className="asset-scale-heading"><h3 id={`${id}-heading`}>Relative size</h3><span>Front orthographic</span></div>
    <div className="scale-controls"><label>Units <select value={units} onChange={event => {
      const value = event.target.value === "imperial" ? "imperial" : "metric"; setUnits(value); localStorage.setItem("openbridge.scaleUnits", value);
    }}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label>
      <label>Person <select value={reference} onChange={event => { const value = Number(event.target.value); setReference(value); localStorage.setItem("openbridge.referenceHeight", String(value)); }}>
        {[1.5, 1.6, 1.7, 1.78, 1.85, 2].map(value => <option key={value} value={value}>{format(value)}</option>)}
      </select></label></div>
    {bounds && layout ? <>
      <svg className="asset-scale-diagram" viewBox="0 0 420 268" role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>Asset bounding box beside a human</title>
        <desc id={`${id}-description`}>Same scale and ground line. Asset width {format(bounds.width)}, height {format(bounds.height)}.
          Depth {format(bounds.depth)} is not shown. Human height {format(reference)}.</desc>
        <line className="scale-ground" x1="24" x2="396" y1={layout.ground} y2={layout.ground} />
        <g className="scale-human" transform={`translate(${layout.humanX} ${layout.humanY}) scale(${layout.pixelsPerMeter * reference / REFERENCE_HUMAN_HEIGHT})`}>
          <circle cx="0.275" cy="0.105" r="0.105" />
          <path d="M.22 .24 L.33 .24 Q.42 .25 .45 .34 L.55 .87 L.47 .89 L.37 .5 L.37 .94 L.43 1.78 L.31 1.78 L.275 1.13 L.24 1.78 L.12 1.78 L.18 .94 L.18 .5 L.08 .89 L0 .87 L.1 .34 Q.13 .25 .22 .24 Z" />
        </g>
        <rect className="scale-bounds" x={layout.boxX} y={layout.boxY} width={layout.boxWidth} height={layout.boxHeight} />
        <line className="scale-guide" x1={layout.humanX - 12} x2={layout.humanX - 12} y1={layout.humanY} y2={layout.ground} />
        <line className="scale-guide" x1={layout.humanX - 16} x2={layout.humanX - 8} y1={layout.humanY} y2={layout.humanY} />
        <line className="scale-guide" x1={layout.humanX - 16} x2={layout.humanX - 8} y1={layout.ground} y2={layout.ground} />
      </svg>
      {Math.min(layout.boxWidth, layout.boxHeight) < 8 && <div className="scale-inset">
        <strong>Asset detail — enlarged, not to scale</strong>
        <svg viewBox="0 0 100 68" role="img" aria-label="Enlarged asset box detail; not to the human scale">
          <rect x={50 - bounds.width * Math.min(90 / bounds.width, 50 / bounds.height) / 2}
            y={34 - bounds.height * Math.min(90 / bounds.width, 50 / bounds.height) / 2}
            width={bounds.width * Math.min(90 / bounds.width, 50 / bounds.height)}
            height={bounds.height * Math.min(90 / bounds.width, 50 / bounds.height)} className="scale-bounds" />
        </svg>
      </div>}
      <div className="asset-scale-legend">
        <div><span><i className="scale-human-key" />Human reference</span><strong>{format(reference)} tall</strong></div>
        <div><span><i className="scale-box-key" />Asset bounding box</span><strong>{format(bounds.width)} wide × {format(bounds.height)} tall</strong></div>
      </div>
      <p className="hint">Same scale · width × height · {format(bounds.depth)} depth (not shown)
        {bounds.variation !== undefined ? ` · recorded variation ${bounds.variation}` : ""}.
        {Math.min(layout.boxWidth, layout.boxHeight, layout.humanHeight) < 1 ? " One or more dimensions are smaller than one diagram pixel; sizes are not exaggerated." : ""}
        {" "}Metadata bounds, not a mesh silhouette; asset orientation may differ from its preview.</p>
    </> : <p className="hint asset-scale-unavailable">Scale comparison unavailable: this asset has no complete, usable width, depth and height
      {variation !== undefined && technical.variationDimensions.length > 0 ? ` for variation ${variation}` : ""}.
      Scan area alone does not describe a 3D bounding box.</p>}
  </section>;
}
