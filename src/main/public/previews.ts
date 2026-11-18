import { createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import type { DownloadProgress, MapPreview, PoliigonHdrData } from "../../shared/types";
import { ambientCgPanoramaUrl, OPENHDRI_PREVIEW_WIDTH, openHdriImageUrl, publicJobId, type PublicAssetDetail, type PublicPreviewSet, type PublicProviderId } from "../../shared/public-providers";
import { previewProgressKey } from "../../shared/preview-keys";
import { downloadFile } from "../downloader";
import { DownloadStats } from "../download-stats";
import { decodeHdrFile } from "../hdr-decode";
import { smartThumbnail } from "../smart-thumbnails";
import { resolutionPixels, safeSegment } from "./common";
import { hdrLimitsFor, hdrMaxBytesFor, PUBLIC_PREVIEW_MAX_BYTES, toneMappedPng } from "./preview-data";

/** Read a single image member; do not unpack arbitrary paths or multi-GB packages. */
async function extractMap(zipPath: string, destination: string, type: string, signal: AbortSignal): Promise<string> {
  const token = type.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
    if (error || !zip) { reject(error ?? new Error("Invalid preview ZIP")); return; }
    let settled = false;
    const fail = (reason: unknown): void => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); zip.close(); reject(reason); };
    const abort = (): void => fail(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    zip.on("error", fail);
    zip.on("end", () => fail(new Error(`This delivery variant contains no browser-readable ${type} map`)));
    zip.on("entry", entry => {
      const name = basename(entry.fileName), extension = extname(name).toLowerCase();
      const normalized = name.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension) || !normalized.includes(token)) { zip.readEntry(); return; }
      if (entry.uncompressedSize > PUBLIC_PREVIEW_MAX_BYTES) { fail(new Error("Extracted map exceeds the preview budget")); return; }
      const output = `${destination}${extension}`;
      zip.openReadStream(entry, (streamError, stream) => {
        if (streamError || !stream) { fail(streamError ?? new Error("Could not read preview map")); return; }
        void pipeline(stream, createWriteStream(output), { signal }).then(() => {
          if (settled) return;
          settled = true; signal.removeEventListener("abort", abort); zip.close(); resolve(output);
        }).catch(fail);
      });
    });
    zip.readEntry();
  }));
}

