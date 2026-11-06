import { app } from "electron";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BatchStartResult,
  DownloadCompletion,
  DownloadOverview,
  DownloadProgress,
  DownloadStatus,
  PolyHavenAssetDetail,
  PolyHavenDownloadOptions,
  PolyHavenMapPreview,
  PoliigonHdrData
} from "../../shared/types";
import { previewProgressKey } from "../../shared/preview-keys";
import {
  polyHavenMapLabel,
  polyHavenMapRank,
  polyHavenPrimaryPreview,
  polyHavenResolutionValue
} from "../../shared/polyhaven";
import { DownloadCompletions } from "../download-completions";
import { DownloadStats, type TransferTelemetry } from "../download-stats";
import { downloadFile } from "../downloader";
import type { Logger } from "../logger";
import type { PolyHavenCatalog } from "./catalog";
import { decodeRadianceHdr, rgbaToHalfRgba, rgbToHalfRgba, type HdrTexture } from "../poliigon/hdr";
import { decodeExrRgba } from "@bb-studio/exr";

const PREFIX = "polyhaven:";
const FILE_CONCURRENCY = 6;
const ASSET_CONCURRENCY = 2;
const DOWNLOAD_TIMEOUT_SEC = 180;
const IMAGE_FORMATS = ["jpg", "jpeg", "png", "tif", "tiff", "exr", "hdr"];
const MODEL_FORMATS = ["blend", "fbx", "gltf", "usd", "obj"];

type Dict = Record<string, unknown>;

interface ManifestFile {
  url: string;
  name: string;
  bytes: number;
}

interface Job {
  assetId: string;
  polyId: string;
  name?: string;
  type?: string;
  status: DownloadStatus;
  received: number;
  total: number;
  ratio: number;
  message?: string;
  path?: string;
  bytes: number;
  options?: Partial<PolyHavenDownloadOptions>;
  cancelled: boolean;
  paused: boolean;
  abort?: AbortController;
  startedAt: number;
}

function dict(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    throw new Error(`Poly Haven download path escapes the asset folder: ${relative}`);
  }
  return target;
}

function jobId(id: string): string {
  return `${PREFIX}${id}`;
}

function parseId(assetId: string): string | null {
  const raw = assetId.startsWith(PREFIX) ? assetId.slice(PREFIX.length) : assetId;
  const id = raw.trim();
  return id && !id.includes("/") && !id.includes("\\") ? id : null;
}

function entryFile(value: unknown): { url: string; size: number; include: Dict } | null {
  const entry = dict(value);
  const url = text(entry.url);
  if (!url) return null;
  return {
    url,
    size: numberValue(entry.size),
    include: dict(entry.include)
  };
}

function mapEntry(files: Dict, code: string): Dict {
  return dict(files[code]);
}

function resolutionsForMap(files: Dict, code: string): string[] {
  return Object.keys(mapEntry(files, code))
    .filter(key => /^\d+(?:\.\d+)?k$/i.test(key))
    .sort((a, b) => polyHavenResolutionValue(a) - polyHavenResolutionValue(b));
}

function formatsForMap(files: Dict, code: string, resolution: string): string[] {
  const entry = dict(mapEntry(files, code)[resolution]);
  return Object.keys(entry).filter(key => IMAGE_FORMATS.includes(key.toLowerCase()));
}

function pickFormat(formats: string[], preferred?: string): string {
  if (preferred && formats.includes(preferred)) return preferred;
  for (const format of ["jpg", "png", "exr", "hdr", "tif", "tiff"]) {
    if (formats.includes(format)) return format;
  }
  return formats[0] ?? "jpg";
}

function fileFromMap(
  files: Dict,
  code: string,
  resolution: string,
  preferred?: string
): { format: string; url: string; size: number } | null {
  const formats = formatsForMap(files, code, resolution);
  if (formats.length === 0) return null;
  const format = pickFormat(formats, preferred);
  const entry = entryFile(dict(mapEntry(files, code)[resolution])[format]);
  return entry ? { format, url: entry.url, size: entry.size } : null;
}

function hdriResolutions(files: Dict): string[] {
  return Object.keys(dict(files.hdri))
    .filter(key => /^\d+(?:\.\d+)?k$/i.test(key))
    .sort((a, b) => polyHavenResolutionValue(a) - polyHavenResolutionValue(b));
}

