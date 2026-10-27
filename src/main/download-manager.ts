import { app } from "electron";
import { cp, mkdir, readFile, readdir, rm, stat, statfs, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  assetDefaultsKind,
  canonicalMapType,
  DEFAULT_MAP_TYPES
} from "../shared/download-defaults";
import type {
  AppSettings,
  BatchStartResult,
  DownloadMapFormat,
  DownloadMapOption,
  DownloadOptions,
  DownloadProgress,
  DownloadStatus,
  ExtendedAsset,
  TextureFormat
} from "../shared/types";
import type { AuthService } from "./auth";
import { downloadFile, extractZip } from "./downloader";
import type { DownloadResponse, FileDescriptor, LegacyApi } from "./legacy-api";
import type { Logger } from "./logger";

interface Job {
  assetId: string;
  name?: string;
  status: DownloadStatus;
  received: number;
  total: number;
  ratio: number;
  message?: string;
  path?: string;
  options?: Partial<DownloadOptions>;
  cancelled: boolean;
  paused: boolean;
  abort?: AbortController;
}

const RESOLUTIONS = [1024, 2048, 4096, 8192];
const LOD_KEYS = Array.from({ length: 9 }, (_, index) => index);
const FILE_CONCURRENCY = 4;
const DOWNLOAD_TIMEOUT_SEC = 30;
const DOWNLOAD_RETRIES = 3;


const CANONICAL_MAP_ORDER = [
  "albedo",
  "ao",
  "normal",
  "normalbump",
  "normalobject",
  "displacement",
  "bump",
  "roughness",
  "metalness",
  "specular",
  "gloss",
  "diffuse",
  "cavity",
  "curvature",
  "opacity",
  "translucency",
  "transmission",
  "fuzz",
  "thickness",
  "mask",
  "brush"
];

function mimeForTexture(format: TextureFormat | undefined): DownloadMapFormat {
  return format === "exr" ? "image/x-exr" : "image/jpeg";
}

function mimeForMesh(format: DownloadOptions["meshFormat"]): string {
  return format === "abc" ? "application/x-abc" : "application/x-fbx";
}

function isFileDescriptor(value: unknown): value is FileDescriptor {
  return Boolean(value) && typeof value === "object" && typeof (value as FileDescriptor).uri === "string";
}

function flattenFiles(value: unknown, out: FileDescriptor[] = []): FileDescriptor[] {
  if (Array.isArray(value)) {
    for (const item of value) flattenFiles(item, out);
  } else if (isFileDescriptor(value)) {
    out.push(value);
  }
  return out;
}

function safeSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "asset";
}

function safeRelativePath(value: string, fallback: string): string {
  const parts = value
    .replace(/\\/g, "/")
    .split("/")
    .filter(part => part && part !== "." && part !== "..");
  return parts.length > 0 ? parts.join("/") : fallback;
}

