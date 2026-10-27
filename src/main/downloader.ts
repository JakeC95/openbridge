import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve, sep } from "node:path";
import { net } from "electron";
import yauzl from "yauzl";
import { abortError, delay, HttpError, isRetryable, retryAfter, retryDelay } from "./network";
import { downloadSource, type TransferTelemetry } from "./download-stats";

export interface DownloadProgress {
  received: number;
  total: number;
  ratio: number;
}

export async function downloadFile(
  url: string,
  destination: string,
  onProgress?: (progress: DownloadProgress) => void,
  timeoutSec = 30,
  signal?: AbortSignal,
  expectedBytes?: number,
  telemetry?: (sample: TransferTelemetry) => void
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    try { return await downloadAttempt(url, destination, onProgress, timeoutSec, signal, expectedBytes, telemetry); }
    catch (error) {
      signal?.throwIfAborted();
      if (attempt === 2 || !isRetryable(error)) throw error;
      const wait = retryDelay(attempt, (error as HttpError).retryAfterMs ?? 0);
      // Leave long server-imposed backoff to a user-initiated resume, not a hidden sleeping queue.
      if (wait > 30_000) throw error;
      await delay(wait, signal);
    }
  }
  throw new Error("Download failed");
}

interface PartialInfo { resource: string; etag?: string; modified?: string }

async function downloadAttempt(url: string, destination: string, onProgress: ((progress: DownloadProgress) => void) | undefined,
  timeoutSec: number, signal?: AbortSignal, expectedBytes?: number,
  telemetry?: (sample: TransferTelemetry) => void): Promise<string> {
  signal?.throwIfAborted();
  await mkdir(dirname(destination), { recursive: true });
  const part = `${destination}.part`, metadata = `${part}.meta.json`;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Downloads require an HTTP or HTTPS URL");
  // Signed URL credentials rotate. Store only an object-identity hash, never the signed URL itself.
  const identity = new URLSearchParams(parsed.search);
  for (const key of [...identity.keys()]) if (/^(x-amz-|x-goog-|signature$|policy$|key-pair-id$|expires$|token$|awsaccesskeyid$)/i.test(key)) identity.delete(key);
  identity.sort();
  const resource = createHash("sha256").update(`${parsed.origin}${parsed.pathname}?${identity}`).digest("hex");
  const info: PartialInfo | null = await readFile(metadata, "utf8").then(JSON.parse).catch(() => null);
  const existing = await stat(part).catch(() => null);
  const validator = info?.etag && !info.etag.startsWith("W/") ? info.etag : info?.modified;
  const offset = info?.resource === resource && validator && existing?.isFile() ? existing.size : 0;
  const headers: Record<string, string> = { "Accept-Encoding": "identity" };
  if (offset > 0) { headers.Range = `bytes=${offset}-`; headers["If-Range"] = validator!; }
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let lastActivity = Date.now();
  const timer = timeoutSec > 0 ? setInterval(() => {
    if (Date.now() - lastActivity > timeoutSec * 1000) controller.abort(new DOMException("Download stalled", "TimeoutError"));
  }, Math.min(1000, timeoutSec * 1000)) : undefined;
  let response: Response | undefined;
  let writeStream: ReturnType<typeof createWriteStream> | undefined;
  let receiveBytes = 0, reportedReceive = 0, reportedWrite = 0;
  let source: ReturnType<typeof downloadSource> | undefined;
  let statsTimer: ReturnType<typeof setInterval> | undefined;
  const report = (active: boolean) => {
    if (!telemetry || !source) return;
    const written = writeStream?.bytesWritten ?? 0;
    const sample = { receivedBytes: receiveBytes - reportedReceive, writtenBytes: written - reportedWrite, source, active };
    reportedReceive = receiveBytes; reportedWrite = written;
    try { telemetry(sample); } catch { /* diagnostics must not interrupt file transfers */ }
  };
  try {
    combined.throwIfAborted();
    response = await net.fetch(url, { method: "GET", headers, signal: combined });
    lastActivity = Date.now();
    if (response.status === 416 && offset > 0) {
      const size = Number(response.headers.get("content-range")?.match(/^bytes \*\/(\d+)$/)?.[1]);
      await response.body?.cancel();
      if (size === offset && (expectedBytes === undefined || expectedBytes === size)) {
        await rename(part, destination); await rm(metadata, { force: true });
        onProgress?.({ received: size, total: size, ratio: 1 }); return destination;
      }
      await rm(part, { force: true }); await rm(metadata, { force: true });
      throw new TypeError("Range rejected; restarting download");
    }
    if (response.status !== 200 && response.status !== 206) {
      throw new HttpError(response.status, "Asset transfer", retryAfter(response.headers.get("retry-after")));
    }
    const encoded = Boolean(response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity");
    // net.fetch transparently decodes HTTP compression. Wire lengths/ranges cannot describe
    // the decoded bytes written to disk, so compressed partials must restart rather than append.
    const length = encoded ? 0 : Number(response.headers.get("content-length")) || 0;
    let total = length, resumed = false;
    if (response.status === 206) {
      const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (encoded || !range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[3]) <= Number(range[2]) ||
        (length > 0 && length !== Number(range[2]) - offset + 1)) {
        await response.body?.cancel(); await rm(part, { force: true }); await rm(metadata, { force: true });
        throw new TypeError("Invalid Content-Range; restarting download");
      }
      total = Number(range[3]); resumed = offset > 0;
      if (resumed && ((info?.etag && response.headers.get("etag") && info.etag !== response.headers.get("etag")) ||
        (!info?.etag && info?.modified && response.headers.get("last-modified") && info.modified !== response.headers.get("last-modified")))) {
        await response.body?.cancel(); await rm(part, { force: true }); await rm(metadata, { force: true });
        throw new TypeError("Asset changed during resume; restarting download");
      }
    }
    if (expectedBytes !== undefined && total > 0 && total !== expectedBytes) throw new Error("Asset transfer size does not match its signed descriptor. Refresh download URLs.");
    if (!response.body) throw new TypeError("Asset transfer returned an empty body");
    if (telemetry) {
      source = downloadSource(response.url || url, response.headers);
      report(true);
      statsTimer = setInterval(() => report(true), 250);
    }
    if (!resumed) await rm(part, { force: true });
    await writeFile(metadata, JSON.stringify({ resource, etag: !encoded ? response.headers.get("etag") || undefined : undefined,
      modified: !encoded ? response.headers.get("last-modified") || undefined : undefined } satisfies PartialInfo));
    let received = resumed ? offset : 0;
    const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      lastActivity = Date.now(); received += chunk.length;
      receiveBytes += chunk.length;
      try {
        onProgress?.({ received, total, ratio: total > 0 ? Math.min(1, received / total) : 0 });
        callback(null, chunk);
      } catch (error) { callback(error as Error); }
    } });
    writeStream = createWriteStream(part, { flags: resumed ? "a" : "w" });
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), counter,
      writeStream, { signal: combined });
    if ((total > 0 && received !== total) || (expectedBytes !== undefined && received !== expectedBytes)) {
      throw new TypeError("Asset transfer ended before its expected size");
    }
    combined.throwIfAborted();
    await rename(part, destination); await rm(metadata, { force: true });
    onProgress?.({ received, total: total || received, ratio: 1 });
    return destination;
  } catch (error) {
    if (combined.aborted) throw combined.reason ?? abortError();
    throw error;
  } finally {
    if (timer) clearInterval(timer);
    if (statsTimer) clearInterval(statsTimer);
    report(false);
    // pipeline waits for stream closure on cancellation/error, so immediate retries cannot append
    // to an old still-open Windows file handle. Cancel any response rejected before piping, too.
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
    controller.abort();
  }
}

