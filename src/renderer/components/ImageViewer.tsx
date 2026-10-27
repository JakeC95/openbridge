import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MapPreview } from "../../shared/types";

interface LoadedPreview { url: string; width: number; height: number }
interface Upgrade {
  key: string;
  phase: "loading" | "ready" | "error" | "none";
  image?: LoadedPreview;
}

export function ImageViewer({ items, index, onIndex, onClose, loadHighResolution }: {
  items: MapPreview[]; index: number; onIndex(index: number): void; onClose(): void;
  loadHighResolution?(item: MapPreview, signal?: AbortSignal): Promise<MapPreview | null>;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fallback, setFallback] = useState({ key: "", loaded: false, failed: false });
  const [upgrade, setUpgrade] = useState<Upgrade>({ key: "", phase: "none" });
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<string, LoadedPreview>());
  const dialog = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const item = items[index];
  const imageKey = item ? JSON.stringify({ url: item.url, type: item.type, map: item.map }) : "";
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [imageKey]);
  useEffect(() => {
    if (!item) return;
    if (!item.map || !loadHighResolution) {
      setUpgrade({ key: imageKey, phase: "none" });
      return;
    }
    const cached = cache.current.get(imageKey);
    if (cached) {
      setUpgrade({ key: imageKey, phase: "ready", image: cached });
      return;
    }
    let cancelled = false;
    const request = new AbortController();
    let image: HTMLImageElement | null = null;
    const fail = () => {
      if (cancelled) return;
      setUpgrade({ key: imageKey, phase: "error" });
    };
    setUpgrade({ key: imageKey, phase: "loading" });
    const timeout = window.setTimeout(() => {
      fail(); cancelled = true;
      request.abort();
      if (image) { image.onload = null; image.onerror = null; image.src = ""; }
    }, 60_000);
    void loadHighResolution(item, request.signal).then(preview => {
      if (cancelled) return;
      if (!preview) { window.clearTimeout(timeout); setUpgrade({ key: imageKey, phase: "none" }); return; }
      image = new Image();
      image.referrerPolicy = "no-referrer";
      image.onload = () => {
        const loaded = image!;
        void loaded.decode().then(() => {
          if (cancelled) return;
          const decoded = { url: preview.url, width: loaded.naturalWidth, height: loaded.naturalHeight };
          cache.current.set(imageKey, decoded);
          if (cache.current.size > 4) cache.current.delete(cache.current.keys().next().value!);
          window.clearTimeout(timeout);
          setUpgrade({ key: imageKey, phase: "ready", image: decoded });
        }).catch(() => { window.clearTimeout(timeout); fail(); });
      };
      image.onerror = () => { window.clearTimeout(timeout); fail(); };
      image.src = preview.url;
    }).catch(() => { window.clearTimeout(timeout); fail(); });
    return () => {
      cancelled = true; window.clearTimeout(timeout);
      request.abort();
      if (image) { image.onload = null; image.onerror = null; image.src = ""; }
    };
  }, [imageKey, item, loadHighResolution, retry]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById("root");
    if (root) root.inert = true;
    dialog.current?.focus();
    return () => {
      if (root) root.inert = false;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return;
      }
      if (event.key === "Tab") {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),select") ?? [])];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
      if ((event.target as HTMLElement)?.tagName === "SELECT") return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); event.stopImmediatePropagation();
        onIndex((index + (event.key === "ArrowLeft" ? -1 : 1) + items.length) % items.length);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [index, items.length, onIndex]);
  if (!item) return null;
  const currentUpgrade = upgrade.key === imageKey ? upgrade : null;
  const full = currentUpgrade?.phase === "ready" ? currentUpgrade.image : undefined;
  const upgrading = Boolean(item.map && loadHighResolution) && (!currentUpgrade || currentUpgrade.phase === "loading");
  const baseLoaded = fallback.key === imageKey && fallback.loaded;
  const baseFailed = fallback.key === imageKey && fallback.failed;
  const loading = upgrading || (!full && !baseLoaded && !baseFailed);
  const upgradeFailed = currentUpgrade?.phase === "error";
  return createPortal(<div className="image-viewer" ref={dialog} role="dialog" aria-modal="true"
    aria-label="Expanded asset preview" tabIndex={-1}>
    <div className="image-viewer-toolbar">
      <select aria-label="Preview image or texture set" value={index} onChange={event => onIndex(Number(event.target.value))}>
        {items.map((image, i) => <option value={i} key={`${image.url}:${i}`}>{image.label}</option>)}
      </select>
      <button type="button" className="btn btn-ghost" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" className="btn btn-ghost" disabled={zoom >= 8} onClick={() => setZoom(value => Math.min(8, value + 0.5))}>+</button>
      <button type="button" className="btn btn-ghost" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</button>
      <button type="button" className="btn btn-primary" onClick={onClose}>Close preview</button>
    </div>
    <div className="image-viewer-canvas" aria-busy={loading} style={{ cursor: zoom > 1 ? "grab" : "default" }}
      onWheel={event => setZoom(value => Math.max(1, Math.min(8, value + (event.deltaY < 0 ? 0.25 : -0.25))))}
      onPointerDown={event => {
        if (zoom <= 1 || (event.target as HTMLElement).closest("button")) return;
        drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (drag.current) setPan({ x: drag.current.px + event.clientX - drag.current.x,
          y: drag.current.py + event.clientY - drag.current.y });
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {baseFailed && !full ? <p>Preview could not be loaded. Try another image.</p> :
        <img key={imageKey} src={full?.url ?? item.url} alt={item.label} referrerPolicy="no-referrer" draggable={false}
          onLoad={() => setFallback({ key: imageKey, loaded: true, failed: false })}
          onError={() => {
            if (full) { cache.current.delete(imageKey); setUpgrade({ key: imageKey, phase: "error" }); }
            else setFallback({ key: imageKey, loaded: false, failed: true });
          }} style={{ transform: `translate(${zoom === 1 ? 0 : pan.x}px, ${zoom === 1 ? 0 : pan.y}px) scale(${zoom})` }} />}
      {loading && <div className="preview-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <strong>{upgrading ? "Loading maximum-resolution JPG…" : "Loading preview…"}</strong>
        <span>{upgrading ? "The current preview stays visible while the full-size image downloads." : "Fetching image…"}</span>
      </div>}
      {upgradeFailed && <div className="preview-load-error" role="status">
        <span>High-resolution JPG unavailable. Showing the original preview.</span>
        <button type="button" className="btn btn-ghost" onClick={() => { cache.current.delete(imageKey); setRetry(value => value + 1); }}>Retry high-res</button>
      </div>}
    </div>
    <div className="image-viewer-footer">
      <button type="button" className="btn btn-ghost" disabled={items.length < 2}
        onClick={() => onIndex((index - 1 + items.length) % items.length)}>Previous image</button>
      <span>{index + 1} / {items.length}{full ? ` · ${full.width.toLocaleString()} × ${full.height.toLocaleString()} JPG` : ""} · Scroll to zoom · Drag to pan</span>
      <button type="button" className="btn btn-ghost" disabled={items.length < 2}
        onClick={() => onIndex((index + 1) % items.length)}>Next image</button>
    </div>
  </div>, document.body);
}
