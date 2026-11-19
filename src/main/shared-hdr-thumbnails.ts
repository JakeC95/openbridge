import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeHdrFile } from "./hdr-decode";
import { inspectSharedFileFacts } from "./shared-file-facts";
import { sharedHdrInfo } from "./shared-library";
import { hdrLimitsFor, toneMappedPng } from "./public/preview-data";
import type { SharedFileFacts, SharedHdrInfo } from "../shared/types";

const CACHE_REVISION = 1;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_THUMB_AXIS = 512;

export interface SharedHdrThumbnail extends SharedHdrInfo {
  /** A generated PNG in the local profile cache, never beside a source asset. */
  path: string | null;
}

function identity(path: string, facts: SharedFileFacts): string {
  return createHash("sha256").update(JSON.stringify([
    CACHE_REVISION, path, facts.bytes, facts.mtimeMs
  ])).digest("hex");
}

/** Caller must resolve/authorize the indexed source before passing its path. */
export class SharedHdrThumbnailCache {
  private queue: Promise<unknown> = Promise.resolve();
  private inventory: Map<string, { bytes: number; used: number }> | null = null;
  private cacheBytes = 0;

  constructor(private readonly directory: string) {}

  async get(path: string, signal?: AbortSignal): Promise<SharedHdrThumbnail> {
    const request = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(60_000)]);
    request.throwIfAborted();
    const pending = this.queue.catch(() => {}).then(() => this.generate(path, request));
    this.queue = pending;
    let abort = () => {};
    try {
      return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        abort = () => reject(request.reason);
        request.addEventListener("abort", abort, { once: true });
        if (request.aborted) abort();
      })]);
    } finally {
      request.removeEventListener("abort", abort);
    }
  }

  private async generate(path: string, signal: AbortSignal): Promise<SharedHdrThumbnail> {
    signal.throwIfAborted();
    // Source IO stays inside a terminable worker, including mounted filesystems.
    const facts = await inspectSharedFileFacts(path, signal);
    if (!facts.image) throw new Error("Thumbnail generation requires an HDR or EXR source.");
    const policy = sharedHdrInfo(facts.image, facts.bytes);
    if (!policy.previewAvailable) return { ...policy, path: null };
    const key = identity(path, facts);
    const output = join(this.directory, `${key}.png`);
    const existing = await lstat(output).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return null;
    });
    signal.throwIfAborted();
    if (existing?.isFile() && existing.size > 0) {
      await this.track(output, existing.size);
      return { ...policy, path: output };
    }
    if (existing && !existing.isFile()) throw new Error("The thumbnail cache contains an invalid entry.");
    if (existing) await rm(output, { force: true });
    const decoded = await decodeHdrFile(path, hdrLimitsFor("shared"), signal);
    signal.throwIfAborted();
    const after = await inspectSharedFileFacts(path, signal);
    if (identity(path, after) !== key) throw new Error("The source changed during thumbnail generation. Try again.");
    const maxWidth = Math.max(1, Math.min(MAX_THUMB_AXIS,
      Math.floor(decoded.width * MAX_THUMB_AXIS / Math.max(decoded.width, decoded.height))));
    const png = toneMappedPng({ ...decoded, resolution: `${decoded.width} × ${decoded.height}` }, maxWidth);
    signal.throwIfAborted();
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, png, { flag: "wx", mode: 0o600 });
      signal.throwIfAborted();
      await rename(temporary, output);
    } finally {
      await rm(temporary, { force: true });
    }
    await this.track(output, png.length);
    await this.prune(output);
    return { ...policy, path: output };
  }

  /** Reconcile disk once per instance; subsequent requests update the tracked inventory. */
  private async cacheInventory(): Promise<Map<string, { bytes: number; used: number }>> {
    if (this.inventory) return this.inventory;
    const inventory = new Map<string, { bytes: number; used: number }>();
    const names = await readdir(this.directory).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return [];
    });
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.png$/.test(name)) continue;
      const path = join(this.directory, name);
      const info = await lstat(path).catch(() => null);
      if (info?.isFile()) inventory.set(path, { bytes: info.size, used: info.mtimeMs });
    }
    this.cacheBytes = [...inventory.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    this.inventory = inventory;
    return inventory;
  }

  private async track(path: string, bytes: number): Promise<void> {
    const inventory = await this.cacheInventory();
    this.cacheBytes += bytes - (inventory.get(path)?.bytes ?? 0);
    inventory.set(path, { bytes, used: Date.now() });
  }

  private async prune(keep: string): Promise<void> {
    const inventory = await this.cacheInventory();
    if (this.cacheBytes <= MAX_CACHE_BYTES) return;
    for (const [path, entry] of [...inventory.entries()].sort((a, b) => a[1].used - b[1].used)) {
      if (this.cacheBytes <= MAX_CACHE_BYTES) break;
      if (path === keep) continue;
      await rm(path, { force: true });
      inventory.delete(path);
      this.cacheBytes -= entry.bytes;
    }
  }
}
