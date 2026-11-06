import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetScaleDiagram } from "./AssetScaleDiagram";
import { useStore } from "../store";
import { Dropdown } from "./Dropdown";
import { ImageViewer } from "./ImageViewer";
import type {
  CatalogHit,
  DownloadMapFormat,
  DownloadMapOption,
  DownloadOptions,
  ExtendedAsset,
  MapPreview,
  MeshFormat
} from "../../shared/types";
import {
  assetTechnicalFacts,
  downloadPlan,
  lodMeshBytes,
  mapTechnicalDetails
} from "../../shared/asset-metadata";
import { formatMeasurementText } from "../../shared/measurements";
import { assetTypeLabel } from "../asset-visuals";
import { ProviderLogo } from "./ProviderLogo";
import { groupTechnicalFacts, type TechnicalFact } from "../technical-order";
import {
  aclResolution,
  hitId,
  hitPreview,
  hitThumb,
  renderPreviews,
  typeLabel
} from "../catalog-utils";
import {
  MAP_FORMAT_OPTIONS,
  buildDownloadOptions,
  canUseExr,
  formatBytes,
  lodInfo,
  mapTypeLabel,
  variationCount
} from "../download-options";
import {
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  FolderIcon,
  UserIcon
} from "../icons";

const RESOLUTIONS = [1024, 2048, 4096, 8192];

function bytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function is3d(asset: ExtendedAsset | undefined, type: string | undefined): boolean {
  const categories = asset?.categories ?? [];
  return (
    categories[0]?.toLowerCase().startsWith("3d") ||
    (type ?? "").toLowerCase().startsWith("3d")
  );
}

function isPlant(asset: ExtendedAsset | undefined, type: string | undefined): boolean {
  const categories = asset?.categories ?? [];
  return categories[0]?.toLowerCase() === "3dplant" || (type ?? "").toLowerCase() === "3dplant";
}

function updateMapOption(
  options: DownloadOptions,
  type: string,
  patch: Partial<DownloadMapOption>
): DownloadOptions {
  return {
    ...options,
    components: options.components.map(component =>
      component.type === type ? { ...component, ...patch } : component
    )
  };
}

