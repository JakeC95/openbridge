import { useEffect, useState } from "react";

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

/**
 * Resolves a thumbnail through the main-process alpha-bounds cache. Opaque
 * images resolve to the original URL; transparent subjects resolve to a
 * tightly cropped cache file.
 */
export function useSmartThumbnail(source: string | null | undefined): string | null {
  const [value, setValue] = useState<string | null>(() =>
    source ? cache.get(source) ?? source : null
  );

  useEffect(() => {
    if (!source) {
      setValue(null);
      return;
    }
    const cached = cache.get(source);
    if (cached) {
      setValue(cached);
      return;
    }
    let cancelled = false;
    setValue(source);
    let request = pending.get(source);
    if (!request) {
      request = window.openbridge.smartThumbnail(source)
        .then(result => {
          cache.set(source, result);
          return result;
        })
        .catch(() => source)
        .finally(() => {
          pending.delete(source);
        });
      pending.set(source, request);
    }
    void request.then(result => {
      if (!cancelled) setValue(result);
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return value;
}
