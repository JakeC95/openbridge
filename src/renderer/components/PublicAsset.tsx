import { useCallback, useEffect, useState } from "react";
import { ambientCgPanoramaUrl, openHdriImageUrl, publicCardThumbnail, publicJobId, publicProviderLabel, type PublicAssetSummary, type PublicCatalogQuery, type PublicPreviewSet } from "../../shared/public-providers";
import type { MapPreview } from "../../shared/types";
import { skyConditionLabel } from "../../shared/sky-conditions";
import { formatHdriTime } from "../../shared/hdri-time";
import { usePublicStore } from "../public-store";
import { useStore } from "../store";
import { ProviderLogo, ProviderTag } from "./ProviderLogo";
import { SmartThumbImage } from "./SmartThumbImage";
import { ImageViewer } from "./ImageViewer";
import { ModelPreviewPanel, SurfacePreviewPanel } from "./ModelViewer";
import { is3dAssetType, isSurfaceAssetType } from "../../shared/model-preview";
import { CloseIcon, DownloadIcon, CheckIcon, PauseIcon, PlayIcon } from "../icons";
import { previewProgressKey } from "../../shared/preview-keys";
import { TransferStatus } from "./TransferStatus";
import { AssetScaleDiagram } from "./AssetScaleDiagram";
import { publicTechnical } from "../public-technical";
import { groupTechnicalFacts, type TechnicalFact } from "../technical-order";
import { assetTypeClass } from "../asset-visuals";
import { formatBytes } from "../download-options";

interface PublicCardProps {
  hit: PublicAssetSummary;
  selected?: boolean;
  selectionMode?: boolean;
  wide?: boolean;
  downloadReason?: string;
  onSelect?: (event: { shiftKey: boolean }) => void;
  onOpen?: () => void;
  onDownload?: () => void;
}

export function PublicCard({ hit, selected, selectionMode = false, wide = false, downloadReason, onSelect, onOpen, onDownload }: PublicCardProps) {
  const open = (event: { shiftKey: boolean }): void => {
    if (selectionMode || event.shiftKey) { onSelect?.(event); return; }
    if (onOpen) onOpen(); else { useStore.getState().closeSelection(); void usePublicStore.getState().open(hit); }
  };
  const refs = useStore(state => state.localRefs);
  const job = useStore(state => state.downloads[publicJobId(hit.provider, hit.id)]);
  const favorite = usePublicStore(state => state.favorites.includes(publicJobId(hit.provider, hit.id)));
  const downloaded = refs.some(ref => ref.id === publicJobId(hit.provider, hit.id)) || job?.status === "complete";
  const active = Boolean(job && ["queued", "requesting", "downloading", "extracting", "paused"].includes(job.status));
  const ratio = job ? Math.round(job.ratio * 100) : 0;
  const hdri = /^(hdr|hdri|hdri-element)$/i.test(hit.type);
  const thumb = publicCardThumbnail(hit, 512);
  const directThumb = hit.provider === "ambientcg" && hdri;
  const sphereThumb = directThumb ? hit.previews.find(preview => preview.type === "thumbnail")?.url : undefined;
  const thumbFallback = directThumb && sphereThumb && sphereThumb !== thumb ? sphereThumb : undefined;
  const facts = [
    hit.maxResolution ? `${Math.round(hit.maxResolution / 1024)}K` : "",
    hdri && hit.weather ? skyConditionLabel(hit.weather) : "",
    hdri && hit.timeOfDay !== null ? formatHdriTime(hit.timeOfDay) : "",
    hit.polycount !== null ? `${hit.polycount.toLocaleString()} ${hit.provider === "blenderkit" ? "polys" : "tris"}` : "",
    !hdri && hit.mapCodes.length > 0 ? `${hit.mapCodes.length} maps` : "",
    !hdri ? hit.dimensions ?? "" : "",
    hit.lodCount > 0 ? `${hit.lodCount} LOD${hit.lodCount === 1 ? "" : "s"}` : ""
  ].filter(Boolean).slice(0, 4);
  const access = hit.provider === "blenderkit"
    ? hit.attributes.canDownload === false ? "Account required" : hit.free ? "Free" : "Plan/account"
    : hit.free ? "Free" : "Plan required";
  return <div className={`asset-card${selected ? " selected" : ""}${wide ? " hdri-card" : ""}`} role="button" tabIndex={0} title={hit.name} data-asset-id={publicJobId(hit.provider, hit.id)} onClick={open} onKeyDown={event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); open(event); } }}>
    <div className="asset-thumb">
      {thumb ? <SmartThumbImage source={thumb} fallback={thumbFallback} direct={directThumb} crop={hit.provider === "openhdri" ? "top-2-1" : undefined} alt="" className={`${wide ? "asset-thumb-img hdri-panorama" : "asset-thumb-img"}${hit.provider === "openhdri" ? " openhdri-thumb" : ""}`} /> : <span className="asset-placeholder">{hit.typeLabel}</span>}
      <ProviderLogo provider={hit.provider} className="asset-provider-mark" />
      <span className={`asset-type ${assetTypeClass(hit.typeLabel)}`}>{hit.typeLabel}</span>
      {downloaded && <span className="asset-flag downloaded">DOWNLOADED</span>}
      {selected && <span className="asset-flag">SELECTED</span>}
      {active && job && <div className="asset-progress" title={job.message ?? job.status}><span style={{ width: `${ratio}%` }} /></div>}
      {!selectionMode && <span className={active || downloaded ? "asset-card-actions always" : "asset-card-actions"}>
        {active && job ? <button type="button" className="asset-action progress" title={job.status === "paused" ? "Resume download" : "Pause download"} aria-label={job.status === "paused" ? `Resume ${hit.name}` : `Pause ${hit.name}`} onClick={event => {
          event.preventDefault(); event.stopPropagation();
          void (job.status === "paused" ? window.openbridge.downloads.resume(job.assetId) : window.openbridge.downloads.pause(job.assetId));
        }}>{job.status === "paused" ? <PlayIcon width={12} height={12} /> : <PauseIcon width={12} height={12} />}<span>{ratio}%</span></button>
          : downloaded ? <span className="asset-action done" title="Downloaded"><CheckIcon width={15} height={15} /></span>
            : <button type="button" className="asset-action" disabled={!onDownload} title={onDownload ? "Download with the default published tier" : downloadReason || "Download unavailable"} aria-label={`Download ${hit.name}`} onClick={event => {
              event.preventDefault(); event.stopPropagation(); onDownload?.();
            }}><DownloadIcon width={15} height={15} /></button>}
      </span>}
      {!selectionMode && <button type="button" className={favorite ? "asset-favorite active" : "asset-favorite"} title={favorite ? "Remove from favorites" : "Add to favorites"} aria-label={favorite ? "Remove from favorites" : "Add to favorites"} onClick={event => { event.preventDefault(); event.stopPropagation(); usePublicStore.getState().toggleFavorite(publicJobId(hit.provider, hit.id)); }}>{favorite ? "♥" : "♡"}</button>}
      {selectionMode && <button type="button" className={selected ? "asset-select selected" : "asset-select"} aria-label={selected ? `Deselect ${hit.name}` : `Select ${hit.name}`} aria-pressed={selected} onClick={event => { event.preventDefault(); event.stopPropagation(); onSelect?.(event); }}>{selected && <CheckIcon width={14} height={14} />}</button>}
    </div>
    <div className="asset-meta">
      <strong>{hit.name}</strong>
      <span>{hit.category || hit.categories.slice(0, 2).join(" / ") || hit.id}</span>
      {facts.length > 0 && <span className="asset-facts">{facts.join(" · ")}</span>}
      <span className="asset-facts">{hit.license} · {access}{job?.message && active ? ` · ${job.message}` : ""}</span>
    </div>
  </div>;
}

