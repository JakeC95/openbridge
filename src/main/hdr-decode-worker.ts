import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { decodeExrRgba } from "@bb-studio/exr";
import { decodeRadianceHdr, rgbaToHalfRgba, rgbToHalfRgba } from "./poliigon/hdr";
import { checkHdrDimensions, type HdrLimits } from "./public/preview-data";

const { path, limits } = workerData as { path: string; limits: HdrLimits };

void (async () => {
  try {
    const buffer = await readFile(path);
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
