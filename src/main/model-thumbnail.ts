import { BrowserWindow, ipcMain, session } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ModelManifest } from "../shared/model-preview";
import { withAbort } from "./abortable";

const REVISION = 1;
const MAX_MODEL = 96 * 1024 * 1024;
const MAX_RESOURCES = 160 * 1024 * 1024;
const MAX_CACHE = 128 * 1024 * 1024;
const FORMATS = new Set(["obj", "fbx", "gltf", "glb", "stl", "ply", "dae"]);
const RESOURCE = /\.(?:obj|fbx|gltf|glb|stl|ply|dae|bin)$/i;
let serial: Promise<unknown> = Promise.resolve();
type Pending = { manifest: ModelManifest; ready(): void; error(message: string): void };
const pending = new Map<number, Pending>();
let registered = false;
function register() {
  if (registered) return;
  registered = true;
  ipcMain.handle("model-thumbnail:manifest", event => {
    const job = pending.get(event.sender.id);
    if (!job) throw new Error("No geometry thumbnail was requested by this renderer.");
    return job.manifest;
  });
  ipcMain.on("model-thumbnail:ready", event => pending.get(event.sender.id)?.ready());
  ipcMain.on("model-thumbnail:error", (event, message) => pending.get(event.sender.id)?.error(String(message).slice(0, 1000)));
}
type CacheEntry = { bytes: number; used: number };
const inventories = new Map<string, Map<string, CacheEntry>>();
async function trackAndPrune(directory: string, keep: string, size: number, signal: AbortSignal) {
  let inventory = inventories.get(directory);
  if (!inventory) {
    inventory = new Map();
    const entries = await withAbort(() => readdir(directory, { withFileTypes: true }), signal);
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.png$/.test(entry.name)) continue;
      const path = join(directory, entry.name);
      const info = await withAbort(() => lstat(path), signal).catch(error => {
        signal.throwIfAborted();
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return null;
      });
      if (info?.isFile()) inventory.set(path, { bytes: info.size, used: info.mtimeMs });
    }
    signal.throwIfAborted();
    inventories.set(directory, inventory);
  }
  inventory.set(keep, { bytes: size, used: Date.now() });
  let total = [...inventory.values()].reduce((sum, item) => sum + item.bytes, 0);
  if (total <= MAX_CACHE) return;
  for (const [path, item] of [...inventory].sort((a, b) => a[1].used - b[1].used)) {
    if (total <= MAX_CACHE) break;
    if (path === keep) continue;
    await withAbort(() => rm(path, { force: true }), signal);
    inventory.delete(path);
    total -= item.bytes;
  }
}

