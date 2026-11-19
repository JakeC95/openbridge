import { parentPort, workerData } from "node:worker_threads";
import { readSharedFileFacts } from "./shared-file-facts";

void readSharedFileFacts(workerData.path).then(facts => parentPort!.postMessage({ facts })).catch(error =>
  parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }));
