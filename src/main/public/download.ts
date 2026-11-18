import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BatchStartResult, DownloadOverview, DownloadProgress } from "../../shared/types";
import { ambientCgPanoramaUrl, openHdriImageUrl, parsePublicJobId, publicJobId, publicProviderLabel, type PublicAssetDetail, type PublicDownloadOptions, type PublicFile, type PublicProviderId } from "../../shared/public-providers";
import { downloadFile, extractZip } from "../downloader";
import { DownloadCompletions } from "../download-completions";
import { DownloadStats } from "../download-stats";
import type { Logger } from "../logger";
import { safeSegment } from "./common";

interface Job extends DownloadProgress {
  provider: PublicProviderId;
  id: string;
  options: PublicDownloadOptions;
  abort?: AbortController;
  running?: Promise<void>;
  stats?: DownloadStats;
}

/** Select one provider-published delivery variant, never silently substitute a requested tier. */
export function publicManifest(detail: PublicAssetDetail, options: PublicDownloadOptions): PublicFile[] {
  let files = detail.files.filter(file => file.downloadable !== false && ["package", "hdri", "model", "texture"].includes(file.role));
  if (options.fileType) files = files.filter(file => file.fileType === options.fileType);
  if (options.format) files = files.filter(file => file.format?.toLowerCase() === options.format!.toLowerCase() || detail.provider === "blenderkit" && file.fileType?.toLowerCase() === options.format!.toLowerCase());
  if (options.resolution) files = files.filter(file => file.resolution?.toLowerCase() === options.resolution!.toLowerCase());
  else if (!options.fileType && files.some(file => file.resolution)) {
    const resolutions = files.map(file => file.resolution).filter((value): value is string => Boolean(value));
    const tier = resolutions.find(value => value.toLowerCase() === "2k") ?? resolutions[0];
    files = files.filter(file => file.resolution === tier);
  }
  if (files.length === 0) throw new Error("The selected resolution/format is unavailable. Choose a published file variant.");
  // Each adapter describes alternative packages, not dependencies. OpenHDRI's
  // color-checker EXR is the one published accessory that can accompany it.
  const selected = files[0];
  if (options.includeColorChecker && detail.provider === "openhdri") {
    const colorChecker = detail.files.find(file => file.role === "colorchart" && file.downloadable !== false);
    if (colorChecker) return [selected, colorChecker];
  }
  return [selected];
}

export class PublicDownloadManager {
  private readonly jobs = new Map<string, Job>();
  private readonly listeners = new Set<(progress: DownloadProgress) => void>();
  private readonly completions: DownloadCompletions;
  private running = 0;
  private receivedBytes = 0;
  private completed = 0;
  private peak = 0;
  private started = Date.now();
  private persistChain: Promise<void> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(
    private readonly statePath: string,
    historyPath: string,
    private readonly detail: (provider: PublicProviderId, id: string) => Promise<PublicAssetDetail>,
    private readonly libraryPath: (provider: PublicProviderId) => string,
    private readonly resolveUrl: (provider: PublicProviderId, url: string) => Promise<string>,
    private readonly logger: Logger,
    private readonly onLibraryChanged: (path: string) => void,
    private readonly transfer: typeof downloadFile = downloadFile
  ) {
    this.completions = new DownloadCompletions(historyPath);
    this.ready = this.restore();
  }