export class PublicPreviewService {
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<unknown> }>();
  private hdrCache: { key: string; data: PoliigonHdrData } | null = null;
  private decodeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly cacheRoot: string,
    private readonly detail: (provider: PublicProviderId, id: string) => Promise<PublicAssetDetail>,
    private readonly resolveUrl: (provider: PublicProviderId, url: string) => Promise<string>,
    private readonly emit: (progress: DownloadProgress) => void,
    private readonly transfer: typeof downloadFile = downloadFile
  ) {}

  cancel(provider: PublicProviderId, id: string): void {
    const prefix = `${publicJobId(provider, id)}:`;
    for (const [key, operation] of this.active) if (key.startsWith(prefix)) operation.controller.abort(new DOMException("Preview closed", "AbortError"));
  }
  close(): void { for (const operation of this.active.values()) operation.controller.abort(); this.hdrCache = null; }

  private run<T>(provider: PublicProviderId, id: string, kind: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const key = `${publicJobId(provider, id)}:${kind}`;
    const existing = this.active.get(key); if (existing && !existing.controller.signal.aborted) return existing.promise as Promise<T>;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]);
    const promise = Promise.resolve().then(() => { signal.throwIfAborted(); return work(signal); }).then(value => { signal.throwIfAborted(); return value; }).finally(() => { if (this.active.get(key)?.controller === controller) this.active.delete(key); });
    this.active.set(key, { controller, promise }); return promise;
  }

  private folder(detail: PublicAssetDetail): string {
    const hash = createHash("sha256").update(detail.filesHash).digest("hex").slice(0, 12);
    return join(this.cacheRoot, detail.provider, safeSegment(detail.id), hash);
  }

  private async file(detail: PublicAssetDetail, source: string, name: string, key: string, signal: AbortSignal, expectedBytes?: number, maxBytes = PUBLIC_PREVIEW_MAX_BYTES): Promise<string> {
    const destination = join(this.folder(detail), name);
    const existing = await stat(destination).catch(() => null);
    if (existing?.isFile() && existing.size > 0 && existing.size <= maxBytes && Date.now() - existing.mtimeMs < 12 * 60 * 60 * 1000 && (!expectedBytes || existing.size === expectedBytes)) return destination;
    await mkdir(dirname(destination), { recursive: true });
    const stats = new DownloadStats();
    const progress: DownloadProgress = { provider: detail.provider, assetId: key, name: `${detail.name} · Preview`, status: "requesting", received: 0, total: expectedBytes ?? 0, ratio: 0, preview: true };
    let lastEmit = 0, lastStatus = "";
    const publish = (): void => {
      if (Date.now() - lastEmit < 150 && progress.status === lastStatus) return;
      lastEmit = Date.now(); lastStatus = progress.status;
      this.emit({ ...progress, diagnostics: stats.snapshot(progress.status === "downloading") });
    };
    publish();
    try {
      const url = detail.provider === "blenderkit" && !new URL(source).pathname.startsWith("/api/v1/downloads/") ? source : await this.resolveUrl(detail.provider, source); signal.throwIfAborted();
      progress.status = "downloading";
      await this.transfer(url, destination, update => { Object.assign(progress, update); publish(); }, 60, signal, expectedBytes || undefined, sample => { stats.record(name, sample); publish(); }, maxBytes);
      progress.status = "complete"; progress.ratio = 1; publish(); return destination;
    } catch (error) { progress.status = signal.aborted ? "cancelled" : "error"; progress.message = error instanceof Error ? error.message : String(error); publish(); throw error; }
  }

  private hdrSource(detail: PublicAssetDetail, low: boolean): { url: string; name: string; bytes?: number; resolution: string } | null {
    const direct = detail.previews.filter(preview => preview.type === "hdr-source");
    if (direct.length) {
      const selected = (low ? direct.find(preview => /LQ/.test(preview.label)) : direct.find(preview => /HQ/.test(preview.label))) ?? direct[0];
      return { url: selected.url, name: low ? "panorama-lq.exr" : "panorama-hq.exr", resolution: low ? "LQ" : "HQ" };
    }
    const maxResolution = hdrLimitsFor(detail.provider).maxWidth;
    const maxBytes = hdrMaxBytesFor(detail.provider);
    const files = detail.files.filter(file => /\.(hdr|exr)$/i.test(file.name) && file.resolution && (resolutionPixels(file.resolution) ?? Infinity) <= maxResolution && file.bytes <= maxBytes).sort((a, b) => (resolutionPixels(a.resolution!) ?? 0) - (resolutionPixels(b.resolution!) ?? 0));
    const selected = low ? files.find(file => (resolutionPixels(file.resolution!) ?? 0) >= 1024) ?? files[0] : files.at(-1);
    return selected ? { url: selected.url, name: `source-${safeSegment(selected.resolution!)}${extname(selected.name)}`, bytes: selected.bytes, resolution: selected.resolution! } : null;
  }

  private async decode(detail: PublicAssetDetail, low: boolean, signal: AbortSignal): Promise<PoliigonHdrData> {
    const source = this.hdrSource(detail, low);
    if (!source) throw new Error("This provider does not publish an HDR source within the live-preview budget. Use the published tone-mapped panorama or download the original for your DCC.");
    const cacheKey = `${detail.provider}:${detail.id}:${detail.filesHash}:${source.name}`;
    if (this.hdrCache?.key === cacheKey) return this.hdrCache.data;
    const path = await this.file(detail, source.url, source.name, previewProgressKey.publicHdr(publicJobId(detail.provider, detail.id)), signal, source.bytes, hdrMaxBytesFor(detail.provider));
    // Decode one HDR at a time and retain only one half-float image, not an unbounded float cache.
    const pending = this.decodeQueue.catch(() => {}).then(async () => {
      signal.throwIfAborted();
      if (this.hdrCache?.key === cacheKey) return this.hdrCache.data;
      this.hdrCache = null;
      const decoded = await decodeHdrFile(path, hdrLimitsFor(detail.provider), signal);
      const result = { ...decoded, resolution: source.resolution };
      signal.throwIfAborted(); this.hdrCache = { key: cacheKey, data: result }; return result;
    });
    this.decodeQueue = pending.then(() => undefined, () => undefined); return pending;
  }

  async hdr(provider: PublicProviderId, id: string): Promise<PoliigonHdrData> {
    return this.run(provider, id, "hdr", async signal => this.bestHdr(await this.detail(provider, id), signal));
  }

  private async bestHdr(detail: PublicAssetDetail, signal: AbortSignal): Promise<PoliigonHdrData> {
    try { return await this.decode(detail, false, signal); }
    catch (error) {
      signal.throwIfAborted();
      if (detail.provider !== "ambientcg" || !/budget/.test(error instanceof Error ? error.message : "")) throw error;
      return this.decode(detail, true, signal);
    }
  }

  private async openHdriPoster(detail: PublicAssetDetail, signal: AbortSignal): Promise<string | null> {
    // Do not trust detail.previews or detail.thumbnail here: catalogues indexed
    // before the PNG fix still point at the 512 AVIF thumbnail. Build the real
    // high-resolution preview URL from the slug so the crop works immediately.
    const source = openHdriImageUrl(detail.id, OPENHDRI_PREVIEW_WIDTH);
    const path = await this.file(detail, source, "openhdri-panorama-4096.png", previewProgressKey.publicMaps(publicJobId(detail.provider, detail.id)), signal);
    const local = pathToFileURL(path).href;
    return smartThumbnail(local, "top-2-1").catch(() => local);
  }

  private async ambientCgPoster(detail: PublicAssetDetail, signal: AbortSignal): Promise<string | null> {
    // ambientCG publishes a sphere thumbnail, but its PBR preview folder has
    // matching LQ/HQ JPG panoramas next to the EXR viewer sources. Prefer the
    // HQ JPG for the flat panorama; fall back to LQ and then the existing EXR
    // tone-map path in previews().
    for (const quality of ["HQ", "LQ"] as const) {
      const source = ambientCgPanoramaUrl(detail.previews, quality);
      if (!source) continue;
      try {
        const path = await this.file(detail, source, `ambientcg-panorama-${quality.toLowerCase()}.jpg`, previewProgressKey.publicMaps(publicJobId(detail.provider, detail.id)), signal);
        return pathToFileURL(path).href;
      } catch (error) {
        signal.throwIfAborted();
      }
    }
    return null;
  }

  async previews(provider: PublicProviderId, id: string): Promise<PublicPreviewSet> {
    return this.run(provider, id, "maps", async signal => {
      const detail = await this.detail(provider, id), assetId = publicJobId(provider, id);
      const isHdri = /^(hdri|hdr|hdri-element)$/.test(detail.type);
      const isOpenHdri = provider === "openhdri";
      // Ignore stored OpenHDRI previews entirely; build the current 4096px PNG
      // preview below. Older catalogues still contain the 512 AVIF thumbnail.
      const renders: MapPreview[] = isOpenHdri ? [] : detail.previews.filter(preview => !["hdr-source", "map"].includes(preview.type)).map(preview => ({ type: preview.type, label: preview.label, url: preview.url, assetId, panorama: preview.type === "panorama" }));
      const maps: MapPreview[] = [];
      const hdrAvailable = isHdri && Boolean(this.hdrSource(detail, false));
      if (isHdri) {
        let panorama = isOpenHdri ? undefined : renders.find(preview => preview.panorama)?.url;
        if (isOpenHdri) {
          const poster = await this.openHdriPoster(detail, signal);
          if (poster) {
            panorama = poster;
            // Use the cropped panorama for the render view too, so expanding it
            // never reveals the provider's material-ball strip.
            renders.push({ type: "preview", label: "Environment preview", url: poster, assetId, panorama: false });
          }
        } else if (!panorama && provider === "ambientcg") {
          const poster = await this.ambientCgPoster(detail, signal);
          if (poster) panorama = poster;
          else if (hdrAvailable) {
            const hdr = await this.decode(detail, true, signal);
            const target = join(this.folder(detail), "tonemapped-lq.png");
            await writeFile(target, toneMappedPng(hdr)); panorama = pathToFileURL(target).href;
          }
        }
        // Only use explicitly published panorama/preview types as equirectangular.
        // Square BlenderKit renders and OpenHDRI material-ball previews are not panoramas.
        if (panorama && /^https?:/i.test(panorama)) {
          const original = panorama;
          const path = await this.file(detail, panorama, `published-panorama${extname(new URL(panorama).pathname) || ".jpg"}`, previewProgressKey.publicMaps(assetId), signal);
          panorama = pathToFileURL(path).href;
          for (const render of renders) if (render.url === original) render.url = panorama;
        }
        if (provider === "ambientcg" && /^(hdri|hdr|hdri-element)$/.test(detail.type) && panorama) {
          // Replace the sphere render for ambientCG HDRIs with the real local
          // panorama. The card uses the small LQ JPG; this is the HQ version.
          renders.length = 0;
          renders.push({ type: "preview", label: detail.type === "hdri-element" ? "HDR element preview" : "Panorama preview", url: panorama, assetId, panorama: false });
        }
        if (panorama) {
          const equirect = detail.type !== "hdri-element" && provider !== "blenderkit";
          const base: MapPreview = { type: "JPG", label: detail.type === "hdri-element" ? "Tone-mapped HDR element" : detail.provider === "openhdri" || detail.provider === "ambientcg" ? "Panorama preview" : "Tone-mapped panorama", url: panorama, assetId, panorama: equirect, map: { type: "JPG" }, ...(hdrAvailable && provider !== "blenderkit" ? { exposure: { assetId, mapType: "JPG" } } : {}) };
          maps.push(base);
        }
        if (hdrAvailable) {
          // The viewer fetches the poster through fetch(); remote CDN URLs are
          // blocked by the renderer's connect-src policy. Cache it locally first.
          let poster = maps[0]?.url ?? renders[0]?.url ?? detail.thumbnail ?? "";
          if (poster && /^https?:/i.test(poster)) {
            try {
              const extension = extname(new URL(poster).pathname).toLowerCase();
              const path = await this.file(detail, poster, `hdr-poster${extension || ".jpg"}`, previewProgressKey.publicMaps(assetId), signal);
              poster = pathToFileURL(path).href;
            } catch (error) {
              signal.throwIfAborted();
            }
          }

          const hdrEntry: MapPreview = { type: "HDR", label: "HDR · live exposure", url: poster, assetId, panorama: detail.type !== "hdri-element", exposure: { assetId, mapType: "HDR" } };
          if (hdrEntry.url) maps.push(hdrEntry);
        }
        if (renders.length === 0 && maps[0]) renders.push({ ...maps[0], type: "render", label: "Tone-mapped view" });
      } else {
        const seen = new Set<string>();
        for (const preview of detail.previews.filter(item => item.map)) {
          const type = preview.map!; if (seen.has(type)) continue; seen.add(type);
          const path = await this.file(detail, preview.url, `${safeSegment(type)}${extname(new URL(preview.url).pathname)}`, previewProgressKey.publicMaps(assetId), signal);
          maps.push({ type, label: preview.label, url: pathToFileURL(path).href, assetId, map: { type } });
        }
      }
      const note = isHdri && !hdrAvailable
        ? detail.provider === "openhdri"
          ? "OpenHDRI publishes 16K EXRs only. Live HDR exposure is disabled because 16K exceeds the safe 8K preview budget for most systems. The 4K tone-mapped panorama remains available; download the original EXR for your DCC."
          : "No standalone HDR source is published within the safe 8K live-preview budget. Tone-mapped 360° viewing is available when published; download the original for full HDR work, or refresh an older cached catalogue."
        : !isHdri && !maps.length
          ? "The provider supplies a native asset package, not separate browser-readable texture maps. Render previews and the original download remain available."
          : undefined;
      return { renders, maps, hdrAvailable, note };
    });
  }

  async highResolution(provider: PublicProviderId, id: string, type: string): Promise<MapPreview> {
    if (typeof type !== "string" || !type.trim() || type.length > 100) throw new Error("Invalid preview map type");
    return this.run(provider, id, `map:${type}`, async signal => {
      const detail = await this.detail(provider, id), assetId = publicJobId(provider, id);
      if (/^(hdri|hdr|hdri-element)$/.test(detail.type)) {
        if (provider === "openhdri" && !/^hdr/i.test(type)) {
          const poster = await this.openHdriPoster(detail, signal);
          if (!poster) throw new Error("OpenHDRI did not publish an environment preview");
          return { type, label: "Panorama preview", url: poster, assetId, panorama: detail.type !== "hdri-element", resolution: "Preview" };
        }
        if (provider === "ambientcg" && !/^hdr/i.test(type)) {
          const poster = await this.ambientCgPoster(detail, signal);
          if (!poster) throw new Error("ambientCG did not publish a panorama preview");
          return { type, label: detail.type === "hdri-element" ? "HDR element preview" : "Panorama preview", url: poster, assetId, panorama: detail.type !== "hdri-element", resolution: "HQ" };
        }
        if (!this.hdrSource(detail, false) || provider === "blenderkit" && !/^hdr/i.test(type)) {
          const published = detail.previews.find(preview => preview.type === "panorama") ?? detail.previews.find(preview => preview.type !== "hdr-source" && !preview.map);
          if (!published) throw new Error("No published panorama preview");
          const path = await this.file(detail, published.url, `published-panorama${extname(new URL(published.url).pathname) || ".jpg"}`, previewProgressKey.publicMap(assetId, type), signal);
          return { type, label: published.label, url: pathToFileURL(path).href, assetId, panorama: true };
        }
        const hdr = await this.bestHdr(detail, signal);
        const target = join(this.folder(detail), "tonemapped-hq.png"); await writeFile(target, toneMappedPng(hdr, 4096));
        return { type, label: "HDR preview", url: pathToFileURL(target).href, assetId, panorama: detail.type !== "hdri-element", resolution: `${Math.min(hdr.width, 4096)}` };
      }
      if (provider !== "ambientcg" || !detail.previews.some(preview => preview.map === type)) throw new Error("This asset does not publish a separate high-resolution map");
      const variants = detail.files.filter(file => /\.zip$/i.test(file.name) && file.resolution && (resolutionPixels(file.resolution) ?? Infinity) <= 8192 && file.bytes > 0 && file.bytes <= PUBLIC_PREVIEW_MAX_BYTES && /^(jpg|png)$/i.test(file.format ?? "")).sort((a, b) => (resolutionPixels(b.resolution!) ?? 0) - (resolutionPixels(a.resolution!) ?? 0) || (a.format === "png" ? -1 : 1));
      const variant = variants[0]; if (!variant) throw new Error("No map package fits the preview transfer budget");
      const zip = await this.file(detail, variant.url, `${safeSegment(variant.resolution!)}-${variant.format}.zip`, previewProgressKey.publicMap(assetId, type), signal, variant.bytes);
      const original = detail.previews.find(preview => preview.map === type)?.url ?? "";
      const token = type === "normal" && /NormalDX/i.test(original) ? "normaldx" : type === "normal" && /NormalGL/i.test(original) ? "normalgl" : type;
      const output = await extractMap(zip, join(this.folder(detail), `${safeSegment(type)}-${safeSegment(variant.resolution!)}`), token, signal);
      return { type, label: type, url: pathToFileURL(output).href, assetId, resolution: variant.resolution };
    });
  }
}
