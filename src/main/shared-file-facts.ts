import { stat } from "node:fs/promises";
import { extname, basename, join } from "node:path";
import { Worker } from "node:worker_threads";
import type { SharedFileFacts } from "../shared/types";
import { inspectSharedHdrFacts } from "./shared-hdr-facts";
import { inspectSharedModelFacts } from "./shared-model-facts";

export const SHARED_FACTS_REVISION = 1;

/** File-level facts only. Account or semantic attributes require separate evidence. */
export async function readSharedFileFacts(path: string, signal?: AbortSignal): Promise<SharedFileFacts> {
  signal?.throwIfAborted();
  const info = await stat(path);
  const facts: SharedFileFacts = {
    revision: SHARED_FACTS_REVISION, inspectedAt: Date.now(), bytes: info.size, mtimeMs: info.mtimeMs,
    format: extname(path).slice(1).toLowerCase(), notes: []
  };
  if (facts.format === "hdr" || facts.format === "exr") {
    facts.image = await inspectSharedHdrFacts(path);
    if (facts.image.views.length > 1) facts.notes.push("This EXR contains multiple views.");
    if (facts.image.deep || facts.image.multipart || facts.image.tiled) {
      facts.notes.push("This EXR layout is available for inspection but requires an external tool for preview.");
    }
  } else {
    facts.model = await inspectSharedModelFacts(path, signal);
    facts.notes.push(...facts.model.notes);
  }
  const stem = basename(path, extname(path));
  const lod = /(?:^|[-_.\s])lod[-_ ]?(\d{1,2})(?=$|[-_.\s])/i.exec(stem);
  const version = /(?:^|[-_.\s])v(\d{1,5})(?=$|[-_.\s])/i.exec(stem);
  if (lod) facts.lod = Number(lod[1]);
  if (version) facts.version = version[1];
  signal?.throwIfAborted();
  const after = await stat(path);
  if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error("The source file changed during inspection. Inspect it again.");
  return facts;
}


/** Parsing happens in an isolated worker so large text models cannot stall the desktop. */
export async function inspectSharedFileFacts(path: string, signal?: AbortSignal): Promise<SharedFileFacts> {
  const request = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(45_000)]);
  request.throwIfAborted();
  const worker = new Worker(join(__dirname, "shared-facts-worker.js"), { workerData: { path },
    resourceLimits: { maxOldGenerationSizeMb: 256 } });
  let abort = () => {};
  try {
    return await new Promise<SharedFileFacts>((resolve, reject) => {
      abort = () => reject(request.reason);
      request.addEventListener("abort", abort, { once: true });
      worker.once("message", (reply: { facts?: SharedFileFacts; error?: string }) => {
        if (reply.facts) resolve(reply.facts);
        else reject(new Error(reply.error ?? "File inspection failed."));
      });
      worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`File inspection ended before returning metadata (${code}).`)));
    });
  } finally {
    request.removeEventListener("abort", abort);
    await worker.terminate();
  }
}
