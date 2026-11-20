import type { AssetRecord } from "../../shared/types";
import { RendererMark } from "./RendererMark";
import { usePresentationCard } from "./use-presentation-card";

export function SharedCardMeta({ asset }: { asset: AssetRecord }) {
  const card = usePresentationCard(asset);
  if (!card) return null;
  const byline = [card.category, card.job, card.artist].filter(Boolean).join(" · ");
  const formats = card.originalFormats?.length
    ? card.originalFormats
    : card.originalFormat ? [card.originalFormat] : [];
  const specs = [formats.join(" · "), card.renderer, card.originalSize].filter(Boolean).join(" · ");
  const detail = [...formats, card.renderer, card.originalSize, card.originalDetail].filter(Boolean).join(" · ");
  if (!byline && !specs) return null;
  return <span className="shared-card-meta">
    {card.category && <span title={byline}>{card.category}</span>}
    {specs && <span className="shared-card-specs" title={detail || specs}>
      {formats.length > 0 && <span className="shared-card-formats">
        Source: {formats.join(" · ")}
      </span>}
      {(card.renderer || card.originalSize) && <span className="shared-card-publish">
        {card.renderer && <span className="shared-card-renderer"><RendererMark renderer={card.renderer} />{card.renderer}</span>}
        {card.renderer && card.originalSize && " · "}
        {card.originalSize}
      </span>}
    </span>}
    {card.job && <span title={byline}>{card.job}</span>}
  </span>;
}
