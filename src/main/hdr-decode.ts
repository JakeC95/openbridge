import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { PoliigonHdrData } from "../shared/types";
import type { HdrLimits } from "./public/preview-data";

type DecodedHdr = Omit<PoliigonHdrData, "resolution">;
type WorkerReply = { result: DecodedHdr } | { error: string };

// Bound peak memory across providers: decoding allocates large temporary float
// buffers in addition to the half-float image returned to the viewer.
let decodeQueue: Promise<unknown> = Promise.resolve();

export function decodeHdrFile(path: string, limits: HdrLimits, signal: AbortSignal): Promise<DecodedHdr> {
  const pending = decodeQueue.then(async () => {
    signal.throwIfAborted();
    const worker = new Worker(join(__dirname, "hdr-decode-worker.js"), { workerData: { path, limits } });
    let onAbort: () => void = () => {};
    try {
      return await new Promise<DecodedHdr>((resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        worker.once("message", (reply: WorkerReply) => {
          if ("error" in reply) reject(new Error(reply.error));
          else resolve(reply.result);
        });
        worker.once("error", reject);
        worker.once("exit", code => reject(new Error(`HDR decode worker exited before returning an image (${code})`)));
      });
    } finally {
      signal.removeEventListener("abort", onAbort);
      await worker.terminate();
    }
  });
  decodeQueue = pending.then(() => undefined, () => undefined);
  return pending;
}
