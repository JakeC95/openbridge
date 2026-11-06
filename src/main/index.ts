import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { cp, mkdir, readFile, statfs } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { AuthService } from "./auth";
import { LocalApiServer } from "./api-server";
import { BridgeLink } from "./bridge-link";
import { CatalogMetadataProvider } from "./catalog-metadata";
import { CatalogPackBuilder } from "./catalog-pack-builder";
import { buildDownloadPayload, DownloadManager } from "./download-manager";
import { downloadFile, extractZip } from "./downloader";
import { buildExportAsset, sendToSocket, writeMegascansJson } from "./exporter";
import {
  fetchCategories,
  LegacyApi,
  primeMegascansIdIndex,
  searchCatalog,
  searchCatalogIds
} from "./legacy-api";
import { buildBillboardPreviews, buildMapPreviews } from "./map-previews";
import { highResolutionPreview } from "./high-resolution-preview";
import { recommendedDownloadDefaults } from "../shared/download-defaults";
import { LibraryService } from "./library";
import { Logger } from "./logger";
import { PoliigonCatalog } from "./poliigon/catalog";
import { PoliigonAuthService } from "./poliigon/auth";
import { PoliigonDownloadManager } from "./poliigon/download";
import { PolyHavenCatalog } from "./polyhaven/catalog";
import { PolyHavenDownloadManager } from "./polyhaven/download";
import { smartThumbnail } from "./smart-thumbnails";
import { flushLargePreviewCache } from "./preview-cache";
import { SettingsStore } from "./settings";
import { SyncService } from "./sync";
import { UpdateService } from "./updater";
import type {
  AppSettings,
  AuthState,
  CatalogQuery,
  DownloadOptions,
  ExportAsset,
  JsonValidationReport,
  LibraryQuery,
  LibrarySnapshot,
  MapPreviewRequest,
  ScanResult
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let logger: Logger | null = null;
let settingsStore: SettingsStore | null = null;
let library: LibraryService | null = null;
let healthAbort: AbortController | null = null;
let apiServer: LocalApiServer | null = null;
let bridgeLink: BridgeLink | null = null;
let authService: AuthService | null = null;
let legacyApi: LegacyApi | null = null;
let downloads: DownloadManager | null = null;
let syncService: SyncService | null = null;
let updateService: UpdateService | null = null;
let catalogMetadata: CatalogMetadataProvider | null = null;
let poliigonCatalog: PoliigonCatalog | null = null;
let poliigonAuth: PoliigonAuthService | null = null;
let poliigonDownloads: PoliigonDownloadManager | null = null;
let polyhavenCatalog: PolyHavenCatalog | null = null;
let polyhavenDownloads: PolyHavenDownloadManager | null = null;
let catalogueRefreshTimer: ReturnType<typeof setInterval> | null = null;

function exportPath(): string {
  if (process.platform === "win32") {
    return resolve(app.getPath("appData"), "..", "LocalLow", "Quixel", "Megascans Bridge");
  }
  return join(app.getPath("home"), ".quixel", "megascans-bridge");
}

function notify(message: string, error = false): void {
  mainWindow?.webContents.send("app:notification", { message, error });
}

function settings(): AppSettings {
  if (!settingsStore) throw new Error("settings not ready");
  return settingsStore.get();
}

function logFilePath(): string {
  return join(app.getPath("userData"), "logs", "bridge.log");
}

function requireAuth(): AuthService {
  if (!authService) throw new Error("auth not ready");
  return authService;
}

function requireApi(): LegacyApi {
  if (!legacyApi) throw new Error("api not ready");
  return legacyApi;
}

function requireDownloads(): DownloadManager {
  if (!downloads) throw new Error("downloads not ready");
  return downloads;
}

function requireSync(): SyncService {
  if (!syncService) throw new Error("sync not ready");
  return syncService;
}

function requireUpdates(): UpdateService {
  if (!updateService) throw new Error("updater not ready");
  return updateService;
}

function requireCatalogMetadata(): CatalogMetadataProvider {
  if (!catalogMetadata) throw new Error("catalogue metadata provider not ready");
  return catalogMetadata;
}

function requirePoliigon(): PoliigonCatalog {
  if (!poliigonCatalog) throw new Error("Poliigon catalogue is not ready");
  return poliigonCatalog;
}

function requirePoliigonAuth(): PoliigonAuthService {
  if (!poliigonAuth) throw new Error("Poliigon account service is not ready");
  return poliigonAuth;
}

function requirePoliigonDownloads(): PoliigonDownloadManager {
  if (!poliigonDownloads) throw new Error("Poliigon download service is not ready");
  return poliigonDownloads;
}

function requirePolyHaven(): PolyHavenCatalog {
  if (!polyhavenCatalog) throw new Error("Poly Haven catalogue is not ready");
  return polyhavenCatalog;
}

function requirePolyHavenDownloads(): PolyHavenDownloadManager {
  if (!polyhavenDownloads) throw new Error("Poly Haven download service is not ready");
  return polyhavenDownloads;
}

async function validateAssetJson(assetId: string): Promise<JsonValidationReport> {
  if (!library) {
    return { ok: false, assetId, jsonPath: "", error: "Library service is not ready" };
  }
  const record = library.getAsset(assetId);
  if (!record) {
    return { ok: false, assetId, jsonPath: "", error: "Asset is not in the local library" };
  }

  try {
    const raw = JSON.parse(
      (await readFile(record.jsonPath, "utf8")).replace(/^\uFEFF/, "")
    ) as {
      id?: string;
      name?: string;
      categories?: string[];
    };
    const payload = await buildExportAsset(record, exportPath());
    const warnings: string[] = [];
    if (raw.id && raw.id !== assetId) {
      warnings.push(`JSON id "${raw.id}" does not match scanned id "${assetId}"`);
    }
    if (!raw.name) warnings.push("JSON has no name");
    if (!Array.isArray(raw.categories) || raw.categories.length === 0) {
      warnings.push("JSON has no categories");
    }
    if (!record.preview) warnings.push("No preview image found in the asset folder");
    if (payload.components.length === 0 && payload.meshList.length === 0) {
      warnings.push("No components or meshes were discovered");
    }
    return {
      ok: true,
      assetId,
      jsonPath: record.jsonPath,
      name: raw.name ?? record.name,
      categories: raw.categories ?? record.categories,
      components: payload.components.length,
      meshes: payload.meshList.length,
      lods: payload.lodList.length,
      warnings
    };
  } catch (error) {
    return {
      ok: false,
      assetId,
      jsonPath: record.jsonPath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function broadcastLibrary(force = false): Promise<LibrarySnapshot | null> {
  if (!library) return null;
  try {
    const result = await library.snapshot(force);
    mainWindow?.webContents.send("library:updated", result);
    return result;
  } catch (error) {
    logger?.error("Library scan failed", { error });
    notify("Library scan failed. See the log for details.", true);
    return null;
  }
}

async function startServices(): Promise<void> {
  if (!settingsStore || !logger || !library) return;

  await apiServer?.stop();
  await bridgeLink?.stop();

  apiServer = new LocalApiServer({
    getSettings: settings,
    library,
    logger,
    exportPath: exportPath(),
    notify,
    onReload: () => {
      library?.invalidate();
      void broadcastLibrary(true);
    }
  });

  try {
    await apiServer.start();
  } catch (error) {
    logger.error("Could not start the local API", { error });
    notify("Could not start the local API. Is port 28241 already in use?", true);
  }

  bridgeLink = new BridgeLink({
    getApiPort: () => apiServer?.address || settings().apiPort,
    getLibraryPath: () => settings().libraryPath,
    logger,
    onRefresh: () => {
      library?.invalidate();
      void broadcastLibrary(true);
    },
    onRemove: () => {
      library?.invalidate();
      void broadcastLibrary(true);
    }
  });
  bridgeLink.setDiscoveryPort(settings().discoveryPort);
  await bridgeLink.start();
}

async function restartServices(): Promise<void> {
  await startServices();
  await broadcastLibrary(true);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#1b1b1b",
    title: "OpenBridge",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

function signIn(): void {
  if (!mainWindow) return;
  void requireAuth()
    .login(mainWindow)
    .catch(error => notify(error instanceof Error ? error.message : String(error), true));
}

function signOut(): void {
  void requireAuth().logout();
}

function syncNow(): void {
  void requireSync().run();
}

function checkUpdates(): void {
  void requireUpdates()
    .check()
    .then(info => {
      void dialog.showMessageBox({
        type: "info",
        title: "OpenBridge updates",
        message: info.available
          ? `Version ${info.latest} is available`
          : info.error
            ? "Could not check for updates"
            : "OpenBridge is up to date",
        detail: info.error ?? info.notes ?? `Current version: ${info.current}`
      });
    });
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Change Library Folder...",
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ["openDirectory", "createDirectory"]
            });
            if (result.canceled || !result.filePaths[0]) return;
            settingsStore?.update({ libraryPath: result.filePaths[0] });
            library?.invalidate();
            await broadcastLibrary(true);
          }
        },
        {
          label: "Reload Library",
          click: () => {
            library?.invalidate();
            void broadcastLibrary(true);
          }
        },
        {
          label: "Open Library Folder",
          click: () => {
            void shell.openPath(settings().libraryPath);
          }
        },
        { type: "separator" },
        {
          label: "Open Log",
          click: () => {
            if (logger) shell.showItemInFolder(logger.path);
          }
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Account",
      submenu: [
        { label: "Sign in with Epic...", click: signIn },
        { label: "Sign out", click: signOut },
        { type: "separator" },
        { label: "Sync acquired assets", click: syncNow },
        { label: "Check for updates", click: checkUpdates }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About OpenBridge",
          click: () => {
            void dialog.showMessageBox({
              type: "info",
              title: "OpenBridge",
              message: `OpenBridge ${app.getVersion()}`,
              detail:
                "Open-source, clean-room reimplementation of the discontinued Quixel Bridge desktop app.\n\n" +
                `Electron ${process.versions.electron} - Chromium ${process.versions.chrome} - Node ${process.versions.node}`
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => settings());

  ipcMain.handle("settings:update", async (_event, patch: Partial<AppSettings>) => {
    if (!settingsStore) throw new Error("settings not ready");
    const before = settingsStore.get();
    const after = settingsStore.update(patch);

    if (
      before.libraryPath !== after.libraryPath ||
      before.apiPort !== after.apiPort ||
      before.discoveryPort !== after.discoveryPort
    ) {
      await restartServices();
    } else {
      library?.invalidate();
      await broadcastLibrary(true);
    }

    if (
      before.autoSyncEnabled !== after.autoSyncEnabled ||
      before.syncIntervalMinutes !== after.syncIntervalMinutes ||
      before.libraryPath !== after.libraryPath
    ) {
      syncService?.restart();
    }

    return after;
  });

  ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("library:list", async (_event, force?: boolean) => {
    if (!library) throw new Error("Library service is not ready");
    return library.scan(Boolean(force));
  });

  ipcMain.handle("library:snapshot", async (_event, force?: boolean) => {
    if (!library) throw new Error("Library service is not ready");
    return library.snapshot(Boolean(force));
  });

  ipcMain.handle("library:query", async (_event, query: LibraryQuery) => {
    if (!library) throw new Error("Library service is not ready");
    await library.snapshot(false);
    return library.query(query);
  });

  ipcMain.handle("library:ids", async (_event, query: LibraryQuery) => {
    if (!library) throw new Error("Library service is not ready");
    await library.snapshot(false);
    return library.ids(query);
  });
  ipcMain.handle("library:previews", async (_event, assetId: string, indexedPath?: string) => {
    if (!library || typeof assetId !== "string") throw new Error("Invalid local asset");
    return library.previews(assetId, indexedPath);
  });

  ipcMain.handle("library:health", async (_event, force?: boolean) => {
    if (!library) throw new Error("Library service is not ready");
    if (healthAbort) throw new Error("A library health scan is already running");
    const controller = new AbortController(); healthAbort = controller;
    try { return await library.health(Boolean(force), progress => {
      mainWindow?.webContents.send("library:healthProgress", progress);
    }, controller.signal); } finally { if (healthAbort === controller) healthAbort = null; }
  });
  ipcMain.handle("library:cancelHealth", () => { healthAbort?.abort(); });

  ipcMain.handle("library:removeAssets", async (_event, assetIds: string[], scope?: LibraryQuery) => {
    if (!library) throw new Error("Library service is not ready");
    const result = await library.removeAssets(assetIds, scope);
    await broadcastLibrary(true);
    return result;
  });

  ipcMain.handle(
    "library:exportAssets",
    async (_event, assetIds: string[], folder: string, scope?: LibraryQuery) => {
      if (!library) throw new Error("Library service is not ready");
      const records = library.matchingAssets(assetIds, scope);
      const payload = await Promise.all(
        records.map(asset => buildExportAsset(asset, exportPath()))
      );
      return writeMegascansJson(folder, payload);
    }
  );

  ipcMain.handle("library:importFolder", async () => {
    if (!settingsStore) throw new Error("settings not ready");
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const destination = join(settings().libraryPath, "Custom", basename(source));
    await mkdir(join(settings().libraryPath, "Custom"), { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
    library?.invalidate();
    await broadcastLibrary(true);
    notify(`Imported ${basename(source)}`);
    return destination;
  });

  ipcMain.handle("library:importZip", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Zip archives", extensions: ["zip"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const zip = result.filePaths[0];
    const folder = basename(zip, extname(zip));
    const destination = join(settings().libraryPath, "Custom", folder);
    await mkdir(destination, { recursive: true });
    await extractZip(zip, destination);
    library?.invalidate();
    await broadcastLibrary(true);
    notify(`Imported ${folder}`);
    return destination;
  });

  ipcMain.handle("app:openPath", async (_event, target: string) => {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  });
  ipcMain.handle("app:openExternal", async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error("Only web links can be opened externally");
    await shell.openExternal(url);
  });

  ipcMain.handle("app:openLogs", () => {
    if (logger) shell.showItemInFolder(logger.path);
  });

  ipcMain.handle("thumb:smart", (_event, source: string) => {
    if (typeof source !== "string" || !/^(?:https?|file):/i.test(source)) return source;
    return smartThumbnail(source);
  });

  ipcMain.handle("export:send", async (_event, port: number, data: ExportAsset[]) => {
    await sendToSocket(port, data);
  });

  ipcMain.handle("export:writeJson", async (_event, folder: string, data: ExportAsset[]) => {
    return writeMegascansJson(folder, data);
  });

  ipcMain.handle("export:assetToFolder", async (_event, assetId: string, folder: string) => {
    const record = library?.getAsset(assetId);
    if (!record) throw new Error(`Asset ${assetId} is not in the library`);
    const payload = await buildExportAsset(record, exportPath());
    return writeMegascansJson(folder, [payload]);
  });

  ipcMain.handle("export:assetToPort", async (_event, assetId: string, port: number) => {
    const record = library?.getAsset(assetId);
    if (!record) throw new Error(`Asset ${assetId} is not in the library`);
    const payload = await buildExportAsset(record, exportPath());
    await sendToSocket(port, [payload]);
  });

  ipcMain.handle("download:file", async (_event, url: string, destination: string) => {
    return downloadFile(url, destination, undefined, 30);
  });

  ipcMain.handle("auth:state", () => requireAuth().state());
  ipcMain.handle("auth:login", async () => {
    const current = requireAuth().state();
    if (current.loggedIn) return current;
    return requireAuth().login(mainWindow);
  });
  ipcMain.handle("auth:logout", () => requireAuth().logout());
  ipcMain.handle("auth:profile", () => requireAuth().ensureProfile());

  const resolveCatalogQuery = (query: CatalogQuery): CatalogQuery => {
    if (!query.pack) return query;
    const ids = requireCatalogMetadata().packIds(query.pack);
    const allowed = query.ids ? new Set(query.ids) : null;
    return { ...query, ids: allowed ? ids.filter(id => allowed.has(id)) : ids };
  };
  const searches = new Map<string, AbortController>();
  const scopedRequest = async <T>(sender: number, scope: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const key = `${sender}:${scope}`;
    searches.get(key)?.abort();
    const controller = new AbortController(); searches.set(key, controller);
    try { return await work(controller.signal); }
    finally { if (searches.get(key) === controller) searches.delete(key); }
  };
  ipcMain.handle("catalog:cancel", (event, scope: string) => {
    if (!["discover", "related", "drawer", "preview"].includes(scope)) return;
    const key = `${event.sender.id}:${scope}`;
    searches.get(key)?.abort(); searches.delete(key);
  });
  ipcMain.handle("catalog:search", async (event, query: CatalogQuery, scope?: string) => {
    if (scope !== "discover" && scope !== "related") return searchCatalog(resolveCatalogQuery(query));
    return scopedRequest(event.sender.id, scope, signal => searchCatalog(resolveCatalogQuery(query), signal));
  });
  ipcMain.handle("catalog:ids", (_event, query: CatalogQuery) => searchCatalogIds(resolveCatalogQuery(query)));
  ipcMain.handle("catalog:categories", () => fetchCategories());
  ipcMain.handle("catalog:extended", (event, assetId: string, scope?: string) =>
    scope === "drawer" ? scopedRequest(event.sender.id, "drawer", signal => requireApi().extended(assetId, signal)) : requireApi().extended(assetId)
  );
  ipcMain.handle("catalog:mapPreviews", async (_event, assetId: string) => {
    const [asset, signedBase] = await Promise.all([requireApi().extended(assetId), requireApi().signedMapsUrl()]);
    const previews = buildMapPreviews(asset, signedBase);
    if ((asset.billboards?.length ?? 0) > 0) {
      try {
        const options: DownloadOptions = {
          resolution: 1024,
          textureFormat: "jpg",
          components: [],
          meshFormat: "fbx",
          lods: Array.from({ length: 9 }, () => false),
          downloadAllPlantLods: false,
          highpoly: false,
          ztool: false,
          brushes: false,
          uniqueMapsPerLod: false,
          billboards: true,
          variation: 1
        };
        const response = await requireApi().requestDownload(
          buildDownloadPayload(asset, assetId, options)
        );
        previews.push(...buildBillboardPreviews(response));
      } catch (error) {
        logger?.warn("Billboard preview signing failed", { assetId, error });
      }
    }
    return previews;
  });
  ipcMain.handle("catalog:highResolutionPreview", (event, assetId: string, map: MapPreviewRequest) =>
    scopedRequest(event.sender.id, "preview", signal => highResolutionPreview(requireApi(), assetId, map, signal))
  );
  ipcMain.handle("catalog:acquired", () => requireApi().acquired());
  ipcMain.handle("catalog:favorites", () => requireApi().favorites());
  ipcMain.handle("catalog:addFavorite", (_event, assetId: string) =>
    requireApi().addFavorite(assetId)
  );
  ipcMain.handle("catalog:removeFavorite", (_event, assetId: string) =>
    requireApi().removeFavorite(assetId)
  );
  ipcMain.handle("library:validateJson", (_event, assetId: string) =>
    validateAssetJson(assetId)
  );

  ipcMain.handle(
    "context-menu:asset",
    (
      event,
      payload: { assetId: string; localPath?: string | null; link?: string | null }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
      const menu = Menu.buildFromTemplate([
        ...(payload.localPath
          ? [
              {
                label: "Go to Files",
                click: () => void shell.openPath(payload.localPath!)
              }
            ]
          : []),
        {
          label: "Copy Asset ID",
          click: () => clipboard.writeText(payload.assetId)
        },
        {
          label: "Copy Asset Link",
          click: () =>
            clipboard.writeText(
              payload.link ?? `https://quixel.com/assets/${payload.assetId}`
            )
        },
        ...(payload.localPath
          ? [
              { type: "separator" as const },
              {
                label: "Validate Asset JSON",
                click: () => {
                  void validateAssetJson(payload.assetId).then(report => {
                    const detail = report.ok
                      ? [
                          report.name,
                          report.categories?.join(" - "),
                          "",
                          `Components: ${report.components}`,
                          `Meshes: ${report.meshes}`,
                          `LODs: ${report.lods}`,
                          `JSON: ${report.jsonPath}`,
                          ...(report.warnings?.length
                            ? ["", "Warnings:", ...report.warnings.map(w => `- ${w}`)]
                            : [])
                        ]
                          .filter(Boolean)
                          .join("\n")
                      : report.error ?? "Unknown error";
                    const options = {
                      type: report.ok ? ("info" as const) : ("error" as const),
                      title: "Asset JSON",
                      message: report.ok ? "Asset JSON is valid" : "Asset JSON validation failed",
                      detail
                    };
                    void (win
                      ? dialog.showMessageBox(win, options)
                      : dialog.showMessageBox(options));
                  });
                }
              }
            ]
          : [])
      ]);
      if (win) menu.popup({ window: win });
      else menu.popup();
    }
  );

  ipcMain.handle("context-menu:search", event => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
    const send = (search: boolean): void => {
      mainWindow?.webContents.send("search:paste", {
        text: clipboard.readText(),
        search
      });
    };
    const menu = Menu.buildFromTemplate([
      { label: "Paste", click: () => send(false) },
      { label: "Paste and Search", click: () => send(true) }
    ]);
    if (win) menu.popup({ window: win });
    else menu.popup();
  });

  ipcMain.handle(
    "downloads:start",
    (_event, assetId: string, options?: unknown, provider?: string) => {
      if (provider === "polyhaven" || assetId.startsWith("polyhaven:")) {
        return requirePolyHavenDownloads().start(assetId, options as never);
      }
      if (provider === "poliigon" || assetId.startsWith("poliigon:")) {
        return requirePoliigonDownloads().start(assetId, options as never);
      }
      return requireDownloads().start(assetId, options as never);
    }
  );
  ipcMain.handle(
    "downloads:startMany",
    (_event, assetIds: string[], options?: unknown, provider?: string) => {
      if (provider === "polyhaven" || (assetIds.length > 0 && assetIds.every(id => id.startsWith("polyhaven:")))) {
        return requirePolyHavenDownloads().startMany(assetIds, options as never);
      }
      if (provider === "poliigon" || (assetIds.length > 0 && assetIds.every(id => id.startsWith("poliigon:")))) {
        return requirePoliigonDownloads().startMany(assetIds, options as never);
      }
      return requireDownloads().startMany(assetIds, options as never);
    }
  );
  ipcMain.handle("downloads:acquire", (_event, assetId: string) =>
    requireDownloads().acquire(assetId)
  );
  ipcMain.handle("downloads:cancel", (_event, assetId: string) => {
    if (assetId.startsWith("polyhaven:") || polyhavenDownloads?.has(assetId)) {
      requirePolyHavenDownloads().cancel(assetId);
      return;
    }
    if (assetId.startsWith("poliigon:") || poliigonDownloads?.has(assetId)) {
      requirePoliigonDownloads().cancel(assetId);
      return;
    }
    requireDownloads().cancel(assetId);
  });
  ipcMain.handle("downloads:retry", (_event, assetId: string) => {
    if (assetId.startsWith("polyhaven:") || polyhavenDownloads?.has(assetId)) {
      return requirePolyHavenDownloads().retry(assetId);
    }
    if (assetId.startsWith("poliigon:") || poliigonDownloads?.has(assetId)) {
      return requirePoliigonDownloads().retry(assetId);
    }
    return requireDownloads().retry(assetId);
  });
  ipcMain.handle("downloads:pause", (_event, assetId: string) => {
    if (assetId.startsWith("polyhaven:") || polyhavenDownloads?.has(assetId)) {
      return requirePolyHavenDownloads().pause(assetId);
    }
    if (assetId.startsWith("poliigon:") || poliigonDownloads?.has(assetId)) {
      return requirePoliigonDownloads().pause(assetId);
    }
    return requireDownloads().pause(assetId);
  });
  ipcMain.handle("downloads:resume", (_event, assetId: string) => {
    if (assetId.startsWith("polyhaven:") || polyhavenDownloads?.has(assetId)) {
      return requirePolyHavenDownloads().resume(assetId);
    }
    if (assetId.startsWith("poliigon:") || poliigonDownloads?.has(assetId)) {
      return requirePoliigonDownloads().resume(assetId);
    }
    return requireDownloads().resume(assetId);
  });
  ipcMain.handle("downloads:cancelAll", async () => {
    requireDownloads().cancelAll();
    await requirePoliigonDownloads().cancelAll();
    await requirePolyHavenDownloads().cancelAll();
  });
  ipcMain.handle("downloads:pauseAll", async () => {
    await Promise.all([
      requireDownloads().pauseAll(),
      requirePoliigonDownloads().pauseAll(),
      requirePolyHavenDownloads().pauseAll()
    ]);
  });
  ipcMain.handle("downloads:resumeAll", async () => {
    await Promise.all([
      requireDownloads().resumeAll(),
      requirePoliigonDownloads().resumeAll(),
      requirePolyHavenDownloads().resumeAll()
    ]);
  });
  ipcMain.handle("downloads:clearFinished", () => {
    requireDownloads().clearFinished();
    requirePoliigonDownloads().clearFinished();
    requirePolyHavenDownloads().clearFinished();
  });
  ipcMain.handle("downloads:list", () => [
    ...requireDownloads().list(),
    ...requirePoliigonDownloads().list(),
    ...requirePolyHavenDownloads().list()
  ]);
  ipcMain.handle("downloads:overview", async () => {
    const mega = requireDownloads().overview();
    const poliigon = requirePoliigonDownloads().overview();
    const polyhaven = requirePolyHavenDownloads().overview();
    const poliigonJobs = requirePoliigonDownloads().list();
    const polyhavenJobs = requirePolyHavenDownloads().list();
    const libraryPath = polyhavenJobs.length > 0
      ? settings().polyhavenLibraryPath
      : poliigonJobs.length > 0
        ? settings().poliigonLibraryPath
        : settings().libraryPath;
    const measured = poliigonJobs.length > 0 || polyhavenJobs.length > 0
      ? { measuredLibraryBytes: 0, measuredAssets: 0, totalAssets: 0 }
      : library?.storageSummary() ?? { measuredLibraryBytes: 0, measuredAssets: 0, totalAssets: 0 };
    let totalBytes: number | null = null;
    let freeBytes: number | null = null;
    let error: string | undefined;
    try {
      const volume = await statfs(libraryPath);
      totalBytes = Number(volume.blocks) * Number(volume.bsize);
      freeBytes = Number(volume.bavail) * Number(volume.bsize);
    } catch {
      error = "Disk space unavailable. Check that the library folder is accessible.";
    }
    const histories = [mega.history, poliigon.history, polyhaven.history];
    return {
      history: histories.sort((a, b) => b.length - a.length)[0],
      historyError: mega.historyError || poliigon.historyError || polyhaven.historyError,
      session: {
        receivedBytes: mega.session.receivedBytes + poliigon.session.receivedBytes + polyhaven.session.receivedBytes,
        completed: mega.session.completed + poliigon.session.completed + polyhaven.session.completed,
        averageBytesPerSecond: mega.session.averageBytesPerSecond + poliigon.session.averageBytesPerSecond + polyhaven.session.averageBytesPerSecond,
        peakBytesPerSecond: Math.max(mega.session.peakBytesPerSecond, poliigon.session.peakBytesPerSecond, polyhaven.session.peakBytesPerSecond)
      },
      disk: { libraryPath, ...measured, totalBytes, freeBytes, error }
    };
  });

  ipcMain.handle("catalog:metadata:status", () => requireCatalogMetadata().status());
  ipcMain.handle("catalog:metadata:packs", () => requireCatalogMetadata().packs());
  ipcMain.handle("catalog:metadata:lookup", (_event, ids: string[]) =>
    requireCatalogMetadata().lookup(ids)
  );
  ipcMain.handle("catalog:metadata:import", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "OpenBridge metadata packs", extensions: ["gz", "ndjson", "json"] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return requireCatalogMetadata().status();
    return requireCatalogMetadata().importPack(result.filePaths[0]);
  });
  ipcMain.handle("catalog:metadata:download", () =>
    requireCatalogMetadata().installFromUrl()
  );
  ipcMain.handle("catalog:metadata:remove", () => requireCatalogMetadata().remove());

  ipcMain.handle("poliigon:status", () => requirePoliigon().status());
  ipcMain.handle("poliigon:refresh", () => requirePoliigon().refresh());
  ipcMain.handle("poliigon:categories", () => requirePoliigon().categories());
  ipcMain.handle("poliigon:search", (_event, query) => requirePoliigon().query(query));
  ipcMain.handle("poliigon:ids", (_event, query) => requirePoliigon().ids(query));
  ipcMain.handle("poliigon:extended", (_event, assetId: number) => {
    if (!Number.isFinite(assetId)) throw new Error("Invalid Poliigon asset id");
    return requirePoliigon().extended(assetId);
  });
  ipcMain.handle("poliigon:mapPreviews", (_event, assetId: number) => {
    if (!Number.isFinite(assetId)) throw new Error("Invalid Poliigon asset id");
    return requirePoliigonDownloads().previewMaps(assetId);
  });
  ipcMain.handle("poliigon:highResolutionMapPreview", (_event, assetId: number, mapType: string) => {
    if (!Number.isFinite(assetId)) throw new Error("Invalid Poliigon asset id");
    return requirePoliigonDownloads().highResolutionMapPreview(assetId, mapType);
  });
  ipcMain.handle("poliigon:hdrPreview", (_event, assetId: number) => {
    if (!Number.isFinite(assetId)) throw new Error("Invalid Poliigon asset id");
    return requirePoliigonDownloads().hdrPreview(assetId);
  });
  ipcMain.handle("poliigon:auth:state", () => requirePoliigonAuth().state());
  ipcMain.handle("poliigon:auth:login", (_event, email: string, password: string) =>
    requirePoliigonAuth().login(email, password)
  );
  ipcMain.handle("poliigon:auth:loginBrowser", () => requirePoliigonAuth().loginWithBrowser());
  ipcMain.handle("poliigon:auth:cancelBrowser", () => requirePoliigonAuth().cancelBrowserLogin());
  ipcMain.handle("poliigon:auth:logout", () => requirePoliigonAuth().logout());
  ipcMain.handle("poliigon:auth:refresh", () => requirePoliigonAuth().refreshAccount(true));
  ipcMain.handle("poliigon:auth:owned", () => requirePoliigonAuth().ownedIds());
  ipcMain.handle("poliigon:auth:recentDownloads", () => requirePoliigonAuth().recentDownloads());
  ipcMain.handle("poliigon:auth:syncOwned", () => requirePoliigonAuth().syncOwned());

  ipcMain.handle("polyhaven:status", () => requirePolyHaven().status());
  ipcMain.handle("polyhaven:refresh", () => requirePolyHaven().refresh());
  ipcMain.handle("polyhaven:categories", () => requirePolyHaven().categories());
  ipcMain.handle("polyhaven:search", (_event, query) => requirePolyHaven().query(query));
  ipcMain.handle("polyhaven:ids", (_event, query) => requirePolyHaven().ids(query));
  ipcMain.handle("polyhaven:extended", (_event, assetId: string) => {
    if (typeof assetId !== "string" || !assetId) throw new Error("Invalid Poly Haven asset id");
    return requirePolyHaven().extended(assetId);
  });
  ipcMain.handle("polyhaven:mapPreviews", (_event, assetId: string) => {
    if (typeof assetId !== "string" || !assetId) throw new Error("Invalid Poly Haven asset id");
    return requirePolyHavenDownloads().previewMaps(assetId);
  });
  ipcMain.handle("polyhaven:highResolutionMapPreview", (_event, assetId: string, mapType: string) => {
    if (typeof assetId !== "string" || !assetId) throw new Error("Invalid Poly Haven asset id");
    return requirePolyHavenDownloads().highResolutionMapPreview(assetId, mapType);
  });
  ipcMain.handle("polyhaven:hdrPreview", (_event, assetId: string) => {
    if (typeof assetId !== "string" || !assetId) throw new Error("Invalid Poly Haven asset id");
    return requirePolyHavenDownloads().hdrPreview(assetId);
  });

  ipcMain.handle("sync:status", () => requireSync().current());
  ipcMain.handle("sync:run", () => requireSync().run());

  ipcMain.handle("updates:check", () => requireUpdates().check());
  ipcMain.handle("updates:install", (_event, info) => requireUpdates().install(info));

  ipcMain.handle("app:versions", () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }));
}

async function init(): Promise<void> {
  app.setAppUserModelId("org.openbridge.app");

  const userData = app.getPath("userData");
  await mkdir(join(userData, "logs"), { recursive: true });
  logger = new Logger(logFilePath());

  const defaults: AppSettings = {
    libraryRoot: join(app.getPath("documents"), "OpenBridge"),
    libraryPath: join(app.getPath("documents"), "OpenBridge", "Megascans"),
    poliigonLibraryPath: join(app.getPath("documents"), "OpenBridge", "Poliigon"),
    polyhavenLibraryPath: join(app.getPath("documents"), "OpenBridge", "PolyHaven"),
    poliigonConfirmPurchases: true,
    apiPort: 28241,
    discoveryPort: 28852,
    autoSyncEnabled: true,
    syncIntervalMinutes: 30,
    downloadDefaults: recommendedDownloadDefaults()
  };

  settingsStore = new SettingsStore(join(userData, "settings.json"), defaults);
  library = new LibraryService(
    () => settings().libraryPath,
    () => settings().poliigonLibraryPath,
    () => settings().polyhavenLibraryPath,
    assetName => poliigonCatalog?.findByAssetName(assetName) ?? null,
    id => polyhavenCatalog?.findById(id) ?? polyhavenCatalog?.findByName(id) ?? null,
    join(userData, "library-index.sqlite"),
    logger
  );

  authService = new AuthService(logger, notify);
  await authService.load();
  poliigonAuth = new PoliigonAuthService(
    logger,
    url => {
      if (/^https:\/\//i.test(url)) void shell.openExternal(url).catch(() => undefined);
    },
    notify
  );
  await poliigonAuth.load();
  poliigonAuth.onChanged(state => {
    mainWindow?.webContents.send("poliigon:auth:changed", state);
  });
  legacyApi = new LegacyApi(authService, logger);
  const packArg = process.argv.find(arg => arg.startsWith("--build-catalog-pack="));
  if (packArg) {
    const outputPath = resolve(packArg.slice("--build-catalog-pack=".length));
    const limit = Number(
      process.argv.find(arg => arg.startsWith("--catalog-limit="))?.split("=")[1] ?? 0
    );
    const concurrency = Number(
      process.argv.find(arg => arg.startsWith("--catalog-concurrency="))?.split("=")[1] ?? 8
    );
    try {
      if (!authService.state().loggedIn) throw new Error("Log in before building a metadata pack");
      await new CatalogPackBuilder(legacyApi, logger).build(outputPath, {
        limit: limit > 0 ? limit : undefined,
        concurrency: concurrency > 0 ? concurrency : 8
      });
      app.quit();
    } catch (error) {
      logger.error("Catalogue metadata pack build failed", { error });
      app.exit(1);
    }
    return;
  }
  downloads = new DownloadManager(
    authService,
    legacyApi,
    logger,
    () => settings(),
    () => settings().libraryPath,
    () => {
      library?.invalidate();
      void broadcastLibrary(true);
    },
    notify
  );
  syncService = new SyncService(
    legacyApi,
    downloads,
    library,
    settings,
    logger,
    notify
  );
  updateService = new UpdateService(logger);
  catalogMetadata = new CatalogMetadataProvider(
    join(userData, "catalog-metadata.sqlite"),
    logger
  );
  poliigonCatalog = new PoliigonCatalog(
    join(userData, "poliigon-catalog.sqlite"),
    logger
  );
  poliigonCatalog.onStatus(status => {
    mainWindow?.webContents.send("poliigon:status", status);
    if (status.state === "ready") {
      library?.invalidate();
      void broadcastLibrary(true);
    }
  });
  poliigonDownloads = new PoliigonDownloadManager(
    poliigonAuth,
    poliigonCatalog,
    logger,
    () => settings().poliigonLibraryPath,
    notify,
    undefined,
    () => {
      library?.invalidate();
      void broadcastLibrary(true);
    }
  );
  poliigonDownloads.onProgress(progress => {
    mainWindow?.webContents.send("downloads:progress", progress);
  });
  polyhavenCatalog = new PolyHavenCatalog(
    join(userData, "polyhaven-catalog.sqlite"),
    logger
  );
  let lastPolyHavenLibraryCount = 0;
  polyhavenCatalog.onStatus(status => {
    mainWindow?.webContents.send("polyhaven:status", status);
    // Only rescan the disk after the catalogue (and its file metadata) is fully
    // ready, not on every background enrichment progress tick.
    if (
      status.state === "ready" &&
      status.count > 0 &&
      status.enriched >= status.count &&
      lastPolyHavenLibraryCount !== status.count
    ) {
      lastPolyHavenLibraryCount = status.count;
      library?.invalidate();
      void broadcastLibrary(true);
    }
  });
  polyhavenDownloads = new PolyHavenDownloadManager(
    polyhavenCatalog,
    logger,
    () => settings().polyhavenLibraryPath,
    notify,
    undefined,
    () => {
      library?.invalidate();
      void broadcastLibrary(true);
    }
  );
  polyhavenDownloads.onProgress(progress => {
    mainWindow?.webContents.send("downloads:progress", progress);
  });
  const importPackArg = process.argv.find(arg =>
    arg.startsWith("--import-catalog-pack=")
  );
  if (importPackArg) {
    try {
      const status = await catalogMetadata.importPack(
        resolve(importPackArg.slice("--import-catalog-pack=".length))
      );
      logger.info("Catalogue metadata pack imported from CLI", { status });
      app.quit();
    } catch (error) {
      logger.error("Catalogue metadata pack import failed", { error });
      app.exit(1);
    }
    return;
  }

  downloads.onProgress(progress => {
    mainWindow?.webContents.send("downloads:progress", progress);
  });
  syncService.onStatus(status => {
    mainWindow?.webContents.send("sync:status", status);
  });
  authService.onChanged((state: AuthState) => {
    mainWindow?.webContents.send("auth:changed", state);
    if (state.loggedIn) {
      syncService?.start();
      void syncService?.run();
    } else {
      syncService?.stop();
    }
  });

  logger.info("OpenBridge starting", {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    libraryPath: settings().libraryPath,
    loggedIn: authService.state().loggedIn
  });

  registerIpc();
  buildMenu();
  await startServices();
  createWindow();
  await broadcastLibrary();
  void poliigonCatalog.ensureReady();
  void polyhavenCatalog.ensureReady();
  void primeMegascansIdIndex();
  // Keep checking for newly published assets while the app stays open. The
  // catalogue's own TTL decides whether this performs a network refresh.
  catalogueRefreshTimer = setInterval(() => {
    void poliigonCatalog?.ensureReady();
    void polyhavenCatalog?.ensureReady();
  }, 2 * 60 * 60 * 1000);
  app.on("browser-window-focus", () => {
    void poliigonCatalog?.ensureReady();
    void polyhavenCatalog?.ensureReady();
  });

  if (authService.state().loggedIn) {
    syncService.start();
    void syncService.run();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app
    .whenReady()
    .then(init)
    .catch(error => {
      console.error("Failed to start OpenBridge", error);
      dialog.showErrorBox("OpenBridge failed to start", String(error));
      app.quit();
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    downloads?.flushQueue();
    syncService?.stop();
    void apiServer?.stop();
    void bridgeLink?.stop();
  });
  app.on("will-quit", () => {
    if (catalogueRefreshTimer) {
      clearInterval(catalogueRefreshTimer);
      catalogueRefreshTimer = null;
    }
    downloads?.closeHistory();
    poliigonDownloads?.closeHistory();
    polyhavenDownloads?.closeHistory();
    poliigonAuth?.cancelBrowserLogin();
    poliigonCatalog?.close();
    polyhavenCatalog?.close();
    const flushed = flushLargePreviewCache();
    if (flushed.removed > 0) {
      console.log(
        `Flushed ${flushed.removed} large preview cache file${flushed.removed === 1 ? "" : "s"} (${Math.round(flushed.bytes / (1024 * 1024))} MB)`
      );
    }
  });
}



