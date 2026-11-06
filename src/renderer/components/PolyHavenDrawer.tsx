import { useCallback, useEffect, useRef, useState } from "react";
import type { MapPreview, PolyHavenAssetSummary } from "../../shared/types";
import { previewProgressKey } from "../../shared/preview-keys";
import { CheckIcon, CloseIcon, DownloadIcon } from "../icons";
import { AssetScaleDiagram } from "./AssetScaleDiagram";
import { Dropdown } from "./Dropdown";
import { ImageViewer } from "./ImageViewer";
import { TransferStatus } from "./TransferStatus";
import { usePolyHavenStore } from "../polyhaven-store";
import { polyHavenTechnical } from "../polyhaven-technical";
import { assetTypeLabel } from "../asset-visuals";
import { formatClock, formatHdriTime } from "../../shared/hdri-time";
import {
  polyHavenAttributeLabel,
  polyHavenAttributeValue,
  polyHavenMapLabel,
  polyHavenMapRank,
  polyHavenPrimaryPreview,
  polyHavenResolutionValue
} from "../../shared/polyhaven";
import { ProviderLogo } from "./ProviderLogo";
import { groupTechnicalFacts, type TechnicalFact } from "../technical-order";
import { useStore } from "../store";

function formatBytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function fallbackResolutions(hit: PolyHavenAssetSummary): string[] {
  if (hit.resolutions.length > 0) return hit.resolutions;
  const max = hit.maxResolution ?? 2048;
  const keys = hit.type === "hdris"
    ? ["1k", "2k", "4k", "8k", "16k", "24k"]
    : ["1k", "2k", "4k", "8k", "16k"];
  return keys.filter(key => polyHavenResolutionValue(key) <= max);
}

function mapOrder(code: string): number {
  return polyHavenMapRank(code);
}

function formatsForMap(hit: PolyHavenAssetSummary, code: string): string[] {
  const formats = hit.mapFormats.filter(value => !["hdr", "exr"].includes(value) || hit.type === "hdris");
  if (hit.type === "hdris") return ["hdr", "exr"].filter(value => formats.includes(value));
  const images = formats.filter(value => ["jpg", "jpeg", "png", "tif", "tiff", "exr"].includes(value));
  return images.length > 0 ? images : ["jpg"];
}

function pickFormat(formats: string[]): string {
  for (const format of ["jpg", "png", "exr", "tif", "tiff", "hdr"]) {
    if (formats.includes(format)) return format;
  }
  return formats[0] ?? "jpg";
}

function quickOptions(hit: PolyHavenAssetSummary): {
  resolution: string;
  format?: string;
  modelFormat?: string;
  maps?: Array<{ type: string; format: string }>;
} {
  const resolutions = fallbackResolutions(hit);
  const resolution = resolutions.includes("2k") ? "2k" : resolutions[0] ?? "2k";
  if (hit.type === "hdris") {
    return { resolution, format: formatsForMap(hit, "hdr").includes("hdr") ? "hdr" : "exr" };
  }
  if (hit.type === "models") {
    return {
      resolution,
      modelFormat: hit.modelFormats.includes("gltf") ? "gltf" : hit.modelFormats[0] ?? "gltf"
    };
  }
  return {
    resolution,
    maps: hit.mapCodes
      .filter(code => /diffuse|albedo|col|nor_gl|normal|rough|ao|arm|metal/i.test(code))
      .map(type => ({ type, format: pickFormat(formatsForMap(hit, type)) }))
  };
}

interface PolyHavenDownloadPrefs {
  resolution?: string;
  format?: string;
  modelFormat?: string;
}

function readDownloadPrefs(type: string): PolyHavenDownloadPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(`openbridge.polyhavenDownload.${type}`) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed as PolyHavenDownloadPrefs : {};
  } catch {
    return {};
  }
}

