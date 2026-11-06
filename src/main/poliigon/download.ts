import { app } from "electron";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BatchStartResult,
  DownloadCompletion,
  DownloadOverview,
  DownloadProgress,
  DownloadStatus,
  PoliigonDownloadOptions,
  PoliigonHdrData,
  PoliigonMapPreview
} from "../../shared/types";
import type { PoliigonAssetDetail } from "../../shared/types";
import { previewProgressKey } from "../../shared/preview-keys";
import { DownloadCompletions } from "../download-completions";
import { DownloadStats, type TransferTelemetry } from "../download-stats";
import { downloadFile } from "../downloader";
import { HttpError } from "../network";
import type { Logger } from "../logger";
import type { PoliigonAuthService } from "./auth";
import type { PoliigonCatalog } from "./catalog";
import { buildPoliigonDownloadPayload } from "./payload";
import { decodeRadianceHdr, rgbaToHalfRgba, rgbToHalfRgba, type HdrTexture } from "./hdr";
import { decodeExrRgba } from "@bb-studio/exr";

const PREFIX = "poliigon:";
const FILE_CONCURRENCY = 6;
const ASSET_CONCURRENCY = 2;
const DOWNLOAD_TIMEOUT_SEC = 120;
const MODEL_EXTENSIONS = new Set([".fbx", ".blend", ".max", ".c4d", ".obj", ".ma", ".skp"]);
const PREVIEW_SUFFIXES = [
  "_atlas",
  "_sphere",
  "_cylinder",
  "_fabric",
  "_preview1",
  "_preview2",
  "_preview3",
  "_preview01",
  "_preview02",
  "_preview03",
  "_flat",
  "_cube",
  "_grid"
];

interface ManifestFile {
  url: string;
  name: string;
  bytes: number;
  resolution?: string;
}

interface DynamicFile {
  name: string;
  contents: string;
}

interface Manifest {
  uuid: string;
  files: ManifestFile[];
  dynamicFiles: DynamicFile[];
}

interface Job {
  assetId: string;
  poliigonId: number;
  name?: string;
  status: DownloadStatus;
  received: number;
  total: number;
  ratio: number;
  message?: string;
  path?: string;
  bytes: number;
  options?: Partial<PoliigonDownloadOptions>;
  cancelled: boolean;
  paused: boolean;
  abort?: AbortController;
  startedAt: number;
}

function jobId(id: number): string {
  return `${PREFIX}${id}`;
}

function parseId(assetId: string): number | null {
  const raw = assetId.startsWith(PREFIX) ? assetId.slice(PREFIX.length) : assetId;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function safeSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "asset";
}

function safeRelativeName(value: string): string {
  const parts = value
    .replace(/\\/g, "/")
    .split("/")
    .filter(part => part && part !== "." && part !== "..");
  return parts.length > 0 ? parts.join("/") : "file.bin";
}

function targetWithin(root: string, relative: string): string {
  const base = resolve(root);
  const target = resolve(join(base, safeRelativeName(relative)));
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`Poliigon download path escapes the asset folder: ${relative}`);
  }
  return target;
}

function isPreview(name: string): boolean {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  return PREVIEW_SUFFIXES.some(suffix => base.endsWith(suffix)) || /_preview\d*$/.test(base);
}

function isModelFile(name: string): boolean {
  const lower = name.toLowerCase();
  return [...MODEL_EXTENSIONS].some(ext => lower.endsWith(ext));
}

const MAP_LABELS: Record<string, string> = {
  COL: "Base Color",
  BaseColor: "Base Color",
  Albedo: "Base Color",
  NRM: "Normal",
  Normal: "Normal",
  ROUGHNESS: "Roughness",
  Rough: "Roughness",
  METALNESS: "Metalness",
  Metallic: "Metalness",
  AO: "Ambient Occlusion",
  AmbientOcclusion: "Ambient Occlusion",
  ORM: "ORM",
  DISP: "Displacement",
  DISP16: "Displacement",
  Displacement: "Displacement",
  GLOSS: "Gloss",
  REFL: "Reflection",
  SPECULAR: "Specular",
  SSS: "Subsurface",
  TRANSMISSION: "Transmission",
  ALPHAMASKED: "Opacity Mask",
  OPACITY: "Opacity",
  EMISSION: "Emission",
  EMISSIVE: "Emission",
  HDR: "HDR",
  JPG: "Tone-mapped JPG"
};

function mapLabel(code: string): string {
  return MAP_LABELS[code] ?? code
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, value => value.toUpperCase());
}

