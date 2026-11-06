import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapPreview, PoliigonPreview } from "../../shared/types";
import { previewProgressKey } from "../../shared/preview-keys";
import { CheckIcon, CloseIcon, DownloadIcon } from "../icons";
import { AssetScaleDiagram } from "./AssetScaleDiagram";
import { Dropdown } from "./Dropdown";
import { ImageViewer } from "./ImageViewer";
import { TransferStatus } from "./TransferStatus";
import { usePoliigonStore } from "../poliigon-store";
import { poliigonScaleDimensions, poliigonTechnical } from "../poliigon-technical";
import { assetTypeLabel } from "../asset-visuals";
import { formatClock, formatHdriTime } from "../../shared/hdri-time";
import { ProviderLogo } from "./ProviderLogo";
import { groupTechnicalFacts, type TechnicalFact } from "../technical-order";
import { useStore } from "../store";
import { poliigonMapName } from "../poliigon-labels";

function mapLabel(preview: PoliigonPreview): string {
  if (preview.role) return preview.role;
  const base = preview.fileName.split("?")[0].replace(/\.[^.]+$/, "");
  const match = /_(?:[A-Za-z]+)_\d+_(.+?)(?:_WM)?$/.exec(base);
  const raw = match?.[1] ?? base;
  return poliigonMapName(raw);
}

function mapCodeForPreview(preview: PoliigonPreview): string | null {
  if (preview.mapCode) return preview.mapCode;
  const base = preview.fileName.split("?")[0].replace(/\.[^.]+$/, "");
  const match = /_(?:[A-Za-z]+)_\d+_(.+?)(?:_WM)?$/.exec(base);
  return match?.[1] ?? null;
}

function previewLabel(preview: PoliigonPreview, index: number): string {
  if (preview.role) return preview.role.charAt(0).toUpperCase() + preview.role.slice(1);
  return `Preview ${index + 1}`;
}

function formatBytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function mapPreviewRank(preview: PoliigonPreview): number {
  const text = `${mapLabel(preview)} ${preview.role ?? ""}`.toLowerCase();
  if (/base\s*color|basecolor|albedo|(?:^|[_-])col(?:[_-]|\.)/.test(text)) return 0;
  if (/normal|(?:^|[_-])nrm(?:[_-]|\.)/.test(text)) return 1;
  if (/rough/.test(text)) return 2;
  if (/metal/.test(text)) return 3;
  if (/orm/.test(text)) return 4;
  if (/ambient\s*occlusion|ambientocclusion|(?:^|[_-])ao(?:[_-]|\.)/.test(text)) return 5;
  if (/disp/.test(text)) return 6;
  if (/gloss|refl|spec/.test(text)) return 7;
  return 8;
}

const COMMON_MAP_TOKENS = new Set([
  "basecolor",
  "albedo",
  "col",
  "ambientocclusion",
  "ao",
  "normal",
  "nrm",
  "roughness",
  "metallic",
  "metalness",
  "displacement",
  "disp",
  "disp16",
  "orm",
  "opacity",
  "basecoloropacity",
  "mask",
  "emission",
  "emissive"
]);

function commonMapKeys(keys: string[]): string[] {
  return keys.filter(key =>
    COMMON_MAP_TOKENS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );
}

interface PoliigonDownloadPrefs {
  resolution?: string;
  mapFormat?: string;
  nativeMesh?: boolean;
  renderer?: string;
  software?: string;
}

function readDownloadPrefs(type: string): PoliigonDownloadPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(`openbridge.poliigonDownload.${type}`) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed as PoliigonDownloadPrefs : {};
  } catch {
    return {};
  }
}