  private async restore(): Promise<void> {
    try {
      const records = JSON.parse(await readFile(this.statePath, "utf8")) as Job[];
      for (const record of records) {
        const parsed = parsePublicJobId(record.assetId);
        if (!parsed) continue;
        this.jobs.set(record.assetId, { ...record, ...parsed, options: record.options ?? {}, status: ["complete", "cancelled", "error"].includes(record.status) ? record.status : "paused", abort: undefined, running: undefined, stats: undefined });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.logger.warn("Public download queue could not be restored", { error });
    }
  }

  private persist(): void {
    const data = JSON.stringify([...this.jobs.values()].map(({ abort, running, stats, ...record }) => record));
    this.persistChain = this.persistChain.then(async () => {
      await writeFile(`${this.statePath}.tmp`, data, "utf8");
      await rename(`${this.statePath}.tmp`, this.statePath);
    }).catch(error => this.logger.error("Public download queue could not be saved", { error }));
  }

  onProgress(listener: (progress: DownloadProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private progress(job: Job): DownloadProgress {
    const { id, options, abort, running, stats, ...progress } = job;
    return { ...progress, diagnostics: stats?.snapshot(job.status === "downloading") };
  }
  list(): DownloadProgress[] { return [...this.jobs.values()].map(job => this.progress(job)); }
  has(id: string): boolean { return this.jobs.has(id); }
  private emit(job: Job): void { for (const listener of this.listeners) listener(this.progress(job)); }
  private status(job: Job, status: Job["status"], message: string): void {
    job.status = status; job.message = message; this.persist(); this.emit(job);
  }
  async start(assetId: string, options: PublicDownloadOptions = {}, provider?: PublicProviderId): Promise<void> {
    await this.ready;
    const parsed = parsePublicJobId(assetId) ?? (provider ? { provider, id: assetId } : null);
    if (!parsed) throw new Error("Invalid public provider asset id");
    const key = publicJobId(parsed.provider, parsed.id);
    const existing = this.jobs.get(key);
    if (existing?.running || existing && ["queued", "paused"].includes(existing.status)) return;
    const job: Job = { ...parsed, assetId: key, options, status: "queued", received: 0, total: 0, ratio: 0 };
    this.jobs.set(key, job); this.status(job, "queued", "Queued"); this.pump();
  }
  async startMany(ids: string[], options: PublicDownloadOptions = {}, provider?: PublicProviderId): Promise<BatchStartResult> {
    let queued = 0, skipped = 0;
    for (const id of new Set(ids)) {
      const key = provider && !parsePublicJobId(id) ? publicJobId(provider, id) : id;
      if (this.jobs.has(key) && !["error", "cancelled", "complete"].includes(this.jobs.get(key)!.status)) { skipped++; continue; }
      await this.start(id, options, provider); queued++;
    }
    return { queued, skipped };
  }
  async pause(id: string): Promise<void> {
    const job = this.jobs.get(id); if (!job || !["queued", "requesting", "downloading", "extracting"].includes(job.status)) return;
    this.status(job, "paused", "Paused"); job.abort?.abort(); await job.running;
  }
  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id); if (!job || ["complete", "cancelled"].includes(job.status)) return;
    this.status(job, "cancelled", "Cancelled"); job.abort?.abort(); await job.running;
  }
  async resume(id: string): Promise<void> {
    const job = this.jobs.get(id); if (!job || job.status !== "paused") return;
    await job.running; this.status(job, "queued", "Queued"); this.pump();
  }
  async retry(id: string): Promise<void> {
    const job = this.jobs.get(id); if (!job || !["error", "cancelled"].includes(job.status)) return;
    await job.running; this.status(job, "queued", "Queued"); this.pump();
  }
  async pauseAll(): Promise<void> { await Promise.all([...this.jobs.keys()].map(id => this.pause(id))); }
  async cancelAll(): Promise<void> { await Promise.all([...this.jobs.keys()].map(id => this.cancel(id))); }
  async resumeAll(): Promise<void> { for (const id of this.jobs.keys()) await this.resume(id); }
  clearFinished(): void { for (const [id, job] of this.jobs) if (!job.running && ["complete", "error", "cancelled"].includes(job.status)) this.jobs.delete(id); this.persist(); }
  private pump(): void {
    for (const job of this.jobs.values()) {
      if (this.running >= 2) break;
      if (job.status !== "queued" || job.running) continue;
      this.running++;
      job.running = this.run(job).finally(() => { this.running--; job.running = undefined; this.pump(); });
    }
  }
  private async run(job: Job): Promise<void> {
    const controller = new AbortController(); job.abort = controller;
    const signal = controller.signal;
    job.stats = new DownloadStats();
    try {
      this.status(job, "requesting", "Resolving provider files");
      const detail = await this.detail(job.provider, job.id); signal.throwIfAborted();
      job.name = detail.name;
      const files = publicManifest(detail, job.options);
      const folder = join(this.libraryPath(job.provider), safeSegment(detail.id));
      await mkdir(folder, { recursive: true });
      job.total = files.reduce((sum, file) => sum + file.bytes, 0); job.received = 0;
      for (const file of files) {
        const url = await this.resolveUrl(job.provider, file.url); signal.throwIfAborted();
        const target = join(folder, safeSegment(basename(file.name)));
        this.status(job, "downloading", `Downloading ${basename(target)}`);
        const existing = await stat(target).catch(() => null);
        if (!(file.bytes > 0 && existing?.size === file.bytes)) {
          await this.transfer(url, target, progress => {
            job.received = progress.received; job.total = progress.total || job.total; job.ratio = progress.ratio; this.emit(job);
          }, 60, signal, file.bytes || undefined, sample => {
            this.receivedBytes += sample.receivedBytes; job.stats?.record(file.name, sample);
          });
        }
        signal.throwIfAborted();
        if (/\.zip$/i.test(target)) { this.status(job, "extracting", "Extracting package"); await extractZip(target, folder); }
      }
      signal.throwIfAborted();
      const lowResPanorama = detail.provider === "ambientcg" && /^(hdri|hdr|hdri-element)$/i.test(detail.type)
        ? ambientCgPanoramaUrl(detail.previews, "LQ")
        : null;
      const thumbnail = detail.provider === "openhdri" ? openHdriImageUrl(detail.id, 512) : lowResPanorama ?? detail.thumbnail;
      if (thumbnail) {
        try {
          const thumbnailUrl = new URL(thumbnail);
          const requested = thumbnailUrl.searchParams.get("f")?.toLowerCase();
          const pathExtension = /\.(png|jpe?g|webp)(?:[?#]|$)/i.exec(thumbnailUrl.pathname)?.[1]?.toLowerCase().replace("jpeg", "jpg");
          const extension = requested === "png" || requested === "webp" ? requested : pathExtension ?? "jpg";
          await this.transfer(thumbnail, join(folder, `preview.${extension}`), undefined, 30, signal);
        }
        catch (error) { signal.throwIfAborted(); this.logger.warn("Provider thumbnail could not be cached", { provider: job.provider }); }
      }
      // No API keys, signed URLs or account-specific raw payloads in the local sidecar.
      const { raw, files: allFiles, ...summary } = detail;
      await writeFile(join(folder, `openbridge-${job.provider}.json`), JSON.stringify({ ...summary, downloadedAt: Date.now(), downloadOptions: job.options, downloadedFiles: files.map(file => ({ name: basename(file.name), bytes: file.bytes, resolution: file.resolution, format: file.format })) }, null, 2));
      job.path = folder; job.ratio = 1;
      this.completions.record({ assetId: job.assetId, name: detail.name, path: folder, bytes: job.received || job.total, completedAt: Date.now() });
      this.completed++; this.status(job, "complete", `${publicProviderLabel(job.provider)} download complete`); this.onLibraryChanged(folder);
    } catch (error) {
      if (!["paused", "cancelled"].includes(job.status)) {
        this.logger.error("Public provider download failed", { assetId: job.assetId, error });
        this.status(job, "error", error instanceof Error ? error.message : String(error));
      }
    } finally { job.abort = undefined; }
  }
  overview(): Pick<DownloadOverview, "history" | "session"> {
    const average = this.receivedBytes / Math.max(1, (Date.now() - this.started) / 1000);
    this.peak = Math.max(this.peak, average);
    return { history: this.completions.recent(), session: { receivedBytes: this.receivedBytes, completed: this.completed, averageBytesPerSecond: average, peakBytesPerSecond: this.peak } };
  }
  async close(): Promise<void> { await this.pauseAll(); await this.persistChain; this.completions.close(); }
}