function mapPreviewOrder(code: string): number {
  const order = [
    "COL",
    "BaseColor",
    "Albedo",
    "NRM",
    "Normal",
    "ROUGHNESS",
    "Rough",
    "METALNESS",
    "Metallic",
    "ORM",
    "AO",
    "AmbientOcclusion",
    "DISP16",
    "DISP",
    "Displacement",
    "GLOSS",
    "REFL",
    "SPECULAR",
    "SSS"
  ];
  const index = order.indexOf(code);
  return index >= 0 ? index : order.length;
}

function safeMapFile(code: string): string {
  return code.replace(/[^A-Za-z0-9_-]+/g, "_") || "map";
}

function resolutionValue(value: string): number {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 0;
  return /k$/i.test(value.trim()) ? number * 1000 : number;
}

/**
 * A rate limit or outage will fail every resolution tier, so previews stop
 * immediately instead of hammering the provider with fallback requests.
 */
function isProviderWideFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /HTTP (?:429|5\d\d)|rate-limit|temporarily unavailable|session expired/i.test(error.message);
}

function previewImageFiles(files: ManifestFile[]): ManifestFile[] {
  return files.filter(file =>
    /\.(png|jpe?g|webp)$/i.test(file.name) &&
    !isModelFile(file.name) &&
    !isPreview(file.name)
  );
}

function detailMapCodes(detail: PoliigonAssetDetail): string[] {
  const workflow = detail.maps.find(map => map.workflow)?.workflow;
  return [...new Set(
    detail.maps
      .filter(map => !workflow || map.workflow === workflow)
      .flatMap(map => (map.maps?.length ? map.maps : map.type ? [map.type] : []))
  )];
}