function isAbortError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /aborterror|preview closed/i.test(message);
}

function humanLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function providerMetadata(asset: PublicAssetSummary) {
  const attributes = asset.attributes;
  const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
  const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  const author = Object.keys(asset.authors).filter(name => name && name !== "Unknown").join(", ");
  const filesBytes = asset.files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  const downloadBytes = number(attributes.downloadBytes) ?? (filesBytes > 0 ? filesBytes : null);
  const downloadSize = text(attributes.downloadSize) || (downloadBytes ? formatBytes(downloadBytes) : "");
  const stats = object(attributes.downloadStats);
  const downloadStats = [
    typeof stats.total === "number" && stats.total > 0 ? `${stats.total.toLocaleString()} total` : "",
    typeof stats.lastMonth === "number" && stats.lastMonth > 0 ? `${stats.lastMonth.toLocaleString()} last month` : "",
    typeof stats.lastWeek === "number" && stats.lastWeek > 0 ? `${stats.lastWeek.toLocaleString()} last week` : "",
    typeof stats.lastDay === "number" && stats.lastDay > 0 ? `${stats.lastDay.toLocaleString()} today` : ""
  ].filter(Boolean).join(" · ");
  const rating = number(attributes.rating);
  const ratingCount = number(attributes.ratingCount) ?? 0;
  const verification = text(attributes.verification);
  const version = number(attributes.versionNumber);
  const sourceApp = text(attributes.sourceApp);
  const videoUrl = text(attributes.videoUrl);
  const relations = object(attributes.relations);
  const variations = strings(relations.variations);
  const relationIds = [...new Set([
    ...variations,
    ...strings(relations.parents),
    ...strings(relations.children),
    text(relations.previous),
    text(relations.next)
  ].filter(Boolean))];
  return {
    author,
    downloadSize,
    downloadStats,
    rating,
    ratingCount,
    ratingText: rating !== null ? `${rating.toFixed(1)}/10${ratingCount > 0 ? ` · ${ratingCount} rating${ratingCount === 1 ? "" : "s"}` : ""}` : "",
    verification,
    verificationText: verification ? humanLabel(verification) : "",
    version,
    sourceApp,
    videoUrl,
    variations,
    relationIds,
    location: text(attributes.location),
    captured: text(attributes.captureDate),
    dynamicRange: text(attributes.dynamicRange),
    whiteBalance: text(attributes.whiteBalance),
    fileFormat: text(attributes.fileFormat),
    colorChecker: text(attributes.colorChecker),
    colors: strings(attributes.colors),
    collections: strings(attributes.collections),
    technique: text(attributes.technique),
    longDescription: text(attributes.longDescription),
    trueHDR: typeof attributes.trueHDR === "boolean" ? attributes.trueHDR : null,
    platforms: strings(attributes.platforms),
    processingDate: text(attributes.processingDate)
  };
}