export function extractZip(zipPath: string, destination: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(error ?? new Error(`Cannot open ${zipPath}`));
        return;
      }

      const root = resolve(destination);
      let settled = false;
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        zipfile.close();
        reject(err);
      };

      zipfile.on("error", fail);
      zipfile.on("end", () => {
        if (!settled) {
          settled = true;
          resolvePromise();
        }
      });

      zipfile.on("entry", entry => {
        const target = resolve(join(root, entry.fileName));
        if (target !== root && !target.startsWith(root + sep)) {
          fail(new Error(`Zip entry escapes destination: ${entry.fileName}`));
          return;
        }

        if (/\/$/.test(entry.fileName)) {
          void mkdir(target, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch(fail);
          return;
        }

        void mkdir(dirname(target), { recursive: true })
          .then(
            () =>
              new Promise<void>((done, failed) => {
                zipfile.openReadStream(entry, (err, readStream) => {
                  if (err || !readStream) {
                    failed(err ?? new Error(`Cannot read ${entry.fileName}`));
                    return;
                  }
                  const writeStream = createWriteStream(target);
                  readStream.on("error", failed);
                  writeStream.on("error", failed);
                  writeStream.on("finish", done);
                  readStream.pipe(writeStream);
                });
              })
          )
          .then(() => zipfile.readEntry())
          .catch(fail);
      });

      zipfile.readEntry();
    });
  });
}

export interface RemoteFile {
  url: string;
  saveAs: string;
}

export async function downloadFiles(
  files: RemoteFile[],
  destination: string,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  await mkdir(destination, { recursive: true });
  const queue = [...files];
  const output: string[] = [];
  let completed = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const file = queue.shift();
      if (!file) return;
      const target = join(destination, file.saveAs);
      await downloadFile(file.url, target);
      output.push(target);
      completed += 1;
      onProgress?.(completed, files.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, () => worker())
  );
  return output;
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