function mapFileForCode(files: ManifestFile[], code: string, used?: Set<string>): ManifestFile | undefined {
  const names = [code, MAP_LABELS[code]?.replace(/\s+/g, "")]
    .filter((value): value is string => Boolean(value))
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?:^|[_-])(?:${names.join("|")})(?:[_-]|\\.)`, "i");
  return files.find(file => !used?.has(file.name) && pattern.test(file.name));
}

function normalizeMapKey(value: string): string {
  const text = value.toLowerCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, string> = {
    col: "basecolor",
    color: "basecolor",
    colour: "basecolor",
    albedo: "basecolor",
    nrm: "normal",
    rough: "roughness",
    metallic: "metalness",
    ao: "ambientocclusion",
    disp: "displacement",
    disp16: "displacement",
    spec: "specular",
    refl: "reflection",
    sss: "subsurface"
  };
  return aliases[text] ?? text;
}

function resolveMapCode(detail: PoliigonAssetDetail, requested: string): string | null {
  const wanted = normalizeMapKey(requested);
  const codes = detailMapCodes(detail);
  return codes.find(code =>
    normalizeMapKey(code) === wanted ||
    normalizeMapKey(MAP_LABELS[code] ?? "") === wanted
  ) ?? null;
}

/**
 * Tracks a temporary preview transfer and publishes it through the normal
 * download-progress channel. Preview waits then show the same size, speed,
 * ETA and CDN source statistics as library downloads.
 */
class PreviewTransfer {
  private readonly perFile = new Map<string, number>();
  private readonly stats = new DownloadStats();
  private lastEmit = 0;
  private received = 0;
  private message = "";

  constructor(
    private readonly key: string,
    private readonly name: string,
    private total: number,
    private readonly publish: (progress: DownloadProgress) => void
  ) {}

  begin(message: string): void {
    this.status("requesting", message);
  }

  setTotal(total: number): void {
    this.total = Math.max(0, total);
  }

  update(file: string, received: number): void {
    this.perFile.set(file, Math.max(this.perFile.get(file) ?? 0, received));
    this.received = [...this.perFile.values()].reduce((sum, value) => sum + value, 0);
    const now = Date.now();
    if (now - this.lastEmit > 200) {
      this.lastEmit = now;
      this.publish(this.progress("downloading", this.message));
    }
  }

  telemetry(file: string): (sample: TransferTelemetry) => void {
    return sample => this.stats.record(file, sample);
  }

  status(status: DownloadStatus, message?: string): void {
    if (message) this.message = message;
    this.publish(this.progress(status, this.message));
  }

  finish(message = "Preview ready"): void {
    this.message = message;
    if (this.total > 0) this.received = Math.max(this.received, this.total);
    this.publish(this.progress("complete", message));
  }

  fail(message: string): void {
    this.message = message;
    this.publish(this.progress("error", message));
  }

  private progress(status: DownloadStatus, message?: string): DownloadProgress {
    return {
      assetId: this.key,
      provider: "poliigon",
      name: this.name,
      status,
      received: this.received,
      total: this.total,
      ratio: this.total > 0 ? Math.min(1, this.received / this.total) : 0,
      message,
      preview: true,
      diagnostics: this.stats.snapshot(status === "downloading" || status === "extracting")
    };
  }
}

export class PoliigonDownloadManager {
  private readonly jobs = new Map<string, Job>();
  private readonly mapPreviewCache = new Map<number, PoliigonMapPreview[]>();
  private readonly hdrCache = new Map<string, HdrTexture>();
  private readonly manifestCache = new Map<string, { manifest: Manifest; expiresAt: number }>();
  private readonly queue: string[] = [];
  private readonly listeners = new Set<(progress: DownloadProgress) => void>();
  private completions?: DownloadCompletions;
  private historyError?: string;
  private running = 0;
  private sessionBytes = 0;
  private sessionCompleted = 0;
  private sessionPeak = 0;
  private sessionStarted = 0;
  private sessionElapsed = 0;

  constructor(
    private readonly auth: PoliigonAuthService,
    private readonly catalog: PoliigonCatalog,
    private readonly logger: Logger,
    private readonly getLibraryPath: () => string,
    private readonly notify: (message: string, error?: boolean) => void,
    private readonly transfer: typeof downloadFile = downloadFile,
    private readonly onLibraryChanged: () => void = () => undefined
  ) {
    try {
      this.completions = new DownloadCompletions(join(app.getPath("userData"), "download-history.sqlite"));
    } catch (error) {
      this.historyError = "Download history is unavailable.";
      this.logger.error("Could not open Poliigon download history", { error });
    }
  }

  onProgress(callback: (progress: DownloadProgress) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private previewTransfer(key: string, name: string, total = 0): PreviewTransfer {
    return new PreviewTransfer(key, name, total, progress => {
      for (const listener of this.listeners) {
        try {
          listener(progress);
        } catch {
          // ignore listener failures
        }
      }
    });
  }

  has(assetId: string): boolean {
    return this.jobs.has(assetId);
  }

  list(): DownloadProgress[] {
    return [...this.jobs.values()].map(job => this.toProgress(job));
  }

  overview(): Pick<DownloadOverview, "history" | "historyError" | "session"> {
    let history: DownloadCompletion[] = [];
    try {
      history = this.completions?.recent() ?? [];
    } catch (error) {
      this.historyError = "Download history could not be read.";
      this.logger.error(this.historyError, { error });
    }
    const elapsed = this.sessionElapsed + (this.sessionStarted ? performance.now() - this.sessionStarted : 0);
    return {
      history,
      historyError: this.historyError,
      session: {
        receivedBytes: this.sessionBytes,
        completed: this.sessionCompleted,
        averageBytesPerSecond: elapsed > 0 ? this.sessionBytes / (elapsed / 1000) : 0,
        peakBytesPerSecond: this.sessionPeak
      }
    };
  }

  closeHistory(): void {
    this.completions?.close();
    this.completions = undefined;
  }

  async previewMaps(assetId: number): Promise<PoliigonMapPreview[]> {
    if (!this.auth.state().loggedIn) return [];
    const cached = this.mapPreviewCache.get(assetId);
    if (cached) return cached;
    const detail = this.catalog.extended(assetId);
    if (!["Models", "Textures", "Brushes", "HDRS"].includes(detail.type)) return [];
    const resolutions = [...detail.resolutions].sort((a, b) => resolutionValue(a) - resolutionValue(b));
    const resolution = resolutions.find(value => resolutionValue(value) >= 1000)
      ?? resolutions.at(-1)
      ?? "1K";
    const transfer = this.previewTransfer(
      previewProgressKey.maps(assetId),
      `${detail.name} · Map previews`
    );
    transfer.begin(`Requesting ${resolution} map previews`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75_000);
    try {
      const manifest = await this.requestManifest(
        detail,
        resolution,
        { nativeMesh: false },
        controller.signal,
        true
      );
      const images = previewImageFiles(manifest.files);
      if (images.length === 0) {
        transfer.finish("No map preview images published");
        return [];
      }
      const codes = detailMapCodes(detail);
      const selected: Array<{ code: string; file: ManifestFile }> = [];
      const used = new Set<string>();
      for (const code of codes) {
        const file = mapFileForCode(images, code, used);
        if (file) {
          used.add(file.name);
          selected.push({ code, file });
        }
      }
      if (selected.length === 0) {
        transfer.finish("No previewable maps for this asset");
        return [];
      }
      selected.sort((a, b) => mapPreviewOrder(a.code) - mapPreviewOrder(b.code));
      const slice = selected.slice(0, 8);
      transfer.setTotal(slice.reduce((sum, item) => sum + Math.max(0, item.file.bytes), 0));
      transfer.status("downloading", `Downloading ${slice.length} map preview${slice.length === 1 ? "" : "s"}`);
      const cacheDir = join(app.getPath("userData"), "poliigon-map-previews", String(assetId));
      await mkdir(cacheDir, { recursive: true });
      const results: PoliigonMapPreview[] = [];
      for (const { code, file } of slice) {
        try {
          const extension = file.name.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ".png";
          const destination = join(cacheDir, `${safeMapFile(code)}${extension}`);
          const existing = await stat(destination).catch(() => null);
          if (!existing?.isFile() || (file.bytes > 0 && existing.size !== file.bytes)) {
            await this.transfer(
              file.url,
              destination,
              progress => transfer.update(file.name, progress.received),
              60,
              controller.signal,
              file.bytes,
              transfer.telemetry(file.name)
            );
          } else {
            transfer.update(file.name, file.bytes);
          }
          results.push({
            type: code,
            label: mapLabel(code),
            url: pathToFileURL(destination).href,
            bytes: file.bytes
          });
        } catch (error) {
          this.logger.warn("Poliigon map preview file failed", { assetId, code, error });
        }
      }
      if (results.length > 0 && detail.type === "HDRS") {
        const jpg = results.find(item => normalizeMapKey(item.type) === "jpg");
        const hdrCode = codes.find(item => normalizeMapKey(item) === "hdr");
        if (jpg && hdrCode) {
          results.push({
            type: hdrCode,
            label: "HDR (EXR)",
            url: jpg.url,
            bytes: jpg.bytes
          });
        }
      }
      if (results.length > 0) this.mapPreviewCache.set(assetId, results);
      transfer.finish("Map previews ready");
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      transfer.fail(message);
      this.logger.warn("Poliigon map previews unavailable", { assetId, error });
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async highResolutionMapPreview(assetId: number, mapType: string): Promise<PoliigonMapPreview> {
    if (!this.auth.state().loggedIn) throw new Error("Sign in to Poliigon to view full-resolution maps");
    if (typeof mapType !== "string" || !mapType.trim()) throw new Error("Invalid map type");
    const detail = this.catalog.extended(assetId);
    if (!["Models", "Textures", "Brushes", "HDRS"].includes(detail.type)) {
      throw new Error("Full-resolution map previews are only available for assets with texture maps");
    }
    const code = resolveMapCode(detail, mapType);
    if (!code) throw new Error("This map is not available for full-resolution preview");
    // HDRIs use the HDR map for exposure but the JPG/PNG map as the fast display image.
    const imageCode = detail.type === "HDRS" && normalizeMapKey(code) === "hdr"
      ? resolveMapCode(detail, "JPG")
      : code;
    if (!imageCode) throw new Error("This map has no previewable image at full resolution");
    const resolutions = [...detail.resolutions].sort((a, b) => resolutionValue(b) - resolutionValue(a));
    const transfer = this.previewTransfer(
      previewProgressKey.map(assetId, mapType),
      `${detail.name} · ${mapLabel(code)}`
    );
    transfer.begin("Requesting full-resolution preview");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    let lastError: unknown;
    try {
      const cacheDir = join(app.getPath("userData"), "poliigon-map-highres", String(assetId));
      await mkdir(cacheDir, { recursive: true });
      for (const resolution of resolutions) {
        try {
          const manifest = await this.requestManifest(
            detail,
            resolution,
            { nativeMesh: false },
            controller.signal,
            true
          );
          const file = mapFileForCode(previewImageFiles(manifest.files), imageCode);
          if (!file) continue;
          const extension = file.name.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ".jpg";
          const destination = join(cacheDir, `${safeMapFile(code)}_${safeMapFile(resolution)}${extension}`);
          const existing = await stat(destination).catch(() => null);
          transfer.setTotal(file.bytes);
          transfer.status("downloading", `Downloading ${resolution} ${mapLabel(code)}`);
          if (!existing?.isFile() || (file.bytes > 0 && existing.size !== file.bytes)) {
            await this.transfer(
              file.url,
              destination,
              progress => transfer.update(file.name, progress.received),
              120,
              controller.signal,
              file.bytes,
              transfer.telemetry(file.name)
            );
          } else {
            transfer.update(file.name, file.bytes);
          }
          transfer.finish(`${mapLabel(code)} preview ready`);
          return {
            type: code,
            label: mapLabel(code),
            url: pathToFileURL(destination).href,
            bytes: file.bytes
          };
        } catch (error) {
          if (isProviderWideFailure(error)) throw error;
          lastError = error;
        }
      }
      const message = lastError instanceof Error
        ? lastError.message
        : "Poliigon did not return a high-resolution image for this map";
      transfer.fail(message);
      throw lastError instanceof Error ? lastError : new Error(message);
    } finally {
      clearTimeout(timer);
    }
  }

  async hdrPreview(assetId: number): Promise<PoliigonHdrData> {
    if (!this.auth.state().loggedIn) throw new Error("Sign in to Poliigon to view HDR exposure");
    const detail = this.catalog.extended(assetId);
    if (detail.type !== "HDRS") throw new Error("HDR exposure is only available for HDRI assets");
    const cached = [...this.hdrCache.entries()].find(([key]) => key.startsWith(`${assetId}:`))?.[1];
    const hdr = cached ?? await this.loadHdrSource(assetId, detail);
    return { width: hdr.width, height: hdr.height, resolution: hdr.resolution, data: hdr.data };
  }

  private async loadHdrSource(assetId: number, detail: PoliigonAssetDetail): Promise<HdrTexture> {
    // HDR exposure is served at the highest published resolution so it matches
    // the maximum-resolution JPG/PNG default; lower tiers are only fallbacks.
    const resolutions = [...new Set(detail.resolutions)]
      .filter(value => resolutionValue(value) > 0)
      .sort((a, b) => resolutionValue(b) - resolutionValue(a));
    const transfer = this.previewTransfer(previewProgressKey.hdr(assetId), `${detail.name} · HDR`);
    transfer.begin("Requesting HDR source");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600_000);
    let lastError: unknown;
    try {
      const sourceDir = join(app.getPath("userData"), "poliigon-hdr-source", String(assetId));
      await mkdir(sourceDir, { recursive: true });
      for (const resolution of resolutions) {
        try {
          const cacheKey = `${assetId}:${resolution}`;
          const existingHdr = this.hdrCache.get(cacheKey);
          if (existingHdr) return existingHdr;
          const manifest = await this.requestManifest(
            detail,
            resolution,
            { nativeMesh: false },
            controller.signal,
            true
          );
          const radianceFile = manifest.files.find(item => /\.hdr$/i.test(item.name));
          const exrFile = manifest.files.find(item => /\.exr$/i.test(item.name));
          const file = radianceFile ?? exrFile;
          if (!file) {
            this.logger.info("Poliigon HDR manifest had no HDR/EXR file", {
              assetId,
              resolution,
              files: manifest.files.map(item => item.name)
            });
            continue;
          }
          const extension = radianceFile ? ".hdr" : ".exr";
          const sourceFile = join(sourceDir, `${safeMapFile(resolution)}${extension}`);
          const existing = await stat(sourceFile).catch(() => null);
          transfer.setTotal(file.bytes);
          if (!existing?.isFile() || (file.bytes > 0 && existing.size !== file.bytes)) {
            this.logger.info("Downloading Poliigon HDR source", {
              assetId,
              resolution,
              bytes: file.bytes
            });
            transfer.status("downloading", `Downloading ${resolution} HDR source`);
            await this.transfer(
              file.url,
              sourceFile,
              progress => transfer.update(file.name, progress.received),
              180,
              controller.signal,
              file.bytes,
              transfer.telemetry(file.name)
            );
          } else {
            transfer.update(file.name, file.bytes);
          }
          transfer.status("extracting", `Decoding ${resolution} HDR source`);
          const buffer = await readFile(sourceFile);
          let hdr: HdrTexture;
          if (radianceFile) {
            const decoded = decodeRadianceHdr(buffer);
            hdr = {
              width: decoded.width,
              height: decoded.height,
              resolution,
              data: rgbToHalfRgba(decoded.data)
            };
          } else {
            const decoded = decodeExrRgba(buffer);
            hdr = {
              width: decoded.width,
              height: decoded.height,
              resolution,
              data: rgbaToHalfRgba(decoded.rgba)
            };
          }
          this.hdrCache.clear();
          this.hdrCache.set(cacheKey, hdr);
          this.logger.info("Poliigon HDR source ready", {
            assetId,
            resolution,
            width: hdr.width,
            height: hdr.height,
            bytes: hdr.data.byteLength
          });
          transfer.finish(`${resolution} HDR source ready`);
          return hdr;
        } catch (error) {
          if (isProviderWideFailure(error)) throw error;
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("Poliigon did not return a decodable HDR/EXR image for this asset");
    } catch (error) {
      transfer.fail(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async start(assetId: string, options?: Partial<PoliigonDownloadOptions>): Promise<void> {
    if (!this.auth.state().loggedIn) throw new Error("Sign in to Poliigon to download assets");
    const id = parseId(assetId);
    if (id === null) throw new Error("Invalid Poliigon asset id");
    const key = jobId(id);
    const existing = this.jobs.get(key);
    if (existing && !["error", "cancelled", "complete"].includes(existing.status)) {
      if (existing.status === "paused") await this.resume(key);
      return;
    }
    const job: Job = {
      assetId: key,
      poliigonId: id,
      status: "queued",
      received: 0,
      total: 0,
      ratio: 0,
      bytes: 0,
      options,
      cancelled: false,
      paused: false,
      startedAt: Date.now()
    };
    this.jobs.set(key, job);
    this.queue.push(key);
    this.emit(job);
    this.pump();
  }

  async startMany(
    assetIds: string[],
    options?: Partial<PoliigonDownloadOptions>
  ): Promise<BatchStartResult> {
    if (!this.auth.state().loggedIn) throw new Error("Sign in to Poliigon to download assets");
    let queued = 0;
    let skipped = 0;
    for (const assetId of [...new Set(assetIds.filter(Boolean))]) {
      const id = parseId(assetId);
      if (id === null) {
        skipped += 1;
        continue;
      }
      const key = jobId(id);
      const existing = this.jobs.get(key);
      if (existing?.status === "complete") {
        skipped += 1;
        continue;
      }
      if (existing && !["error", "cancelled"].includes(existing.status)) {
        skipped += 1;
        continue;
      }
      const job: Job = {
        assetId: key,
        poliigonId: id,
        status: "queued",
        received: 0,
        total: 0,
        ratio: 0,
        bytes: 0,
        options,
        cancelled: false,
        paused: false,
        startedAt: Date.now()
      };
      this.jobs.set(key, job);
      this.queue.push(key);
      queued += 1;
      this.emit(job);
    }
    if (queued > 0) this.pump();
    return { queued, skipped };
  }

  async retry(assetId: string): Promise<void> {
    const job = this.jobs.get(assetId);
    if (!job || job.status !== "error") throw new Error("Only failed downloads can be retried");
    await this.start(job.assetId, job.options);
  }

  cancel(assetId: string): void {
    const job = this.jobs.get(assetId);
    if (!job) return;
    job.cancelled = true;
    job.paused = false;
    job.abort?.abort();
    job.status = "cancelled";
    job.message = "Cancelled";
    this.emit(job);
  }

  async pause(assetId: string): Promise<void> {
    const job = this.jobs.get(assetId);
    if (!job || job.status === "complete" || job.status === "cancelled") return;
    job.paused = true;
    job.abort?.abort();
    job.status = "paused";
    job.message = "Paused";
    this.emit(job);
  }

  async resume(assetId: string): Promise<void> {
    const job = this.jobs.get(assetId);
    if (!job || job.status !== "paused") return;
    job.paused = false;
    job.cancelled = false;
    job.status = "queued";
    job.message = "Queued";
    if (!this.queue.includes(assetId)) this.queue.push(assetId);
    this.emit(job);
    this.pump();
  }

  async cancelAll(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (!["complete", "error", "cancelled"].includes(job.status)) this.cancel(job.assetId);
    }
    this.queue.length = 0;
  }

  async pauseAll(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (["queued", "requesting", "downloading"].includes(job.status)) await this.pause(job.assetId);
    }
  }

  async resumeAll(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.status === "paused") await this.resume(job.assetId);
    }
  }

  clearFinished(): void {
    for (const [assetId, job] of this.jobs) {
      if (["complete", "error", "cancelled"].includes(job.status)) this.jobs.delete(assetId);
    }
  }

  private pump(): void {
    while (this.running < ASSET_CONCURRENCY && this.queue.length > 0) {
      const assetId = this.queue.shift();
      if (!assetId) break;
      const job = this.jobs.get(assetId);
      if (!job || job.cancelled || job.paused) continue;
      this.running += 1;
      if (!this.sessionStarted) this.sessionStarted = performance.now();
      void this.runJob(job).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
    if (this.running === 0 && this.queue.length === 0 && this.sessionStarted) {
      this.sessionElapsed += performance.now() - this.sessionStarted;
      this.sessionStarted = 0;
    }
  }

  private async runJob(job: Job): Promise<void> {
    job.abort = new AbortController();
    const signal = job.abort.signal;
    try {
      this.setStatus(job, "requesting", "Requesting download URLs");
      const detail = this.catalog.extended(job.poliigonId);
      job.name = detail.name;
      const resolution = this.resolveResolution(detail, job.options?.resolution);
      signal.throwIfAborted();

      const dirAsset = join(this.getLibraryPath(), safeSegment(detail.assetName));
      await mkdir(dirAsset, { recursive: true });
      const dirSize = detail.convention === 0
        ? dirAsset
        : join(dirAsset, safeSegment(resolution));
      await mkdir(dirSize, { recursive: true });

      const perFile = new Map<string, number>();
      let lastEmit = 0;
      const update = (name: string, received: number): void => {
        perFile.set(name, Math.max(perFile.get(name) ?? 0, received));
        job.received = [...perFile.values()].reduce((sum, value) => sum + value, 0);
        job.ratio = job.total > 0 ? Math.min(1, job.received / job.total) : 0;
        const now = Date.now();
        if (now - lastEmit > 200) {
          lastEmit = now;
          this.emit(job);
        }
      };

      for (let attempt = 0; ; attempt++) {
        let manifest: Manifest;
        try {
          manifest = await this.requestManifest(detail, resolution, job.options, signal);
        } catch (error) {
          if (error instanceof HttpError && error.status === 403 && attempt < 2) {
            this.logger.warn("Poliigon download manifest URL expired; refreshing", {
              assetId: detail.id,
              attempt: attempt + 1
            });
            continue;
          }
          throw error;
        }
        signal.throwIfAborted();
        if (manifest.files.length === 0) throw new Error("Poliigon returned no downloadable files");
        job.total = manifest.files.reduce((sum, file) => sum + Math.max(0, file.bytes), 0);
        job.received = [...perFile.values()].reduce((sum, value) => sum + value, 0);
        job.ratio = job.total > 0 ? Math.min(1, job.received / job.total) : 0;
        this.setStatus(job, "downloading", `Downloading ${manifest.files.length} file${manifest.files.length === 1 ? "" : "s"}`);

        try {
          const queue = [...manifest.files];
          const worker = async (): Promise<void> => {
            for (;;) {
              if (signal.aborted) throw signal.reason ?? new Error("Download cancelled");
              const file = queue.shift();
              if (!file) return;
              const folder = isModelFile(file.name) || isPreview(file.name)
                ? dirAsset
                : dirSize;
              const target = targetWithin(folder, file.name);
              const existing = await stat(target).catch(() => null);
              if (existing?.isFile() && file.bytes > 0 && existing.size === file.bytes) {
                update(file.name, file.bytes);
                continue;
              }
              await this.transfer(
                file.url,
                target,
                progress => update(file.name, progress.received),
                DOWNLOAD_TIMEOUT_SEC,
                signal,
                file.bytes > 0 ? file.bytes : undefined
              );
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(FILE_CONCURRENCY, manifest.files.length) }, () => worker())
          );
          signal.throwIfAborted();

          if (manifest.dynamicFiles.length > 0) {
            this.setStatus(job, "downloading", "Writing generated material files");
            for (const dynamic of manifest.dynamicFiles) {
              const target = targetWithin(dirSize, dynamic.name);
              await writeFile(target, dynamic.contents, "utf8");
            }
          }
          break;
        } catch (error) {
          if (error instanceof HttpError && error.status === 403 && attempt < 2) {
            this.logger.warn("Poliigon file URL expired; refreshing manifest", {
              assetId: detail.id,
              attempt: attempt + 1
            });
            continue;
          }
          throw error;
        }
      }

      const bytes = job.total > 0 ? job.total : job.received;
      job.received = bytes;
      job.ratio = 1;
      job.bytes = bytes;
      job.path = dirAsset;
      const elapsedSec = Math.max(1, (Date.now() - job.startedAt) / 1000);
      this.sessionPeak = Math.max(this.sessionPeak, bytes / elapsedSec);
      this.completions?.record({
        assetId: job.assetId,
        name: job.name ?? job.assetId,
        path: dirAsset,
        bytes,
        completedAt: Date.now()
      });
      this.sessionBytes += bytes;
      this.sessionCompleted += 1;
      this.setStatus(job, "complete", "Download complete");
      this.notify(`Downloaded ${job.name ?? job.assetId} from Poliigon`);
      this.onLibraryChanged();
    } catch (error) {
      if (job.cancelled) {
        this.setStatus(job, "cancelled", "Cancelled");
      } else if (job.paused) {
        this.setStatus(job, "paused", "Paused");
      } else {
        const message = error instanceof HttpError && error.status === 401
          ? "Poliigon session expired. Sign in again."
          : error instanceof Error ? error.message : String(error);
        this.logger.error("Poliigon download failed", { assetId: job.assetId, error });
        this.setStatus(job, "error", message);
        this.notify(`Poliigon download failed: ${message}`, true);
      }
    } finally {
      job.abort = undefined;
    }
  }

  private resolveResolution(detail: PoliigonAssetDetail, requested?: string): string {
    const resolutions = detail.resolutions;
    if (requested && resolutions.includes(requested)) return requested;
    if (resolutions.includes("2K")) return "2K";
    return resolutions.at(-1) ?? "2K";
  }

  private async requestManifest(
    detail: PoliigonAssetDetail,
    resolution: string,
    options: Partial<PoliigonDownloadOptions> | undefined,
    signal: AbortSignal,
    cache = false
  ): Promise<Manifest> {
    const cacheKey = `${detail.id}:${resolution}:${JSON.stringify(options ?? {})}`;
    if (cache) {
      const hit = this.manifestCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) return hit.manifest;
      this.manifestCache.delete(cacheKey);
    }
    const body = buildPoliigonDownloadPayload(detail, resolution, options);
    const response = await this.auth.apiRequest(
      "/assets/download",
      {
        method: "POST",
        body
      },
      signal
    );
    if (!response.ok) {
      if (response.status === 401) throw new Error("Poliigon session expired. Sign in again.");
      if (response.status === 403) throw new HttpError(403, "Poliigon download");
      if (response.status === 429) throw new Error("Poliigon is rate-limiting requests. Wait a minute, then retry.");
      if ([502, 503, 504].includes(response.status)) {
        throw new Error(`Poliigon is temporarily unavailable (HTTP ${response.status}). Try again shortly.`);
      }
      const code = typeof response.body.error_code === "string" ? response.body.error_code : "";
      if (code === "insufficient-credits") throw new Error("Not enough credits for this asset.");
      const message = typeof response.body.message === "string" ? response.body.message : response.error;
      throw new Error(message || "Poliigon download request failed");
    }

    const payload = Array.isArray(response.body.payload) ? response.body.payload : [];
    const entry = payload[0] && typeof payload[0] === "object" ? (payload[0] as Record<string, unknown>) : {};
    const files = (Array.isArray(entry.files) ? entry.files : [])
      .map(file => {
        const item = file && typeof file === "object" ? (file as Record<string, unknown>) : {};
        return {
          url: typeof item.url === "string" ? item.url : "",
          name: typeof item.name === "string" ? item.name : "",
          bytes: Number(item.bytes ?? 0) || 0,
          resolution: typeof item.resolution === "string" ? item.resolution : undefined
        };
      })
      .filter(file => file.url && file.name);
    const dynamicFiles = (Array.isArray(entry.dynamic_files) ? entry.dynamic_files : [])
      .map(file => {
        const item = file && typeof file === "object" ? (file as Record<string, unknown>) : {};
        return {
          name: typeof item.name === "string" ? item.name : "",
          contents: typeof item.contents === "string" ? item.contents : ""
        };
      })
      .filter(file => file.name);
    const manifest: Manifest = {
      uuid: typeof response.body.uuid === "string" ? response.body.uuid : "",
      files,
      dynamicFiles
    };
    if (cache) {
      this.manifestCache.set(cacheKey, { manifest, expiresAt: Date.now() + 120_000 });
      if (this.manifestCache.size > 24) {
        const oldest = this.manifestCache.keys().next().value;
        if (oldest) this.manifestCache.delete(oldest);
      }
    }
    return manifest;
  }

  private setStatus(job: Job, status: DownloadStatus, message?: string): void {
    job.status = status;
    if (message) job.message = message;
    this.emit(job);
  }

  private emit(job: Job): void {
    const progress = this.toProgress(job);
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch {
        // ignore listener failures
      }
    }
  }

  private toProgress(job: Job): DownloadProgress {
    return {
      assetId: job.assetId,
      provider: "poliigon",
      name: job.name,
      status: job.status,
      received: job.received,
      total: job.total,
      ratio: job.ratio,
      message: job.message,
      path: job.path
    };
  }
}