/** Render a validated local manifest as a neutral geometry preview. Never downloads provider resources. */
export function modelGeometryThumbnail(manifest: ModelManifest, sourceFingerprint: string, cacheDirectory: string, signal?: AbortSignal): Promise<string> {
  const request = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30_000)]);
  const io = <T>(operation: () => Promise<T>): Promise<T> => withAbort(operation, request);
  const work = serial.catch(() => {}).then(async () => {
    request.throwIfAborted();
    if (manifest.source !== "local" || manifest.surface || !manifest.meshes.length || manifest.meshes.length > 64)
      throw new Error("Geometry thumbnails require a bounded local mesh manifest.");
    const mesh = manifest.defaultMesh ?? manifest.meshes[0];
    if (!FORMATS.has(mesh.format) || mesh.parts?.some(part => !FORMATS.has(part.format)))
      throw new Error("This model format has no bounded geometry-thumbnail renderer.");
    const urls = new Set([mesh.url, ...(mesh.parts ?? []).map(part => part.url)]);
    for (const url of manifest.allowedFileUrls ?? []) {
      if (url.startsWith("file:") && RESOURCE.test(fileURLToPath(url))) urls.add(url);
    }
    if (urls.size > 256) throw new Error("The geometry thumbnail has too many resources.");
    const fingerprints: unknown[] = [];
    let bytes = 0;
    for (const url of urls) {
      request.throwIfAborted();
      if (!url.startsWith("file:")) throw new Error("Geometry thumbnails require local geometry resources.");
      const path = fileURLToPath(url);
      const info = await io(() => lstat(path));
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MODEL) throw new Error("A model resource exceeds the 96 MiB geometry-thumbnail limit or is not a regular file.");
      bytes += info.size;
      if (bytes > MAX_RESOURCES) throw new Error("Geometry-thumbnail resources exceed the 160 MiB limit.");
      fingerprints.push([url, info.size, info.mtimeMs]);
    }
    const key = createHash("sha256").update(JSON.stringify([REVISION, sourceFingerprint, mesh, fingerprints])).digest("hex");
    await io(() => mkdir(cacheDirectory, { recursive: true }));
    const output = join(cacheDirectory, `${key}.png`);
    const existing = await io(() => lstat(output)).catch(error => { request.throwIfAborted(); if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return null; });
    if (existing?.isFile() && !existing.isSymbolicLink() && existing.size > 0 && existing.size < 4 * 1024 * 1024) {
      await trackAndPrune(cacheDirectory, output, existing.size, request);
      return output;
    }
    request.throwIfAborted();
    register();
    const rendererRoot = resolve(__dirname, "../renderer");
    const rendererUrl = pathToFileURL(rendererRoot + sep).href;
    const isolated = session.fromPartition(`geometry-thumbnail-${randomUUID()}`, { cache: false });
    isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) => {
      const ownAsset = details.url.startsWith(rendererUrl) && details.webContentsId !== undefined;
      const geometry = urls.has(details.url) && !["script", "subFrame", "mainFrame"].includes(details.resourceType);
      callback({ cancel: !ownAsset && !geometry });
    });
    const win = new BrowserWindow({ show: false, width: 512, height: 512, useContentSize: true,
      webPreferences: { preload: join(__dirname, "../preload/model-thumbnail.js"), sandbox: true,
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true,
        session: isolated, webSecurity: true } });
    const id = win.webContents.id;
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", event => event.preventDefault());
    let abort = () => {};
    try {
      await new Promise<void>((complete, reject) => {
        let settled = false;
        const finish = (error?: Error) => { if (settled) return; settled = true; error ? reject(error) : complete(); };
        abort = () => finish(new Error(request.reason?.message ?? "Geometry thumbnail cancelled."));
        request.addEventListener("abort", abort, { once: true });
        if (request.aborted) { abort(); return; }
        pending.set(id, { manifest: { ...manifest, meshes: [mesh], defaultMesh: mesh, textures: [], availableQualities: [], alpha: false },
          ready: () => finish(), error: message => finish(new Error(message)) });
        win.webContents.once("render-process-gone", (_event, details) => finish(new Error(`Geometry thumbnail renderer ended (${details.reason}).`)));
        win.once("closed", () => finish(new Error("Geometry thumbnail renderer closed.")));
        void win.loadFile(join(rendererRoot, "thumbnail/index.html")).catch(error => finish(error));
      });
      request.throwIfAborted();
      const image = await io(() => win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 }));
      const png = image.resize({ width: 512, height: 512 }).toPNG();
      if (!png.length || png.length > 4 * 1024 * 1024) throw new Error("The geometry thumbnail could not produce a bounded image.");
      request.throwIfAborted();
      // Reject results if a geometry resource changed while the renderer was loading it.
      for (const [url, size, mtime] of fingerprints as Array<[string, number, number]>) {
        const current = await io(() => stat(fileURLToPath(url)));
        if (current.size !== size || current.mtimeMs !== mtime) throw new Error("The model changed during geometry-thumbnail rendering.");
      }
      const temporary = `${output}.${randomUUID()}.tmp`;
      try { await io(() => writeFile(temporary, png, { flag: "wx" })); request.throwIfAborted(); await io(() => rename(temporary, output)); }
      finally { void rm(temporary, { force: true }).catch(() => {}); }
      await trackAndPrune(cacheDirectory, output, png.length, request);
      return output;
    } finally {
      pending.delete(id);
      request.removeEventListener("abort", abort);
      if (!win.isDestroyed()) win.destroy();
      isolated.webRequest.onBeforeRequest(null);
      await io(() => isolated.clearStorageData()).catch(() => {});
    }
  });
  serial = work.then(() => {}, () => {});
  return withAbort(() => work, request);
}