export function AssetDrawer() {
  const selection = useStore(state => state.selection);
  const auth = useStore(state => state.auth);
  const settings = useStore(state => state.settings);
  const acquired = useStore(state => state.acquired);
  const downloads = useStore(state => state.downloads);
  const favorites = useStore(state => state.favorites);
  const toggleFavorite = useStore(state => state.toggleFavorite);
  const close = useStore(state => state.closeSelection);
  const login = useStore(state => state.login);
  const openHit = useStore(state => state.openHit);
  const startDownload = useStore(state => state.startDownload);
  const acquire = useStore(state => state.acquire);
  const cancelDownload = useStore(state => state.cancelDownload);
  const validateJson = useStore(state => state.validateJson);
  const toast = useStore(state => state.toast);
  const history = useStore(state => state.selectionHistory);
  const hits = useStore(state => state.hits);
  const libraryAssets = useStore(state => state.libraryAssets);
  const catalogMetadata = useStore(state => state.catalogMetadata);

  const hit = selection?.hit;
  const local = selection?.local;
  const extended = selection?.extended;
  const assetId = hit ? hitId(hit) : local?.id ?? "";
  const owned = acquired.includes(assetId);
  const favorited = favorites.includes(assetId);
  const progress = downloads[assetId];

  const [options, setOptions] = useState<DownloadOptions | null>(null);
  const [tab, setTab] = useState<"textures" | "models">("textures");
  const [section, setSection] = useState<"overview" | "settings" | "technical" | "related">("overview");
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [assetId]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (section === "overview") scroll.scrollTo({ top: 0 });
    else {
      const tabs = scroll.querySelector<HTMLElement>(".inspector-tabs");
      if (tabs) scroll.scrollTop += tabs.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 20;
    }
  }, [section]);
  const [previewMode, setPreviewMode] = useState<"render" | "maps">("render");
  const [mapPreviews, setMapPreviews] = useState<MapPreview[]>([]);
  const [mapIndex, setMapIndex] = useState(0);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [related, setRelated] = useState<CatalogHit[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [renderIndex, setRenderIndex] = useState(0);
  const [localRenders, setLocalRenders] = useState<MapPreview[]>([]);
  const [localMaps, setLocalMaps] = useState<MapPreview[]>([]);
  const [localPreviewError, setLocalPreviewError] = useState("");
  const [viewerOpen, setViewerOpen] = useState(false);
  const renders = useMemo(() => local ? localRenders : renderPreviews(hit, extended), [local, localRenders, hit, extended]);
  const loadHighResolution = useCallback((item: MapPreview, signal?: AbortSignal) => {
    if (!item.map) return Promise.resolve(null);
    const cancel = () => { void window.openbridge.catalog.cancel("preview").catch(() => undefined); };
    signal?.addEventListener("abort", cancel, { once: true });
    return window.openbridge.catalog.highResolutionPreview(assetId, item.map)
      .finally(() => signal?.removeEventListener("abort", cancel));
  }, [assetId]);

  const assetType = extended?.type ?? hit?.type ?? local?.type ?? "";
  const threeD = is3d(extended, assetType);
  const plant = isPlant(extended, assetType);
  const maxResolution = aclResolution(extended);
  const resolutionOptions = RESOLUTIONS.filter(value => !maxResolution || value <= maxResolution);
  const lods = useMemo(() => lodInfo(extended, threeD), [extended, threeD]);
  const maxVariation = useMemo(() => variationCount(extended), [extended]);

  useEffect(() => {
    if (!selection) {
      setOptions(null);
      return;
    }
    const built = buildDownloadOptions(extended, settings);
    setOptions(built);
    setTab(threeD ? "textures" : "textures");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, extended, settings]);

  useEffect(() => {
    setSection("overview");
    setPreviewMode("render");
    setMapPreviews([]);
    setMapIndex(0);
    setMapsError(null);
    setMapsLoading(false);
    setRenderIndex(0);
    setViewerOpen(false);
    setLocalRenders([]);
    setLocalMaps([]);
    setLocalPreviewError("");
  }, [assetId]);

  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    void window.openbridge.localPreviews(local.id, local.path).then(result => {
      if (!cancelled) { setLocalRenders(result.renders); setLocalMaps(result.maps); }
    }).catch(error => { if (!cancelled) setLocalPreviewError(String(error)); });
    return () => { cancelled = true; };
  }, [local]);

  useEffect(() => {
    const inline = (extended?.similarAssets ?? []).filter(
      item => item && (item.id || item.objectID) && hitId(item) !== assetId
    );
    if (inline.length > 0) {
      setRelated(inline.slice(0, 8));
      setRelatedLoading(false);
      return;
    }
    if (!extended) {
      setRelated([]);
      setRelatedLoading(false);
      return;
    }

    let cancelled = false;
    const assetCategories = extended.assetCategories as Record<string, unknown> | undefined;
    const topCategory =
      assetCategories && typeof assetCategories === "object"
        ? Object.keys(assetCategories)[0]
        : extended.categories?.[0];
    const tags = (extended.tags ?? []).slice(0, 3);
    setRelatedLoading(true);

    const search = async (
      query: string,
      categoryPath: string[] | undefined
    ): Promise<CatalogHit[]> => {
      const result = await window.openbridge.catalog.search({
        query,
        categoryPath,
        page: 0,
        hitsPerPage: 24
      }, "related");
      return result.hits.filter(
        item => item && (item.id || item.objectID) && hitId(item) !== assetId
      );
    };

    void (async () => {
      try {
        const categoryPath = topCategory ? [topCategory] : undefined;
        const merged = new Map<string, CatalogHit>();
        const add = (hits: CatalogHit[]): void => {
          for (const item of hits) {
            const id = hitId(item);
            if (id && id !== assetId) merged.set(id, item);
          }
        };

        add(await search(tags.slice(0, 2).join(" "), categoryPath));
        if (cancelled) return;
        if (merged.size < 8 && tags[0]) {
          add(await search(tags[0], categoryPath));
          if (cancelled) return;
        }
        if (merged.size < 8) {
          add(await search("", categoryPath));
        }

        if (!cancelled) setRelated([...merged.values()].slice(0, 8));
      } catch {
        if (!cancelled) setRelated([]);
      } finally {
        if (!cancelled) setRelatedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      void window.openbridge.catalog.cancel("related").catch(() => undefined);
    };
  }, [assetId, extended]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!selection || viewerOpen) return;
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.defaultPrevented || (event.target as HTMLElement)?.closest("input,select,textarea,[role=listbox],[contenteditable=true]")) return;
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault(); useStore.getState().backSelection(); return;
      }
      if (previewMode !== "maps") {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); useStore.getState().stepSelection(event.key === "ArrowLeft" ? -1 : 1);
        }
        return;
      }
      const count = local ? localMaps.length : mapPreviews.length;
      if (count === 0) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setMapIndex(index => (index - 1 + count) % count);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setMapIndex(index => (index + 1) % count);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, mapPreviews.length, localMaps.length, local, previewMode, selection, viewerOpen]);

  if (!selection) return null;

  const preview = local
    ? local.preview
      ? window.openbridge.toFileUrl(local.preview)
      : null
    : hit
      ? hitPreview(hit)
      : null;
  const availableMaps = local ? localMaps : mapPreviews;
  const activeMap = previewMode === "maps" ? availableMaps[mapIndex] : undefined;
  const renderItems = renders.length ? renders : preview ? [{ type: "render", label: "Render", url: preview }] : [];
  const activePreview = activeMap?.url ?? (previewMode === "maps" ? null : renderItems[renderIndex]?.url);
  const previewItems = previewMode === "maps" ? availableMaps : renderItems;
  const resultIndex = local ? libraryAssets.findIndex(asset => asset.path === local.path)
    : hits.findIndex(item => hitId(item) === assetId);
  const resultCount = local ? libraryAssets.length : hits.length;

  async function openMaps(): Promise<void> {
    if (local) { setPreviewMode("maps"); setMapIndex(0); return; }
    if (!auth.loggedIn) {
      await login();
      if (!useStore.getState().auth.loggedIn) return;
    }
    setPreviewMode("maps");
    if (mapPreviews.length > 0 || mapsLoading) return;
    setMapsLoading(true);
    setMapsError(null);
    const currentId = assetId;
    try {
      const maps = await window.openbridge.catalog.mapPreviews(assetId);
      const current = useStore.getState().selection;
      if ((current?.hit ? hitId(current.hit) : current?.local?.id) !== currentId) return;
      setMapPreviews(maps);
      setMapIndex(0);
      if (maps.length === 0) {
        setMapsError("No texture map previews are available for this asset");
      }
    } catch (error) {
      const current = useStore.getState().selection;
      if ((current?.hit ? hitId(current.hit) : current?.local?.id) !== currentId) return;
      setMapsError(error instanceof Error ? error.message : String(error));
    } finally {
      const current = useStore.getState().selection;
      if ((current?.hit ? hitId(current.hit) : current?.local?.id) === currentId) setMapsLoading(false);
    }
  }

  function stepMap(delta: number): void {
    if (availableMaps.length === 0) return;
    setMapIndex(index => (index + delta + availableMaps.length) % availableMaps.length);
  }

  const name = local?.name ?? hit?.name ?? extended?.name ?? assetId;
  const categories = extended?.categories ?? hit?.categories ?? local?.categories ?? [];
  const tags = extended?.tags ?? hit?.tags ?? local?.tags ?? [];
  const points = extended?.points ?? hit?.points ?? 0;
  const active =
    progress && ["queued", "requesting", "downloading", "extracting", "paused"].includes(progress.status);

  const update = (next: DownloadOptions) => {
    setOptions(next);
  };

  const patch = (next: Partial<DownloadOptions>) => {
    if (!options) return;
    update({ ...options, ...next });
  };

  async function download() {
    if (!options) return;
    if (!auth.loggedIn) {
      await login();
      return;
    }
    await startDownload(options);
  }

  async function exportLocal() {
    if (!local) return;
    const folder = await window.openbridge.chooseDirectory();
    if (!folder) return;
    try {
      const written = await window.openbridge.exportAssetToFolder(local.id, folder);
      toast(`Wrote ${written}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function resetDefaults() {
    const defaults = buildDownloadOptions(extended, settings, {});
    update(defaults);
  }

  const plan = options ? downloadPlan(extended, options) : null;
  const technical = local?.technical ?? (extended ? assetTechnicalFacts(extended) : hit?.metadata?.technical) ?? assetTechnicalFacts(extended);
  const lodBytes = lodMeshBytes(extended, options?.meshFormat ?? "fbx");
  const selectedMaps = options?.components.filter(component => component.selected).length ?? 0;
  const selectedLods = options
    ? lods.filter(lod => (plant && options.downloadAllPlantLods) || options.lods[lod.index]).length
    : 0;

  const averageColor = technical.averageColor;
  const texelDensity = technical.texelDensity
    ? /^\d+$/.test(technical.texelDensity)
      ? `${technical.texelDensity} px/m`
      : technical.texelDensity
    : null;
  const facts: TechnicalFact[] = [];
  if (technical.dimensions) facts.push(["dimensions", "Dimensions", formatMeasurementText(technical.dimensions)]);
  if (technical.scanArea) facts.push(["scanArea", "Scan area", formatMeasurementText(technical.scanArea)]);
  if (technical.height && !technical.dimensions) facts.push(["height", "Height", formatMeasurementText(technical.height)]);
  if (texelDensity && Number.parseFloat(texelDensity) > 0) {
    facts.push(["texelDensity", "Texel density", texelDensity]);
  }
  if (resolutionOptions.length > 0) {
    facts.push([
      "resolutions",
      "Resolutions",
      resolutionOptions.map(value => `${value / 1024}K`).join(", ")
    ]);
  }
  if (technical.resolution) {
    facts.push(["maxResolution", "Max resolution", `${technical.resolution / 1024}K`]);
  }
  if (options?.resolution) {
    facts.push(["defaultResolution", "Default resolution", `${options.resolution / 1024}K`]);
  }
  if (technical.mapCount > 0) facts.push(["mapTypes", "Map types", String(technical.mapCount)]);
  if (technical.mapFormats && technical.mapFormats.length > 0) {
    facts.push(["mapFormats", "Map formats", technical.mapFormats.join(", ")]);
  }
  if (technical.lodCount > 0) facts.push(["lods", "LODs", String(technical.lodCount)]);
  if (technical.maxTris > 0) {
    facts.push(["maxTriangles", "Max triangles", technical.maxTris.toLocaleString()]);
  }
  if (technical.meshType) facts.push(["meshType", "Mesh type", technical.meshType]);
  if (technical.closedMesh !== null) {
    facts.push(["meshClosed", "Mesh", technical.closedMesh ? "Closed" : "Open"]);
  }
  if (technical.scaleFixed !== null) {
    facts.push(["scaleFixed", "Scale fixed", technical.scaleFixed ? "Yes" : "No"]);
  }
  if (technical.assembly !== null) {
    facts.push(["assembly", "Assembly", technical.assembly ? "Yes" : "No"]);
  }
  if (technical.modular) facts.push(["modular", "Modular", "Yes"]);
  if (technical.tileable !== null) {
    facts.push([
      "tileable",
      "Tileable",
      technical.tilingDirections.length > 0
        ? `Yes (${technical.tilingDirections.join(", ")})`
        : technical.tileable
          ? "Yes"
          : "No"
    ]);
  }
  if (technical.variationCount > 1) {
    facts.push(["variations", "Variations", String(technical.variationCount)]);
  }
  if (technical.billboardCount > 0) {
    facts.push(["billboards", "Billboards", String(technical.billboardCount)]);
  }
  if (technical.materialWorkflow) {
    facts.push([
      "materialWorkflow",
      "Material workflow",
      technical.materialWorkflow === "metal-rough"
        ? "Metal / Rough"
        : technical.materialWorkflow === "spec-gloss"
          ? "Specular / Gloss"
          : "Mixed"
    ]);
  }
  if (technical.hasAlpha) facts.push(["alpha", "Alpha / opacity", "Yes"]);
  if (technical.packName) facts.push(["pack", "Pack", technical.packName]);
  if (assetId) facts.push(["catalogueId", "Catalogue ID", assetId]);
  if (technical.revision != null) facts.push(["revision", "Revision", String(technical.revision)]);
  if (technical.revised) {
    if (typeof technical.revised === "number") {
      facts.push(["revised", "Updated", new Date(technical.revised).toLocaleDateString()]);
    } else if (typeof technical.revised === "string") {
      facts.push(["revised", "Updated", technical.revised]);
    } else {
      facts.push(["revised", "Revised", "Yes"]);
    }
  }
  const techGroups = groupTechnicalFacts(facts);

  const semanticLabels = [
    ["state", technical.semantic.state],
    ["setting", technical.semantic.interiorExterior],
    ["industry", technical.semantic.industry],
    ["theme", technical.semantic.theme],
    ["descriptive", technical.semantic.descriptive],
    ["contains", technical.semantic.contains],
    ["colour", technical.semantic.color],
    ["orientation", technical.semantic.orientation]
  ]
    .flatMap(([group, values]) =>
      (values as string[]).map(value => `${group}: ${value}`)
    )
    .slice(0, 18);
  const objectKeys = (value: unknown): string[] =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>)
      : [];
  const materialNames = objectKeys(extended?.materials);
  const textureSetNames = objectKeys(extended?.textureSets);

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-label={name}>
        <div className="drawer-head">
          <button type="button" className="text-btn" disabled={!history.length}
            onClick={() => useStore.getState().backSelection()} title="Back to previous asset (Alt+Left)">Back</button>
          <ProviderLogo provider="megascans" className="drawer-provider-mark" />
          <button type="button" className="icon-btn" aria-label="Previous asset" disabled={resultIndex <= 0}
            onClick={() => useStore.getState().stepSelection(-1)}>‹</button>
          <button type="button" className="icon-btn" aria-label="Next asset" disabled={resultIndex < 0 || resultIndex >= resultCount - 1}
            onClick={() => useStore.getState().stepSelection(1)}>›</button>
          <button
            type="button"
            className={favorited ? "icon-btn active" : "icon-btn"}
            onClick={() => void toggleFavorite(assetId)}
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            title={favorited ? "Remove from favorites" : "Add to favorites"}
          >
            {favorited ? "♥" : "♡"}
          </button>
          <button type="button" className="icon-btn" onClick={close} title="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="drawer-scroll" ref={scrollRef}>
          <div className="drawer-preview">
            {(
              <div className="preview-switch">
                <button
                  type="button"
                  className={previewMode === "render" ? "active" : ""}
                  onClick={() => setPreviewMode("render")}
                >
                  Render
                </button>
                <button
                  type="button"
                  className={previewMode === "maps" ? "active" : ""}
                  onClick={() => void openMaps()}
                  title={local || auth.loggedIn ? "Texture maps" : "Sign in to preview maps"}
                >
                  Maps
                </button>
              </div>
            )}

            {activePreview ? (
              <button type="button" className="expand-preview" onClick={() => setViewerOpen(true)} aria-label="Expand preview" title="Expand preview">
                <img src={activePreview} alt={activeMap?.label ?? "Asset render"} referrerPolicy="no-referrer" />
              </button>
            ) : previewMode === "maps" ? (
              <span className="map-preview-status">
                {mapsLoading ? "Loading texture maps..." : localPreviewError || mapsError || (local ? "No browser-readable maps (JPG, PNG or WebP). EXR requires an external viewer." : "No texture maps")}
              </span>
            ) : (
              <span>{typeLabel(assetType)}</span>
            )}

            {previewMode === "render" && (
              <div className="drawer-flags">
                {owned && <span className="asset-flag owned">OWNED</span>}
                {points === 0 && <span className="asset-flag free">FREE</span>}
              </div>
            )}

            {previewMode === "render" && renderItems.length > 1 && (
              <div className="map-nav">
                <div className="map-nav-label">
                  <strong>{renderItems[renderIndex]?.label ?? "Render"}</strong>
                </div>
                <div className="map-nav-actions">
                  <button
                    type="button"
                    onClick={() => setRenderIndex(index => Math.max(0, index - 1))}
                    disabled={renderIndex <= 0}
                    title="Previous render"
                    aria-label="Previous render"
                  >
                    ‹
                  </button>
                  <span>
                    {renderIndex + 1} / {renderItems.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRenderIndex(index => Math.min(renderItems.length - 1, index + 1))}
                    disabled={renderIndex >= renderItems.length - 1}
                    title="Next render"
                    aria-label="Next render"
                  >
                    ›
                  </button>
                </div>
              </div>
            )}

            {previewMode === "maps" && activeMap && (
              <div className="map-nav">
                <div className="map-nav-label">
                  <strong title={activeMap.label}>{activeMap.label}</strong>
                  {activeMap.resolution && <span>{activeMap.resolution}</span>}
                </div>
                <div className="map-nav-actions">
                  <button
                    type="button"
                    onClick={() => stepMap(-1)}
                    disabled={mapIndex <= 0}
                    title="Previous map"
                    aria-label="Previous map"
                  >
                    ‹
                  </button>
                  <span>
                    {mapIndex + 1} / {availableMaps.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => stepMap(1)}
                    disabled={mapIndex >= availableMaps.length - 1}
                    title="Next map"
                    aria-label="Next map"
                  >
                    ›
                  </button>
                </div>
              </div>
            )}
          </div>

          {previewItems.length > 0 && <div className="preview-picker">
            <Dropdown className="select-dropdown" value={String(previewMode === "maps" ? mapIndex : renderIndex)}
              ariaLabel={previewMode === "maps" ? "Map and texture set" : "Render image"}
              onChange={value => previewMode === "maps" ? setMapIndex(Number(value)) : setRenderIndex(Number(value))}
              options={previewItems.map((item, index) => ({ value: String(index), label: item.label }))} />
            <button type="button" className="btn btn-ghost preview-expand-action"
              onClick={() => setViewerOpen(true)} aria-label="Expand preview in larger viewer">Expand</button>
          </div>}
          {viewerOpen && previewItems.length > 0 && <ImageViewer items={previewItems}
            index={previewMode === "maps" ? mapIndex : renderIndex}
            loadHighResolution={loadHighResolution}
            onIndex={previewMode === "maps" ? setMapIndex : setRenderIndex} onClose={() => setViewerOpen(false)} />}

          <h2 className="drawer-title" title={name}>{name}</h2>
          <p className="drawer-id">{assetId}</p>
          <div className="inspector-tabs" role="group" aria-label="Asset sections">
            {(["overview", "settings", "technical", "related"] as const).map(value => <button type="button" key={value}
              className={section === value ? "active" : ""} aria-pressed={section === value}
              onClick={() => setSection(value)}>{value === "settings" ? (local ? "Files" : "Download settings") : value === "overview" ? "Overview" : value === "technical" ? "Technical" : "Related"}</button>)}
          </div>
          <div hidden={section !== "overview"}>
          {(technical.packId || technical.packName) && <div className="pack-link">
            <button type="button" className="btn btn-ghost" disabled={!local && !catalogMetadata?.available}
              onClick={() => useStore.getState().browsePack({ id: technical.packId || undefined,
                name: technical.packName || technical.packId || "Pack" }, Boolean(local))}>
              More from {technical.packName || "this pack"}
            </button>
            {!local && !catalogMetadata?.available && <p className="hint">Install catalogue metadata in Settings to explore this pack.</p>}
          </div>}

          {selection.loading && <div className="loading-line">Loading asset details...</div>}
          {selection.error && <div className="error-box small" role="alert">Could not load asset details: {selection.error}{" "}
            {hit && <button type="button" className="text-btn" onClick={() => void openHit(hit)}>Retry details</button>}</div>}

          <div className="meta-grid">
            <span>Type</span>
            <strong>{assetTypeLabel(typeLabel(assetType))}</strong>
            <span>Access</span>
            <strong>{points === 0 ? "Free" : owned ? "Owned" : "Not acquired"}</strong>
            {technical.dimensions && (
              <>
                <span>Physical size</span>
                <strong>{formatMeasurementText(technical.dimensions)}</strong>
              </>
            )}
            <span>Asset ID</span>
            <strong>{assetId}</strong>
            <span>Categories</span>
            <strong>{categories.join(" - ") || "-"}</strong>
            <span>Tags</span>
            <strong>{tags.slice(0, 12).join(", ") || "-"}</strong>
            {hit?.biome && hit.biome !== "undefined" && (
              <>
                <span>Biome</span>
                <strong>{hit.biome}</strong>
              </>
            )}
            {hit?.region && hit.region !== "undefined" && (
              <>
                <span>Region</span>
                <strong>{hit.region}</strong>
              </>
            )}
            {extended?.acl?.exrAccess && (
              <>
                <span>EXR access</span>
                <strong>{extended.acl.exrAccess}</strong>
              </>
            )}
          </div>

          {semanticLabels.length > 0 && (
            <section className="semantic-panel">
              <h3>Semantic tags</h3>
              <div className="semantic-chips">
                {semanticLabels.map(label => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </section>
          )}

          {(materialNames.length > 0 || textureSetNames.length > 0) && (
            <section className="material-panel">
              <h3>Materials & texture sets</h3>
              {materialNames.length > 0 && (
                <div className="material-row">
                  <span>Materials</span>
                  <strong>{materialNames.join(", ")}</strong>
                </div>
              )}
              {textureSetNames.length > 0 && (
                <div className="material-row">
                  <span>Texture sets</span>
                  <strong>{textureSetNames.join(", ")}</strong>
                </div>
              )}
            </section>
          )}

          <AssetScaleDiagram technical={technical} variation={local ? undefined : options?.variation} />
          </div>
          <div hidden={section !== "technical"}>
          {techGroups.length === 0 && !averageColor && <p className="hint">No technical metadata available.</p>}
          {(techGroups.length > 0 || averageColor) && (
            <section className="technical-panel">
              <div className="technical-head">
                <h3>Technical</h3>
                {averageColor && (
                  <span className="color-swatch" title={`Average color ${averageColor}`}>
                    <i style={{ background: averageColor }} />
                    {averageColor}
                  </span>
                )}
              </div>
              {techGroups.map(group => (
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
          )}
          {technical.mapTypes.length > 0 && (
            <div className="poliigon-chips-section">
              <strong>Texture maps</strong>
              <div className="poliigon-chip-row">
                {technical.mapTypes.map(type => (
                  <span key={type}>{mapTypeLabel(type)}</span>
                ))}
              </div>
            </div>
          )}
          {(technical.lodTriangles?.length ?? 0) > 0 && (
            <div className="poliigon-lods">
              <strong>LOD triangles</strong>
              {(technical.lodTriangles ?? []).map(item => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <em>{item.tris.toLocaleString()}</em>
                </div>
              ))}
            </div>
          )}

          </div>
          <div hidden={section !== "related"}>
          {!relatedLoading && related.length === 0 && <p className="hint">No related assets available.</p>}
          {(relatedLoading || related.length > 0) && (
            <div className="related-assets">
              <h3>Related assets</h3>
              {relatedLoading ? (
                <p className="hint">Finding similar assets...</p>
              ) : (
                <div className="related-grid">
                  {related.map(item => {
                    const relatedId = hitId(item);
                    const thumb = hitThumb(item);
                    return (
                      <button
                        type="button"
                        className="related-card"
                        key={relatedId}
                        onClick={() => void openHit(item)}
                        title={item.name}
                      >
                        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span />}
                        <strong>{item.name}</strong>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          </div>
          <div hidden={section !== "settings"}>
          {local ? (
            <div className="download-box">
              <h3>Local asset</h3>
              <p className="path-box" title={local.path}>
                {local.path}
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="btn btn-primary btn-wide"
                  onClick={() => void window.openbridge.openPath(local.path)}
                >
                  <FolderIcon /> Open folder
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void exportLocal()}>
                  Export megascansAsset.json...
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void validateJson(local.id)}
                >
                  Validate asset JSON
                </button>
              </div>
            </div>
          ) : (
            <div className="download-box">
              <div className="download-heading">
                <h3>Download settings</h3>
                <button type="button" className="text-btn" onClick={resetDefaults}>
                  Reset to default
                </button>
              </div>

              {!options ? (
                <div className="loading-line">Preparing options...</div>
              ) : (
                <>
                  <div className="form-row compact">
                    <label>Resolution</label>
                    <Dropdown
                      className="select-dropdown"
                      value={String(
                        Math.min(
                          options.resolution,
                          resolutionOptions[resolutionOptions.length - 1] ?? options.resolution
                        )
                      )}
                      onChange={value => patch({ resolution: Number(value) })}
                      ariaLabel="Download resolution"
                      options={resolutionOptions.map(value => ({
                        value: String(value),
                        label: `${value / 1024}K`
                      }))}
                    />
                  </div>

                  <div className="download-tabs">
                    <button
                      type="button"
                      className={tab === "textures" ? "download-tab active" : "download-tab"}
                      onClick={() => setTab("textures")}
                    >
                      Textures
                    </button>
                    {threeD && (
                      <button
                        type="button"
                        className={tab === "models" ? "download-tab active" : "download-tab"}
                        onClick={() => setTab("models")}
                      >
                        Models & Extras
                      </button>
                    )}
                  </div>

                  {tab === "textures" ? (
                    <div className="map-options">
                      {options.components.map(component => {
                        const exrAllowed = canUseExr(extended, component.type);
                        const mapDetails = mapTechnicalDetails(extended, component, options.resolution);
                        const mapFacts = [
                          mapDetails.resolution,
                          mapDetails.formats.join("/"),
                          mapDetails.bitDepth ? `${mapDetails.bitDepth}-bit` : null,
                          mapDetails.bytes > 0 ? formatBytes(mapDetails.bytes) : null
                        ].filter(Boolean).join(" · ");
                        return (
                          <div className="map-row" key={component.type}>
                            <div className="map-row-main">
                              <label className="toggle inline">
                                <input
                                  type="checkbox"
                                  checked={component.selected}
                                  onChange={event =>
                                    update(
                                      updateMapOption(options, component.type, {
                                        selected: event.target.checked
                                      })
                                    )
                                  }
                                />
                                <span>{mapTypeLabel(component.type)}</span>
                              </label>
                              {mapFacts && <span className="map-facts">{mapFacts}</span>}
                            </div>
                            <Dropdown
                              className="select-dropdown small"
                              value={component.mimeType}
                              onChange={value =>
                                update(
                                  updateMapOption(options, component.type, {
                                    mimeType: value as DownloadMapFormat
                                  })
                                )
                              }
                              ariaLabel={`${mapTypeLabel(component.type)} format`}
                              options={MAP_FORMAT_OPTIONS.map(option => ({
                                value: option.value,
                                label: option.label,
                                disabled: option.value !== "image/jpeg" && !exrAllowed
                              }))}
                            />
                          </div>
                        );
                      })}

                      {threeD && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={options.uniqueMapsPerLod}
                            onChange={event => patch({ uniqueMapsPerLod: event.target.checked })}
                          />
                          <span>Unique maps per LOD when available</span>
                        </label>
                      )}
                      <p className="hint">
                        All settings are preferred options and will be downloaded when available.
                      </p>
                    </div>
                  ) : (
                    <div className="model-options">
                      <div className="form-row compact">
                        <label>Mesh format</label>
                        <Dropdown
                          className="select-dropdown"
                          value={options.meshFormat}
                          onChange={value => patch({ meshFormat: value as MeshFormat })}
                          ariaLabel="Mesh format"
                          options={[
                            { value: "fbx", label: "FBX" },
                            { value: "abc", label: "ABC" }
                          ]}
                        />
                      </div>

                      {threeD && lods.length > 0 && (
                        <div className="lod-options">
                          <span className="label">LODs</span>
                          {plant && (
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={options.downloadAllPlantLods}
                                onChange={event =>
                                  patch({ downloadAllPlantLods: event.target.checked })
                                }
                              />
                              <span>Download all LODs for 3D Plants</span>
                            </label>
                          )}
                          {(!plant || !options.downloadAllPlantLods) &&
                            lods.map(lod => (
                              <label className="toggle inline lod-row" key={lod.index}>
                                <input
                                  type="checkbox"
                                  checked={options.lods[lod.index] ?? true}
                                  onChange={event => {
                                    const next = options.lods.slice();
                                    next[lod.index] = event.target.checked;
                                    patch({ lods: next });
                                  }}
                                />
                                <span>LOD {lod.index}</span>
                                <em>
                                  {lod.tris ? `${lod.tris.toLocaleString()} tris` : ""}
                                  {lodBytes[lod.index] > 0
                                    ? ` · ${formatBytes(lodBytes[lod.index])}`
                                    : ""}
                                </em>
                              </label>
                            ))}
                          {plant && options.downloadAllPlantLods && (
                            <p className="hint">
                              All {lods.length} available LODs will be downloaded.
                            </p>
                          )}
                        </div>
                      )}

                      {plant && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={options.billboards}
                            onChange={event => patch({ billboards: event.target.checked })}
                          />
                          <span>Billboards</span>
                        </label>
                      )}

                      {(technical.hasHighpoly ||
                        technical.hasZtool ||
                        technical.hasBrushes) && (
                        <>
                          <span className="label">Extras</span>
                          {technical.hasHighpoly && (
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={options.highpoly}
                                onChange={event => patch({ highpoly: event.target.checked })}
                              />
                              <span>Highpoly Source</span>
                            </label>
                          )}
                          {technical.hasZtool && (
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={options.ztool}
                                onChange={event => patch({ ztool: event.target.checked })}
                              />
                              <span>Source ZTool</span>
                            </label>
                          )}
                          {technical.hasBrushes && (
                            <label className="toggle">
                              <input
                                type="checkbox"
                                checked={options.brushes}
                                onChange={event => patch({ brushes: event.target.checked })}
                              />
                              <span>Brushes</span>
                            </label>
                          )}
                        </>
                      )}

                      {maxVariation > 1 && technical.variationDimensions.length <= 1 && (
                        <div className="form-row compact">
                          <label>Mesh variation</label>
                          <Dropdown
                            className="select-dropdown"
                            value={String(options.variation)}
                            onChange={value => patch({ variation: Number(value) })}
                            ariaLabel="Mesh variation"
                            options={Array.from({ length: maxVariation }, (_, index) => ({
                              value: String(index + 1),
                              label: `Var ${index + 1}`
                            }))}
                          />
                        </div>
                      )}
                      {technical.variationDimensions.length > 1 && (
                        <div className="variation-explorer">
                          <span className="label">Variation dimensions</span>
                          <div className="variation-chips">
                            {technical.variationDimensions.map(item => {
                              const dims = formatMeasurementText(
                                [item.length, item.width, item.height].filter(Boolean).join(" x ")
                              );
                              return (
                                <button
                                  type="button"
                                  key={item.variation}
                                  className={
                                    options.variation === item.variation
                                      ? "variation-chip active"
                                      : "variation-chip"
                                  }
                                  onClick={() => patch({ variation: item.variation })}
                                >
                                  <strong>Var {item.variation}</strong>
                                  {dims && <em>{dims}</em>}
                                </button>
                              );
                            })}
                          </div>
                          <p className="hint">Mesh variation is independent of LOD selection.</p>
                        </div>
                      )}
                      <p className="hint">
                        All settings are preferred options and will be downloaded when available.
                      </p>
                    </div>
                  )}

                  {plan && (
                    <div className="download-plan">
                      <div className="download-plan-head">
                        <strong>Download plan</strong>
                        <span>
                          {plan.bytes > 0
                            ? `~${formatBytes(plan.bytes)}${plan.partial ? "+" : ""}`
                            : "Size unavailable"}
                        </span>
                      </div>
                      <div className="download-plan-row">
                        <span>Textures</span>
                        <strong>
                          {plan.mapCount} maps · {plan.mapFiles} files
                          {plan.textureBytes > 0 ? ` · ${formatBytes(plan.textureBytes)}` : ""}
                        </strong>
                      </div>
                      {threeD && (
                        <div className="download-plan-row">
                          <span>Mesh</span>
                          <strong>
                            {plan.lodCount} LOD{plan.lodCount === 1 ? "" : "s"} · {plan.meshFiles} files
                            {plan.meshBytes > 0 ? ` · ${formatBytes(plan.meshBytes)}` : ""}
                          </strong>
                        </div>
                      )}
                      {technical.hasHighpoly && options.highpoly && (
                        <div className="download-plan-row">
                          <span>Highpoly</span>
                          <strong>included</strong>
                        </div>
                      )}
                      {technical.hasZtool && options.ztool && (
                        <div className="download-plan-row">
                          <span>ZTool</span>
                          <strong>included</strong>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="hint">
                    Files are written to {settings?.libraryPath || "the library folder"} using the standard
                    Megascans layout.
                  </p>
                </>
              )}
            </div>
          )}
          </div>
        </div>
        <footer className="drawer-footer">
          {local ? <button type="button" className="btn btn-primary btn-wide" onClick={() => void window.openbridge.openPath(local.path)}>
            <FolderIcon /> Open folder</button> : <>
          <div className="download-summary">
            <span>
              {options ? `${options.resolution / 1024}K · ` : ""}
              {plan?.bytes ? `~${formatBytes(plan.bytes)}${plan.partial ? "+" : ""}` : "Size unavailable"} · {selectedMaps} {selectedMaps === 1 ? "map" : "maps"}
              {threeD ? ` · ${selectedLods} LOD${selectedLods === 1 ? "" : "s"}` : ""}
            </span>
            <button type="button" className="text-btn" onClick={() => setSection("settings")}>Edit plan</button>
          </div>
          {options && <div className="footer-resolution" role="group" aria-label="Quick download resolution">
            {resolutionOptions.map(value => <button type="button" key={value} className={options.resolution === value ? "chip active" : "chip"}
              aria-pressed={options.resolution === value} disabled={active} onClick={() => patch({ resolution: value })}>{value / 1024}K</button>)}
          </div>}
              {!auth.loggedIn ? (
                <button type="button" className="btn btn-primary btn-wide" onClick={() => void login()}>
                  <UserIcon /> Sign in with Epic to download
                </button>
              ) : active && progress ? (
                <div className="active-download">
                  <div className="download-top">
                    <strong>{progress.message ?? progress.status}</strong>
                    <span>
                      {bytes(progress.received)} / {bytes(progress.total)}
                    </span>
                  </div>
                  <div className="progress">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                    />
                  </div>
                  <div className="button-row horizontal">
                    {progress.status === "paused" ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void window.openbridge.downloads.resume(assetId)}
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void window.openbridge.downloads.pause(assetId)}
                      >
                        Pause
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void cancelDownload(assetId)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : !owned && points > 0 ? (
                <button type="button" className="btn btn-accent btn-wide" onClick={() => void acquire()}>
                  Acquire - {points.toLocaleString()} pts
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-accent btn-wide"
                  onClick={() => void download()}
                  disabled={!options || selection.loading || Boolean(selection.error)}
                >
                  <DownloadIcon /> {points === 0 && !owned ? "Download free" : "Download"}
                </button>
              )}

              {progress?.status === "complete" && (
                <div className="complete-box">
                  <CheckIcon />
                  <span>Saved to {progress.path}</span>
                  {progress.path && (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => void window.openbridge.openPath(progress.path!)}
                    >
                      Open folder
                    </button>
                  )}
                </div>
              )}

              {progress?.status === "error" && (
                <div className="error-box small">{progress.message}</div>
              )}

              {!owned && points > 0 && (
                <p className="hint">
                  Acquired assets are downloaded only for accounts that own them. Free assets are
                  acquired automatically.
                </p>
              )}
          </>}
        </footer>
      </aside>
    </>
  );
}