function hdriFile(
  files: Dict,
  resolution: string,
  preferred?: string
): { format: string; url: string; size: number } | null {
  const entry = dict(dict(files.hdri)[resolution]);
  const formats = Object.keys(entry).filter(key => ["hdr", "exr"].includes(key.toLowerCase()));
  if (formats.length === 0) return null;
  const format = preferred && formats.includes(preferred)
    ? preferred
    : formats.includes("hdr")
      ? "hdr"
      : formats[0];
  const file = entryFile(entry[format]);
  return file ? { format, url: file.url, size: file.size } : null;
}

function modelPackage(
  files: Dict,
  format: string,
  resolution: string
): { name: string; url: string; size: number; include: Dict } | null {
  const packageEntry = dict(files[format]);
  if (Object.keys(packageEntry).length === 0) return null;
  const available = Object.keys(packageEntry)
    .filter(key => /^\d+(?:\.\d+)?k$/i.test(key))
    .sort((a, b) => polyHavenResolutionValue(a) - polyHavenResolutionValue(b));
  const chosen = available.includes(resolution)
    ? resolution
    : available[available.length - 1];
  if (!chosen) return null;
  const resolutionEntry = dict(packageEntry[chosen]);
  for (const [innerKey, value] of Object.entries(resolutionEntry)) {
    const file = entryFile(value);
    if (file) {
      const extension = extname(new URL(file.url).pathname) || `.${format}`;
      return {
        name: `${chosen}${extension}`,
        url: file.url,
        size: file.size,
        include: file.include
      };
    }
  }
  return null;
}

function defaultMapSelection(detail: PolyHavenAssetDetail): string[] {
  return [...detail.mapCodes]
    .filter(code => !["JPG", "HDR"].includes(code))
    .sort((a, b) => polyHavenMapRank(a) - polyHavenMapRank(b));
}

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
      provider: "polyhaven",
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

export class PolyHavenDownloadManager {
  private readonly jobs = new Map<string, Job>();
  private readonly mapPreviewCache = new Map<string, PolyHavenMapPreview[]>();
  private readonly hdrCache = new Map<string, HdrTexture>();
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
    private readonly catalog: PolyHavenCatalog,
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
      this.logger.error("Could not open Poly Haven download history", { error });
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

