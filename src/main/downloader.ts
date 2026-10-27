import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { net } from "electron";
import yauzl from "yauzl";

export interface DownloadProgress {
  received: number;
  total: number;
  ratio: number;
}

export function downloadFile(
  url: string,
  destination: string,
  onProgress?: (progress: DownloadProgress) => void,
  timeoutSec = 30,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const part = `${destination}.part`;
    void (async () => {
      await mkdir(dirname(destination), { recursive: true });
      const existing = await stat(part).catch(() => null);
      const offset = existing?.isFile() ? existing.size : 0;
      const request = net.request({ method: "GET", url, redirect: "follow" });
      if (offset > 0) request.setHeader("Range", `bytes=${offset}-`);

      let lastActivity = Date.now();
      let settled = false;
      let timer: ReturnType<typeof setInterval> | undefined;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearInterval(timer);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolvePromise(destination);
      };

      const onAbort = (): void => {
        request.abort();
        finish(new Error("Cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      if (timeoutSec > 0) {
        timer = setInterval(() => {
          if (Date.now() - lastActivity > timeoutSec * 1000) {
            request.abort();
            finish(new Error(`Download stalled for ${timeoutSec}s: ${url}`));
          }
        }, 1000);
      }

      request.on("error", error => finish(error));
      request.on("response", rawResponse => {
        const status = rawResponse.statusCode;
        const resuming = status === 206 && offset > 0;
        if (status === 416 && offset > 0) {
          request.abort();
          void rm(part, { force: true })
            .catch(() => undefined)
            .then(() => finish(new Error(`Range rejected for ${url}; restarting download`)));
          return;
        }
        if (status !== 200 && status !== 206) {
          const error = new Error(`HTTP ${status} for ${url}`) as Error & {
            status?: number;
          };
          error.status = status;
          finish(error);
          request.abort();
          return;
        }

        const response = rawResponse as unknown as IncomingMessage;
        const contentLength =
          Number.parseInt(String(response.headers["content-length"] ?? "0"), 10) || 0;
        const total = resuming ? offset + contentLength : contentLength;
        const stream = createWriteStream(part, { flags: resuming ? "a" : "w" });
        let received = resuming ? offset : 0;

        response.on("data", (chunk: Buffer) => {
          lastActivity = Date.now();
          received += chunk.length;
          onProgress?.({
            received,
            total,
            ratio: total > 0 ? Math.min(1, received / total) : 0
          });
        });

        response.on("error", error => {
          stream.destroy();
          finish(error);
        });

        stream.on("finish", () => {
          void rename(part, destination)
            .then(() => finish())
            .catch(error => finish(error as Error));
        });

        stream.on("error", error => {
          finish(error as Error);
        });

        response.pipe(stream);
      });

      request.end();
    })().catch(error => reject(error));
  });
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