function writeDownloadPrefs(type: string, prefs: PolyHavenDownloadPrefs): void {
  try {
    localStorage.setItem(`openbridge.polyhavenDownload.${type}`, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function PolyHavenDrawer() {
  const selection = usePolyHavenStore(state => state.selection);
  const close = usePolyHavenStore(state => state.closeAsset);
  const favorites = usePolyHavenStore(state => state.favorites);
  const toggleFavorite = usePolyHavenStore(state => state.toggleFavorite);
  const setQuery = usePolyHavenStore(state => state.setQuery);
  const setCategoryByPath = usePolyHavenStore(state => state.setCategoryByPath);
  const hits = usePolyHavenStore(state => state.hits);
  const stepAsset = usePolyHavenStore(state => state.stepAsset);
  const downloads = useStore(state => state.downloads);
  const settings = useStore(state => state.settings);
  const [section, setSection] = useState<"overview" | "download" | "technical" | "related">("overview");
  const [mode, setMode] = useState<"renders" | "maps">("renders");
  const [renderIndex, setRenderIndex] = useState(0);
  const [mapIndex, setMapIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerPending, setViewerPending] = useState(false);
  const [resolution, setResolution] = useState("2k");
  const [format, setFormat] = useState("hdr");
  const [modelFormat, setModelFormat] = useState("gltf");
  const [mapFormats, setMapFormats] = useState<Record<string, string>>({});
  const [selectedMaps, setSelectedMaps] = useState<string[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [fetchedMaps, setFetchedMaps] = useState<MapPreview[]>([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [mapsAttempted, setMapsAttempted] = useState(false);
  const [mapsRetry, setMapsRetry] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const detail = selection?.detail;
  const summary = selection?.summary;

  const loadHighResolution = useCallback((item: MapPreview, signal?: AbortSignal) => {
    if (!item.map || !summary) return Promise.resolve(null);
    if (signal?.aborted) return Promise.resolve(null);
    return window.openbridge.polyhaven.highResolutionMapPreview(summary.id, item.map.type)
      .then(result => ({
        type: result.type,
        label: result.label,
        url: result.url,
        map: item.map
      }));
  }, [summary?.id]);

  const loadHdrSource = useCallback((item: MapPreview, signal?: AbortSignal) => {
    if (!item.exposure || typeof item.exposure.assetId !== "string") return Promise.resolve(null);
    if (signal?.aborted) return Promise.resolve(null);
    return window.openbridge.polyhaven.hdrPreview(item.exposure.assetId);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selection?.summary.id]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (section === "overview") {
      scroll.scrollTo({ top: 0 });
    } else {
      const tabs = scroll.querySelector<HTMLElement>(".inspector-tabs");
      if (tabs) {
        scroll.scrollTop += tabs.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 20;
      }
    }
  }, [section]);

  useEffect(() => {
    if (!selection) return;
    setSection("overview");
    setMode(selection.summary.type === "hdris" ? "maps" : "renders");
    setRenderIndex(0);
    setMapIndex(0);
    setViewerOpen(false);
    setViewerPending(false);
    setDownloadError(null);
    setStarting(false);
    setFetchedMaps([]);
    setMapsLoading(false);
    setMapsError(null);
    setMapsAttempted(false);
    setMapsRetry(0);
    const available = fallbackResolutions(selection.summary);
    const prefs = readDownloadPrefs(selection.summary.type);
    setResolution(
      prefs.resolution && available.includes(prefs.resolution)
        ? prefs.resolution
        : available.includes("2k") ? "2k" : available[0] ?? "2k"
    );
    setFormat(
      prefs.format && formatsForMap(selection.summary, "hdr").includes(prefs.format)
        ? prefs.format
        : selection.summary.type === "hdris"
          ? (formatsForMap(selection.summary, "hdr").includes("hdr") ? "hdr" : "exr")
          : pickFormat(selection.summary.mapFormats.length > 0 ? selection.summary.mapFormats : ["jpg"])
    );
    setModelFormat(
      prefs.modelFormat && selection.summary.modelFormats.includes(prefs.modelFormat)
        ? prefs.modelFormat
        : selection.summary.modelFormats.includes("gltf")
          ? "gltf"
          : selection.summary.modelFormats[0] ?? "gltf"
    );
    setSelectedMaps(
      selection.summary.type === "textures"
        ? [...selection.summary.mapCodes].sort((a, b) => mapOrder(a) - mapOrder(b))
        : []
    );
    const formats: Record<string, string> = {};
    for (const code of selection.summary.mapCodes) {
      formats[code] = pickFormat(formatsForMap(selection.summary, code));
    }
    setMapFormats(formats);
  }, [selection?.summary.id]);

  useEffect(() => {
    if (mode !== "maps" || !summary) return;
    if (mapsAttempted) return;
    setMapsAttempted(true);
    setMapsLoading(true);
    setMapsError(null);
    let cancelled = false;
    void window.openbridge.polyhaven.mapPreviews(summary.id)
      .then(items => {
        if (cancelled) return;
        setFetchedMaps(items.map((item, index) => ({
          type: item.type,
          label: item.label,
          url: item.url,
          assetId: summary.id,
          mapCode: item.type,
          position: index
        } as MapPreview & { mapCode?: string })));
        if (items.length === 0) {
          setMapsError("Poly Haven did not return previewable map images for this asset.");
        }
      })
      .catch(error => {
        if (!cancelled) setMapsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setMapsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, summary?.id, mapsRetry]);

  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, selection]);

  useEffect(() => {
    if (!viewerPending) return;
    if (fetchedMaps.length > 0) {
      setViewerPending(false);
      setViewerOpen(true);
      return;
    }
    if (mapsAttempted && !mapsLoading) {
      setViewerPending(false);
      setMode("renders");
      setRenderIndex(0);
      if (selection?.localPreview || selection?.summary.thumbnail) setViewerOpen(true);
    }
  }, [
    viewerPending,
    fetchedMaps.length,
    mapsAttempted,
    mapsLoading,
    selection?.localPreview,
    selection?.summary.thumbnail
  ]);

  if (!selection || !summary) return null;

  const localPath = selection.localPath;
  const localPreview = selection.localPreview;
  const renderThumb = summary.type === "hdris"
    ? polyHavenPrimaryPreview(summary.thumbnail, 760)
    : summary.thumbnail;
  const renders: MapPreview[] = localPreview
    ? [{
        type: "render",
        label: "Local preview",
        url: window.openbridge.toFileUrl(localPreview)
      }]
    : renderThumb
      ? [{ type: "render", label: "Render", url: renderThumb }]
      : [];
  const displayMaps = [...fetchedMaps].sort((a, b) =>
    polyHavenMapRank(a.type) - polyHavenMapRank(b.type)
  );
  const active = mode === "renders" ? renders[renderIndex] : displayMaps[mapIndex];
  const genuineLoading = mode === "maps" && fetchedMaps.length === 0 && (mapsLoading || !mapsAttempted);
  const activeLabel = active
    ? mode === "renders"
      ? active.label
      : polyHavenMapLabel(active.type)
    : "";
  const isHdri = summary.type === "hdris";
  const isTexture = summary.type === "textures";
  const isModel = summary.type === "models";
  const technical = polyHavenTechnical(summary);
  const showScale = Boolean(summary.type === "models" && summary.dimensions);
  const favorited = favorites.includes(summary.id);
  const resultIndex = hits.findIndex(hit => hit.id === summary.id);
  const jobId = `polyhaven:${summary.id}`;
  const progress = downloads[jobId];
  const downloadActive = Boolean(
    progress && ["queued", "requesting", "downloading", "paused"].includes(progress.status)
  );
  const resolutions = fallbackResolutions(summary);
  const hdriFormats = formatsForMap(summary, "hdr").filter(value => ["hdr", "exr"].includes(value));

  const previewItems: MapPreview[] = (mode === "renders" ? renders : displayMaps).map((preview, index) => {
    const mapCode = mode === "maps" ? preview.type : undefined;
    const displayMapCode = isHdri && mapCode?.toUpperCase() === "HDR" ? "JPG" : mapCode;
    return {
      type: mode === "renders" ? "render" : "map",
      label: mode === "renders" ? preview.label : polyHavenMapLabel(preview.type),
      url: preview.url,
      assetId: summary.id,
      map: displayMapCode ? { type: displayMapCode } : undefined,
      exposure: mode === "maps" && isHdri && mapCode
        ? { assetId: summary.id, mapType: mapCode }
        : undefined
    };
  });
  const activeIndex = mode === "renders" ? renderIndex : mapIndex;
  const previewCount = mode === "renders" ? renders.length : displayMaps.length;
  const previewPosition = mode === "renders" ? renderIndex : mapIndex;
  const setActiveIndex = (index: number): void => {
    if (mode === "renders") setRenderIndex(index);
    else setMapIndex(index);
  };

  const openViewer = (): void => {
    if (isHdri && mode === "renders") {
      setMode("maps");
      setMapIndex(0);
      if (displayMaps.length > 0) setViewerOpen(true);
      else setViewerPending(true);
      return;
    }
    setViewerOpen(true);
  };

  const step = (delta: number): void => {
    if (mode === "renders") {
      setRenderIndex(index => Math.min(Math.max(0, index + delta), Math.max(0, renders.length - 1)));
    } else {
      setMapIndex(index => Math.min(Math.max(0, index + delta), Math.max(0, displayMaps.length - 1)));
    }
  };

  const toggleMap = (code: string): void => {
    setSelectedMaps(current =>
      current.includes(code) ? current.filter(item => item !== code) : [...current, code]
    );
  };

  const startDownload = async (): Promise<void> => {
    if (isTexture && selectedMaps.length === 0) {
      setDownloadError("Select at least one texture map.");
      return;
    }
    setStarting(true);
    setDownloadError(null);
    try {
      const options = isHdri
        ? { resolution, format }
        : isModel
          ? { resolution, modelFormat }
          : {
              resolution,
              maps: selectedMaps.map(type => ({ type, format: mapFormats[type] ?? format }))
            };
      await window.openbridge.downloads.start(jobId, options, "polyhaven");
      writeDownloadPrefs(summary.type, { resolution, format, modelFormat });
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  const quickDownload = async (): Promise<void> => {
    setStarting(true);
    setDownloadError(null);
    try {
      await window.openbridge.downloads.start(jobId, quickOptions(summary), "polyhaven");
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  const raw = detail?.raw ?? {};
  const rawString = (key: string): string =>
    typeof raw[key] === "string" || typeof raw[key] === "number"
      ? String(raw[key])
      : "";
  const overviewFacts: Array<[string, string]> = [];
  if (summary.dimensions) overviewFacts.push(["Physical size", summary.dimensions]);
  if (summary.texelDensity) overviewFacts.push(["Texel density", `${summary.texelDensity} px/m`]);
  if (summary.polycount) overviewFacts.push(["Polycount", summary.polycount.toLocaleString()]);
  if (summary.publishedAt) overviewFacts.push(["Published", new Date(summary.publishedAt).toLocaleDateString()]);
  if (summary.downloadCount) overviewFacts.push(["Downloads", summary.downloadCount.toLocaleString()]);
  const authorNames = Object.entries(summary.authors).map(([name, role]) =>
    role && role.toLowerCase() !== "all" ? `${name} (${role})` : name
  );
  if (authorNames.length > 0) overviewFacts.push(["Authors", authorNames.join(", ")]);
  if (summary.collections.length > 0) {
    overviewFacts.push(["Collection", summary.collections.map(value => value.replace(/^collection:\s*/i, "")).join(", ")]);
  }
  if (isHdri && typeof raw.evs_cap === "number") overviewFacts.push(["EV range", `${raw.evs_cap} EV`]);
  if (isHdri && typeof raw.whitebalance === "number") overviewFacts.push(["White balance", `${raw.whitebalance} K`]);
  if (isHdri && typeof raw.date_taken === "number") {
    overviewFacts.push(["Taken", new Date(raw.date_taken * 1000).toLocaleDateString()]);
  }
  if (isHdri && Array.isArray(raw.coords) && raw.coords.length === 2) {
    overviewFacts.push(["Coordinates", raw.coords.map(value => Number(value).toFixed(4)).join(", ")]);
  }
  if (raw.vault && typeof raw.vault === "object" && typeof (raw.vault as Record<string, unknown>).name === "string") {
    overviewFacts.push(["Vault", String((raw.vault as Record<string, unknown>).name)]);
  }
  if (typeof raw.version_required === "string" && raw.version_required) {
    overviewFacts.push(["Requires", raw.version_required]);
  }

  const technicalFacts: TechnicalFact[] = [];
  if (summary.dimensions) technicalFacts.push(["dimensions", "Dimensions", summary.dimensions]);
  if (summary.texelDensity) technicalFacts.push(["texelDensity", "Texel density", `${summary.texelDensity} px/m`]);
  if (summary.mapCodes.length > 0) technicalFacts.push(["mapTypes", "Map types", String(summary.mapCodes.length)]);
  if (summary.mapFormats.length > 0) {
    technicalFacts.push(["mapFormats", "Map formats", summary.mapFormats.map(value => value.toUpperCase()).join(", ")]);
  }
  if (summary.maxResolution) {
    technicalFacts.push(["maxResolution", "Max resolution", `${Math.round(summary.maxResolution / 1024)}K`]);
  }
  if (resolutions.length > 0) technicalFacts.push(["resolutions", "Resolutions", resolutions.join(", ")]);
  if (summary.modelFormats.length > 0) {
    technicalFacts.push([
      "layoutConvention",
      isModel ? "Model formats" : "Material formats",
      summary.modelFormats.map(value => value.toUpperCase()).join(", ")
    ]);
  }
  if (summary.lodCount > 0) technicalFacts.push(["lods", "LODs", String(summary.lodCount)]);
  if (summary.polycount) technicalFacts.push(["maxTriangles", "Max triangles", summary.polycount.toLocaleString()]);
  if (technical.materialWorkflow) {
    technicalFacts.push(["materialWorkflow", "Material workflow", "Metal / Rough"]);
  }
  if (technical.hasAlpha) technicalFacts.push(["alpha", "Alpha / opacity", "Yes"]);
  if (isHdri && summary.timeOfDay != null) {
    technicalFacts.push([
      "timeOfDay",
      "Time of day",
      `${formatHdriTime(summary.timeOfDay)} · ${formatClock(summary.timeOfDay)}`
    ]);
  }
  if (typeof raw.date_taken === "number") {
    technicalFacts.push(["dateTaken", "Date taken", new Date(raw.date_taken * 1000).toLocaleDateString()]);
  }
  if (Array.isArray(raw.coords) && raw.coords.length === 2) {
    technicalFacts.push(["coordinates", "Coordinates", raw.coords.map(value => Number(value).toFixed(5)).join(", ")]);
  }
  if (typeof raw.evs_cap === "number") technicalFacts.push(["evsCap", "EV range", `${raw.evs_cap} EV`]);
  if (typeof raw.whitebalance === "number") technicalFacts.push(["whiteBalance", "White balance", `${raw.whitebalance} K`]);
  if (raw.vault && typeof raw.vault === "object" && typeof (raw.vault as Record<string, unknown>).name === "string") {
    technicalFacts.push(["vault", "Vault", String((raw.vault as Record<string, unknown>).name)]);
  }
  if (typeof raw.version_required === "string" && raw.version_required) {
    technicalFacts.push(["versionRequired", "Requires", raw.version_required]);
  }
  if (rawString("category_id")) technicalFacts.push(["categoryId", "Category ID", rawString("category_id")]);
  if (rawString("files_hash")) technicalFacts.push(["filesHash", "Files hash", rawString("files_hash")]);
  technicalFacts.push(["catalogueId", "Catalogue ID", summary.id]);
  if (summary.publishedAt) {
    technicalFacts.push(["published", "Published", new Date(summary.publishedAt).toLocaleDateString()]);
  }
  const technicalGroups = groupTechnicalFacts(technicalFacts);
  const footerMapCount = isTexture ? selectedMaps.length : summary.mapCodes.length;
  const showInLibrary = (): void => {
    const state = useStore.getState();
    state.setLocalProvider("polyhaven");
    state.setLocalQuery(summary.id);
    state.setView("library");
    close();
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer poliigon-drawer polyhaven-drawer" role="dialog" aria-label={summary.name}>
        <div className="drawer-head">
          <ProviderLogo provider="polyhaven" className="drawer-provider-mark" />
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous asset"
            disabled={resultIndex <= 0}
            onClick={() => stepAsset(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next asset"
            disabled={resultIndex < 0 || resultIndex >= hits.length - 1}
            onClick={() => stepAsset(1)}
          >
            ›
          </button>
          <button
            type="button"
            className={favorited ? "icon-btn active" : "icon-btn"}
            onClick={() => toggleFavorite(summary.id)}
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            title={favorited ? "Remove from favorites" : "Add to favorites"}
          >
            {favorited ? "♥" : "♡"}
          </button>
          <button
            type="button"
            className="text-btn"
            onClick={() => void window.openbridge.openExternal(`https://polyhaven.com/a/${summary.id}`)}
            title="Open this asset on polyhaven.com"
          >
            Open on Poly Haven
          </button>
          <button type="button" className="icon-btn" onClick={close} title="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="drawer-scroll" ref={scrollRef}>
          <div className="drawer-preview">
            <div className="preview-switch">
              <button type="button" className={mode === "renders" ? "active" : ""} onClick={() => setMode("renders")}>
                Render
              </button>
              <button type="button" className={mode === "maps" ? "active" : ""} onClick={() => setMode("maps")}>
                Maps
              </button>
            </div>

            {mode === "maps" && genuineLoading ? (
              <div className="poliigon-map-empty">
                <span className="spinner" aria-hidden="true" />
                <strong>Preparing genuine map previews…</strong>
                <TransferStatus
                  progress={downloads[previewProgressKey.polyMaps(summary.id)]}
                  fallbackText="Requesting the smallest published map images for this asset."
                />
              </div>
            ) : mode === "maps" && displayMaps.length === 0 ? (
              mapsError ? (
                <div className="poliigon-map-empty">
                  <strong>Map previews could not be loaded.</strong>
                  <p>{mapsError}</p>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setFetchedMaps([]);
                      setMapsError(null);
                      setMapsAttempted(false);
                      setMapsRetry(value => value + 1);
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="poliigon-map-empty">
                  <strong>No map previews are published for this asset.</strong>
                  <p>The download still includes the published asset files.</p>
                </div>
              )
            ) : active ? (
              <button
                type="button"
                className="expand-preview"
                onClick={openViewer}
                aria-label="Expand preview"
                title="Expand preview"
              >
                <img src={active.url} alt={activeLabel || summary.name} referrerPolicy="no-referrer" />
              </button>
            ) : renderThumb ? (
              <img src={renderThumb} alt={summary.name} referrerPolicy="no-referrer" />
            ) : (
              <span>{summary.typeLabel}</span>
            )}

            {localPath && (
              <div className="drawer-flags">
                <span className="asset-flag local">LOCAL</span>
              </div>
            )}

            {previewCount > 1 && (
              <div className="map-nav">
                <div className="map-nav-label">
                  <strong>{activeLabel}</strong>
                </div>
                <div className="map-nav-actions">
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Previous preview"
                    disabled={previewPosition <= 0}
                  >
                    ‹
                  </button>
                  <span>{previewPosition + 1} / {previewCount}</span>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Next preview"
                    disabled={previewPosition >= previewCount - 1}
                  >
                    ›
                  </button>
                </div>
              </div>
            )}
          </div>

          {previewItems.length > 0 && (
            <div className="preview-picker">
              <Dropdown
                className="select-dropdown"
                value={String(activeIndex)}
                ariaLabel={mode === "renders" ? "Render image" : "Map preview"}
                onChange={value => setActiveIndex(Number(value))}
                options={previewItems.map((item, index) => ({
                  value: String(index),
                  label: item.label
                }))}
              />
              <button
                type="button"
                className="btn btn-ghost preview-expand-action"
                onClick={openViewer}
                aria-label="Expand preview in larger viewer"
              >
                Expand
              </button>
            </div>
          )}

          {mode === "maps" && displayMaps.length > 0 && (
            <p className="hint poliigon-map-note">
              Genuine files from this CC0 asset. Open full-screen to inspect the highest published
              resolution; HDRI HDR entries add live exposure and the 360° viewer.
            </p>
          )}

          {viewerOpen && previewItems.length > 0 && (
            <ImageViewer
              items={previewItems}
              index={activeIndex}
              onIndex={setActiveIndex}
              onClose={() => setViewerOpen(false)}
              loadHighResolution={loadHighResolution}
              loadHdrSource={loadHdrSource}
            />
          )}

          <h2 className="drawer-title" title={summary.name}>{summary.name}</h2>
          <p className="drawer-id">{summary.id}</p>

          <div className="inspector-tabs" role="group" aria-label="Poly Haven asset sections">
            {(["overview", "download", "technical", "related"] as const).map(value => (
              <button
                type="button"
                key={value}
                className={section === value ? "active" : ""}
                aria-pressed={section === value}
                onClick={() => setSection(value)}
              >
                {value === "overview" ? "Overview" : value === "download" ? "Download" : value === "technical" ? "Technical" : "Related"}
              </button>
            ))}
          </div>

          {selection.loading && <div className="loading-line">Loading asset details…</div>}
          {selection.error && <div className="error-box small" role="alert">{selection.error}</div>}

          <div hidden={section !== "overview"}>
            {summary.description && <p className="poliigon-description">{summary.description}</p>}
            <div className="meta-grid">
              <span>Type</span>
              <strong>{assetTypeLabel(summary.typeLabel)}</strong>
              <span>Access</span>
              <strong>{localPath ? "Downloaded" : "Free"}</strong>
              {localPath && (
                <>
                  <span>Local folder</span>
                  <strong className="poliigon-local-path">{localPath}</strong>
                </>
              )}
              {localPath && selection.localSizeBytes != null && (
                <>
                  <span>Local size</span>
                  <strong>{formatBytes(selection.localSizeBytes)}</strong>
                </>
              )}
              {overviewFacts.map(([label, value]) => (
                <FragmentRow key={label} label={label} value={value} />
              ))}
            </div>
            {summary.category && (
              <div className="poliigon-chips-section">
                <strong>Categories</strong>
                <div className="poliigon-chip-row">
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryByPath(summary.category.split("/"));
                      close();
                    }}
                  >
                    {summary.category}
                  </button>
                  {summary.categories.slice(0, 8).map(category => (
                    <button
                      type="button"
                      key={category}
                      onClick={() => {
                        usePolyHavenStore.getState().toggleCategory(category);
                        close();
                      }}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {summary.tags.length > 0 && (
              <div className="poliigon-chips-section">
                <strong>Tags</strong>
                <div className="poliigon-chip-row">
                  {summary.tags.slice(0, 12).map(tag => (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => {
                        setQuery(tag);
                        close();
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(summary.attributes).length > 0 && (
              <div className="poliigon-chips-section">
                <strong>Attributes</strong>
                <div className="poliigon-chip-row">
                  {Object.entries(summary.attributes).map(([key, value]) => (
                    <span key={key}>
                      {polyHavenAttributeLabel(key)}: {polyHavenAttributeValue(value)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {rawString("info") && (
              <div className="poliigon-chips-section">
                <strong>Notes</strong>
                <p className="hint">{rawString("info")}</p>
              </div>
            )}
            {showScale && <AssetScaleDiagram technical={technical} />}
          </div>

          <div hidden={section !== "related"}>
            {selection.related && selection.related.length > 0 ? (
              <div className="poliigon-related">
                <strong>Related assets</strong>
                <div className="poliigon-related-grid">
                  {selection.related.map(item => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => void usePolyHavenStore.getState().openAsset(item)}
                      title={item.name}
                    >
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="poliigon-related-placeholder">{item.typeLabel}</span>
                      )}
                      <span>{item.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="hint">No related assets available for this item.</p>
            )}
          </div>

          <div hidden={section !== "technical"}>
            <section className="technical-panel">
              <div className="technical-head">
                <h3>Technical</h3>
              </div>
              {technicalGroups.map(group => (
                <div className="technical-group" key={group.title}>
                  <h4>{group.title}</h4>
                  <div className="technical-grid">
                    {group.rows.map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
            {summary.mapCodes.length > 0 && (
              <div className="poliigon-chips-section">
                <strong>Texture maps</strong>
                <div className="poliigon-chip-row">
                  {summary.mapCodes.map(code => (
                    <span key={code}>{polyHavenMapLabel(code)}</span>
                  ))}
                </div>
              </div>
            )}
            {detail && detail.files && (
              <details className="poliigon-raw">
                <summary>Raw file metadata</summary>
                <pre>{JSON.stringify(detail.files, null, 2).slice(0, 20_000)}</pre>
              </details>
            )}
          </div>

          <div hidden={section !== "download"}>
            <div className="download-box">
              <div className="download-heading">
                <h3>Download settings</h3>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    const options = quickOptions(summary);
                    setResolution(options.resolution);
                    if (options.format) setFormat(options.format);
                    if (options.modelFormat) setModelFormat(options.modelFormat);
                    setSelectedMaps(
                      summary.type === "textures"
                        ? [...summary.mapCodes].sort((a, b) => mapOrder(a) - mapOrder(b))
                        : []
                    );
                  }}
                >
                  Reset to default
                </button>
              </div>

              <div className="form-row compact">
                <label>Resolution</label>
                <Dropdown
                  className="select-dropdown"
                  value={resolution}
                  onChange={setResolution}
                  ariaLabel="Download resolution"
                  options={resolutions.map(value => ({ value, label: value.toUpperCase() }))}
                />
              </div>

              {isHdri && (
                <div className="form-row compact">
                  <label>Format</label>
                  <Dropdown
                    className="select-dropdown"
                    value={hdriFormats.includes(format) ? format : hdriFormats[0] ?? "hdr"}
                    onChange={setFormat}
                    ariaLabel="HDRI format"
                    options={hdriFormats.map(value => ({ value, label: value.toUpperCase() }))}
                  />
                </div>
              )}

              {isModel && (
                <div className="form-row compact">
                  <label>Model format</label>
                  <Dropdown
                    className="select-dropdown"
                    value={summary.modelFormats.includes(modelFormat) ? modelFormat : summary.modelFormats[0] ?? "gltf"}
                    onChange={setModelFormat}
                    ariaLabel="Model package format"
                    options={(summary.modelFormats.length > 0 ? summary.modelFormats : ["gltf"]).map(value => ({
                      value,
                      label: value.toUpperCase()
                    }))}
                  />
                </div>
              )}

              {isTexture && (
                <>
                  <div className="poliigon-option-head">
                    <strong>Texture maps</strong>
                    <div>
                      <button type="button" className="text-btn" onClick={() => setSelectedMaps(summary.mapCodes)}>All</button>
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => setSelectedMaps(summary.mapCodes.filter(code => /diffuse|albedo|col|nor_gl|normal|rough|ao|arm|metal/i.test(code)))}
                      >
                        Common
                      </button>
                      <button type="button" className="text-btn" onClick={() => setSelectedMaps([])}>None</button>
                    </div>
                  </div>
                  <div className="map-options">
                    {[...summary.mapCodes].sort((a, b) => mapOrder(a) - mapOrder(b)).map(code => {
                      const choices = formatsForMap(summary, code);
                      return (
                        <div className="map-row" key={code}>
                          <div className="map-row-main">
                            <label className="toggle inline">
                              <input
                                type="checkbox"
                                checked={selectedMaps.includes(code)}
                                onChange={() => toggleMap(code)}
                              />
                              <span>{polyHavenMapLabel(code)}</span>
                            </label>
                            <span className="map-facts">{resolution} · {choices.join("/")}</span>
                          </div>
                          <Dropdown
                            className="select-dropdown small"
                            value={mapFormats[code] ?? pickFormat(choices)}
                            onChange={value => setMapFormats(current => ({ ...current, [code]: value }))}
                            ariaLabel={`${polyHavenMapLabel(code)} format`}
                            options={choices.map(value => ({ value, label: value.toUpperCase() }))}
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {isModel && (
                <p className="hint">
                  The model package includes its published textures and any included files. Pick the
                  format your DCC or renderer reads best.
                </p>
              )}

              <p className="hint">
                Files are written to {settings?.polyhavenLibraryPath || "the Poly Haven library"} in a
                self-contained asset folder with an OpenBridge metadata record.
              </p>
              <p className="hint">
                Plan: {resolution.toUpperCase()}
                {isHdri
                  ? ` · ${format.toUpperCase()}`
                  : isModel
                    ? ` · ${modelFormat.toUpperCase()} package`
                    : ` · ${selectedMaps.length} map${selectedMaps.length === 1 ? "" : "s"}`}
              </p>

              {downloadError && <div className="error-box small" role="alert">{downloadError}</div>}

              {downloadActive && progress ? (
                <div className="active-download">
                  <div className="download-top">
                    <strong>{progress.message ?? progress.status}</strong>
                    <span>{formatBytes(progress.received)} / {formatBytes(progress.total)}</span>
                  </div>
                  <div className="progress">
                    <div className="progress-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                  </div>
                  <div className="button-row horizontal">
                    {progress.status === "paused" ? (
                      <button type="button" className="btn btn-primary" onClick={() => void window.openbridge.downloads.resume(jobId)}>
                        Resume
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost" onClick={() => void window.openbridge.downloads.pause(jobId)}>
                        Pause
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost" onClick={() => void window.openbridge.downloads.cancel(jobId)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-wide"
                  disabled={starting || selection.loading}
                  onClick={() => void startDownload()}
                >
                  {starting ? "Starting…" : `Download ${resolution.toUpperCase()}`}
                </button>
              )}

              {progress?.status === "complete" && (
                <div className="complete-box">
                  <CheckIcon />
                  <span>Saved to {progress.path}</span>
                  {progress.path && (
                    <button type="button" className="text-btn" onClick={() => void window.openbridge.openPath(progress.path!)}>
                      Open folder
                    </button>
                  )}
                </div>
              )}
              {progress?.status === "error" && <div className="error-box small">{progress.message}</div>}
            </div>
          </div>
        </div>

        <footer className="drawer-footer">
          {localPath ? (
            <>
              <div className="download-summary">
                <span>
                  Downloaded locally
                  {selection.localSizeBytes != null ? ` · ${formatBytes(selection.localSizeBytes)}` : ""}
                </span>
                <button type="button" className="text-btn" onClick={() => setSection("download")}>
                  Download again
                </button>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-wide"
                onClick={() => void window.openbridge.openPath(localPath)}
              >
                Open folder
              </button>
              <button type="button" className="btn btn-ghost btn-wide" onClick={showInLibrary}>
                Show in Library
              </button>
            </>
          ) : (
            <>
              <div className="download-summary">
                <span>
                  {isHdri
                    ? `${resolution.toUpperCase()} · ${formatHdriTime(summary.timeOfDay)}`
                    : isModel
                      ? `${resolution.toUpperCase()} · ${modelFormat.toUpperCase()} package`
                      : `${resolution.toUpperCase()} · ${footerMapCount} ${footerMapCount === 1 ? "map" : "maps"}`}
                </span>
                <button type="button" className="text-btn" onClick={() => setSection("download")}>
                  Edit plan
                </button>
              </div>

              {resolutions.length > 0 && (
                <div className="footer-resolution" role="group" aria-label="Quick download resolution">
                  {resolutions.map(value => (
                    <button
                      type="button"
                      key={value}
                      className={resolution === value ? "chip active" : "chip"}
                      aria-pressed={resolution === value}
                      disabled={downloadActive}
                      onClick={() => setResolution(value)}
                    >
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}

              {downloadActive && progress ? (
                <div className="active-download">
                  <div className="download-top">
                    <strong>{progress.message ?? progress.status}</strong>
                    <span>{formatBytes(progress.received)} / {formatBytes(progress.total)}</span>
                  </div>
                  <div className="progress">
                    <div className="progress-fill" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                  </div>
                  <div className="button-row horizontal">
                    {progress.status === "paused" ? (
                      <button type="button" className="btn btn-primary" onClick={() => void window.openbridge.downloads.resume(jobId)}>
                        Resume
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost" onClick={() => void window.openbridge.downloads.pause(jobId)}>
                        Pause
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost" onClick={() => void window.openbridge.downloads.cancel(jobId)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-accent btn-wide"
                  disabled={starting || selection.loading}
                  onClick={() => void quickDownload()}
                >
                  <DownloadIcon /> {starting ? "Starting…" : "Download"}
                </button>
              )}

              {downloadError && <div className="error-box small">{downloadError}</div>}
              {progress?.status === "complete" && (
                <div className="complete-box">
                  <CheckIcon />
                  <span>Saved to {progress.path}</span>
                  {progress.path && (
                    <button type="button" className="text-btn" onClick={() => void window.openbridge.openPath(progress.path!)}>
                      Open folder
                    </button>
                  )}
                </div>
              )}
              {progress?.status === "error" && <div className="error-box small">{progress.message}</div>}
            </>
          )}
        </footer>
      </aside>
    </>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );
}
