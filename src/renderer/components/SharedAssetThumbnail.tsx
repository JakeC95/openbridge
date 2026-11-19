import { useEffect, useRef, useState } from "react";
import type { AssetRecord, SharedAssetThumbnail as ThumbnailResult } from "../../shared/types";
import "./SharedAssetThumbnail.css";

const results = new Map<string, ThumbnailResult>();
const waiting: Array<() => void> = [];
let running = 0;
// Limit IPC requests before they enter the single HDR decoder queue. Scrolling
// away cancels work, so offscreen cards cannot fill it with obsolete requests.
function schedule<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++;
      work().then(resolve, reject).finally(() => {
        running--;
        waiting.shift()?.();
      });
    };
    if (running < 2) run(); else waiting.push(run);
  });
}

export function SharedAssetThumbnail({ asset, className = "" }: { asset: AssetRecord; className?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const key = JSON.stringify([asset.id, asset.path, asset.mtime, asset.sizeBytes]);
  const [state, setState] = useState<{ key: string; value?: ThumbnailResult; error?: string } | null>(null);
  const [visible, setVisible] = useState(false);
  const result = state?.key === key ? state.value : results.get(key);
  const error = state?.key === key ? state.error : undefined;
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: "100px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || results.has(key)) return;
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    const cancel = () => void window.openbridge.sharedLibrary.cancelThumbnail(requestId).catch(() => {});
    controller.signal.addEventListener("abort", cancel, { once: true });
    void schedule(async () => {
      controller.signal.throwIfAborted();
      const value = await window.openbridge.sharedLibrary.thumbnail(asset.id, requestId);
      controller.signal.throwIfAborted();
      if (results.size >= 512) results.delete(results.keys().next().value!);
      results.set(key, value);
      setState({ key, value });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
  }, [asset.id, key, visible]);
  return <span ref={host} className="shared-thumbnail">
    {result?.url ? <img src={result.url} alt="" loading="lazy" className={className} title={result.kind === "geometry" ? "Generated geometry preview. Open the asset for materials and textures." : "Generated HDR preview"} onError={() => {
      results.delete(key);
      setState({ key, error: "Cached preview is unavailable. Reopen this view to regenerate it." });
    }} /> : <span className="asset-placeholder" title={error || result?.reason || "A preview is generated when this card is visible."}>
      {error || result ? "Preview unavailable" : visible ? "Preparing preview…" : asset.type === "hdri" ? "HDRI" : "3D Model"}
    </span>}
    {result?.url && result.kind === "geometry" && <span className="shared-thumbnail-kind">Geometry preview</span>}
  </span>;
}
