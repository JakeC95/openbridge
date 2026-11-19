import { useCallback, useEffect, useState } from "react";
import type { AssetRecord, MapPreview, SharedHdrInfo } from "../../shared/types";
import { CloseIcon } from "../icons";
import { useStore } from "../store";
import { ImageViewer } from "./ImageViewer";
import { ModelPreviewPanel } from "./ModelViewer";

export function SharedAssetDrawer({ asset }: { asset: AssetRecord }) {
  const close = useStore(state => state.closeSelection);
  const history = useStore(state => state.selectionHistory.length);
  const favorite = useStore(state => state.sharedFavorites.includes(asset.id));
  const toast = useStore(state => state.toast);
  const [image, setImage] = useState<MapPreview | null>(null);
  const [hdr, setHdr] = useState<SharedHdrInfo | null>(null);
  const [problem, setProblem] = useState("");
  const [view, setView] = useState<"render" | "model">(asset.preview ? "render" : "model");
  const [item, setItem] = useState<MapPreview | null>(null);
  const [copying, setCopying] = useState(false);
  const [variants, setVariants] = useState<AssetRecord[]>([]);
  const [organization, setOrganization] = useState({ tags: "", collections: "", notes: "" });
  const [organizationReady, setOrganizationReady] = useState(false);
  const [organizationBusy, setOrganizationBusy] = useState(false);
  const hdrAsset = asset.type === "hdri";

  useEffect(() => {
    let current = true;
    void window.openbridge.localPreviews(asset.id, asset.path).then(result => {
      if (current) setImage(result.renders[0] ?? null);
    }).catch(() => {});
    void window.openbridge.sharedLibrary.variants(asset.id).then(result => {
      if (current) setVariants(result);
    }).catch(() => {});
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
  }, [asset.id, asset.path, hdrAsset, toast]);

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
    setOrganizationBusy(true);
    try {
      const saved = await window.openbridge.sharedLibrary.saveOrganization(asset.id, {
        tags: organization.tags.split(","),
        collections: organization.collections.split(","),
        notes: organization.notes
      });
      setOrganization({ tags: saved.tags.join(", "), collections: saved.collections.join(", "), notes: saved.notes });
      await useStore.getState().queryLocalLibrary(true);
      toast("Saved local organization");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally { setOrganizationBusy(false); }
  }

  return <>
    <div className="drawer-backdrop" onClick={close} />
    <aside className="drawer" role="dialog" aria-label={asset.name}>
      <div className="drawer-head">
        <button type="button" className="text-btn" disabled={!history} onClick={() => useStore.getState().backSelection()}>Back</button>
        <span className="drawer-id">Shared</span>
        <button type="button" className="icon-btn" aria-label="Previous asset" onClick={() => useStore.getState().stepSelection(-1)}>‹</button>
        <button type="button" className="icon-btn" aria-label="Next asset" onClick={() => useStore.getState().stepSelection(1)}>›</button>
        <button type="button" className={favorite ? "icon-btn active" : "icon-btn"}
          aria-label={favorite ? "Remove favorite" : "Add favorite"} onClick={() => useStore.getState().toggleSharedFavorite(asset.id)}>
          {favorite ? "♥" : "♡"}
        </button>
        <button type="button" className="icon-btn" title="Close" onClick={close}><CloseIcon /></button>
      </div>
      <div className="drawer-scroll">
        <h2 className="drawer-title">{asset.name}</h2>
        <p className="drawer-id">{asset.categories.join(" / ")}</p>
        {!hdrAsset && image && <div className="button-row horizontal">
          <button type="button" className={view === "render" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setView("render")}>Render</button>
          <button type="button" className={view === "model" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setView("model")}>3D</button>
        </div>}
        {((!hdrAsset && view === "model") || image) && <div className="drawer-preview">
          {!hdrAsset && view === "model" && <ModelPreviewPanel assetId={asset.id} provider="shared" name={asset.name} type={asset.type} />}
          {image && (hdrAsset || view === "render") && <button type="button" className="expand-preview" onClick={() => setItem(image)}>
            <img src={image.url} alt={asset.name} />
          </button>}
        </div>}
        {hdrAsset && hdr?.previewAvailable && <button type="button" className="btn btn-primary" onClick={() => setItem({
          type: "HDR", label: `${asset.name} · ${hdr.width} × ${hdr.height}`, url: image?.url ?? "",
          exposure: { assetId: asset.id, mapType: "HDR" }, panorama: hdr.panorama
        })}>{hdr.panorama ? "Open HDRI viewer" : "Open HDR image"}</button>}
        {hdrAsset && (problem || hdr?.reason) && <p className="hint" role="status">{problem || hdr?.reason}</p>}
        <div className="technical-grid">
          <div><span>Format</span><strong>{asset.tags[0]?.toUpperCase()}</strong></div>
          {asset.sizeBytes !== undefined && <div><span>Size</span><strong>{(asset.sizeBytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB</strong></div>}
          {hdr && <div><span>Dimensions</span><strong>{hdr.width} × {hdr.height}</strong></div>}
          <div><span>Modified</span><strong>{new Date(asset.mtime).toLocaleDateString()}</strong></div>
        </div>
        <p className="hint shared-asset-path" title={asset.path}>{asset.path}</p>
        {variants.length > 0 && <section className="shared-organization">
          <h3>Possible variants in this folder</h3>
          <div className="button-row horizontal">
            {variants.map(variant => <button key={variant.id} type="button" className="btn btn-ghost"
              onClick={() => void useStore.getState().openLocal(variant)}>
              {variant.name} · {variant.tags[0]?.toUpperCase()}
            </button>)}
          </div>
        </section>}
        {organizationReady && <form className="shared-organization" onSubmit={event => { event.preventDefault(); void saveOrganization(); }}>
          <h3>Organize</h3>
          <label>Tags <input value={organization.tags} placeholder="Comma-separated tags" maxLength={2400}
            onChange={event => setOrganization({ ...organization, tags: event.target.value })} /></label>
          <label>Collections <input value={organization.collections} placeholder="Comma-separated collections" maxLength={2400}
            onChange={event => setOrganization({ ...organization, collections: event.target.value })} /></label>
          <label>Notes <textarea value={organization.notes} maxLength={4000} rows={4}
            onChange={event => setOrganization({ ...organization, notes: event.target.value })} /></label>
          <button type="submit" className="btn btn-ghost" disabled={organizationBusy}>{organizationBusy ? "Saving…" : "Save organization"}</button>
        </form>}
      </div>
      <div className="drawer-footer">
        <button type="button" className="btn btn-ghost" onClick={() => void run("reveal")}>Reveal file</button>
        <button type="button" className="btn btn-ghost" onClick={() => void run("open")}>Open in associated app</button>
        <button type="button" className="btn btn-ghost" disabled={copying} onClick={() => void run("copy")}>Copy source file</button>
        {["obj", "gltf", "glb"].includes(asset.tags[0]) && <button type="button" className="btn btn-primary" disabled={copying}
          onClick={() => void run("copyPackage")}>Copy with dependencies</button>}
        {copying && <span className="hint" role="status">Copying…</span>}
      </div>
    </aside>
    {item && <ImageViewer items={[item]} index={0} onIndex={() => {}} onClose={() => setItem(null)} loadHdrSource={loadHdrSource} />}
  </>;
}
