import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MapPreview, PoliigonHdrData } from "../../shared/types";
import { previewProgressKey } from "../../shared/preview-keys";
import { useStore } from "../store";
import { HdrCanvas } from "./HdrCanvas";
import { PanoramaCanvas } from "./PanoramaCanvas";
import { TransferStatus } from "./TransferStatus";

interface LoadedPreview { url: string; width: number; height: number }
interface Upgrade {
  key: string;
  phase: "loading" | "ready" | "error" | "none";
  image?: LoadedPreview;
}
interface HdrState {
  key: string;
  phase: "loading" | "ready" | "error" | "none";
  data?: PoliigonHdrData;
}

const DEFAULT_PANO_VIEW = { yaw: 0, pitch: 0, fov: (65 * Math.PI) / 180 };
const MIN_PANO_FOV = (25 * Math.PI) / 180;
const MAX_PANO_FOV = (110 * Math.PI) / 180;

function clampPanoFov(value: number): number {
  return Math.max(MIN_PANO_FOV, Math.min(MAX_PANO_FOV, value));
}

export function ImageViewer({ items, index, onIndex, onClose, loadHighResolution, loadHdrSource }: {
  items: MapPreview[]; index: number; onIndex(index: number): void; onClose(): void;
  loadHighResolution?(item: MapPreview, signal?: AbortSignal): Promise<MapPreview | null>;
  loadHdrSource?(item: MapPreview, signal?: AbortSignal): Promise<PoliigonHdrData | null>;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fallback, setFallback] = useState({ key: "", loaded: false, failed: false });
  const [upgrade, setUpgrade] = useState<Upgrade>({ key: "", phase: "none" });
  const [hdr, setHdr] = useState<HdrState>({ key: "", phase: "none" });
  const [exposure, setExposure] = useState<{ key: string; enabled: boolean; stops: number }>(
    { key: "", enabled: false, stops: 0 }
  );
  const [hdrRetry, setHdrRetry] = useState(0);
  const [retry, setRetry] = useState(0);
  const [panorama, setPanorama] = useState(false);
  const [panoView, setPanoView] = useState(DEFAULT_PANO_VIEW);
  const [panoReady, setPanoReady] = useState(false);
  const [panoError, setPanoError] = useState("");
  const [baseSize, setBaseSize] = useState({ width: 0, height: 0 });
  const downloads = useStore(state => state.downloads);
  const cache = useRef(new Map<string, LoadedPreview>());
  const hdrCache = useRef(new Map<string, PoliigonHdrData>());
  const dialog = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number; y: number; px: number; py: number; moved: boolean;
    yaw: number; pitch: number; panorama: boolean;
  } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const item = items[index];
  const itemRef = useRef(item);
  itemRef.current = item;
  const panoViewRef = useRef(panoView);
  panoViewRef.current = panoView;
  const canPanoramaRef = useRef(false);
  const togglePanoramaRef = useRef<() => void>(() => undefined);
  const panoAssetRef = useRef<number | string | null>(null);
  const panoUserTouchedRef = useRef("");
  const isHdrEntry = Boolean(item?.exposure?.mapType && /hdr/i.test(item.exposure.mapType));
  const imageKey = item
    ? JSON.stringify({
        url: item.url,
        type: item.type,
        map: item.map,
        label: item.label,
        exposure: item.exposure?.mapType,
        exposureId: item.exposure?.assetId
      })
    : "";
  // Mode is keyed to the current item so selecting the HDR entry is reflected
  // immediately, without a frame of the previous tone-mapped view.
  const exposureEnabled = exposure.key === imageKey ? exposure.enabled : isHdrEntry;
  const exposureStops = exposure.key === imageKey ? exposure.stops : 0;

  useEffect(() => {
    // Selecting the HDR (EXR) entry shows the live HDR view immediately; the
    // tone-mapped entry keeps showing the JPG until exposure is enabled. Zoom
    // and pan are preserved so both entries stay framed identically.
    setExposure({ key: imageKey, enabled: isHdrEntry, stops: 0 });
    setHdr({ key: "", phase: "none" });
    // HDRI map entries open in the live 360 view; the look direction is kept
    // when swapping between the tone-mapped and HDR entries of one asset.
    const assetId = itemRef.current?.exposure?.assetId ?? itemRef.current?.assetId ?? null;
    if (panoAssetRef.current !== assetId) {
      panoAssetRef.current = assetId;
      setPanoView(DEFAULT_PANO_VIEW);
    }
    panoUserTouchedRef.current = "";
    setPanorama(Boolean(itemRef.current?.exposure?.assetId));
    setPanoReady(false);
    setPanoError("");
    setBaseSize({ width: 0, height: 0 });
  }, [imageKey, isHdrEntry]);

  // Follow the content: equirectangular (2:1) images default to the 360 view,
  // everything else stays flat. An explicit toggle wins for that image.
  useEffect(() => {
    if (panoUserTouchedRef.current === imageKey) return;
    const ratio = baseSize.height > 0 ? baseSize.width / baseSize.height : 0;
    const equirect = ratio >= 1.9 && ratio <= 2.1;
    setPanorama(Boolean(itemRef.current?.exposure?.assetId) || equirect);
  }, [imageKey, baseSize.width, baseSize.height]);

  useEffect(() => {
    const current = itemRef.current;
    if (!current) return;
    if (!current.map || !loadHighResolution) {
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
    void loadHighResolution(current, request.signal).then(preview => {
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
  }, [imageKey, loadHighResolution, retry]);

  useEffect(() => {
    const current = itemRef.current;
    if (!current?.exposure || !loadHdrSource || !exposureEnabled) {
      setHdr({ key: "", phase: "none" });
      return;
    }
    const key = String(current.exposure.assetId);
    const cached = hdrCache.current.get(key);
    if (cached) {
      setHdr({ key, phase: "ready", data: cached });
      return;
    }
    let cancelled = false;
    const request = new AbortController();
    setHdr({ key, phase: "loading" });
    const timeout = window.setTimeout(() => {
      if (!cancelled) setHdr({ key, phase: "error" });
      cancelled = true;
      request.abort();
    }, 600_000);
    void loadHdrSource(current, request.signal).then(data => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      if (!data) {
        setHdr({ key, phase: "error" });
        return;
      }
      hdrCache.current.set(key, data);
      if (hdrCache.current.size > 1) hdrCache.current.delete(hdrCache.current.keys().next().value!);
      setHdr({ key, phase: "ready", data });
    }).catch(() => {
      window.clearTimeout(timeout);
      if (!cancelled) setHdr({ key, phase: "error" });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      request.abort();
    };
  }, [imageKey, loadHdrSource, exposureEnabled, hdrRetry]);

  const aspect = baseSize.height > 0 ? baseSize.width / baseSize.height : 0;
  const canPanorama = Boolean(item?.exposure) || (aspect >= 1.9 && aspect <= 2.1);
  const panoramaActive = panorama && canPanorama && !panoError;
  const togglePanorama = (): void => {
    setPanoError("");
    panoUserTouchedRef.current = imageKey;
    setPanorama(value => !value);
  };
  canPanoramaRef.current = canPanorama;
  togglePanoramaRef.current = togglePanorama;

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
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),select,input:not(:disabled)") ?? [])];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
      if ((event.target as HTMLElement)?.tagName === "SELECT") return;
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;
      if ((event.key === "p" || event.key === "P") && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (canPanoramaRef.current) {
          event.preventDefault();
          event.stopImmediatePropagation();
          togglePanoramaRef.current();
        }
        return;
      }
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
  const hdrKey = item.exposure ? String(item.exposure.assetId) : "";
  const hdrCurrent = hdr.key === hdrKey && hdr.phase === "ready" ? hdr.data : undefined;
  const exposureAvailable = Boolean(item.exposure && loadHdrSource);
  const hdrLoading = exposureEnabled && !hdrCurrent && hdr.phase !== "error";
  const hdrFailed = exposureEnabled && hdr.phase === "error";
  const upgrading = Boolean(item.map && loadHighResolution) && (!currentUpgrade || currentUpgrade.phase === "loading");
  const baseLoaded = fallback.key === imageKey && fallback.loaded;
  const baseFailed = fallback.key === imageKey && fallback.failed;
  const panoLoading = panoramaActive && !hdrCurrent && !panoReady;
  const loading = exposureEnabled
    ? hdrLoading || (!hdrCurrent && !panoramaActive && !baseLoaded && !baseFailed)
    : panoramaActive
      ? panoLoading
      : upgrading || (!full && !baseLoaded && !baseFailed);
  const upgradeFailed = !exposureEnabled && currentUpgrade?.phase === "error";
  const displayWidth = hdrCurrent?.width ?? full?.width;
  const displayHeight = hdrCurrent?.height ?? full?.height;
  const hdrProgress = item.exposure
    ? downloads[
        typeof item.exposure.assetId === "string"
          ? previewProgressKey.polyHdr(item.exposure.assetId)
          : previewProgressKey.hdr(item.exposure.assetId)
      ]
    : undefined;
  const mapProgress = item.assetId && item.map
    ? downloads[
        typeof item.assetId === "string"
          ? previewProgressKey.polyMap(item.assetId, item.map.type)
          : previewProgressKey.map(item.assetId, item.map.type)
      ]
    : undefined;
  const hdrSiblingIndex = item.exposure
    ? items.findIndex(other => other.exposure?.assetId === item.exposure!.assetId
        && /hdr/i.test(other.exposure?.mapType ?? ""))
    : -1;
  const jpgSiblingIndex = item.exposure
    ? items.findIndex(other => other.exposure?.assetId === item.exposure!.assetId
        && !/hdr/i.test(other.exposure?.mapType ?? ""))
    : -1;
  const panoSrc = full?.url ?? item.url;
  const transform = `translate(${zoom === 1 ? 0 : pan.x}px, ${zoom === 1 ? 0 : pan.y}px) scale(${zoom})`;
  const zoomLabel = panoramaActive ? `${Math.round((panoView.fov * 180) / Math.PI)}°` : `${Math.round(zoom * 100)}%`;

  const zoomIn = (): void => {
    if (panoramaActive) setPanoView(value => ({ ...value, fov: clampPanoFov(value.fov / 1.15) }));
    else setZoom(value => Math.min(8, value + 0.5));
  };
  const zoomOut = (): void => {
    if (panoramaActive) setPanoView(value => ({ ...value, fov: clampPanoFov(value.fov * 1.15) }));
    else setZoom(value => Math.max(1, value - 0.5));
  };
  const resetView = (): void => {
    if (panoramaActive) setPanoView(DEFAULT_PANO_VIEW);
    else { setZoom(1); setPan({ x: 0, y: 0 }); }
  };

  return createPortal(<div className="image-viewer" ref={dialog} role="dialog" aria-modal="true"
    aria-label="Expanded asset preview" tabIndex={-1}>
    <div className="image-viewer-toolbar">
      <select aria-label="Preview image or texture set" value={index} onChange={event => onIndex(Number(event.target.value))}>
        {items.map((image, i) => <option value={i} key={`${image.url}:${i}`}>{image.label}</option>)}
      </select>
      {canPanorama && (
        <button
          type="button"
          className={`btn btn-ghost ${panoramaActive ? "active" : ""}`}
          aria-pressed={panoramaActive}
          title="Toggle 360° panorama view (P)"
          onClick={togglePanorama}
        >
          360°
        </button>
      )}
      <button type="button" className="btn btn-ghost" disabled={panoramaActive ? panoView.fov <= MIN_PANO_FOV : zoom <= 1} onClick={zoomOut}>−</button>
      <span>{zoomLabel}</span>
      <button type="button" className="btn btn-ghost" disabled={panoramaActive ? panoView.fov >= MAX_PANO_FOV : zoom >= 8} onClick={zoomIn}>+</button>
      <button type="button" className="btn btn-ghost" onClick={resetView}>Fit</button>
      <button type="button" className="btn btn-primary" onClick={onClose}>Close preview</button>
    </div>
    {exposureAvailable && (
      <div className="exposure-bar" role="group" aria-label="HDR exposure controls">
        <label className="toggle inline">
          <input
            type="checkbox"
            checked={exposureEnabled}
            onChange={event => {
              const enabled = event.target.checked;
              setExposure({ key: imageKey, enabled, stops: exposureStops });
              if (enabled && !isHdrEntry && hdrSiblingIndex >= 0) onIndex(hdrSiblingIndex);
              else if (!enabled && isHdrEntry && jpgSiblingIndex >= 0) onIndex(jpgSiblingIndex);
            }}
          />
          <span>HDR exposure</span>
        </label>
        <input
          type="range"
          min={-10}
          max={10}
          step={0.1}
          value={exposureStops}
          disabled={!exposureEnabled}
          aria-label="HDR exposure stops"
          onChange={event => setExposure({ key: imageKey, enabled: exposureEnabled, stops: Number(event.target.value) })}
        />
        <strong>{exposureStops > 0 ? "+" : ""}{exposureStops.toFixed(1)} EV</strong>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={exposureStops === 0}
          title="Reset exposure to 0 EV"
          onClick={() => setExposure({ key: imageKey, enabled: exposureEnabled, stops: 0 })}
        >
          Reset
        </button>
        {!exposureEnabled && <span className="hint">Enable to load the linear HDR source</span>}
      </div>
    )}
    <div className="image-viewer-canvas" aria-busy={loading}
      title={panoramaActive ? "Drag to look around. Click to close" : "Click the image to close"}
      style={{ cursor: panoramaActive || zoom > 1 ? "grab" : "pointer" }}
      onWheel={event => {
        if (panoramaActive) {
          setPanoView(value => ({ ...value, fov: clampPanoFov(value.fov * Math.exp(event.deltaY * 0.0012)) }));
          return;
        }
        setZoom(value => Math.max(1, Math.min(8, value + (event.deltaY < 0 ? 0.25 : -0.25))));
      }}
      onPointerDown={event => {
        if ((event.target as HTMLElement).closest("button")) return;
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          px: pan.x,
          py: pan.y,
          moved: false,
          yaw: panoViewRef.current.yaw,
          pitch: panoViewRef.current.pitch,
          panorama: panoramaActive
        };
        if (panoramaActive || zoom > 1) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) current.moved = true;
        if (current.panorama) {
          const sensitivity = 0.0032 * (panoViewRef.current.fov / ((65 * Math.PI) / 180));
          const yaw = current.yaw - dx * sensitivity;
          const pitch = Math.max(-1.45, Math.min(1.45, current.pitch + dy * sensitivity));
          setPanoView(value => ({ ...value, yaw, pitch }));
        } else if (zoom > 1) {
          setPan({ x: current.px + dx, y: current.py + dy });
        }
      }}
      onPointerUp={() => {
        const current = drag.current;
        drag.current = null;
        if (current && !current.moved) closeRef.current();
      }}
      onPointerCancel={() => { drag.current = null; }}>
      {hdrCurrent ? (
        <HdrCanvas
          data={hdrCurrent}
          exposureStops={exposureStops}
          zoom={zoom}
          pan={pan}
          projection={panoramaActive ? "equirect" : "flat"}
          yaw={panoView.yaw}
          pitch={panoView.pitch}
          fov={panoView.fov}
        />
      ) : panoramaActive ? (
        <PanoramaCanvas
          key={imageKey}
          src={panoSrc}
          yaw={panoView.yaw}
          pitch={panoView.pitch}
          fov={panoView.fov}
          onReady={() => setPanoReady(true)}
          onError={message => {
            setPanoReady(false);
            setPanoError(message);
            setPanorama(false);
          }}
        />
      ) : baseFailed && !full ? <p>Preview could not be loaded. Try another image.</p> :
        <img key={imageKey} src={full?.url ?? item.url} alt={item.label} referrerPolicy="no-referrer" draggable={false}
          onLoad={event => {
            setFallback({ key: imageKey, loaded: true, failed: false });
            setBaseSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight
            });
          }}
          onError={() => {
            if (full) {
              cache.current.delete(imageKey);
              setUpgrade({ key: imageKey, phase: "error" });
            } else {
              setFallback({ key: imageKey, loaded: false, failed: true });
            }
          }} style={{ transform }} />}
      {loading && <div className="preview-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <strong>
          {hdrLoading
            ? "Loading maximum-resolution HDR source…"
            : panoLoading
              ? "Preparing 360° panorama…"
              : upgrading
                ? "Loading maximum-resolution preview…"
                : "Loading preview…"}
        </strong>
        <TransferStatus
          progress={hdrLoading ? hdrProgress : upgrading ? mapProgress : undefined}
          fallbackText={
            hdrLoading
              ? "Downloading and decoding the highest published EXR/HDR image for live exposure."
              : panoLoading
                ? "Decoding the panorama for drag-to-look navigation."
                : upgrading
                  ? "The current preview stays visible while the full-size image downloads."
                  : "Fetching image…"
          }
        />
      </div>}
      {hdrFailed && <div className="preview-load-error" role="status">
        <span>HDR source unavailable. Showing the JPG/PNG preview.</span>
        <button type="button" className="btn btn-ghost" onClick={() => setHdrRetry(value => value + 1)}>Retry HDR</button>
      </div>}
      {upgradeFailed && <div className="preview-load-error" role="status">
        <span>High-resolution preview unavailable. Showing the original preview.</span>
        <button type="button" className="btn btn-ghost" onClick={() => { cache.current.delete(imageKey); setRetry(value => value + 1); }}>Retry high-res</button>
      </div>}
      {panoError && !panoramaActive && <div className="preview-load-error" role="status">
        <span>360° view unavailable: {panoError}. Showing the flat preview.</span>
      </div>}
    </div>
    <div className="image-viewer-footer">
      <button type="button" className="btn btn-ghost" disabled={items.length < 2}
        onClick={() => onIndex((index - 1 + items.length) % items.length)}>Previous image</button>
      <span>{index + 1} / {items.length}{displayWidth && displayHeight ? ` · ${displayWidth.toLocaleString()} × ${displayHeight.toLocaleString()}${hdrCurrent ? ` (${hdrCurrent.resolution} HDR)` : ""}` : ""} · {panoramaActive ? "Drag to look around · Scroll to zoom · Click to close" : "Scroll to zoom · Drag to pan · Click to close"}</span>
      <button type="button" className="btn btn-ghost" disabled={items.length < 2}
        onClick={() => onIndex((index + 1) % items.length)}>Next image</button>
    </div>
  </div>, document.body);
}