function technicalGroups(asset: PublicAssetSummary | null, local: import("../../shared/types").AssetRecord | null) {
  if (!asset && local?.technical) {
    const t = local.technical;
    const facts: TechnicalFact[] = [
      ["dimensions", "Dimensions", t.dimensions ?? "Not available"],
      ["texelDensity", "Texel density", t.texelDensity ?? "Not available"],
      ["resolutions", "Resolution", t.resolution ? `${Math.round(t.resolution / 1024)}K` : "Not available"],
      ["mapTypes", "Texture maps", t.mapTypes.length ? t.mapTypes.join(", ") : "Not available"],
      ["mapFormats", "Map formats", t.mapFormats.length ? t.mapFormats.join(", ") : "Not available"],
      ["maxTriangles", "Triangles", t.maxTris > 0 ? t.maxTris.toLocaleString() : "Not available"],
      ["lods", "LODs", t.lodCount > 0 ? String(t.lodCount) : "None"],
      ["catalogueId", "Asset ID", local.id],
      ["published", "Downloaded", new Date(local.mtime).toLocaleString()]
    ];
    return groupTechnicalFacts(facts);
  }
  if (!asset) return [];
  const t = publicTechnical(asset);
  const meta = providerMetadata(asset);
  const isHdri = /^(hdr|hdri|hdri-element)$/i.test(asset.type);
  const isModel = /model|terrain/i.test(asset.type);
  const extraMetadata = [
    meta.trueHDR !== null ? `True HDR: ${meta.trueHDR ? "Yes" : "No"}` : "",
    meta.processingDate ? `Processed: ${new Date(meta.processingDate).toLocaleDateString()}` : "",
    meta.platforms.length ? `Platforms: ${meta.platforms.join(", ")}` : ""
  ].filter(Boolean).join(" · ");
  const formats = (asset.modelFormats.length ? asset.modelFormats : asset.mapFormats).map(value => value.toUpperCase());
  const facts: TechnicalFact[] = [];
  if (asset.dimensions || isModel) facts.push(["dimensions", "Dimensions", asset.dimensions ?? "Not available"]);
  if (asset.texelDensity) facts.push(["texelDensity", "Texel density", asset.texelDensity]);
  if (asset.polycount !== null || isModel) facts.push(["maxTriangles", "Geometry count", asset.polycount !== null ? `${asset.polycount.toLocaleString()} ${asset.provider === "blenderkit" ? "polygons (provider)" : "triangles"}` : "Not available"]);
  if (isModel || asset.lodCount > 0) facts.push(["lods", "LODs", asset.lodCount > 0 ? String(asset.lodCount) : "None"]);
  facts.push(["layoutConvention", "Delivery type", asset.files.length > 0 ? (asset.files.some(file => /model|package/.test(file.role)) ? "Asset package" : "Files") : "Not available"]);
  facts.push(["mapTypes", "Texture maps", asset.mapCodes.length ? asset.mapCodes.map(value => humanLabel(value)).join(", ") : "Not published separately"]);
  if (asset.resolutions.length) facts.push(["resolutions", "Resolutions", asset.resolutions.map(value => value.toUpperCase()).join(", ")]);
  if (asset.maxResolution) facts.push(["maxResolution", "Max resolution", `${Math.round(asset.maxResolution / 1024)}K`]);
  if (formats.length) facts.push(["mapFormats", "Formats", formats.join(", ")]);
  if (isHdri) {
    if (asset.weather) facts.push(["weather", "Weather", skyConditionLabel(asset.weather)]);
    if (asset.timeOfDay !== null) facts.push(["timeOfDay", "Time of day", `${formatHdriTime(asset.timeOfDay)} (metadata estimate)`]);
  }
  if (meta.collections.length) facts.push(["pack", "Collection", meta.collections.join(", ")]);
  if (meta.technique) facts.push(["creationMethod", "Technique", humanLabel(meta.technique)]);
  facts.push(["catalogueId", "Catalogue ID", publicJobId(asset.provider, asset.id)]);
  if (asset.publishedAt) facts.push(["published", "Published", new Date(asset.publishedAt).toLocaleDateString()]);
  facts.push(["filesHash", "Files version", asset.filesHash.slice(0, 12)]);
  if (meta.author) facts.push(["creator", "Creator", meta.author]);
  if (meta.downloadSize) facts.push(["downloadSize", asset.provider === "openhdri" ? "Download size" : "Published files", meta.downloadSize]);
  if (meta.downloadStats) facts.push(["downloadStats", "Download stats", meta.downloadStats]);
  if (meta.ratingText) facts.push(["rating", "Rating", meta.ratingText]);
  if (meta.verificationText) facts.push(["verification", "Verification", meta.verificationText]);
  if (meta.version !== null) facts.push(["version", "Version", String(meta.version)]);
  if (meta.sourceApp) facts.push(["sourceApp", "Source app", humanLabel(meta.sourceApp)]);
  if (meta.variations.length) facts.push(["variations", "Variations", meta.variations.map(humanLabel).join(", ")]);
  if (meta.location) facts.push(["coordinates", "Location", meta.location]);
  if (meta.captured) facts.push(["dateTaken", "Captured", meta.captured]);
  if (meta.dynamicRange) facts.push(["evsCap", "Dynamic range", meta.dynamicRange]);
  if (meta.whiteBalance) facts.push(["whiteBalance", "White balance", meta.whiteBalance]);
  if (meta.fileFormat) facts.push(["fileFormat", "File format", meta.fileFormat]);
  if (meta.colorChecker) facts.push(["colorChecker", "Color checker", "Published (EXR)"]);
  if (extraMetadata) facts.push(["attributes", "Metadata", extraMetadata]);
  facts.push(["license", "Licence", asset.license]);
  return groupTechnicalFacts(facts);
}

