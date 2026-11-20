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
    {specs && <span className="shared-card-specs" title={specs}>
      {card.originalFormat && <span>{card.originalFormat}</span>}
      {card.originalFormat && (card.renderer || card.originalSize) && <span className="shared-card-separator">·</span>}
      {card.renderer && <span className="shared-card-renderer">
        <RendererMark renderer={card.renderer} />
        {card.renderer}
      </span>}
      {card.renderer && card.originalSize && <span className="shared-card-separator">·</span>}
      {card.originalSize && <span>{card.originalSize}</span>}
    </span>}
  </span>;
}
