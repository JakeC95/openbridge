import type { AssetRecord } from "../../shared/types";
import { RendererIdentity } from "./RendererMark";
import { usePresentationCard } from "./use-presentation-card";

function compactFormat(format: string) {
  return format.match(/\.([a-z0-9]+)$/i)?.[0].toLowerCase() ?? format;
}

function compactSize(size?: string) {
  return size?.match(/^\s*([\d.,]+\s*(?:bytes?|[kmgt]i?b))\b/i)?.[1] ?? size;
}

export function PublishedAssetType({ asset, fallback }: { asset: AssetRecord; fallback: string }) {
  return usePresentationCard(asset)?.category || fallback;
}

export function PublishedFormats({ asset }: { asset: AssetRecord }) {
  const card = usePresentationCard(asset);
  const formats = card?.originalFormats?.length ? card.originalFormats : [card?.originalFormat].filter(Boolean);
  return <>
    {formats.length > 0 && <div className="hint asset-list-published-formats">Source: {formats.join(" · ")}</div>}
    {card?.renderer && <div className="hint asset-list-production-renderer"><RendererIdentity renderer={card.renderer} /></div>}
  </>;
}

export function SharedCardMeta({ asset }: { asset: AssetRecord }) {
  const card = usePresentationCard(asset);
  const formats = card?.originalFormats?.length
    ? card.originalFormats
    : card?.originalFormat ? [card.originalFormat] : [];
  return <span className="shared-card-meta">
    <span className="shared-card-type">{card?.category || "3D Model"}</span>
    <span className="shared-card-specs">
      <Spec label="Formats" value={[...new Set(formats.map(compactFormat))].join(" · ")} detail={formats.join(" · ")} />
      <Spec label="Renderer" value={card?.renderer} />
      <Spec label="Source size" value={compactSize(card?.originalSize)} detail={card?.originalSize} />
    </span>
  </span>;
}

function Spec({ label, value, detail }: { label: string; value?: string; detail?: string }) {
  return <span className="shared-card-spec" title={`${label}: ${detail || value || "Not documented"}`}>
    <span>{label}</span>
    <span aria-label={value ? undefined : "Not documented"}>{label === "Renderer" && value ? <RendererIdentity renderer={value} /> : value || "—"}</span>
  </span>;
}
