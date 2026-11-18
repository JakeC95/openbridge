import { useEffect, useState } from "react";

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

/**
 * Resolves a thumbnail through the main-process alpha-bounds cache. Opaque
 * images resolve to the original URL; transparent subjects resolve to a
 * tightly cropped cache file.
 */
export function useSmartThumbnail(source: string | null | undefined, crop?: "top-2-1"): string | null {
  const key = source && crop ? `${source}\u0001${crop}` : source;
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!source || !key || cache.has(key)) return;
    let cancelled = false;
    let request = pending.get(key);
    if (!request) {
      request = window.openbridge.smartThumbnail(source, crop)
        .then(result => {
          cache.set(key, result);
          return result;
        })
        .catch(() => source)
        .finally(() => {
          pending.delete(key);
        });
      pending.set(key, request);
    }
    void request.then(result => {
      if (!cancelled) setResolved({ key, url: result });
    });
    return () => {
      cancelled = true;
    };
  }, [source, crop, key]);

  return key ? (resolved?.key === key ? resolved.url : cache.get(key) ?? source ?? null) : null;
}
