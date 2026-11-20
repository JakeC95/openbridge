import type { AssetRecord } from "../../shared/types";
import { RendererMark } from "./RendererMark";
import { usePresentationCard } from "./use-presentation-card";

export function SharedCardMeta({ asset }: { asset: AssetRecord }) {
  const card = usePresentationCard(asset);
  if (!card) return null;
  const byline = [card.job, card.artist].filter(Boolean).join(" · ");
  const specs = [card.originalFormat, card.renderer, card.originalSize].filter(Boolean).join(" · ");
  if (!byline && !specs) return null;
  return <span className="shared-card-meta">
    {byline && <span title={byline}>{byline}</span>}
    {specs && <span title={specs}>{specs}</span>}
  </span>;
}

export function SharedRendererBadge({ asset }: { asset: AssetRecord }) {
  const card = usePresentationCard(asset);
  if (!card?.renderer) return null;
  return <RendererMark renderer={card.renderer} className="shared-renderer-badge" />;
}
