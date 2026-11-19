import { open } from "node:fs/promises";
import { extname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { decodeExrRgba } from "@bb-studio/exr";
import { decodeRadianceHdr, rgbaToHalfRgba, rgbToHalfRgba } from "./poliigon/hdr";
import { checkHdrDimensions, PUBLIC_PREVIEW_MAX_BYTES, type HdrLimits } from "./public/preview-data";

const { path, limits } = workerData as { path: string; limits: HdrLimits };

async function readPreviewSource(path: string): Promise<Buffer> {
  const source = await open(path, "r");
  try {
    const before = await source.stat();
    if (!before.isFile()) throw new Error("HDR preview requires a regular file.");
    if (before.size > PUBLIC_PREVIEW_MAX_BYTES) throw new Error("HDR source exceeds the 160 MiB live preview limit.");
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await source.read(buffer, offset, Math.min(buffer.length - offset, 1024 * 1024), offset);
      if (!bytesRead) throw new Error("HDR source changed during preview. Try again.");
      offset += bytesRead;
    }
    const after = await source.stat();
    const extra = await source.read(Buffer.alloc(1), 0, 1, offset);
    if (extra.bytesRead || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("HDR source changed during preview. Try again.");
    }
    return buffer;
  } finally {
    await source.close();
  }
}

void (async () => {
  try {
    const buffer = await readPreviewSource(path);
    const extension = extname(path).toLowerCase();
    checkHdrDimensions(buffer, extension, limits);
    const result = extension === ".exr"
      ? (() => {
          const { width, height, rgba } = decodeExrRgba(buffer);
          return { width, height, data: rgbaToHalfRgba(rgba) };
        })()
      : (() => {
          const { width, height, data } = decodeRadianceHdr(buffer);
          return { width, height, data: rgbToHalfRgba(data) };
        })();
    parentPort!.postMessage({ result }, [result.data.buffer as ArrayBuffer]);
  } catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
})();
