import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssetRecord,
  MapPreview,
  SharedHdrInfo,
  SharedFileFacts,
  SharedAssetDependencies,
  SharedPresentation
} from "../../shared/types";
import { CloseIcon } from "../icons";
import { useStore } from "../store";
import { ImageViewer } from "./ImageViewer";
import { ModelPreviewPanel } from "./ModelViewer";
import { SharedPresentationPanel } from "./SharedPresentationPanel";
import { assetDisplayName } from "../asset-display-name";

const mapNames: Record<string, string> = {
  basecolor: "Base color", albedo: "Base color", normal: "Normal", roughness: "Roughness",
  metalness: "Metalness", opacity: "Opacity / alpha", emissive: "Emissive", ao: "Ambient occlusion",
  orm: "Packed ORM", gloss: "Gloss", displacement: "Displacement", specular: "Specular", translucency: "Translucency"
};
function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`;
  return `${(bytes / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
}
function variantLabel(variant: AssetRecord): string {
  const lod = variant.technical?.local?.lod ?? /(?:^|[._ -])lod(\d+)(?:[._ -]|$)/i.exec(variant.name)?.[1];
  const version = variant.technical?.local?.version;
  return [variant.tags[0]?.toUpperCase(), lod !== undefined ? `LOD${lod}` : "", version ? `v${version}` : "",
    variant.sizeBytes === undefined ? "" : bytesLabel(variant.sizeBytes)].filter(Boolean).join(" · ");
}

export function SharedAssetDrawer({ asset }: { asset: AssetRecord }) {
  const close = useStore(state => state.closeSelection);
  const prepared = useStore(state => state.settings?.sharedLibraryRoots?.some(root =>
    root.kind === "presentations" && asset.id.startsWith(`shared:${root.id}:`)) ?? false);
  const history = useStore(state => state.selectionHistory.length);
  const favorite = useStore(state => state.sharedFavorites.includes(asset.id));
  const toast = useStore(state => state.toast);
  const [image, setImage] = useState<MapPreview | null>(null);
  const [facts, setFacts] = useState<SharedFileFacts | null>(asset.technical?.local ?? null);
  const [factsError, setFactsError] = useState("");
  const [factsLoading, setFactsLoading] = useState(false);
  const [inspectionRequest, setInspectionRequest] = useState(0);
  const [hdr, setHdr] = useState<SharedHdrInfo | null>(null);
  const [problem, setProblem] = useState("");
  const [presentation, setPresentation] = useState<SharedPresentation | null>(null);
  const [presentationError, setPresentationError] = useState("");
  const [view, setView] = useState<"render" | "model" | "resources" | "turntable">(asset.preview && !prepared ? "render" : "model");
  const [viewerItems, setViewerItems] = useState<MapPreview[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [resources, setResources] = useState<SharedAssetDependencies | null>(null);
  const [failedMapUrls, setFailedMapUrls] = useState<Set<string>>(() => new Set());
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState("");
  const [resourcesRetry, setResourcesRetry] = useState(0);
  const [resourceQuery, setResourceQuery] = useState("");
  const [variantQuery, setVariantQuery] = useState("");
  const [variantsError, setVariantsError] = useState("");
  const currentAsset = useRef(asset.id);
  const viewTouched = useRef(false);
  currentAsset.current = asset.id;
  const openImageItems = (items: MapPreview[], index: number) => { setViewerIndex(index); setViewerItems(items); };
  const showImage = (preview: MapPreview) => openImageItems([preview], 0);
  const chooseView = (next: typeof view) => { viewTouched.current = true; setView(next); };
  const [copying, setCopying] = useState(false);
  const [variants, setVariants] = useState<AssetRecord[]>([]);
  const [organization, setOrganization] = useState({ tags: "", collections: "", notes: "" });
  const [organizationReady, setOrganizationReady] = useState(false);
  const [organizationBusy, setOrganizationBusy] = useState(false);
  const hdrAsset = asset.type === "hdri";
  const provenance = [
    ["Type", presentation?.category],
    ["Job", presentation?.job],
    ["Artist", presentation?.artist]
  ].filter(([, value]) => Boolean(value));

  useEffect(() => {
    let current = true;
    setOrganizationReady(false);
    setOrganization({ tags: "", collections: "", notes: "" });
    setOrganizationBusy(false);
    viewTouched.current = false;
    setView(asset.preview && !prepared ? "render" : "model");
    setViewerItems([]);
    setVariants([]);
    setVariantsError("");
    setVariantQuery("");
    setResources(null);
    setFailedMapUrls(new Set());
    setResourceQuery("");
    setResourcesError("");
    setProblem("");
    setPresentation(null);
    setPresentationError("");
    setImage(null);
    setHdr(null);
    void window.openbridge.localPreviews(asset.id, asset.path).then(result => {
      if (!current) return;
      setImage(result.renders[0] ?? null);
      if (!result.renders.length) setView(previous => previous === "render" ? "model" : previous);
    }).catch(() => {});
    void window.openbridge.sharedLibrary.variants(asset.id).then(result => {
      if (current) setVariants(result);
    }).catch(error => { if (current) setVariantsError(error instanceof Error ? error.message : String(error)); });
    void window.openbridge.sharedLibrary.organization(asset.id).then(result => {
      if (!current) return;
      setOrganization({ tags: result.tags.join(", "), collections: result.collections.join(", "), notes: result.notes });
      setOrganizationReady(true);
    }).catch(error => { if (current) toast(String(error), true); });
    if (hdrAsset) {
      void window.openbridge.sharedLibrary.inspectHdr(asset.id).then(result => {
        if (current) setHdr(result);
      }).catch(error => { if (current) setProblem(error instanceof Error ? error.message : String(error)); });
    }
    return () => { current = false; };
  }, [asset.id, asset.path, hdrAsset, prepared, toast]);

  useEffect(() => {
    let current = true;
    if (!prepared) return () => { current = false; };
    void window.openbridge.sharedLibrary.presentation(asset.id).then(result => {
      if (!current) return;
      setPresentation(result.presentation);
      setPresentationError(result.error ?? "");
    }).catch(error => {
      if (current) setPresentationError(error instanceof Error ? error.message : String(error));
    });
    return () => { current = false; };
  }, [asset.id, prepared]);

  useEffect(() => {
    if (!prepared || viewTouched.current) return;
    if (view === "model" && presentation?.hero?.kind === "video") setView("turntable");
  }, [prepared, presentation, view]);

  useEffect(() => {
    let current = true;
    setFacts(asset.technical?.local ?? null);
    setFactsError("");
    setFactsLoading(true);
    void window.openbridge.sharedLibrary.inspectFile(asset.id).then(result => {
      if (!current) return;
      setFacts(result);
      void useStore.getState().refreshLocalLibrary();
    }).catch(error => { if (current) setFactsError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (current) setFactsLoading(false); });
    return () => { current = false; };
  }, [asset.id, asset.path, inspectionRequest]);

  useEffect(() => {
    if (hdrAsset || view !== "resources") return;
    let current = true;
    setResourcesLoading(true);
    setResourcesError("");
    setFailedMapUrls(new Set());
    void window.openbridge.sharedLibrary.dependencies(asset.id).then(result => {
      if (current) setResources(result);
    }).catch(error => { if (current) setResourcesError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (current) setResourcesLoading(false); });
    return () => { current = false; };
  }, [asset.id, hdrAsset, view, resourcesRetry]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || viewerItems.length || document.querySelector(".model-viewer-overlay")) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if ((event.target as HTMLElement)?.closest("input,textarea,select,button,a,summary,[contenteditable=true]")) return;
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault(); useStore.getState().backSelection();
      } else if (!event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault(); useStore.getState().stepSelection(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, viewerItems.length]);

  const previewMaps = useMemo<MapPreview[]>(() => (resources?.maps ?? []).filter(map => Boolean(map.url)).map(map => ({
    type: map.type, label: [map.material, mapNames[map.type] ?? map.type, map.name].filter(Boolean).join(" · "), url: map.url!
  })), [resources]);
  const resourceNeedle = resourceQuery.trim().toLocaleLowerCase();
  const resourceFiles = resources?.files.filter(file => file.name.toLocaleLowerCase().includes(resourceNeedle)) ?? [];
  const resourceMaps = resources?.maps.filter(map => `${map.name} ${map.type} ${map.material ?? ""}`.toLocaleLowerCase().includes(resourceNeedle)) ?? [];
  const visibleVariants = variants.filter(variant => `${variant.name} ${variantLabel(variant)}`.toLocaleLowerCase().includes(variantQuery.trim().toLocaleLowerCase()));

  const loadHdrSource = useCallback(async (_item: MapPreview, signal?: AbortSignal) => {
    const cancel = () => void window.openbridge.sharedLibrary.cancelHdr(asset.id).catch(() => {});
    signal?.addEventListener("abort", cancel, { once: true });
    try { return await window.openbridge.sharedLibrary.hdr(asset.id); }
    finally { signal?.removeEventListener("abort", cancel); }
  }, [asset.id]);

  async function run(action: "open" | "reveal" | "copy" | "copyPackage") {
    try {
      if (action === "copy") {
        setCopying(true);
        if (await window.openbridge.sharedLibrary.copy(asset.id)) toast("Source file copied");
      } else if (action === "copyPackage") {
        setCopying(true);
        const result = await window.openbridge.sharedLibrary.copyPackage(asset.id);
        if (result) toast(`Copied ${result.files} files to ${result.folder}`);
      } else await window.openbridge.sharedLibrary[action](asset.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      if (action === "copy" || action === "copyPackage") setCopying(false);
    }
  }

  async function saveOrganization() {
    const savingId = asset.id;
    setOrganizationBusy(true);
    try {
      const saved = await window.openbridge.sharedLibrary.saveOrganization(asset.id, {
        tags: organization.tags.split(","),
        collections: organization.collections.split(","),
        notes: organization.notes
      });
      if (currentAsset.current !== savingId) return;
      setOrganization({ tags: saved.tags.join(", "), collections: saved.collections.join(", "), notes: saved.notes });
      await useStore.getState().refreshLocalLibrary();
      toast("Saved local organization");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally { if (currentAsset.current === savingId) setOrganizationBusy(false); }
  }

  return <>
    <div className="drawer-backdrop" onClick={close} />
    <aside className="drawer" role="dialog" aria-label={asset.name}>
      <div className="drawer-head">
        <button type="button" className="text-btn" disabled={!history} onClick={() => useStore.getState().backSelection()}>Back</button>
        <span className="drawer-id">{prepared ? "Prepared asset" : "Shared"}</span>
        <button type="button" className="icon-btn" aria-label="Previous asset" onClick={() => useStore.getState().stepSelection(-1)}>‹</button>
        <button type="button" className="icon-btn" aria-label="Next asset" onClick={() => useStore.getState().stepSelection(1)}>›</button>
        <button type="button" className={favorite ? "icon-btn active" : "icon-btn"}
          aria-label={favorite ? "Remove favorite" : "Add favorite"} onClick={() => useStore.getState().toggleSharedFavorite(asset.id)}>
          {favorite ? "♥" : "♡"}
        </button>
        <button type="button" className="icon-btn" title="Close" onClick={close}><CloseIcon /></button>
      </div>
      <div className="drawer-scroll">
        <h2 className="drawer-title">{assetDisplayName(asset.name)}</h2>
        {provenance.length > 0 && <dl className="shared-asset-provenance">
          {provenance.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>}
        {presentationError && <p className="hint" role="status">Presentation details could not be read: {presentationError}</p>}
        {!hdrAsset && <div className="button-row horizontal shared-preview-modes" role="group" aria-label="Local asset preview">
          {presentation?.hero?.kind === "video" && <button type="button" className={view === "turntable" ? "btn btn-primary" : "btn btn-ghost"} aria-pressed={view === "turntable"} onClick={() => chooseView("turntable")}>Turntable</button>}
          <button type="button" className={view === "model" ? "btn btn-primary" : "btn btn-ghost"} aria-pressed={view === "model"} onClick={() => chooseView("model")}>3D</button>
          {image && presentation?.hero?.kind !== "video" && <button type="button" aria-pressed={view === "render"} className={view === "render" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => chooseView("render")}>Render</button>}
          <button type="button" aria-pressed={view === "resources"} className={view === "resources" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => chooseView("resources")}>Resources</button>
        </div>}
        {((!hdrAsset && (view === "model" || view === "turntable")) || (image && (hdrAsset || view === "render"))) && <div className={`drawer-preview${view === "turntable" ? " shared-presentation-video" : ""}${prepared ? " shared-presentation-preview" : ""}`}>
          {!hdrAsset && view === "model" && <ModelPreviewPanel assetId={asset.id} provider="shared" name={asset.name} type={asset.type} />}
          {!hdrAsset && view === "turntable" && presentation?.hero?.kind === "video" && <video key={presentation.hero.url} controls playsInline preload="metadata" autoPlay muted loop
            poster={presentation.hero.poster} aria-label={presentation.hero.label}>
            <source src={presentation.hero.url} type={presentation.hero.mimeType} />
          </video>}
          {image && (hdrAsset || view === "render") && <button type="button" className="expand-preview" onClick={() => showImage(image)}>
            <img src={image.url} alt={asset.name} onError={() => {
              setImage(null);
              setView(previous => previous === "render" ? "model" : previous);
            }} />
          </button>}
        </div>}
        {!hdrAsset && presentation && view !== "resources" && <SharedPresentationPanel presentation={presentation} onOpenImage={openImageItems} />}
        {hdrAsset && hdr?.previewAvailable && <button type="button" className="btn btn-primary" onClick={() => showImage({
          type: "HDR", label: `${asset.name} · ${hdr.width} × ${hdr.height}`, url: image?.url ?? "",
          exposure: { assetId: asset.id, mapType: "HDR" }, panorama: hdr.panorama
        })}>{hdr.panorama ? "Open HDRI viewer" : "Open HDR image"}</button>}
        {hdrAsset && (problem || hdr?.reason) && <p className="hint" role="status">{problem || hdr?.reason}</p>}
        {!hdrAsset && view === "resources" && <section className="shared-resource-section" aria-label="Local resources">
          <div className="shared-section-heading"><h3>Local resources</h3>
            <button type="button" className="text-btn" disabled={resourcesLoading} onClick={() => setResourcesRetry(value => value + 1)}>Refresh resources</button>
          </div>
          {resourcesLoading && <p className="hint" role="status">Reading material and dependency references…</p>}
          {resourcesError && <div className="shared-inline-error" role="status"><p className="hint">{resourcesError}</p>
            <button type="button" className="text-btn" onClick={() => setResourcesRetry(value => value + 1)}>Retry resources</button></div>}
          {resources && <>
            <p className="hint">{resources.files.length} available files · {resources.maps.length} map {resources.maps.length === 1 ? "reference" : "references"} · {resources.complete ? "Dependency inspection complete" : "Partial dependency inspection"}</p>
            {resources.notes.map((note, index) => <p className="hint" key={index}>{note}</p>)}
            <label className="shared-resource-filter">Filter resource files <input value={resourceQuery} onChange={event => setResourceQuery(event.target.value)} placeholder="Filename, material or map type" /></label>
            {resourceMaps.length > 0 && <>
              <h4>Material maps</h4>
              <div className="shared-map-grid">
                {resourceMaps.slice(0, 100).map((map, index) => <div className="shared-map-card" key={`${map.name}-${map.type}-${map.material}-${index}`}>
                  {map.url && !failedMapUrls.has(map.url) ? <button type="button" className="shared-map-image" aria-label={`View ${map.name}`} onClick={() => {
                    const selected = previewMaps.findIndex(preview => preview.url === map.url && preview.type === map.type);
                    if (selected >= 0) { setViewerItems(previewMaps); setViewerIndex(selected); }
                  }}><img loading="lazy" src={map.url} alt={map.name} onError={() => setFailedMapUrls(previous => new Set([...previous, map.url!]))} /></button> : <div className="shared-map-unavailable">Image preview unavailable</div>}
                  <strong>{mapNames[map.type] ?? map.type}</strong>
                  <span>{map.material || "Material not specified"}</span>
                  {map.role && <span>Source slot: {map.role}</span>}
                  <span title={map.name}>{map.name}</span>
                </div>)}
              </div>
              {resourceMaps.length > 100 && <p className="hint">Showing 100 of {resourceMaps.length} map references. Narrow the filter to see other maps.</p>}
            </>}
            <details open><summary>Available source and dependency files ({resourceFiles.length})</summary>
              <ul className="shared-resource-list">{resourceFiles.slice(0, 100).map(file => <li key={file.name}><span title={file.name}>{file.name}</span><span>{bytesLabel(file.bytes)}</span></li>)}</ul>
              {resourceFiles.length > 100 && <p className="hint">Showing 100 of {resourceFiles.length} files. Narrow the filter to see other files.</p>}
            </details>
            {resourceNeedle && !resourceMaps.length && !resourceFiles.length && <p className="hint" role="status">No resources match this filter.</p>}
          </>}
        </section>}
        {!prepared && <div className="technical-grid">
          <div><span>Format</span><strong>{(facts?.format ?? asset.tags[0])?.toUpperCase() || "Unknown"}</strong></div>
          {asset.sizeBytes !== undefined && <div><span>Size</span><strong>{bytesLabel(asset.sizeBytes)}</strong></div>}
          {hdr && <div><span>Dimensions</span><strong>{hdr.width} × {hdr.height}</strong></div>}
          <div><span>Modified</span><strong>{new Date(asset.mtime).toLocaleDateString()}</strong></div>
        </div>}
        {!prepared && facts && <SourceFactsSection facts={facts} loading={factsLoading} onRefresh={() => setInspectionRequest(value => value + 1)} />}
        {!prepared && !facts && factsLoading && <p className="hint" role="status">Inspecting source file…</p>}
        {!prepared && factsError && <div className="shared-inline-error" role="status"><p className="hint">{factsError}</p>
          <button type="button" className="text-btn" disabled={factsLoading} onClick={() => setInspectionRequest(value => value + 1)}>Retry inspection</button></div>}
        {(!prepared || view === "resources") && <p className="hint shared-asset-path" title={asset.path}>{asset.path}</p>}
        {variants.length > 0 && <section className="shared-resource-section">
          <h3>Possible variants in this folder <span className="hint">({variants.length})</span></h3>
          <p className="hint">Related filenames; these may be alternate exports or separate assets. LOD and version labels come from filenames.</p>
          {variants.length > 6 && <label className="shared-resource-filter">Find a variant <input value={variantQuery} onChange={event => setVariantQuery(event.target.value)} placeholder="Name, format or LOD" /></label>}
          <div className="shared-variant-list">
            {visibleVariants.slice(0, 100).map(variant => <button key={variant.id} type="button" className="shared-variant-button"
              onClick={() => void useStore.getState().openLocal(variant)}>
              <strong>{variant.name}</strong><span>{variantLabel(variant)}</span>
            </button>)}
          </div>
          {!visibleVariants.length && <p className="hint" role="status">No variants match this search.</p>}
          {visibleVariants.length > 100 && <p className="hint">Showing 100 of {visibleVariants.length}. Narrow the variant search to see other files.</p>}
        </section>}
        {variantsError && <p className="hint" role="status">Could not load nearby variants: {variantsError}</p>}
        {organizationReady && <details className="shared-organize-disclosure">
          <summary>Organize</summary>
          <form className="shared-organization" onSubmit={event => { event.preventDefault(); void saveOrganization(); }}>
            <label>Tags <input value={organization.tags} placeholder="Comma-separated tags" maxLength={2400}
              onChange={event => setOrganization({ ...organization, tags: event.target.value })} /></label>
            <label>Collections <input value={organization.collections} placeholder="Comma-separated collections" maxLength={2400}
              onChange={event => setOrganization({ ...organization, collections: event.target.value })} /></label>
            <label>Notes <textarea value={organization.notes} maxLength={4000} rows={4}
              onChange={event => setOrganization({ ...organization, notes: event.target.value })} /></label>
            <button type="submit" className="btn btn-ghost" disabled={organizationBusy}>{organizationBusy ? "Saving…" : "Save organization"}</button>
          </form>
        </details>}
      </div>
      <div className="drawer-footer">
        <button type="button" className="btn btn-ghost" onClick={() => void run("reveal")}>Reveal file</button>
        {!prepared && <button type="button" className="btn btn-ghost" onClick={() => void run("open")}>Open in associated app</button>}
        {!prepared && <button type="button" className="btn btn-ghost" disabled={copying} onClick={() => void run("copy")}>Copy source file</button>}
        {["obj", "gltf", "glb"].includes(asset.tags[0]) && <button type="button" className="btn btn-primary" disabled={copying}
          onClick={() => void run("copyPackage")}>Copy with dependencies</button>}
        {copying && <span className="hint" role="status">Copying…</span>}
      </div>
    </aside>
    {viewerItems.length > 0 && <ImageViewer items={viewerItems} index={viewerIndex} onIndex={setViewerIndex} onClose={() => setViewerItems([])} loadHdrSource={loadHdrSource} />}
  </>;
}

function SourceFactsSection({ facts, loading, prepared = false, onRefresh }: {
  facts: SharedFileFacts;
  loading: boolean;
  prepared?: boolean;
  onRefresh: () => void;
}) {
  return <section className="shared-organization">
    <div className="shared-section-heading"><h3>{prepared ? "Prepared GLB facts" : "Measured source facts"}</h3>
      <button type="button" className="text-btn" disabled={loading} onClick={onRefresh}>{loading ? "Inspecting…" : "Refresh facts"}</button>
    </div>
    <p className="hint">{prepared ? "Measured from the prepared GLB" : "Read from the source file"} · {new Date(facts.inspectedAt).toLocaleString()}
      {facts.model?.status === "limited" ? " · Partial inspection" : facts.model?.status === "unsupported" ? " · Format inspection unavailable" : ""}</p>
    <div className="technical-grid">
      {facts.image && <>
        <div><span>Pixel dimensions</span><strong>{facts.image.width} × {facts.image.height}</strong></div>
        <div><span>Projection hint</span><strong>{facts.image.projectionHint === "equirectangular" ? "2:1 panorama candidate" : "Flat / other aspect"}</strong></div>
        <div><span>Pixel type</span><strong>{facts.image.format === "hdr" ? "RGBE shared exponent" : [...new Set(facts.image.channels.map(channel => channel.type.toUpperCase()))].join(", ") || "Unknown"}</strong></div>
        {facts.image.compression && <div><span>Compression</span><strong>{facts.image.compression}</strong></div>}
        {facts.image.views.length > 0 && <div><span>Views</span><strong>{facts.image.views.join(", ")}</strong></div>}
      </>}
      {facts.model && <>
        {facts.model.geometryCount !== undefined && <div><span>{prepared ? "GLB geometries" : "Stored mesh geometries"}</span><strong>{facts.model.geometryCount.toLocaleString()}</strong></div>}
        {facts.model.sourceUnits && <div><span>Metres per source unit</span><strong>{facts.model.sourceUnits.metresPerUnit.toLocaleString(undefined, { maximumSignificantDigits: 8 })}</strong></div>}
        {facts.model.vertices !== null && <div><span>{prepared ? "GLB vertices" : "Stored vertices"}</span><strong>{facts.model.vertices.toLocaleString()}</strong></div>}
        {facts.model.triangles !== null && <div><span>{prepared ? "GLB triangles" : "Stored triangles"}</span><strong>{facts.model.triangles.toLocaleString()}</strong></div>}
        {facts.model.materials !== null && <div><span>{prepared ? "GLB materials" : "Materials"}</span><strong>{facts.model.materials.toLocaleString()}</strong></div>}
        {facts.model.textureImages !== null && <div><span>{prepared ? "GLB image sources" : "Image sources"}</span><strong>{facts.model.textureImages.toLocaleString()}</strong></div>}
        {facts.model.normals !== null && <div><span>{prepared ? "GLB normals" : "Stored normals"}</span><strong>{facts.model.normals.toLocaleString()}</strong></div>}
        {facts.model.uvCoordinates !== null && <div><span>{prepared ? "GLB UV values" : "UV coordinates"}</span><strong>{facts.model.uvCoordinates.toLocaleString()}</strong></div>}
        {facts.model.bounds && <div><span>{prepared ? "Mesh bounds before root scale" : "Mesh-local size"}</span><strong>{facts.model.bounds.max.map((max, axis) =>
          (max - facts.model!.bounds!.min[axis]).toLocaleString(undefined, { maximumFractionDigits: 3 })).join(" × ")}
          {prepared ? " GLB units" : facts.model.bounds.unit === "metres" ? " m" : " source units"}</strong></div>}
      </>}
      {facts.lod !== undefined && <div><span>Filename LOD</span><strong>LOD{facts.lod}</strong></div>}
      {facts.version && <div><span>Filename version</span><strong>v{facts.version}</strong></div>}
    </div>
    {facts.model?.mapTypes.length ? <div><span className="hint">Declared map channels</span><p>{facts.model.mapTypes.map(type => mapNames[type] ?? type).join(", ")}</p></div> : null}
    {facts.model?.materialLibraries.length ? <details><summary>{facts.model.materialLibraries.length} referenced material libraries</summary>
      <ul className="shared-resource-list">{facts.model.materialLibraries.map((name, index) => <li key={`${name}-${index}`}><span>{name}</span></li>)}</ul>
    </details> : null}
    {facts.image?.channels.length ? <details><summary>{facts.image.channels.length} image channels</summary>
      <p className="hint">{facts.image.channels.map(channel => `${channel.name} (${channel.type})`).join(", ")}</p>
    </details> : null}
    {facts.notes.map((note, index) => <p className="hint" key={index}>{note}</p>)}
  </section>;
}
