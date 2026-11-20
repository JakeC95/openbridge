import { useEffect, useState } from "react";
import type { AssetRecord, SharedPresentationCard } from "../../shared/types";

const cache = new Map<string, SharedPresentationCard | null>();

export function SharedCardMeta({ asset }: { asset: AssetRecord }) {
  const [card, setCard] = useState<SharedPresentationCard | null | undefined>(() => cache.get(asset.id));
  useEffect(() => {
    let current = true;
    if (cache.has(asset.id)) {
      setCard(cache.get(asset.id));
      return () => { current = false; };
    }
    void window.openbridge.sharedLibrary.presentationCard(asset.id).then(result => {
      cache.set(asset.id, result);
      if (current) setCard(result);
    }).catch(() => {
      if (current) setCard(null);
    });
    return () => { current = false; };
  }, [asset.id]);

  if (!card) return null;
  const byline = [card.job, card.artist].filter(Boolean).join(" · ");
  const specs = [card.originalFormat, card.renderer, card.originalSize].filter(Boolean).join(" · ");
  if (!byline && !specs) return null;
  return <span className="shared-card-meta">
    {byline && <span title={byline}>{byline}</span>}
    {specs && <span title={specs}>{specs}</span>}
  </span>;
}