function writeDownloadPrefs(type: string, prefs: PoliigonDownloadPrefs): void {
  try {
    localStorage.setItem(`openbridge.poliigonDownload.${type}`, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function PoliigonDrawer() {
  const selection = usePoliigonStore(state => state.selection);
  const close = usePoliigonStore(state => state.closeAsset);
  const auth = usePoliigonStore(state => state.auth);
  const owned = usePoliigonStore(state => state.owned);
  const favorites = usePoliigonStore(state => state.favorites);
  const toggleFavorite = usePoliigonStore(state => state.toggleFavorite);
  const openLogin = usePoliigonStore(state => state.openLogin);
  const setCategoryByPath = usePoliigonStore(state => state.setCategoryByPath);
  const setQuery = usePoliigonStore(state => state.setQuery);
  const hits = usePoliigonStore(state => state.hits);
  const stepAsset = usePoliigonStore(state => state.stepAsset);
  const downloads = useStore(state => state.downloads);
  const settings = useStore(state => state.settings);
  const [section, setSection] = useState<"overview" | "download" | "technical" | "related">("overview");
  const [mode, setMode] = useState<"renders" | "maps">("renders");
  const [renderIndex, setRenderIndex] = useState(0);
  const [mapIndex, setMapIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerPending, setViewerPending] = useState(false);
  const [resolution, setResolution] = useState("2K");
  const [mapFormat, setMapFormat] = useState("jpg");
  const [mapFormats, setMapFormats] = useState<Record<string, string>>({});
  const [selectedMaps, setSelectedMaps] = useState<string[]>([]);
  const [selectedLods, setSelectedLods] = useState<string[]>([]);
  const [nativeMesh, setNativeMesh] = useState(true);
  const [renderer, setRenderer] = useState("Cycles");
  const [software, setSoftware] = useState("Blender");
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [fetchedMaps, setFetchedMaps] = useState<PoliigonPreview[]>([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [mapsAttempted, setMapsAttempted] = useState(false);
  const [mapsRetry, setMapsRetry] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const detail = selection?.detail;
  const summary = selection?.summary;
  const previewEntitled = Boolean(
    summary && auth.loggedIn && (summary.free || auth.isUnlimited || owned.includes(summary.id))
  );

  const loadHighResolution = useCallback((item: MapPreview, signal?: AbortSignal) => {
    if (!item.map || !summary) return Promise.resolve(null);
    if (signal?.aborted) return Promise.resolve(null);
    return window.openbridge.poliigon.highResolutionMapPreview(summary.id, item.map.type)
      .then(result => ({
        type: result.type,
        label: result.label,
        url: result.url,
        map: item.map
      }));
  }, [summary?.id]);

  const loadHdrSource = useCallback((item: MapPreview, signal?: AbortSignal) => {
    if (!item.exposure) return Promise.resolve(null);
    if (signal?.aborted) return Promise.resolve(null);
    return window.openbridge.poliigon.hdrPreview(item.exposure.assetId as number);
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
    setMode(selection.summary.type === "HDRS" ? "maps" : "renders");
    setRenderIndex(0);
    setMapIndex(0);
    setViewerOpen(false);
    setViewerPending(false);
    setMapFormats({});
    setDownloadError(null);
    setStarting(false);
    setFetchedMaps([]);
    setMapsLoading(false);
    setMapsError(null);
    setMapsAttempted(false);
    setMapsRetry(0);
    const available = selection.summary.resolutions;
    const prefs = readDownloadPrefs(selection.summary.type);
    setResolution(
      prefs.resolution && available.includes(prefs.resolution)
        ? prefs.resolution
        : available.includes("2K") ? "2K" : available.at(-1) ?? "2K"
    );
    const formats = selection.summary.mapFormats;
    setMapFormat(
      prefs.mapFormat && formats.includes(prefs.mapFormat)
        ? prefs.mapFormat
        : formats.includes("jpg") ? "jpg" : formats[0] ?? "jpg"
    );
    setSelectedMaps([]);
    setSelectedLods([]);
    setNativeMesh(typeof prefs.nativeMesh === "boolean" ? prefs.nativeMesh : true);
    setRenderer(prefs.renderer || "Cycles");
    setSoftware(prefs.software || "Blender");
  }, [selection?.summary.id]);

  useEffect(() => {
    if (mode !== "maps" || !summary || !detail) return;
    if (!previewEntitled) return;
    if (!["Models", "Textures", "Brushes", "HDRS"].includes(detail.type)) return;
    if (!detail.maps.some(map => map.type || (map.maps?.length ?? 0) > 0)) return;
    if (mapsAttempted) return;
    setMapsAttempted(true);
    setMapsLoading(true);
    setMapsError(null);
    let cancelled = false;
    void window.openbridge.poliigon.mapPreviews(summary.id)
      .then(items => {
        if (cancelled) return;
        setFetchedMaps(items.map((item, index) => ({
          fileName: `${item.type}${index}`,
          baseUrl: "",
          url: item.url,
          type: "Toolbox",
          position: index,
          role: item.label,
          mapCode: item.type
        })));
        if (items.length === 0) {
          setMapsError("Poliigon did not return previewable map images for this asset.");
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
  }, [
    mode,
    summary?.id,
    summary?.free,
    detail?.id,
    detail?.type,
    previewEntitled,
    mapsRetry
  ]);

  useEffect(() => {
    if (!detail) return;
    const keys = detail.convention === 1
      ? detail.maps.filter(map => map.type).map(map => map.type as string)
      : detail.maps.flatMap(map => map.maps ?? []);
    setSelectedMaps(keys);
    setSelectedLods(detail.lods);
    const formats: Record<string, string> = {};
    for (const key of keys) {
      const available = detail.convention === 1
        ? (detail.maps.find(map => map.type === key)?.file_formats ?? [])
        : (detail.mapFormats?.length ? detail.mapFormats : []);
      const choices = available.length > 0 ? available : (detail.mapFormats?.length ? detail.mapFormats : ["jpg"]);
      formats[key] = choices.includes(mapFormat)
        ? mapFormat
        : choices.includes("jpg") ? "jpg" : choices[0] ?? "jpg";
    }
    setMapFormats(formats);
  }, [detail?.id]);

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

  const localPath = selection?.localPath;
  const localPreview = selection?.localPreview;
  const renders = localPreview
    ? [{
        fileName: localPreview.split(/[\\/]/).pop() ?? "preview",
        baseUrl: "",
        url: window.openbridge.toFileUrl(localPreview),
        type: "Image",
        position: 0,
        role: null
      }]
    : detail?.previews ?? summary?.previews ?? [];
  const toolboxMaps = detail?.toolboxPreviews ?? summary?.toolboxPreviews ?? [];
  const maps = useMemo(() => {
    const source = fetchedMaps.length > 0 ? fetchedMaps : toolboxMaps;
    return source
      .map((preview, index) => ({ preview, index }))
      .sort((a, b) => mapPreviewRank(a.preview) - mapPreviewRank(b.preview) || a.index - b.index)
      .map(item => item.preview);
  }, [toolboxMaps, fetchedMaps]);
  const genuineLoading = mode === "maps" && fetchedMaps.length === 0 && previewEntitled && (mapsLoading || !mapsAttempted);
  const displayMaps = genuineLoading ? [] : maps;
  const active = mode === "renders" ? renders[renderIndex] : displayMaps[mapIndex];
  const description = detail?.description || summary?.description || "";
  const activeLabel = useMemo(() => {
    if (!active) return "";
    return mode === "renders" ? previewLabel(active, renderIndex) : mapLabel(active);
  }, [active, mapIndex, mode, renderIndex]);

  const scaleTechnical = useMemo(
    () => (summary ? poliigonTechnical(summary) : null),
    [summary]
  );
  const showScale = Boolean(summary && poliigonScaleDimensions(summary));

  const previewItems: MapPreview[] = (mode === "renders" ? renders : displayMaps).map((preview, index) => {
    const mapCode = mode === "maps" && fetchedMaps.length > 0
      ? mapCodeForPreview(preview)
      : null;
    const displayMapCode = summary?.type === "HDRS" && mapCode?.toUpperCase() === "HDR"
      ? "JPG"
      : mapCode;
    const exposure = mode === "maps" && summary?.type === "HDRS" && mapCode && summary
      ? { assetId: summary.id, mapType: mapCode }
      : undefined;
    return {
      type: mode === "renders" ? "render" : "map",
      label: mode === "renders" ? previewLabel(preview, index) : mapLabel(preview),
      url: preview.url,
      assetId: summary?.id,
      map: displayMapCode ? { type: displayMapCode } : undefined,
      exposure
    };
  });
  const activeIndex = mode === "renders" ? renderIndex : mapIndex;
  const previewCount = mode === "renders" ? renders.length : displayMaps.length;
  const previewPosition = mode === "renders" ? renderIndex : mapIndex;
  const setActiveIndex = (index: number): void => {
    if (mode === "renders") setRenderIndex(index);
    else setMapIndex(index);
  };
  const isHdr = summary?.type === "HDRS";

  // HDRIs only expose exposure controls through their map entries, so expanding
  // from the Render tab switches to the HDRI map view and opens the viewer as
  // soon as the genuine map preview is ready.
  const openViewer = (): void => {
    if (isHdr && mode === "renders") {
      setMode("maps");
      setMapIndex(0);
      if (displayMaps.length > 0) {
        setViewerOpen(true);
      } else {
        setViewerPending(true);
      }
      return;
    }
    setViewerOpen(true);
  };

  useEffect(() => {
    if (!viewerPending) return;
    if (displayMaps.length > 0) {
      setViewerPending(false);
      setViewerOpen(true);
      return;
    }
    if (!previewEntitled || (mapsAttempted && !mapsLoading)) {
      setViewerPending(false);
      setMode("renders");
      setRenderIndex(0);
      setViewerOpen(true);
    }
  }, [viewerPending, displayMaps.length, mapsAttempted, mapsLoading, previewEntitled]);

  const resultIndex = summary ? hits.findIndex(hit => hit.id === summary.id) : -1;
  const resultCount = hits.length;

  if (!selection || !summary) return null;

  const isOwned = owned.includes(summary.id);
  const entitled = isOwned || auth.isUnlimited || summary.free;
  const canPreviewMaps = previewEntitled;
  const favorited = favorites.includes(summary.id);
  const related = selection.related ?? [];
  const showInLibrary = (): void => {
    const state = useStore.getState();
    state.setLocalProvider("poliigon");
    state.setLocalQuery(summary.assetName || summary.name);
    state.setView("library");
    close();
  };
  const jobId = `poliigon:${summary.id}`;
  const progress = downloads[jobId];
  const downloadActive = Boolean(
    progress && ["queued", "requesting", "downloading", "paused"].includes(progress.status)
  );
  const isTexture = summary.type === "Textures" || summary.type === "Brushes";
  const isModel = summary.type === "Models";
  const detailWorkflow = detail?.maps.find(map => map.workflow)?.workflow;
  const mapKeys = detail
    ? detail.convention === 1
      ? detail.maps.filter(map => map.type).map(map => map.type as string)
      : (detail.maps.find(map => map.workflow === detailWorkflow)?.maps ?? [])
    : [];
  const canShowMaps = maps.length > 0 || mapKeys.length > 0;
  const formatOptions = summary.mapFormats.length > 0 ? summary.mapFormats : ["jpg", "png", "tiff"];
  const formatsForMap = (key: string): string[] => {
    const available = detail?.convention === 1
      ? (detail.maps.find(map => map.type === key)?.file_formats ?? [])
      : (detail?.mapFormats ?? []);
    return available.length > 0 ? available : formatOptions;
  };
  const supportedSoftware = (detail?.softwares ?? [])
    .map(item => item.software)
    .filter(value => value && value !== "Generic");
  const softwareOptions = supportedSoftware.length > 0 ? supportedSoftware : [software];
  const activeSoftware = softwareOptions.includes(software) ? software : softwareOptions[0] ?? "Blender";
  const selectedSoftware = detail?.softwares.find(item => item.software === activeSoftware);
  const rendererOptions = selectedSoftware?.render_engines?.length
    ? selectedSoftware.render_engines
    : ["Cycles", "Vray", "Arnold", "Redshift", "Corona", "Octane", "Other"];
  const activeRenderer = rendererOptions.includes(renderer) ? renderer : rendererOptions[0] ?? "Cycles";

  const toggleMap = (key: string): void => {
    setSelectedMaps(current =>
      current.includes(key) ? current.filter(item => item !== key) : [...current, key]
    );
  };
  const toggleLod = (lod: string): void => {
    setSelectedLods(current =>
      current.includes(lod) ? current.filter(item => item !== lod) : [...current, lod]
    );
  };

  const resetOptions = (): void => {
    const available = summary.resolutions;
    setResolution(available.includes("2K") ? "2K" : available.at(-1) ?? "2K");
    setSelectedMaps(mapKeys);
    setSelectedLods(detail?.lods ?? []);
    setNativeMesh(true);
    const firstSoftware = softwareOptions[0] ?? "Blender";
    setSoftware(firstSoftware);
    const entry = detail?.softwares.find(item => item.software === firstSoftware);
    setRenderer(entry?.render_engines?.[0] ?? "Cycles");
    const formats: Record<string, string> = {};
    for (const key of mapKeys) {
      const choices = formatsForMap(key);
      formats[key] = choices.includes(mapFormat)
        ? mapFormat
        : choices.includes("jpg") ? "jpg" : choices[0] ?? "jpg";
    }
    setMapFormats(formats);
  };

  const startDownload = async (): Promise<void> => {
    if (isTexture && selectedMaps.length === 0) {
      setDownloadError("Select at least one texture map.");
      return;
    }
    if (isModel && (detail?.lods.length ?? 0) > 0 && selectedLods.length === 0) {
      setDownloadError("Select at least one LOD.");
      return;
    }
    setStarting(true);
    setDownloadError(null);
    try {
      await window.openbridge.downloads.start(
        jobId,
        {
          resolution,
          maps: selectedMaps.map(type => ({ type, format: mapFormats[type] ?? mapFormat })),
          lods: selectedLods,
          nativeMesh,
          renderer: activeRenderer,
          software: activeSoftware
        },
        "poliigon"
      );
      writeDownloadPrefs(summary.type, {
        resolution,
        mapFormat,
        nativeMesh,
        renderer: activeRenderer,
        software: activeSoftware
      });
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  const step = (delta: number): void => {
    if (mode === "renders") {
      setRenderIndex(index => Math.min(Math.max(0, index + delta), Math.max(0, renders.length - 1)));
    } else {
      setMapIndex(index => Math.min(Math.max(0, index + delta), Math.max(0, maps.length - 1)));
    }
  };

  const overviewPhysical = summary.physicalSize ?? poliigonScaleDimensions(summary);
  const overviewFacts: Array<[string, string]> = [];
  if (overviewPhysical) overviewFacts.push(["Physical size", overviewPhysical]);
  if (summary.creationMethod) overviewFacts.push(["Creation method", summary.creationMethod]);
  if (summary.publishedAt) overviewFacts.push(["Published", new Date(summary.publishedAt).toLocaleDateString()]);
  if (summary.websiteUrl) overviewFacts.push(["Asset ID", `${summary.id} · ${summary.assetName}`]);

  const specifications = (detail?.specifications ?? {}) as Record<string, unknown>;
  const lodTriangles =
    specifications.lods && typeof specifications.lods === "object" && !Array.isArray(specifications.lods)
      ? (specifications.lods as Record<string, unknown>)
      : {};
  const compatibility =
    specifications.minimum_compatibility &&
    typeof specifications.minimum_compatibility === "object" &&
    !Array.isArray(specifications.minimum_compatibility)
      ? (specifications.minimum_compatibility as Record<string, unknown>)
      : {};
  const meshCount = typeof specifications.meshes === "number" ? specifications.meshes : null;
  const polycount = typeof specifications.polycount === "number" ? specifications.polycount : null;
  const technicalFacts: TechnicalFact[] = [];
  if (summary.physicalSize) technicalFacts.push(["dimensions", "Dimensions", summary.physicalSize]);
  if (summary.resolutions.length > 0) technicalFacts.push(["resolutions", "Resolutions", summary.resolutions.join(", ")]);
  if (summary.maxResolution) {
    technicalFacts.push(["maxResolution", "Max resolution", `${Math.round(summary.maxResolution / 1024)}K`]);
  }
  if (summary.defaultResolution) technicalFacts.push(["defaultResolution", "Default resolution", summary.defaultResolution]);
  if (summary.mapCodes.length > 0) technicalFacts.push(["mapTypes", "Map types", String(summary.mapCodes.length)]);
  if (summary.mapFormats.length > 0) {
    technicalFacts.push(["mapFormats", "Map formats", summary.mapFormats.map(value => value.toUpperCase()).join(", ")]);
  }
  const lodCount = summary.lodCount > 0 ? summary.lodCount : (detail?.lods.length ?? 0);
  if (lodCount > 0) technicalFacts.push(["lods", "LODs", String(lodCount)]);
  const triangles = summary.maxTris ?? polycount;
  if (triangles) technicalFacts.push(["maxTriangles", "Max triangles", triangles.toLocaleString()]);
  if (meshCount !== null) technicalFacts.push(["meshes", "Meshes", String(meshCount)]);
  if (scaleTechnical?.materialWorkflow) {
    technicalFacts.push([
      "materialWorkflow",
      "Material workflow",
      scaleTechnical.materialWorkflow === "metal-rough"
        ? "Metal / Rough"
        : scaleTechnical.materialWorkflow === "spec-gloss"
          ? "Specular / Gloss"
          : "Mixed"
    ]);
  }
  if (scaleTechnical?.hasAlpha) technicalFacts.push(["alpha", "Alpha / opacity", "Yes"]);
  if (typeof specifications.displacement_cm === "string" || typeof specifications.displacement_cm === "number") {
    technicalFacts.push(["displacementHeight", "Displacement height", `${String(specifications.displacement_cm)} cm`]);
  }
  if (summary.creationMethod) technicalFacts.push(["creationMethod", "Creation method", summary.creationMethod]);
  if (summary.releaseStatus) technicalFacts.push(["releaseStatus", "Release status", summary.releaseStatus]);
  if (summary.type === "HDRS" && summary.timeOfDay != null) {
    technicalFacts.push([
      "timeOfDay",
      "Time of day",
      `${formatHdriTime(summary.timeOfDay)} · ${formatClock(summary.timeOfDay)}`
    ]);
  }
  const sunPosition = Array.isArray(specifications.sun_position)
    ? specifications.sun_position.filter((value): value is number => typeof value === "number")
    : [];
  if (sunPosition.length > 0) {
    technicalFacts.push(["sunPosition", "Sun position", sunPosition.map(value => Number(value.toFixed(3))).join(", ")]);
  }
  technicalFacts.push([
    "layoutConvention",
    "Folder layout",
    summary.convention === 1 ? "Resolution subfolders" : "Single folder"
  ]);
  technicalFacts.push(["catalogueId", "Catalogue ID", String(summary.id)]);
  if (summary.publishedAt) {
    technicalFacts.push(["published", "Published", new Date(summary.publishedAt).toLocaleDateString()]);
  }
  if (summary.updatedAt) {
    technicalFacts.push(["updated", "Updated", new Date(summary.updatedAt).toLocaleDateString()]);
  }
  const technicalGroups = groupTechnicalFacts(technicalFacts);
  const activeWorkflowMaps = detail?.maps.find(map => map.workflow === detailWorkflow)?.maps ?? [];
  const footerMapCount = isModel && activeWorkflowMaps.length > 0 ? activeWorkflowMaps.length : selectedMaps.length;
  const footerLodCount = (detail?.lods.length ?? 0) > 0 ? detail?.lods.length ?? 0 : summary.lodCount;

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer poliigon-drawer" role="dialog" aria-label={summary.name}>
        <div className="drawer-head">
          <ProviderLogo provider="poliigon" className="drawer-provider-mark" />
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
            disabled={resultIndex < 0 || resultIndex >= resultCount - 1}
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
          {summary.websiteUrl && (
            <button
              type="button"
              className="text-btn"
              onClick={() => void window.openbridge.openExternal(summary.websiteUrl)}
              title="Open this asset on poliigon.com"
            >
              Open on Poliigon
            </button>
          )}
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
              <button
                type="button"
                className={mode === "maps" ? "active" : ""}
                onClick={() => setMode("maps")}
                disabled={!canShowMaps}
                title={
                  canShowMaps
                    ? maps.length > 0
                      ? "Texture map previews"
                      : "Show the texture maps included with this asset"
                    : "No map previews or map metadata for this asset"
                }
              >
                Maps
              </button>
            </div>

            {mode === "maps" && genuineLoading ? (
              <div className="poliigon-map-empty">
                <span className="spinner" aria-hidden="true" />
                <strong>Preparing genuine 1K map previews…</strong>
                <TransferStatus
                  progress={downloads[previewProgressKey.maps(summary.id)]}
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
              ) : mapKeys.length > 0 ? (
                <div className="poliigon-map-empty">
                  <strong>
                    {canPreviewMaps
                      ? `No map previews are published for this ${summary.hasModel ? "3D asset" : "asset"}.`
                      : "Map previews are unavailable for this asset."}
                  </strong>
                  <p>
                    {canPreviewMaps
                      ? "The download includes these maps:"
                      : "Sign in or acquire this asset to load 1K map previews."}
                  </p>
                  <div className="poliigon-chip-row">
                    {mapKeys.map(code => <span key={code}>{poliigonMapName(code)}</span>)}
                  </div>
                </div>
              ) : (
                <span className="map-preview-status">No texture map previews are available for this asset.</span>
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
            ) : summary.thumbnail ? (
              <img src={summary.thumbnail} alt={summary.name} referrerPolicy="no-referrer" />
            ) : (
              <span>{summary.typeLabel}</span>
            )}

            <div className="drawer-flags">
              {localPath ? (
                <span className="asset-flag local">LOCAL</span>
              ) : isOwned ? (
                <span className="asset-flag owned">OWNED</span>
              ) : summary.free ? (
                <span className="asset-flag free">FREE</span>
              ) : auth.isUnlimited ? (
                <span className="asset-flag included">UNLIMITED</span>
              ) : (
                <span className="asset-flag credit">
                  {summary.credit} CREDIT{summary.credit === 1 ? "" : "S"}
                </span>
              )}
            </div>

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
                  <span>
                    {previewPosition + 1} / {previewCount}
                  </span>
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
          {mode === "maps" && fetchedMaps.length > 0 && (
            <p className="hint poliigon-map-note">
              Genuine 1K map images from this asset, unwatermarked. Raw maps can look different
              from the lit render.
              {summary.type === "HDRS" ? " Open full-screen to inspect the HDR exposure range." : ""}
            </p>
          )}
          {mode === "maps" && fetchedMaps.length === 0 && toolboxMaps.length > 0 && !genuineLoading && (
            <p className="hint poliigon-map-note">
              {previewEntitled
                ? "Genuine 1K map previews are unavailable right now. Showing public watermarked previews."
                : "Showing public watermarked previews. Sign in or acquire this asset to load genuine 1K maps."}
              {previewEntitled && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      setFetchedMaps([]);
                      setMapsError(null);
                      setMapsAttempted(false);
                      setMapsRetry(value => value + 1);
                    }}
                  >
                    Retry
                  </button>
                </>
              )}
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
          <p className="drawer-id">{summary.assetName}</p>

          <div className="inspector-tabs" role="group" aria-label="Poliigon asset sections">
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
            {description && <p className="poliigon-description">{description}</p>}
            <div className="meta-grid">
              <span>Type</span>
              <strong>{assetTypeLabel(summary.typeLabel)}</strong>
              <span>Access</span>
              <strong>
                {localPath
                  ? "Downloaded"
                  : summary.free
                    ? "Free"
                    : isOwned
                      ? "Owned"
                      : auth.isUnlimited
                        ? "Included in plan"
                        : `${summary.credit} credit${summary.credit === 1 ? "" : "s"}`}
              </strong>
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
            {summary.categories.length > 0 && (
              <div className="poliigon-chips-section">
                <strong>Categories</strong>
                <div className="poliigon-chip-row">
                  {summary.categories.slice(0, 8).map(path => (
                    <button
                      type="button"
                      key={path}
                      onClick={() => {
                        setCategoryByPath(path.split(" / "));
                        close();
                      }}
                    >
                      {path}
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
              {showScale && scaleTechnical && <AssetScaleDiagram technical={scaleTechnical} />}
            </div>

          <div hidden={section !== "related"}>
            {related.length > 0 ? (
              <div className="poliigon-related">
                <strong>Related assets</strong>
                <div className="poliigon-related-grid">
                  {related.map(item => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => void usePoliigonStore.getState().openAsset(item)}
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
                    <span key={code}>{poliigonMapName(code)}</span>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(lodTriangles).length > 0 && (
              <div className="poliigon-lods">
                <strong>LOD triangles</strong>
                {Object.entries(lodTriangles).map(([lod, triangles]) => (
                  <div key={lod}>
                    <span>{lod}</span>
                    <em>{typeof triangles === "number" ? triangles.toLocaleString() : String(triangles)}</em>
                  </div>
                ))}
              </div>
            )}
            {Object.keys(compatibility).length > 0 && (
              <div className="poliigon-lods">
                <strong>Minimum compatibility</strong>
                {Object.entries(compatibility).map(([software, version]) => (
                  <div key={software}>
                    <span>{software}</span>
                    <em>{String(version)}</em>
                  </div>
                ))}
              </div>
            )}
            {Object.keys(specifications).length > 0 && (
              <details className="poliigon-raw">
                <summary>Raw specifications</summary>
                <pre>{JSON.stringify(specifications, null, 2)}</pre>
              </details>
            )}
          </div>

          <div hidden={section !== "download"}>
            {!auth.loggedIn ? (
              <div className="poliigon-download-prompt">
                <p>Sign in to Poliigon to download this asset.</p>
                <button type="button" className="btn btn-primary" onClick={openLogin}>
                  Sign in to Poliigon
                </button>
              </div>
            ) : !entitled ? (
              <div className="poliigon-download-prompt">
                <p>
                  This asset is not included in your current Poliigon access. Open it on Poliigon to
                  purchase it or adjust your plan, then return here to download.
                </p>
                <button
                  type="button"
                  className="btn btn-accent"
                  disabled={!summary.websiteUrl}
                  onClick={() => {
                    if (summary.websiteUrl) void window.openbridge.openExternal(summary.websiteUrl);
                  }}
                >
                  Buy / download on Poliigon
                </button>
              </div>
            ) : (
              <div className="download-box">
                <div className="download-heading">
                  <h3>Download settings</h3>
                  <button type="button" className="text-btn" onClick={resetOptions}>
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
                    options={summary.resolutions.map(value => ({ value, label: value }))}
                  />
                </div>

                {isTexture && (
                  <>
                    <div className="poliigon-option-head">
                      <strong>Texture maps</strong>
                      <div>
                        <button type="button" className="text-btn" onClick={() => setSelectedMaps(mapKeys)}>All</button>
                        <button type="button" className="text-btn" onClick={() => setSelectedMaps(commonMapKeys(mapKeys))}>Common</button>
                        <button type="button" className="text-btn" onClick={() => setSelectedMaps([])}>None</button>
                      </div>
                    </div>
                    <div className="map-options">
                      {mapKeys.map(key => {
                        const choices = formatsForMap(key);
                        return (
                          <div className="map-row" key={key}>
                            <div className="map-row-main">
                              <label className="toggle inline">
                                <input
                                  type="checkbox"
                                  checked={selectedMaps.includes(key)}
                                  onChange={() => toggleMap(key)}
                                />
                                <span>{poliigonMapName(key)}</span>
                              </label>
                              <span className="map-facts">{resolution} · {choices.join("/")}</span>
                            </div>
                            <Dropdown
                              className="select-dropdown small"
                              value={mapFormats[key] ?? mapFormat}
                              onChange={value =>
                                setMapFormats(current => ({ ...current, [key]: value }))
                              }
                              ariaLabel={`${poliigonMapName(key)} format`}
                              options={choices.map(format => ({
                                value: format,
                                label: format.toUpperCase()
                              }))}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {isModel && (
                  <>
                    {(detail?.lods.length ?? 0) > 0 ? (
                      <>
                        <div className="poliigon-option-head">
                          <strong>LODs</strong>
                          <div>
                            <button type="button" className="text-btn" onClick={() => setSelectedLods(detail?.lods ?? [])}>All</button>
                            <button type="button" className="text-btn" onClick={() => setSelectedLods([])}>None</button>
                          </div>
                        </div>
                        <div className="map-options">
                          {(detail?.lods ?? []).map(lod => (
                            <div className="map-row" key={lod}>
                              <div className="map-row-main">
                                <label className="toggle inline">
                                  <input
                                    type="checkbox"
                                    checked={selectedLods.includes(lod)}
                                    onChange={() => toggleLod(lod)}
                                  />
                                  <span>{lod}</span>
                                </label>
                                <span className="map-facts">
                                  {resolution}
                                  {typeof lodTriangles[lod] === "number"
                                    ? ` · ${(lodTriangles[lod] as number).toLocaleString()} tris`
                                    : lodTriangles[lod]
                                      ? ` · ${String(lodTriangles[lod])}`
                                      : ""}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="hint">
                        This model ships as a single mesh, so there are no LODs to choose.
                      </p>
                    )}
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={nativeMesh}
                        onChange={event => setNativeMesh(event.target.checked)}
                      />
                      <span>Download the native {activeRenderer} mesh</span>
                    </label>
                    {nativeMesh && (
                      <>
                        <div className="form-row compact">
                          <label>DCC</label>
                          <Dropdown
                            className="select-dropdown"
                            value={activeSoftware}
                            onChange={value => {
                              setSoftware(value);
                              const entry = detail?.softwares.find(item => item.software === value);
                              setRenderer(entry?.render_engines?.[0] ?? "Cycles");
                            }}
                            ariaLabel="Native mesh DCC"
                            options={softwareOptions.map(value => ({ value, label: value }))}
                          />
                        </div>
                        <div className="form-row compact">
                          <label>Renderer</label>
                          <Dropdown
                            className="select-dropdown"
                            value={activeRenderer}
                            onChange={setRenderer}
                            ariaLabel="Native mesh renderer"
                            options={rendererOptions.map(value => ({ value, label: value }))}
                          />
                        </div>
                      </>
                    )}
                  </>
                )}

                <p className="hint">
                  Files are written to {settings?.poliigonLibraryPath || "the Poliigon library"} using the
                  layout the Poliigon Blender addon reads.
                </p>
                <p className="hint">
                  Plan: {resolution}
                  {isTexture
                    ? ` · ${selectedMaps.length} map${selectedMaps.length === 1 ? "" : "s"} · ${mapFormat.toUpperCase()}`
                    : isModel
                      ? ` · ${
                          (detail?.lods.length ?? 0) > 0
                            ? `${selectedLods.length} LOD${selectedLods.length === 1 ? "" : "s"}`
                            : "Single mesh"
                        } · ${nativeMesh ? `${activeSoftware} / ${activeRenderer} native mesh` : "Generic mesh"}`
                      : " · HDRI"}
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
                    {starting ? "Starting…" : `Download ${resolution}`}
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
            )}
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
              <button
                type="button"
                className="btn btn-ghost btn-wide"
                onClick={showInLibrary}
              >
                Show in Library
              </button>
            </>
          ) : (
            <>
              <div className="download-summary">
                <span>
                  {summary.type === "HDRS"
                    ? `${resolution} · ${formatHdriTime(summary.timeOfDay)}`
                    : `${resolution} · ${footerMapCount} ${footerMapCount === 1 ? "map" : "maps"}`}
                  {summary.type !== "HDRS" && isModel && footerLodCount > 0
                    ? ` · ${selectedLods.length} LOD${selectedLods.length === 1 ? "" : "s"}`
                    : ""}
                </span>
                <button type="button" className="text-btn" onClick={() => setSection("download")}>
                  Edit plan
                </button>
              </div>

              {entitled && summary.resolutions.length > 0 && (
                <div className="footer-resolution" role="group" aria-label="Quick download resolution">
                  {summary.resolutions.map(value => (
                    <button
                      type="button"
                      key={value}
                      className={resolution === value ? "chip active" : "chip"}
                      aria-pressed={resolution === value}
                      disabled={downloadActive}
                      onClick={() => setResolution(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}

              {!auth.loggedIn ? (
                <button type="button" className="btn btn-primary btn-wide" onClick={openLogin}>
                  Sign in to Poliigon
                </button>
              ) : !entitled ? (
                <button
                  type="button"
                  className="btn btn-accent btn-wide"
                  disabled={!summary.websiteUrl}
                  onClick={() => {
                    if (summary.websiteUrl) void window.openbridge.openExternal(summary.websiteUrl);
                  }}
                >
                  Open on Poliigon
                </button>
              ) : downloadActive && progress ? (
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
                  onClick={() => void startDownload()}
                >
                  <DownloadIcon /> {starting ? "Starting…" : summary.free && !isOwned ? "Download free" : "Download"}
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
