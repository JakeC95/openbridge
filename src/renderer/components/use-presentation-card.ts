import { useEffect, useState } from "react";
import type { AssetRecord, SharedPresentationCard } from "../../shared/types";

const cache = new Map<string, SharedPresentationCard | null>();
const pending = new Map<string, Promise<SharedPresentationCard | null>>();

/** Shared card metadata, fetched once per asset and reused by the badge and text. */
export function usePresentationCard(asset: AssetRecord): SharedPresentationCard | null | undefined {
  const [card, setCard] = useState<SharedPresentationCard | null | undefined>(() => cache.get(asset.id));
  useEffect(() => {
    let current = true;
    if (cache.has(asset.id)) {
      setCard(cache.get(asset.id));
      return () => { current = false; };
    }
    let request = pending.get(asset.id);
    if (!request) {
      request = window.openbridge.sharedLibrary.presentationCard(asset.id).catch(() => null);
      pending.set(asset.id, request);
    }
    void request.then(result => {
      cache.set(asset.id, result);
      pending.delete(asset.id);
      if (current) setCard(result);
    });
    return () => { current = false; };
  }, [asset.id]);
  return card;
}