export function PublicDrawer() {
  const { selection, detail, detailError, local, close, providers, favorites } = usePublicStore();
  const [viewer, setViewer] = useState(false);
  const [index, setIndex] = useState(0);
  const [variant, setVariant] = useState(0);
  const [section, setSection] = useState("overview");
  const [mode, setMode] = useState<"renders" | "maps" | "3d" | "sphere">("renders");
  const [previewSet, setPreviewSet] = useState<PublicPreviewSet | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [related, setRelated] = useState<PublicAssetSummary[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedBasis, setRelatedBasis] = useState<"linked" | "category">("category");
  const [includeColorChecker, setIncludeColorChecker] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const blenderkit = usePublicStore(state => state.blenderkit);
  const toast = useStore(state => state.toast);
  const downloads = useStore(state => state.downloads);
  const asset = detail ?? selection;
  const key = asset ? publicJobId(asset.provider, asset.id) : local?.id;
  const job = key ? downloads[key] : undefined;
  useEffect(() => { setVariant(0); setIndex(0); setViewer(false); setSection("overview"); setMode("renders"); setRelated([]); setRelatedBasis("category"); setIncludeColorChecker(false); setDownloadError(""); }, [key]);
  const provider = asset?.provider;
  const assetId = asset?.id;
  const drawerProvider = asset?.provider ?? local?.provider;
  const drawerType = asset?.type ?? local?.type;
  const drawerDirect = drawerProvider === "ambientcg" && /^(hdri|hdri-element)$/i.test(drawerType ?? "");
  const neighbors = provider ? providers[provider].hits : [];
  const neighborIndex = neighbors.findIndex(hit => hit.id === assetId);
  const modelProvider = asset?.provider ?? local?.provider;
  const canModel = Boolean(modelProvider && ["ambientcg", "blenderkit"].includes(modelProvider)
    && is3dAssetType(asset?.type ?? local?.type));
  const canSurface = !/^(hdr|hdri|hdri-element)$/i.test(drawerType ?? "") && isSurfaceAssetType(drawerType);
  const localAssetId = local?.id?.includes(":") ? local.id.split(":").slice(1).join(":") : local?.id;
  const move = useCallback((offset: number) => {
    const next = neighbors[neighborIndex + offset];
    if (neighborIndex >= 0 && next) void usePublicStore.getState().open(next);
  }, [neighbors, neighborIndex]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (viewer || (event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.key === "Escape") close();
      else if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
      else if (!event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
    };
    document.addEventListener("keydown", listener); return () => document.removeEventListener("keydown", listener);
  }, [close, viewer, move]);
  useEffect(() => {
    let live = true;
    setPreviewSet(null); setPreviewError(""); setPreviewLoading(true);
    const request = local ? window.openbridge.localPreviews(local.id, local.path).then(value => ({ ...value, hdrAvailable: false }))
      : provider && assetId && window.openbridge.public.previews ? window.openbridge.public.previews(provider, assetId) : Promise.resolve(null);
    void request.then(value => { if (live) { setPreviewSet(value); setPreviewLoading(false); } }).catch(error => {
      if (!live) return;
      setPreviewLoading(false);
      // Closing the drawer/viewer aborts preview requests by design; do not
      // surface that cancellation as a retryable error.
      if (!isAbortError(error)) setPreviewError(error instanceof Error ? error.message : String(error));
    });
    return () => { live = false; if (provider && assetId) void window.openbridge.public.cancelPreviews?.(provider, assetId).catch(() => {}); };
  }, [key, local?.path, provider, assetId, previewRetry]);
  const loadHighResolution = useCallback(async (item: MapPreview, signal?: AbortSignal) => {
    if (!provider || !assetId || !item.map) return item;
    signal?.throwIfAborted();
    const result = await window.openbridge.public.highResolutionPreview(provider, assetId, item.map.type);
    signal?.throwIfAborted(); return result;
  }, [provider, assetId]);
  const loadHdr = useCallback(async (_item: MapPreview, signal?: AbortSignal) => {
    if (!provider || !assetId) return null;
    signal?.throwIfAborted(); const result = await window.openbridge.public.hdrPreview(provider, assetId); signal?.throwIfAborted(); return result;
  }, [provider, assetId]);
  useEffect(() => {
    if (section !== "related" || !asset) return;
    let live = true;
    setRelatedLoading(true);
    setRelatedBasis("category");
    const meta = providerMetadata(asset);
    const category = asset.provider === "blenderkit"
      ? String(asset.attributes.categorySlug ?? "")
      : asset.category;
    const tag = asset.tags.find(value => value.length > 2 && !/^\d+$/.test(value));
    const categoryQuery: PublicCatalogQuery = {
      provider: asset.provider,
      limit: 8,
      offset: 0,
      types: [asset.type],
      categoryPaths: category ? [category] : [],
      ...(category || !tag ? {} : { query: tag })
    };
    const load = async (): Promise<void> => {
      if (meta.relationIds.length) {
        const linked = await window.openbridge.public.search({ provider: asset.provider, ids: meta.relationIds, limit: 8, offset: 0 });
        if (!live) return;
        const hits = linked.hits.filter(hit => hit.id !== asset.id).slice(0, 6);
        if (hits.length) { setRelated(hits); setRelatedBasis("linked"); return; }
      }
      const result = await window.openbridge.public.search(categoryQuery);
      if (!live) return;
      setRelated(result.hits.filter(hit => hit.id !== asset.id).slice(0, 6));
    };
    void load().catch(() => { if (live) setRelated([]); }).finally(() => { if (live) setRelatedLoading(false); });
    return () => { live = false; };
  }, [section, asset]);
  const files = asset?.files.filter(file => file.downloadable !== false && ["hdri", "package", "texture", "model"].includes(file.role)) ?? [];
  useEffect(() => {
    const preferred = files.findIndex(file => file.resolution?.toLowerCase() === "2k");
    setVariant(preferred >= 0 ? preferred : 0);
  }, [key, files.length]);
  if (!asset && !local) return null;
  const ambientPreview = asset?.provider === "ambientcg" && /^(hdri|hdri-element)$/i.test(asset.type)
    ? ambientCgPanoramaUrl(asset.previews, "LQ") ?? publicCardThumbnail(asset, 512)
    : null;
  const fallbackRenders: MapPreview[] = asset?.provider === "openhdri"
    ? [{ type: "preview", label: "Environment preview", url: openHdriImageUrl(asset.id, 1500), panorama: false }]
    : ambientPreview
      ? [{ type: "preview", label: asset?.type === "hdri-element" ? "HDR element preview" : "Panorama preview", url: ambientPreview, panorama: asset?.type !== "hdri-element" }]
      : asset?.previews.filter(preview => preview.type !== "hdr-source" && !preview.map).map(({ map, ...preview }) => ({ ...preview, type: "image", panorama: preview.type === "panorama" })) ?? [];
  const previews = mode === "maps" ? previewSet?.maps ?? [] : previewSet?.renders.length ? previewSet.renders : fallbackRenders;
  const assetThumb = asset ? publicCardThumbnail(asset, 1024) : null;
  const image = previews[index]?.url ?? (mode === "renders" ? (local?.preview ? window.openbridge.toFileUrl(local.preview) : null) ?? assetThumb : null);
  const queue = async () => {
    if (!asset) return;
    const file = files[variant];
    setDownloadError("");
    try {
      await window.openbridge.downloads.start(asset.id, {
        resolution: file?.resolution,
        format: file?.format,
        fileType: file?.fileType,
        ...(asset.provider === "openhdri" && includeColorChecker ? { includeColorChecker: true } : {})
      }, asset.provider);
      toast(`Queued ${asset.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDownloadError(message);
      toast(message, true);
    }
  };
  const canDownload = !asset || asset.provider !== "blenderkit" || (blenderkit.hasKey && asset.attributes.canDownload !== false);
  const mapsAvailable = Boolean(previewSet?.maps.length || asset?.mapCodes.length);
  const groups = technicalGroups(asset ?? null, local);
  const meta = asset ? providerMetadata(asset) : null;
  const previewProgress = provider && assetId ? downloads[previewProgressKey.publicMaps(publicJobId(provider, assetId))] : undefined;
  const categoryKey = asset ? asset.provider === "blenderkit" ? String(asset.attributes.categorySlug ?? "") : asset.category : "";
  const focusCategory = (path: string): void => {
    if (!provider || !path) return;
    close();
    void usePublicStore.getState().search(provider, true, { categoryPaths: [path], types: [], tags: [] });
  };
  const focusTag = (tag: string): void => {
    if (!provider) return;
    close();
    void usePublicStore.getState().search(provider, true, { tags: [tag], categoryPaths: [], types: [] });
  };
  const openRelatedId = async (id: string): Promise<void> => {
    if (!asset || !id) return;
    try {
      const result = await window.openbridge.public.search({ provider: asset.provider, ids: [id], limit: 1, offset: 0 });
      const hit = result.hits[0];
      if (hit) void usePublicStore.getState().open(hit);
    } catch (error) {
      toast(String(error), true);
    }
  };
  return <><div className="drawer-backdrop" onClick={close} /><aside className="drawer poliigon-drawer" role="dialog" aria-label={asset?.name ?? local?.name}>
    <div className="drawer-head"><ProviderTag provider={asset?.provider ?? local!.provider!} />
      {asset && <><button type="button" className="icon-btn" aria-label="Previous asset" disabled={neighborIndex <= 0} onClick={() => move(-1)}>‹</button><button type="button" className="icon-btn" aria-label="Next asset" disabled={neighborIndex < 0 || neighborIndex >= neighbors.length - 1} onClick={() => move(1)}>›</button></>}
      {key && <button type="button" className="icon-btn" aria-label={favorites.includes(key) ? "Remove favorite" : "Add favorite"} onClick={() => usePublicStore.getState().toggleFavorite(key)}>{favorites.includes(key) ? "♥" : "♡"}</button>}
      <button type="button" className="icon-btn" aria-label="Close" onClick={close}><CloseIcon /></button>
    </div>
    <div className="drawer-scroll">
      <div className="preview-switch">
        <button type="button" className={mode === "renders" ? "active" : ""} onClick={() => { setMode("renders"); setIndex(0); }}>Render</button>
        <button type="button" className={mode === "maps" ? "active" : ""} disabled={!mapsAvailable && !local} title={mapsAvailable ? undefined : "This provider supplies a native package; separate texture maps are not published."} onClick={() => { setMode("maps"); setIndex(0); }}>Maps</button>
        {canModel && <button type="button" className={mode === "3d" ? "active" : ""} onClick={() => { setMode("3d"); setViewer(false); }}>3D</button>}
        {canSurface && <button type="button" className={mode === "sphere" ? "active" : ""} onClick={() => { setMode("sphere"); setViewer(false); }} title="Preview the maps on a sphere">Sphere</button>}
      </div>
      {mode === "3d" && canModel ? <div className="drawer-preview model-drawer-preview">
        <ModelPreviewPanel
          assetId={asset?.id ?? localAssetId ?? ""}
          provider={modelProvider ?? ""}
          name={asset?.name ?? local?.name ?? ""}
          path={local?.path}
          type={asset?.type ?? local?.type}
          isPlant={is3dAssetType(asset?.type ?? local?.type) && /plant|foliage|leaf/i.test(`${asset?.type ?? ""} ${asset?.name ?? ""} ${local?.type ?? ""} ${local?.name ?? ""}`)}
        />
      </div> : mode === "sphere" && canSurface ? <div className="drawer-preview model-drawer-preview">
        {previewSet?.maps.length ? <SurfacePreviewPanel
          maps={previewSet.maps.map(map => ({ url: map.url, type: map.type, label: map.label, resolution: map.resolution, source: map }))}
          assetId={assetId ?? ""}
          provider={drawerProvider ?? ""}
          name={asset?.name ?? local?.name ?? ""}
          source={local ? "local" : "provider"}
          maxTier={asset?.maxResolution}
          resolveTier={map => map.source ? loadHighResolution(map.source).then(result => result?.url ?? null) : Promise.resolve(null)}
        /> : <span className="map-preview-status">{previewLoading ? "Preparing maps for the sphere preview…" : previewSet?.note || "No browser-readable maps are available for a sphere preview."}</span>}
      </div> : <>
        {image && mode !== "sphere" && <div className="drawer-preview"><button className="expand-preview" type="button" onClick={() => { if (/^(hdr|hdri|hdri-element)$/.test(asset?.type ?? "") && previewSet?.maps.length) { setMode("maps"); setIndex(0); } setViewer(true); }}><SmartThumbImage source={image} direct={drawerDirect} crop={drawerProvider === "openhdri" && (local || !previewSet) ? "top-2-1" : undefined} alt={asset?.name ?? local?.name} /></button></div>}
        {!image && mode === "maps" && !previewLoading && <div className="poliigon-map-empty"><p>{previewSet?.note ?? "This provider does not publish separate browser-readable texture maps."}</p><button type="button" className="btn btn-ghost" onClick={() => setMode("renders")}>Show render</button></div>}
        {previewLoading && <TransferStatus progress={previewProgress} fallbackText="Loading genuine previews…" />}
        {previewError && <div className="error-box" role="alert">{previewError}<button type="button" className="text-btn" onClick={() => setPreviewRetry(value => value + 1)}>Retry previews</button></div>}
        {previewSet?.note && <p className="hint">{previewSet.note}</p>}
        {asset?.provider === "openhdri" && !previewSet?.note && <p className="hint">OpenHDRI publishes 16K EXRs only. Live HDR exposure is disabled because 16K exceeds the safe 8K preview budget for most systems. The 4K panorama preview remains available; download the original EXR for your DCC.</p>}
        {previews.length > 0 && mode !== "sphere" && <div className="map-nav">
          <div className="map-nav-label">{mode === "maps" ? "Map" : "Preview"} {index + 1} / {previews.length}<strong>{previews[index]?.label}</strong></div>
          <div className="map-nav-actions">
            <button type="button" className="icon-btn" aria-label="Previous preview" disabled={index <= 0} onClick={() => setIndex(value => Math.max(0, value - 1))}>‹</button>
            <select className="native-select" aria-label="Preview image" value={index} onChange={event => setIndex(Number(event.target.value))}>{previews.map((preview, i) => <option key={`${preview.url}:${i}`} value={i}>{preview.label}</option>)}</select>
            <button type="button" className="icon-btn" aria-label="Next preview" disabled={index >= previews.length - 1} onClick={() => setIndex(value => Math.min(previews.length - 1, value + 1))}>›</button>
          </div>
        </div>}
      </>}
      {viewer && previews.length > 0 && <ImageViewer items={previews} index={index} onIndex={setIndex} loadHighResolution={provider ? loadHighResolution : undefined} loadHdrSource={provider && previewSet?.hdrAvailable ? loadHdr : undefined} onClose={() => setViewer(false)} />}
      <h2 className="drawer-title">{asset?.name ?? local?.name}</h2><p className="drawer-id">{key}</p>
      <div className="inspector-tabs">{["overview", "technical", "download", ...(local ? [] : ["related"])].map(value => <button type="button" key={value} className={section === value ? "active" : ""} onClick={() => setSection(value)}>{value === "download" ? (local ? "Files" : "Download") : value[0].toUpperCase() + value.slice(1)}</button>)}</div>
      {detailError && <div className="error-box" role="alert">{detailError}<button type="button" className="text-btn" onClick={() => selection && void usePublicStore.getState().open(selection)}>Retry</button></div>}
      {section === "overview" && ((asset && /model|terrain/.test(asset.type)) || (local?.technical && /model|3d/i.test(local.type))) && <AssetScaleDiagram technical={asset ? publicTechnical(asset) : local!.technical!} />}
      {section === "overview" && <>
        {asset?.description && <p className="poliigon-description">{asset.description}</p>}
        <div className="meta-grid">
          <span>Type</span><strong>{asset?.typeLabel ?? local?.type}</strong>
          <span>Licence</span><strong>{asset?.license ?? "See local metadata"}</strong>
          <span>Access</span><strong>{local ? "Local files" : asset?.provider === "blenderkit" && asset.attributes.canDownload === false ? "Account / plan required" : asset?.free ? "Free" : "Account / plan required"}</strong>
          {local && <><span>Local size</span><strong>{local.sizeBytes ? `${(local.sizeBytes / 1048576).toFixed(1)} MB` : "Unknown"}</strong><span>Files</span><strong>{local.fileCount?.toLocaleString() ?? "—"}</strong></>}
          {asset && asset.downloadCount > 0 && <><span>{asset.provider === "blenderkit" ? "Bookmarks" : "Downloads"}</span><strong>{asset.downloadCount.toLocaleString()}</strong></>}
          {!local && meta?.author && <><span>Creator</span><strong>{meta.author}</strong></>}
          {!local && asset?.publishedAt && <><span>Published</span><strong>{new Date(asset.publishedAt).toLocaleDateString()}</strong></>}
          {!local && meta?.downloadSize && <><span>{asset?.provider === "openhdri" ? "Download size" : "Published files"}</span><strong>{meta.downloadSize}</strong></>}
          {!local && meta?.ratingText && <><span>Rating</span><strong>{meta.ratingText}</strong></>}
          {!local && meta?.verificationText && <><span>Verification</span><strong>{meta.verificationText}</strong></>}
          {!local && meta?.location && <><span>Location</span><strong>{meta.location}</strong></>}
          {!local && meta?.captured && <><span>Captured</span><strong>{meta.captured}</strong></>}
          {!local && meta?.dynamicRange && <><span>Dynamic range</span><strong>{meta.dynamicRange}</strong></>}
          {!local && meta?.whiteBalance && <><span>White balance</span><strong>{meta.whiteBalance}</strong></>}
        </div>
        {local && <p className="hint poliigon-local-path">{local.path}</p>}
        {!local && <div className="poliigon-chips-section">
          <strong>Categories</strong>
          <div className="poliigon-chip-row">
            {asset?.categories.map(category => <button type="button" key={category} className="facet-chip" onClick={() => focusCategory(categoryKey || category)}>{category}</button>)}
          </div>
        </div>}
        {!local && asset && asset.tags.length > 0 && <div className="poliigon-chips-section">
          <strong>Tags</strong>
          <div className="poliigon-chip-row">
            {asset.tags.slice(0, 24).map(tag => <button type="button" key={tag} className="facet-chip" onClick={() => focusTag(tag)}>{tag}</button>)}
          </div>
        </div>}
        {!local && meta?.technique && <div className="poliigon-chips-section">
          <strong>Technique</strong>
          <div className="poliigon-chip-row"><span className="facet-chip">{humanLabel(meta.technique)}</span></div>
        </div>}
        {!local && meta && meta.collections.length > 0 && <div className="poliigon-chips-section">
          <strong>Collections</strong>
          <div className="poliigon-chip-row">{meta.collections.map(collection => <span className="facet-chip" key={collection}>{collection}</span>)}</div>
        </div>}
        {!local && meta && meta.colors.length > 0 && <div className="poliigon-chips-section">
          <strong>Colors</strong>
          <div className="public-color-swatches">{meta.colors.map(color => <span key={color} style={{ background: `#${color.replace(/^#/, "")}` }} title={`#${color.replace(/^#/, "")}`} />)}</div>
        </div>}
        {!local && meta && meta.variations.length > 0 && <div className="poliigon-chips-section">
          <strong>Variations</strong>
          <div className="poliigon-chip-row">{meta.variations.map(id => <button type="button" key={id} className="facet-chip" onClick={() => void openRelatedId(id)}>{humanLabel(id)}</button>)}</div>
        </div>}
        {!local && meta?.longDescription && meta.longDescription !== asset?.description && <details className="public-long-description">
          <summary>Full description</summary>
          <p>{meta.longDescription}</p>
        </details>}
        {local && <p className="hint">{local.categories.join(" · ")}</p>}
        {local && local.tags.length > 0 && <p className="hint">{local.tags.join(" · ")}</p>}
        {asset && <div className="public-provider-links">
          <button className="text-btn" type="button" onClick={() => void window.openbridge.openExternal(asset.websiteUrl)}>View on {publicProviderLabel(asset.provider)}</button>
          {meta?.videoUrl && <button className="text-btn" type="button" onClick={() => void window.openbridge.openExternal(meta.videoUrl)}>Watch provider preview</button>}
          {meta?.colorChecker && <button className="text-btn" type="button" onClick={() => void window.openbridge.openExternal(meta.colorChecker)}>Color-checker EXR</button>}
        </div>}
      </>}
      {section === "technical" && <>
        <section className="technical-panel">
          <div className="technical-head"><h3>Technical</h3></div>
          {groups.length === 0 && <p className="hint">No technical metadata was published for this asset.</p>}
          {groups.map(group => <div className="technical-group" key={group.title}>
            <h4>{group.title}</h4>
            <div className="technical-grid">{group.rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
          </div>)}
        </section>
        {asset && <details className="poliigon-raw"><summary>Provider record</summary><pre>{JSON.stringify({
          provider: asset.provider,
          id: asset.id,
          licence: asset.license,
          authors: asset.authors,
          publishedAt: asset.publishedAt,
          website: asset.websiteUrl,
          attributes: Object.fromEntries(Object.entries(asset.attributes).filter(([key]) => !["canDownload", "downloadError"].includes(key)))
        }, null, 2)}</pre></details>}
      </>}
      {section === "download" && <>
        {local ? <div className="poliigon-download-prompt">
          <strong>Downloaded locally</strong>
          <p>{local.path}</p>
          <p className="hint">{local.fileCount?.toLocaleString() ?? "—"} files · {local.sizeBytes ? `${(local.sizeBytes / 1048576).toFixed(1)} MB` : "size unknown"} · record: {local.jsonPath}</p>
          <button type="button" className="btn btn-ghost" onClick={() => void window.openbridge.openPath(local.path)}>Open local folder</button>
        </div> : asset ? <>
          {asset.provider === "blenderkit" && !blenderkit.hasKey && <div className="poliigon-download-prompt">
            <strong>BlenderKit API key required</strong>
            <p>Add your own key in Settings, then test it there. OpenBridge never purchases assets or bypasses entitlement checks.</p>
            <button type="button" className="btn btn-primary" onClick={() => useStore.getState().setView("settings")}>Open Settings</button>
          </div>}
          {asset.provider === "blenderkit" && blenderkit.hasKey && asset.attributes.canDownload === false && <div className="poliigon-download-prompt">
            <strong>Account or plan required</strong>
            <p>{String(asset.attributes.downloadError || "BlenderKit did not grant download access for this account.")}</p>
            <button type="button" className="btn btn-ghost" onClick={() => void window.openbridge.openExternal(asset.websiteUrl)}>Open on BlenderKit</button>
          </div>}
          {files.length > 0 && <label className="public-field"><span>Delivery variant</span><select className="native-select" value={variant} onChange={event => setVariant(Number(event.target.value))}>{files.map((file, i) => <option key={`${file.url}:${i}`} value={i}>{[
            file.resolution,
            file.fileType ? humanLabel(file.fileType) : file.role,
            file.format?.toUpperCase(),
            file.bytes ? `${(file.bytes / 1048576).toFixed(1)} MB` : "size at transfer"
          ].filter(Boolean).join(" · ")}</option>)}</select></label>}
          {files[variant] && <p className="hint">Selected: {files[variant].name} · {files[variant].role.replace(/^\w/, value => value.toUpperCase())}{files[variant].fileType ? ` · ${humanLabel(files[variant].fileType!)}` : ""}</p>}
          {asset.provider === "openhdri" && <p className="hint">OpenHDRI currently publishes 16K EXRs only; ensure you have enough disk space before downloading. The optional color-checker EXR can be included with this download.</p>}
          {asset.provider === "openhdri" && asset.files.some(file => file.role === "colorchart") && <label className="toggle inline">
            <input type="checkbox" checked={includeColorChecker} onChange={event => setIncludeColorChecker(event.target.checked)} />
            <span>Include color-checker EXR</span>
          </label>}
          <p className="hint">Files are written into the {publicProviderLabel(asset.provider)} library folder configured in Settings. ZIP packages are extracted locally; one package is downloaded per asset.</p>
          {downloadError && <div className="error-box" role="alert">{downloadError}<button type="button" className="text-btn" onClick={() => void queue()}>Retry</button></div>}
        </> : null}
      </>}
      {section === "related" && <section className="technical-panel">
        <div className="technical-head"><h3>Related</h3><span>{relatedLoading ? "Loading…" : related.length > 0 ? `${related.length} ${relatedBasis === "linked" ? "provider-linked" : "related by provider category"}` : "No related assets"}</span></div>
        {!relatedLoading && related.length === 0 && <p className="hint">The provider does not publish a curated related list, or this search returned no similar items. Related results here are based on provider category, not a claimed hand-picked relationship.</p>}
        {!relatedLoading && related.length > 0 && relatedBasis === "linked" && <p className="hint">Provider-published variations and adjacent assets, linked by the source catalogue.</p>}
        <div className="related-grid">
          {related.map(hit => {
            const thumb = publicCardThumbnail(hit, 512);
            const ambient = hit.provider === "ambientcg" && /^(hdri|hdri-element)$/i.test(hit.type);
            return <button type="button" key={hit.id} className="related-card" onClick={() => void usePublicStore.getState().open(hit)}>
              {thumb ? <SmartThumbImage source={thumb} direct={ambient} crop={hit.provider === "openhdri" ? "top-2-1" : undefined} alt="" /> : <span className="asset-placeholder">{hit.typeLabel}</span>}
              <strong>{hit.name}</strong><span>{hit.typeLabel} · {hit.license}</span>
            </button>;
          })}
        </div>
      </section>}
    </div>
    <div className="drawer-footer">
      {job && <p className="hint">{job.status} · {Math.round(job.ratio * 100)}% · {job.message}</p>}
      {job?.status === "paused" && <button type="button" className="btn" onClick={() => void window.openbridge.downloads.resume(job.assetId).catch(error => toast(String(error), true))}>Resume download</button>}
      {job?.status === "error" && <button type="button" className="btn" onClick={() => void window.openbridge.downloads.retry(job.assetId).catch(error => toast(String(error), true))}>Retry download</button>}
      {job && ["queued", "requesting", "downloading", "extracting"].includes(job.status) && <button type="button" className="btn btn-ghost" onClick={() => void window.openbridge.downloads.pause(job.assetId).catch(error => toast(String(error), true))}>Pause download</button>}
      {job && ["paused", "queued", "requesting", "downloading", "extracting"].includes(job.status) && <button type="button" className="text-btn" onClick={() => void window.openbridge.downloads.cancel(job.assetId).catch(error => toast(String(error), true))}>Cancel download</button>}
      {asset && !canDownload && <p className="hint">{asset.provider === "blenderkit" && !blenderkit.hasKey ? "Add a BlenderKit API key in Settings to download." : "This asset requires a BlenderKit account or plan."}</p>}
      {asset && <button className="btn btn-primary" type="button" disabled={!files.length || !canDownload || Boolean(job && ["paused", "queued", "requesting", "downloading", "extracting"].includes(job.status))} onClick={() => void queue()}>Download</button>}
      {job?.path && job.status === "complete" && <button type="button" className="btn btn-ghost" onClick={() => void window.openbridge.openPath(job.path!)}>Open download folder</button>}
    </div>
  </aside></>;
}