function relativePath(descriptor: FileDescriptor, assetId: string): string {
  const fallback = `${assetId}.bin`;
  const raw = (descriptor.saveAs ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (raw && !/^[a-zA-Z]:\//.test(raw) && !raw.startsWith("/")) {
    return safeRelativePath(raw, fallback);
  }
  if (raw) {
    const parts = raw.split("/").filter(Boolean);
    const index = parts.findIndex(part => part === assetId);
    if (index >= 0 && index < parts.length - 1) {
      return safeRelativePath(parts.slice(index + 1).join("/"), fallback);
    }
    return safeRelativePath(basename(raw), fallback);
  }
  try {
    const url = new URL(descriptor.uri);
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map(part => decodeURIComponent(part));
    const last = parts.slice(-2);
    if (last[0] === assetId && last[1]) return safeRelativePath(last[1], fallback);
    return safeRelativePath(last.join("/"), fallback);
  } catch {
    return fallback;
  }
}

function mapDefinitions(asset: ExtendedAsset): Array<{ type: string }> {
  const definitions =
    (asset.components && asset.components.length > 0
      ? asset.components
      : asset.maps && asset.maps.length > 0
        ? asset.maps
        : asset.billboards) ?? [];
  return definitions.filter((definition): definition is { type: string } =>
    Boolean(definition) && typeof definition.type === "string"
  );
}

export function availableMapTypes(asset: ExtendedAsset): string[] {
  const types = new Set(
    mapDefinitions(asset).map(definition => definition.type.toLowerCase())
  );
  if (types.size === 0) {
    CANONICAL_MAP_ORDER.forEach(type => types.add(type));
  }
  return [...types].sort((a, b) => {
    const ai = CANONICAL_MAP_ORDER.indexOf(a);
    const bi = CANONICAL_MAP_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function exrAccess(asset: ExtendedAsset): string {
  if ((asset.points ?? 0) === 0) return "full";
  const access = asset.acl?.exrAccess;
  return typeof access === "string" ? access : "none";
}

function canDownloadExr(asset: ExtendedAsset, type: string): boolean {
  const access = exrAccess(asset);
  if (access === "full") return true;
  return type === "displacement" && access === "displacement";
}

function assetLodIndices(asset: ExtendedAsset): number[] {
  const usesModelLods =
    asset.version === 2 || (!asset.meshes?.length && Boolean(asset.models?.length));
  if (usesModelLods) {
    const indices = new Set<number>();
    for (const model of asset.models ?? []) {
      if (typeof model.lod === "number") indices.add(model.lod);
    }
    if (indices.size) return [...indices].sort((a, b) => a - b);
  }
  const lodCount = (asset.meshes ?? []).filter(mesh => mesh.type === "lod").length;
  return Array.from({ length: Math.max(1, lodCount) }, (_, index) => index);
}

function selectedLods(options: DownloadOptions, asset: ExtendedAsset): boolean[] {
  const isPlant = (asset.categories ?? [])[0]?.toLowerCase() === "3dplant";
  const available = new Set(assetLodIndices(asset));
  if (isPlant && options.downloadAllPlantLods) {
    return LOD_KEYS.map(index => available.has(index));
  }
  return LOD_KEYS.map(index => available.has(index) && (options.lods[index] ?? true));
}

function lodTriangles(asset: ExtendedAsset, options: DownloadOptions): Array<{ lod: number; tris: number }> {
  const meshes = (asset.meshes ?? []).filter(
    mesh => mesh.type === "lod" && typeof mesh.tris === "number"
  );
  const sorted = meshes
    .map(mesh => ({ lod: 0, tris: mesh.tris as number }))
    .sort((a, b) => b.tris - a.tris)
    .map((mesh, index) => ({ lod: index, tris: mesh.tris }));
  const selected = selectedLods(options, asset);
  return sorted.filter((_mesh, index) => selected[index] ?? true);
}

function clampResolution(resolution: number | undefined, asset: ExtendedAsset): number {
  const requested = RESOLUTIONS.includes(resolution ?? -1) ? (resolution as number) : 8192;
  const acl = asset.acl?.resolution;
  if (typeof acl !== "number" || acl <= 0) return requested;
  const allowed = RESOLUTIONS.filter(value => value <= acl);
  const maxAllowed = allowed[allowed.length - 1] ?? RESOLUTIONS[0];
  return Math.min(requested, maxAllowed);
}

function defaultComponents(
  asset: ExtendedAsset,
  textureFormat: TextureFormat,
  selectedMaps: string[] = DEFAULT_MAP_TYPES
): DownloadMapOption[] {
  const baseMime = mimeForTexture(textureFormat);
  const selected = new Set(selectedMaps);
  return availableMapTypes(asset).map(type => {
    const preferred: DownloadMapFormat =
      type === "displacement" ? "jpeg+exr" : baseMime;
    const mimeType =
      preferred !== "image/jpeg" && !canDownloadExr(asset, type) ? "image/jpeg" : preferred;
    return { type, selected: selected.has(canonicalMapType(type)), mimeType };
  });
}

export function resolveDownloadOptions(
  asset: ExtendedAsset,
  partial: Partial<DownloadOptions> = {},
  settings?: AppSettings | null
): DownloadOptions {
  const preset = settings?.downloadDefaults?.[assetDefaultsKind(asset)];
  const textureFormat = partial.textureFormat ?? preset?.textureFormat ?? "jpg";
  const components =
    partial.components && partial.components.length > 0
      ? partial.components
      : defaultComponents(asset, textureFormat, preset?.selectedMaps);
  const availableLods = new Set(assetLodIndices(asset));
  return {
    resolution: clampResolution(partial.resolution ?? preset?.resolution, asset),
    textureFormat,
    components,
    meshFormat: partial.meshFormat ?? preset?.meshFormat ?? "fbx",
    lods: LOD_KEYS.map(index =>
      availableLods.has(index) ? partial.lods?.[index] ?? preset?.lods?.[index] ?? true : false
    ),
    downloadAllPlantLods:
      partial.downloadAllPlantLods ?? preset?.downloadAllPlantLods ?? true,
    highpoly: partial.highpoly ?? preset?.highpoly ?? false,
    ztool: partial.ztool ?? preset?.ztool ?? false,
    brushes: partial.brushes ?? preset?.brushes ?? false,
    uniqueMapsPerLod: partial.uniqueMapsPerLod ?? preset?.uniqueMapsPerLod ?? true,
    billboards: partial.billboards ?? preset?.billboards ?? true,
    variation: partial.variation ?? 1
  };
}

function processComponents(
  asset: ExtendedAsset,
  options: DownloadOptions,
  highestTris: number
): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  const resolution = `${options.resolution}x${options.resolution}`;

  for (const component of options.components) {
    if (!component.selected) continue;
    const type = component.type;
    const access = canDownloadExr(asset, type);
    const formats: DownloadMapFormat[] = [];
    const requested = component.mimeType ?? "image/jpeg";

    if (type === "displacement") {
      if (access) {
        if (requested === "image/x-exr") formats.push("image/x-exr");
        else formats.push("image/jpeg", "image/x-exr");
      } else {
        formats.push("image/jpeg");
      }
    } else if (requested === "image/x-exr") {
      formats.push(access ? "image/x-exr" : "image/jpeg");
    } else if (requested === "jpeg+exr") {
      if (access) formats.push("image/jpeg", "image/x-exr");
      else formats.push("image/jpeg");
    } else {
      formats.push("image/jpeg");
    }

    for (const mimeType of formats) {
      const entry: Record<string, unknown> = { type, resolution, mimeType };
      if (
        options.uniqueMapsPerLod &&
        highestTris > 0 &&
        (type === "normal" || type === "normalbump")
      ) {
        entry.tris = highestTris;
      }
      output.push(entry);
    }
  }
  return output;
}

function processBillboards(asset: ExtendedAsset, options: DownloadOptions): Array<Record<string, unknown>> {
  const billboards = asset.billboards ?? [];
  if (billboards.length === 0) return [];
  const types = new Set(billboards.map(definition => definition.type).filter(Boolean));
  const resolution = `${options.resolution}x${options.resolution}`;
  const selected = new Map(options.components.map(component => [component.type, component]));
  const output: Array<Record<string, unknown>> = [];
  for (const type of types) {
    const component = selected.get(type);
    if (component && !component.selected) continue;
    output.push({ type, resolution, mimeType: "image/jpeg" });
  }
  return output;
}

export function buildDownloadPayload(
  asset: ExtendedAsset,
  assetId: string,
  options: DownloadOptions
): Record<string, unknown> {
  const categories = (asset.categories ?? []).map(category => category.toLowerCase());
  const is3d = categories[0]?.startsWith("3d") ?? false;
  const isPlant = categories[0] === "3dplant";
  const meshMimeType = mimeForMesh(options.meshFormat);
  const lodEntries = lodTriangles(asset, options);
  const highestTris = lodEntries[0]?.tris ?? -1;
  const components = processComponents(asset, options, highestTris);

  if (!is3d) {
    return { asset: assetId, components };
  }

  const selected = selectedLods(options, asset);
  const isModular = (asset.tags ?? []).includes("3d-mod-window");

  if (asset.version === 2) {
    const meshes: Array<Record<string, unknown>> = [];
    for (const index of assetLodIndices(asset)) {
      if (!selected[index]) continue;
      meshes.push({
        mimeType: meshMimeType,
        lod: index,
        ...(isModular ? { variations: [options.variation] } : {})
      });
    }
    if (options.highpoly) {
      meshes.push({
        mimeType: meshMimeType,
        lod: -1,
        ...(isModular ? { variations: [options.variation] } : {})
      });
    }
    return {
      asset: assetId,
      components,
      meshes,
      ...(isPlant ? { billboards: options.billboards ? processBillboards(asset, options) : false } : {})
    };
  }

  return {
    asset: assetId,
    components,
    config: {
      highpoly: options.highpoly,
      ztool: options.ztool,
      lowerlod_normals: options.uniqueMapsPerLod,
      albedo_lods: options.uniqueMapsPerLod,
      meshMimeType,
      brushes: options.brushes,
      lods: lodEntries.map(entry => entry.tris)
    },
    ...(isPlant ? { billboards: options.billboards ? processBillboards(asset, options) : false } : {})
  };
}

function destinationFolder(asset: ExtendedAsset, assetId: string): { category: string; folder: string } {
  const categories = (asset.categories ?? []).filter(Boolean);
  const first = (categories[0] ?? asset.type ?? "3d").toLowerCase();
  let name: string;
  if (categories.length <= 1) {
    name = `${first}_${assetId}`;
  } else if (categories.length === 2) {
    name = `${first}_${categories[1]}_${assetId}`;
  } else {
    name = `${categories[1]}_${categories[2]}_${assetId}`;
  }
  return { category: safeSegment(first), folder: safeSegment(name) };
}

export class DownloadManager {
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private running = false;
  private listeners = new Set<(progress: DownloadProgress) => void>();
  private acquiredCache: { ids: Set<string>; at: number } | null = null;
  private readonly queueFile: string;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly auth: AuthService,
    private readonly api: LegacyApi,
    private readonly logger: Logger,
    private readonly getSettings: () => AppSettings,
    private readonly getLibraryPath: () => string,
    private readonly scanLibrary: () => void,
    private readonly notify: (message: string, error?: boolean) => void
  ) {
    this.queueFile = join(app.getPath("userData"), "download-queue.json");
    this.restoreQueue();
  }

  onProgress(callback: (progress: DownloadProgress) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  list(): DownloadProgress[] {
    return [...this.jobs.values()].map(job => this.toProgress(job));
  }

  async pauseAll(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (["queued", "requesting", "downloading", "extracting"].includes(job.status)) {
        await this.pause(job.assetId);
      }
    }
  }

  async resumeAll(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.status === "paused") await this.resume(job.assetId);
    }
  }

  private restoreQueue(): void {
    try {
      if (!existsSync(this.queueFile)) return;
      const data = JSON.parse(readFileSync(this.queueFile, "utf8")) as Array<{
        assetId?: string;
        name?: string;
        options?: Partial<DownloadOptions>;
        status?: DownloadStatus;
        message?: string;
      }>;
      for (const entry of data) {
        if (!entry?.assetId) continue;
        const job = this.createJob(entry.assetId, entry.options);
        job.name = entry.name;
        job.status = entry.status === "error" ? "error" : "paused";
        job.message =
          job.status === "error"
            ? entry.message ?? "Download failed"
            : "Interrupted; resume to continue";
        this.jobs.set(job.assetId, job);
      }
    } catch {
      // ignore corrupt queue
    }
  }

  private persistQueue(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.writeQueue();
    }, 500);
  }

  flushQueue(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.writeQueue();
  }

  private writeQueue(): void {
    try {
      const data = [...this.jobs.values()]
        .filter(job => !["complete", "cancelled"].includes(job.status))
        .map(job => ({
          assetId: job.assetId,
          name: job.name,
          options: job.options,
          status: job.status,
          message: job.message
        }));
      const tmp = `${this.queueFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
      renameSync(tmp, this.queueFile);
    } catch {
      // ignore persistence failures
    }
  }

  async start(assetId: string, options?: Partial<DownloadOptions>): Promise<void> {
    if (!this.auth.state().loggedIn) throw new Error("Sign in to download assets");
    const existing = this.jobs.get(assetId);
    if (existing && !["error", "cancelled", "complete"].includes(existing.status)) {
      if (existing.status === "paused") await this.resume(assetId);
      return;
    }

    const job = this.createJob(assetId, options);
    this.jobs.set(assetId, job);
    this.queue.push(assetId);
    this.emit(job);
    this.persistQueue();
    void this.processQueue();
  }

  async startMany(
    assetIds: string[],
    options?: Partial<DownloadOptions>
  ): Promise<BatchStartResult> {
    if (!this.auth.state().loggedIn) throw new Error("Sign in to download assets");

    const unique = [...new Set(assetIds.filter(Boolean))];
    let queued = 0;
    let skipped = 0;

    for (const assetId of unique) {
      const existing = this.jobs.get(assetId);
      if (existing?.status === "complete") {
        skipped += 1;
        continue;
      }
      if (existing && !["error", "cancelled"].includes(existing.status)) {
        skipped += 1;
        continue;
      }

      const job = this.createJob(assetId, options);
      this.jobs.set(assetId, job);
      this.queue.push(assetId);
      queued += 1;
      this.emit(job);
    }

    if (queued > 0) {
      this.persistQueue();
      void this.processQueue();
    }
    return { queued, skipped };
  }

  private createJob(assetId: string, options?: Partial<DownloadOptions>): Job {
    return {
      assetId,
      status: "queued",
      received: 0,
      total: 0,
      ratio: 0,
      options,
      cancelled: false,
      paused: false
    };
  }

  async acquire(assetId: string): Promise<void> {
    await this.api.acquire(assetId);
    this.acquiredCache = null;
    this.notify(`Acquired ${assetId}`);
  }

  cancel(assetId: string): void {
    const job = this.jobs.get(assetId);
    if (!job) return;
    job.cancelled = true;
    job.paused = false;
    job.abort?.abort();
    job.status = "cancelled";
    job.message = "Cancelled";
    void rm(join(app.getPath("temp"), "openbridge", `asset-${assetId}`), {
      recursive: true,
      force: true
    }).catch(() => undefined);
    this.emit(job);
    this.persistQueue();
  }

  async pause(assetId: string): Promise<void> {
    const job = this.jobs.get(assetId);
    if (!job || job.status === "complete" || job.status === "cancelled") return;
    job.paused = true;
    job.abort?.abort();
    job.status = "paused";
    job.message = "Paused";
    this.emit(job);
    this.persistQueue();
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
    this.persistQueue();
    void this.processQueue();
  }

  async cancelAll(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (!["complete", "error", "cancelled"].includes(job.status)) {
        this.cancel(job.assetId);
      }
    }
    this.queue = [];
    this.persistQueue();
  }

  clearFinished(): void {
    for (const [assetId, job] of this.jobs) {
      if (["complete", "error", "cancelled"].includes(job.status)) {
        this.jobs.delete(assetId);
      }
    }
    this.persistQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const assetId = this.queue.shift();
        if (!assetId) break;
        const job = this.jobs.get(assetId);
        if (!job || job.cancelled) continue;
        if (job.status === "paused") continue;
        await this.runJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async runJob(job: Job): Promise<void> {
    const temp = join(app.getPath("temp"), "openbridge", `asset-${job.assetId}`);
    job.abort = new AbortController();

    try {
      await mkdir(temp, { recursive: true });

      this.setStatus(job, "requesting", "Requesting download URLs");
      const asset = await this.api.extended(job.assetId);
      job.name = asset.name;
      const options = resolveDownloadOptions(asset, job.options, this.getSettings());
      job.options = options;

      this.logger.info("Extended asset loaded", {
        assetId: job.assetId,
        categories: asset.categories,
        version: asset.version,
        points: asset.points,
        maps: mapDefinitions(asset).length,
        meshes: asset.meshes?.length ?? null,
        acl: asset.acl
      });

      const acquired = await this.isAcquired(job.assetId);
      if (!acquired) {
        if ((asset.points ?? 0) === 0) {
          this.setStatus(job, "requesting", "Acquiring free asset");
          await this.api.acquire(job.assetId);
          this.acquiredCache = null;
        } else {
          throw new Error("Asset is not acquired. Use Acquire first.");
        }
      }

      if (job.paused) {
        job.status = "paused";
        job.message = "Paused";
        this.emit(job);
        return;
      }

      const payload = buildDownloadPayload(asset, job.assetId, options);
      this.logger.info("Requesting asset download", {
        assetId: job.assetId,
        options,
        payload
      });
      const response = await this.api.requestDownload(payload);

      const summarise = (value: unknown): Array<Record<string, unknown>> =>
        flattenFiles(value).map(file => ({
          name: file.uri.split("?")[0]?.split("/").pop(),
          saveAs: file.saveAs,
          bytes: file.contentLength
        }));
      this.logger.info("Download response received", {
        assetId: job.assetId,
        keys: Object.keys(response ?? {}),
        jsonType: Array.isArray(response?.json) ? "array" : typeof response?.json,
        previews: summarise(response.previews),
        components: summarise(response.components),
        meshes: summarise(response.meshes),
        brushes: summarise(response.brushes),
        billboards: summarise(response.billboards)
      });

      const jsonValue = response.json;
      let assetJson: ExtendedAsset | null = null;
      let jsonDescriptor: FileDescriptor | null = null;
      if (isFileDescriptor(jsonValue)) {
        jsonDescriptor = jsonValue;
      } else if (Array.isArray(jsonValue)) {
        const first = jsonValue.find(isFileDescriptor);
        if (first) jsonDescriptor = first;
      } else if (jsonValue && typeof jsonValue === "object") {
        assetJson = jsonValue as ExtendedAsset;
      }

      const files: FileDescriptor[] = [];
      if (jsonDescriptor) files.push(jsonDescriptor);
      for (const key of ["previews", "components", "meshes", "brushes", "billboards"]) {
        flattenFiles(response[key], files);
      }

      if (assetJson) {
        await writeFile(join(temp, "asset.json"), JSON.stringify(assetJson, null, 2), "utf8");
      }

      const unique = new Map<string, FileDescriptor>();
      for (const file of files) {
        const relative = relativePath(file, job.assetId);
        if (!unique.has(relative)) unique.set(relative, file);
      }

      const total = [...unique.values()].reduce(
        (sum, file) => sum + (typeof file.contentLength === "number" ? file.contentLength : 0),
        0
      );
      job.total = total;
      job.received = 0;
      job.ratio = 0;
      this.setStatus(job, "downloading", `Downloading ${unique.size} files`);

      try {
        const volume = await statfs(this.getLibraryPath());
        const free = Number(volume.bavail) * Number(volume.bsize);
        if (total > 0 && free < total * 1.1 + 100 * 1024 * 1024) {
          throw new Error(
            `Not enough free disk space: need about ${Math.ceil(
              (total * 1.1 + 100 * 1024 * 1024) / (1024 * 1024)
            )} MB`
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Not enough free disk space")) {
          throw error;
        }
      }

      const entries = [...unique.entries()];
      const receivedByPath = new Map<string, number>();
      let completedBytes = 0;
      let lastEmit = 0;
      let failure: Error | null = null;
      const emitProgress = (force = false): void => {
        const active = [...receivedByPath.values()].reduce((sum, value) => sum + value, 0);
        job.received = completedBytes + active;
        job.total = total;
        job.ratio = total > 0 ? Math.min(1, job.received / total) : 0;
        if (force || Date.now() - lastEmit > 120) {
          lastEmit = Date.now();
          this.emit(job);
        }
      };

      const worker = async (): Promise<void> => {
        for (;;) {
          if (job.cancelled || job.paused) return;
          const entry = entries.shift();
          if (!entry) return;
          const [relative, file] = entry;
          const target = join(temp, relative);
          const expected = file.contentLength;

          const existing = await stat(target).catch(() => null);
          if (existing && typeof expected === "number" && existing.size === expected) {
            completedBytes += expected;
            emitProgress();
            continue;
          }

          let lastError: Error | null = null;
          for (let attempt = 0; attempt < DOWNLOAD_RETRIES; attempt += 1) {
            if (job.cancelled || job.paused) return;
            try {
              await downloadFile(
                file.uri,
                target,
                progress => {
                  receivedByPath.set(relative, progress.received);
                  emitProgress();
                },
                DOWNLOAD_TIMEOUT_SEC,
                job.abort?.signal
              );
              const downloaded = await stat(target);
              if (typeof expected === "number" && downloaded.size !== expected) {
                throw new Error(
                  `Size verification failed for ${relative}: expected ${expected}, got ${downloaded.size}`
                );
              }
              receivedByPath.delete(relative);
              completedBytes += downloaded.size;
              emitProgress(true);
              lastError = null;
              break;
            } catch (error) {
              if (job.cancelled || job.paused) return;
              lastError = error instanceof Error ? error : new Error(String(error));
              if (attempt < DOWNLOAD_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
              }
            }
          }

          if (lastError) {
            failure = lastError;
            job.abort?.abort();
            return;
          }

          if (extname(target).toLowerCase() === ".zip") {
            this.setStatus(job, "extracting", `Extracting ${basename(target)}`);
            await extractZip(target, join(target, ".."));
            await rm(target, { force: true });
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(FILE_CONCURRENCY, Math.max(1, entries.length)) },
          () => worker()
        )
      );
      if (failure) throw failure;

      if (job.cancelled) throw new Error("Cancelled");
      if (job.paused) {
        job.status = "paused";
        job.message = "Paused";
        this.emit(job);
        return;
      }

      this.setStatus(job, "extracting", "Finalizing library folder");
      const json =
        assetJson ??
        (await this.readTempJson(temp)) ??
        (await this.api.extended(job.assetId).catch(() => asset));
      const { category, folder } = destinationFolder(json, job.assetId);
      const destination = join(this.getLibraryPath(), "Downloaded", category, folder);
      await mkdir(destination, { recursive: true });
      await cp(temp, destination, { recursive: true, force: true });

      if (!(await this.findJson(destination))) {
        await writeFile(
          join(destination, `${job.assetId}.json`),
          JSON.stringify(json, null, 2),
          "utf8"
        );
      }

      await rm(temp, { recursive: true, force: true });
      job.path = destination;
      job.received = job.total || job.received;
      job.ratio = 1;
      this.setStatus(job, "complete", "Downloaded");
      this.notify(`${json.name ?? job.assetId} downloaded`);
      this.scanLibrary();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (job.paused) {
        job.status = "paused";
        job.message = "Paused";
        this.emit(job);
        return;
      }
      if (job.cancelled || /cancel/i.test(message)) {
        job.status = "cancelled";
        job.message = "Cancelled";
        await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      } else {
        job.status = "error";
        job.message = message;
        this.logger.error("Asset download failed", { assetId: job.assetId, error });
        this.notify(`Download failed: ${message}`, true);
        await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      }
      this.emit(job);
    } finally {
      job.abort = undefined;
    }
  }

  private async isAcquired(assetId: string): Promise<boolean> {
    if (!this.acquiredCache || Date.now() - this.acquiredCache.at > 60_000) {
      const ids = await this.api.acquired();
      this.acquiredCache = { ids: new Set(ids), at: Date.now() };
    }
    return this.acquiredCache.ids.has(assetId);
  }

  private async readTempJson(temp: string): Promise<ExtendedAsset | null> {
    const files = await readdir(temp, { withFileTypes: true }).catch(() => []);
    const file = files.find(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".json"));
    if (!file) return null;
    try {
      const text = await readFile(join(temp, file.name), "utf8");
      return JSON.parse(text) as ExtendedAsset;
    } catch {
      return null;
    }
  }

  private async findJson(folder: string): Promise<boolean> {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    return entries.some(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".json"));
  }

  private setStatus(job: Job, status: DownloadStatus, message?: string): void {
    job.status = status;
    if (message) job.message = message;
    this.emit(job);
    this.persistQueue();
  }

  private emit(job: Job): void {
    const progress = this.toProgress(job);
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch {
        // ignore
      }
    }
  }

  private toProgress(job: Job): DownloadProgress {
    return {
      assetId: job.assetId,
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