  async previewMaps(assetId: string): Promise<PolyHavenMapPreview[]> {
    const cached = this.mapPreviewCache.get(assetId);
    if (cached) return cached;
    const detail = await this.catalog.extended(assetId);
    const transfer = this.previewTransfer(
      previewProgressKey.polyMaps(assetId),
      `${detail.name} · Map previews`
    );
    transfer.begin("Requesting Poly Haven preview files");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      await mkdir(join(app.getPath("userData"), "polyhaven-map-previews", safeSegment(assetId)), {
        recursive: true
      });
      const results: PolyHavenMapPreview[] = [];
      if (detail.type === "hdris") {
        const previewUrl = hdriPreviewUrl(detail);
        if (previewUrl) {
          const destination = join(
            app.getPath("userData"),
            "polyhaven-map-previews",
            safeSegment(assetId),
            "tonemapped.webp"
          );
          const existing = await stat(destination).catch(() => null);
          transfer.setTotal(1);
          if (!existing?.isFile()) {
            await this.transfer(
              previewUrl,
              destination,
              progress => transfer.update("tonemapped", progress.received),
              60,
              controller.signal,
              undefined,
              transfer.telemetry("tonemapped")
            );
          } else {
            transfer.update("tonemapped", 1);
          }
          const url = pathToFileURL(destination).href;
          results.push({ type: "JPG", label: "Tone-mapped JPG", url });
          if (hdriFile(detail.files, pickHdriResolution(detail.files, "1k"), "hdr")) {
            results.push({ type: "HDR", label: "HDR (EXR)", url });
          }
        }
      } else {
        const codes = defaultMapSelection(detail).slice(0, 12);
        const files = detail.files;
        const tasks: Array<{ code: string; resolution: string; file: NonNullable<ReturnType<typeof fileFromMap>> }> = [];
        for (const code of codes) {
          const resolutions = resolutionsForMap(files, code);
          if (resolutions.length === 0) continue;
          const resolution = resolutions.find(value => polyHavenResolutionValue(value) >= 1024) ?? resolutions[0];
          const file = fileFromMap(files, code, resolution);
          if (file) tasks.push({ code, resolution, file });
        }
        transfer.setTotal(tasks.reduce((sum, task) => sum + task.file.size, 0));
        transfer.status("downloading", `Downloading ${tasks.length} map preview${tasks.length === 1 ? "" : "s"}`);
        for (const { code, resolution, file } of tasks) {
          try {
            const extension = file.format === "jpeg" ? "jpg" : file.format;
            const destination = join(
              app.getPath("userData"),
              "polyhaven-map-previews",
              safeSegment(assetId),
              `${safeSegment(code)}.${extension}`
            );
            const existing = await stat(destination).catch(() => null);
            if (!existing?.isFile() || (file.size > 0 && existing.size !== file.size)) {
              await this.transfer(
                file.url,
                destination,
                progress => transfer.update(`${code}:${resolution}`, progress.received),
                120,
                controller.signal,
                file.size || undefined,
                transfer.telemetry(`${code}:${resolution}`)
              );
            } else {
              transfer.update(`${code}:${resolution}`, file.size);
            }
            results.push({
              type: code,
              label: polyHavenMapLabel(code),
              url: pathToFileURL(destination).href,
              bytes: file.size
            });
          } catch (error) {
            this.logger.warn("Poly Haven map preview file failed", { assetId, code, error });
          }
        }
        results.sort((a, b) => polyHavenMapRank(a.type) - polyHavenMapRank(b.type));
      }
      if (results.length > 0) this.mapPreviewCache.set(assetId, results);
      transfer.finish(results.length > 0 ? "Map previews ready" : "No previewable maps");
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      transfer.fail(message);
      this.logger.warn("Poly Haven map previews unavailable", { assetId, error });
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async highResolutionMapPreview(assetId: string, mapType: string): Promise<PolyHavenMapPreview> {
    if (typeof mapType !== "string" || !mapType.trim()) throw new Error("Invalid map type");
    const detail = await this.catalog.extended(assetId);
    if (detail.type === "hdris") {
      if (/^hdr/i.test(mapType)) {
        const jpg = await this.cachedHdriPreview(detail);
        return { type: "HDR", label: "HDR (EXR)", url: jpg };
      }
      const tonemapped = text(dict(detail.files.tonemapped).url);
      if (!tonemapped) throw new Error("Poly Haven did not publish a tone-mapped HDRI preview");
      const destination = join(
        app.getPath("userData"),
        "polyhaven-map-highres",
        safeSegment(assetId),
        "tonemapped.jpg"
      );
      return this.downloadPreviewFile(
        previewProgressKey.polyMap(assetId, mapType),
        `${detail.name} · Tone-mapped JPG`,
        tonemapped,
        destination,
        "JPG"
      );
    }
    const code = detail.mapCodes.find(item => item === mapType)
      ?? detail.mapCodes.find(item => item.toLowerCase() === mapType.toLowerCase());
    if (!code) throw new Error("This map is not available for full-resolution preview");
    const resolutions = resolutionsForMap(detail.files, code);
    if (resolutions.length === 0) throw new Error("This map has no published image resolutions");
    const resolution = resolutions[resolutions.length - 1];
    const file = fileFromMap(detail.files, code, resolution);
    if (!file) throw new Error("This map has no published image formats");
    const extension = file.format === "jpeg" ? "jpg" : file.format;
    const destination = join(
      app.getPath("userData"),
      "polyhaven-map-highres",
      safeSegment(assetId),
      `${safeSegment(code)}_${safeSegment(resolution)}.${extension}`
    );
    return this.downloadPreviewFile(
      previewProgressKey.polyMap(assetId, mapType),
      `${detail.name} · ${polyHavenMapLabel(code)}`,
      file.url,
      destination,
      code,
      resolution,
      file.size
    );
  }

  private async cachedHdriPreview(detail: PolyHavenAssetDetail): Promise<string> {
    const previewUrl = hdriPreviewUrl(detail);
    if (!previewUrl) throw new Error("Poly Haven did not publish an HDRI preview");
    const destination = join(
      app.getPath("userData"),
      "polyhaven-map-previews",
      safeSegment(detail.id),
      "tonemapped.webp"
    );
    const existing = await stat(destination).catch(() => null);
    if (existing?.isFile()) return pathToFileURL(destination).href;
    return this.downloadPreviewFile(
      previewProgressKey.polyMaps(detail.id),
      `${detail.name} · Tone-mapped JPG`,
      previewUrl,
      destination,
      "JPG"
    ).then(result => result.url);
  }

  private async downloadPreviewFile(
    key: string,
    name: string,
    url: string,
    destination: string,
    type: string,
    resolution?: string,
    bytes = 0
  ): Promise<PolyHavenMapPreview> {
    const transfer = this.previewTransfer(key, name);
    transfer.begin("Requesting full-resolution preview");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300_000);
    try {
      await mkdir(dirname(destination), { recursive: true });
      const existing = await stat(destination).catch(() => null);
      transfer.setTotal(bytes);
      transfer.status("downloading", `Downloading ${resolution ?? "full"} preview`);
      if (!existing?.isFile() || (bytes > 0 && existing.size !== bytes)) {
        await this.transfer(
          url,
          destination,
          progress => transfer.update(destination, progress.received),
          300,
          controller.signal,
          bytes || undefined,
          transfer.telemetry(destination)
        );
      } else {
        transfer.update(destination, bytes);
      }
      transfer.finish(`${polyHavenMapLabel(type)} preview ready`);
      return {
        type,
        label: polyHavenMapLabel(type),
        url: pathToFileURL(destination).href,
        bytes
      };
    } catch (error) {
      transfer.fail(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async hdrPreview(assetId: string): Promise<PoliigonHdrData> {
    const detail = await this.catalog.extended(assetId);
    if (detail.type !== "hdris") throw new Error("HDR exposure is only available for HDRI assets");
    const cached = [...this.hdrCache.entries()].find(([key]) => key.startsWith(`${assetId}:`))?.[1];
    if (cached) {
      return { width: cached.width, height: cached.height, resolution: cached.resolution, data: cached.data };
    }
    const resolution = highestHdriResolution(detail.files);
    const file = hdriFile(detail.files, resolution);
    if (!file) throw new Error("Poly Haven did not return a decodable HDR/EXR source");
    const transfer = this.previewTransfer(previewProgressKey.polyHdr(assetId), `${detail.name} · HDR`);
    transfer.begin("Requesting HDR source");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600_000);
    try {
      const sourceDir = join(app.getPath("userData"), "polyhaven-hdr-source", safeSegment(assetId));
      await mkdir(sourceDir, { recursive: true });
      const extension = file.format === "exr" ? ".exr" : ".hdr";
      const sourceFile = join(sourceDir, `${safeSegment(resolution)}${extension}`);
      const existing = await stat(sourceFile).catch(() => null);
      transfer.setTotal(file.size);
      transfer.status("downloading", `Downloading ${resolution} HDR source`);
      if (!existing?.isFile() || (file.size > 0 && existing.size !== file.size)) {
        await this.transfer(
          file.url,
          sourceFile,
          progress => transfer.update(sourceFile, progress.received),
          300,
          controller.signal,
          file.size || undefined,
          transfer.telemetry(sourceFile)
        );
      } else {
        transfer.update(sourceFile, file.size);
      }
      transfer.status("extracting", `Decoding ${resolution} HDR source`);
      const buffer = await readFile(sourceFile);
      let hdr: HdrTexture;
      if (file.format === "exr") {
        const decoded = decodeExrRgba(buffer);
        hdr = {
          width: decoded.width,
          height: decoded.height,
          resolution,
          data: rgbaToHalfRgba(decoded.rgba)
        };
      } else {
        const decoded = decodeRadianceHdr(buffer);
        hdr = {
          width: decoded.width,
          height: decoded.height,
          resolution,
          data: rgbToHalfRgba(decoded.data)
        };
      }
      this.hdrCache.clear();
      this.hdrCache.set(`${assetId}:${resolution}`, hdr);
      transfer.finish(`${resolution} HDR source ready`);
      return { width: hdr.width, height: hdr.height, resolution: hdr.resolution, data: hdr.data };
    } catch (error) {
      transfer.fail(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async start(assetId: string, options?: Partial<PolyHavenDownloadOptions>): Promise<void> {
    const id = parseId(assetId);
    if (!id) throw new Error("Invalid Poly Haven asset id");
    const key = jobId(id);
    const existing = this.jobs.get(key);
    if (existing && !["error", "cancelled", "complete"].includes(existing.status)) {
      if (existing.status === "paused") await this.resume(key);
      return;
    }
    const job: Job = {
      assetId: key,
      polyId: id,
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
    options?: Partial<PolyHavenDownloadOptions>
  ): Promise<BatchStartResult> {
    let queued = 0;
    let skipped = 0;
    for (const assetId of [...new Set(assetIds.filter(Boolean))]) {
      const id = parseId(assetId);
      if (!id) {
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
      this.jobs.set(key, {
        assetId: key,
        polyId: id,
        status: "queued",
        received: 0,
        total: 0,
        ratio: 0,
        bytes: 0,
        options,
        cancelled: false,
        paused: false,
        startedAt: Date.now()
      });
      this.queue.push(key);
      queued += 1;
      this.emit(this.jobs.get(key)!);
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
      this.setStatus(job, "requesting", "Requesting download files");
      const detail = await this.catalog.extended(job.polyId);
      job.name = detail.name;
      job.type = detail.type;
      signal.throwIfAborted();

      const dirAsset = join(this.getLibraryPath(), safeSegment(detail.id));
      await mkdir(dirAsset, { recursive: true });
      const manifest = buildManifest(detail, job.options);
      if (manifest.length === 0) throw new Error("Poly Haven returned no downloadable files");
      job.total = manifest.reduce((sum, file) => sum + Math.max(0, file.bytes), 0);
      this.setStatus(job, "downloading", `Downloading ${manifest.length} file${manifest.length === 1 ? "" : "s"}`);

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

      const queue = [...manifest];
      const worker = async (): Promise<void> => {
        for (;;) {
          if (signal.aborted) throw signal.reason ?? new Error("Download cancelled");
          const file = queue.shift();
          if (!file) return;
          const target = targetWithin(dirAsset, file.name);
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
        Array.from({ length: Math.min(FILE_CONCURRENCY, manifest.length) }, () => worker())
      );
      signal.throwIfAborted();

      await this.writeMetadata(job, detail, dirAsset);
      await this.writePreview(detail, dirAsset, signal);

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
      this.notify(`Downloaded ${job.name ?? job.assetId} from Poly Haven`);
      this.onLibraryChanged();
    } catch (error) {
      if (job.cancelled) {
        this.setStatus(job, "cancelled", "Cancelled");
      } else if (job.paused) {
        this.setStatus(job, "paused", "Paused");
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error("Poly Haven download failed", { assetId: job.assetId, error });
        this.setStatus(job, "error", message);
        this.notify(`Poly Haven download failed: ${message}`, true);
      }
    } finally {
      job.abort = undefined;
    }
  }

  private async writeMetadata(job: Job, detail: PolyHavenAssetDetail, folder: string): Promise<void> {
    const payload = {
      provider: "polyhaven",
      id: detail.id,
      name: detail.name,
      type: detail.type,
      typeLabel: detail.typeLabel,
      category: detail.category,
      categories: detail.categories,
      tags: detail.tags,
      collections: detail.collections,
      description: detail.description,
      authors: detail.authors,
      attributes: detail.attributes,
      info: typeof detail.raw.info === "string" ? detail.raw.info : "",
      dateTaken: typeof detail.raw.date_taken === "number" ? detail.raw.date_taken : null,
      coords: Array.isArray(detail.raw.coords) ? detail.raw.coords : null,
      evsCap: typeof detail.raw.evs_cap === "number" ? detail.raw.evs_cap : null,
      whiteBalance: typeof detail.raw.whitebalance === "number" ? detail.raw.whitebalance : null,
      vault: detail.raw.vault ?? null,
      versionRequired: typeof detail.raw.version_required === "string" ? detail.raw.version_required : null,
      publishedAt: detail.publishedAt,
      thumbnail: detail.thumbnail,
      downloadedAt: Date.now(),
      resolution: job.options?.resolution ?? null,
      files: detail.mapCodes
    };
    await writeFile(
      join(folder, "openbridge-polyhaven.json"),
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  }

  private async writePreview(
    detail: PolyHavenAssetDetail,
    folder: string,
    signal: AbortSignal
  ): Promise<void> {
    if (!detail.thumbnail) return;
    try {
      const target = join(folder, "preview.png");
      const existing = await stat(target).catch(() => null);
      if (existing?.isFile()) return;
      const source = detail.type === "hdris"
        ? polyHavenPrimaryPreview(detail.thumbnail, 760) ?? detail.thumbnail
        : detail.thumbnail;
      const url = new URL(source);
      if (detail.type !== "hdris") {
        url.searchParams.set("width", "512");
        url.searchParams.set("height", "512");
        url.searchParams.set("format", "png");
      }
      await this.transfer(url.href, target, undefined, 60, signal);
    } catch (error) {
      this.logger.warn("Poly Haven thumbnail cache failed", { id: detail.id, error });
    }
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
      provider: "polyhaven",
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

function pickHdriResolution(files: Dict, preferred: string): string {
  const resolutions = hdriResolutions(files);
  if (resolutions.includes(preferred)) return preferred;
  if (resolutions.includes("4k")) return "4k";
  return resolutions[0] ?? preferred;
}

/** Highest published tier that is practical to decode into a half-float texture. */
function highestHdriResolution(files: Dict, maxWidth = 8192): string {
  const resolutions = hdriResolutions(files);
  const withinBudget = resolutions.filter(value => polyHavenResolutionValue(value) <= maxWidth);
  return (withinBudget.length > 0 ? withinBudget : resolutions).at(-1) ?? "2k";
}

function hdriPreviewUrl(detail: PolyHavenAssetDetail): string | null {
  const primary = polyHavenPrimaryPreview(detail.thumbnail, 1024);
  if (primary) return primary;
  if (!detail.thumbnail) return null;
  try {
    const url = new URL(detail.thumbnail);
    url.searchParams.set("width", "1024");
    url.searchParams.set("height", "512");
    url.searchParams.set("format", "webp");
    return url.href;
  } catch {
    return null;
  }
}

function buildManifest(detail: PolyHavenAssetDetail, options?: Partial<PolyHavenDownloadOptions>): ManifestFile[] {
  const files = detail.files;
  const output: ManifestFile[] = [];

  if (detail.type === "hdris") {
    const resolutions = hdriResolutions(files);
    const resolution = options?.resolution && resolutions.includes(options.resolution)
      ? options.resolution
      : pickHdriResolution(files, "4k");
    const file = hdriFile(files, resolution, options?.format);
    if (file) {
      output.push({
        url: file.url,
        name: `${detail.id}_${resolution}.${file.format}`,
        bytes: file.size
      });
    }
    return output;
  }

  if (detail.type === "models") {
    const modelFormat = options?.modelFormat
      ?? (detail.modelFormats.includes("gltf") ? "gltf" : detail.modelFormats[0]);
    if (modelFormat) {
      const packageFile = modelPackage(files, modelFormat, options?.resolution ?? "2k");
      if (packageFile) {
        output.push({
          url: packageFile.url,
          name: `${detail.id}_${packageFile.name}`,
          bytes: packageFile.size
        });
        for (const [name, value] of Object.entries(packageFile.include)) {
          const entry = entryFile(value);
          if (entry) output.push({ url: entry.url, name, bytes: entry.size });
        }
      }
    }
    return output;
  }

  const selected = options?.maps && options.maps.length > 0
    ? options.maps
    : defaultMapSelection(detail).map(type => ({ type, format: undefined }));
  for (const choice of selected) {
    const code = choice.type;
    const resolutions = resolutionsForMap(files, code);
    if (resolutions.length === 0) continue;
    const resolution = options?.resolution && resolutions.includes(options.resolution)
      ? options.resolution
      : resolutions.find(value => polyHavenResolutionValue(value) >= 2048) ?? resolutions[0];
    const file = fileFromMap(files, code, resolution, choice.format ?? options?.format);
    if (!file) continue;
    const extension = file.format === "jpeg" ? "jpg" : file.format;
    output.push({
      url: file.url,
      name: `${detail.id}_${safeSegment(code)}_${resolution}.${extension}`,
      bytes: file.size
    });
  }
  return output;
}
