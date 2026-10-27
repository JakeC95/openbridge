import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { cp, mkdir, readFile } from "node:fs/promises";
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
  searchCatalog,
  searchCatalogIds
} from "./legacy-api";
import { buildBillboardPreviews, buildMapPreviews } from "./map-previews";
import { recommendedDownloadDefaults } from "../shared/download-defaults";
import { LibraryService } from "./library";
import { Logger } from "./logger";
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
  ScanResult
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let logger: Logger | null = null;
let settingsStore: SettingsStore | null = null;
let library: LibraryService | null = null;
let apiServer: LocalApiServer | null = null;
let bridgeLink: BridgeLink | null = null;
let authService: AuthService | null = null;
let legacyApi: LegacyApi | null = null;
let downloads: DownloadManager | null = null;
let syncService: SyncService | null = null;
let updateService: UpdateService | null = null;
let catalogMetadata: CatalogMetadataProvider | null = null;

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

  ipcMain.handle("library:health", async (_event, force?: boolean) => {
    if (!library) throw new Error("Library service is not ready");
    return library.health(Boolean(force), progress => {
      mainWindow?.webContents.send("library:healthProgress", progress);
    });
  });

  ipcMain.handle("library:removeAssets", async (_event, assetIds: string[]) => {
    if (!library) throw new Error("Library service is not ready");
    const result = await library.removeAssets(assetIds);
    await broadcastLibrary(true);
    return result;
  });

  ipcMain.handle(
    "library:exportAssets",
    async (_event, assetIds: string[], folder: string) => {
      if (!library) throw new Error("Library service is not ready");
      const records = library.getAssets(assetIds);
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

  ipcMain.handle("app:openLogs", () => {
    if (logger) shell.showItemInFolder(logger.path);
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

  ipcMain.handle("catalog:search", (_event, query: CatalogQuery) => searchCatalog(query));
  ipcMain.handle("catalog:ids", (_event, query: CatalogQuery) => searchCatalogIds(query));
  ipcMain.handle("catalog:categories", () => fetchCategories());
  ipcMain.handle("catalog:extended", (_event, assetId: string) =>
    requireApi().extended(assetId)
  );
  ipcMain.handle("catalog:mapPreviews", async (_event, assetId: string) => {
    const asset = await requireApi().extended(assetId);
    const signedBase = await requireApi().signedMapsUrl();
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
    (_event, assetId: string, options?: Partial<DownloadOptions>) =>
      requireDownloads().start(assetId, options)
  );
  ipcMain.handle(
    "downloads:startMany",
    (_event, assetIds: string[], options?: Partial<DownloadOptions>) =>
      requireDownloads().startMany(assetIds, options)
  );
  ipcMain.handle("downloads:acquire", (_event, assetId: string) =>
    requireDownloads().acquire(assetId)
  );
  ipcMain.handle("downloads:cancel", (_event, assetId: string) =>
    requireDownloads().cancel(assetId)
  );
  ipcMain.handle("downloads:pause", (_event, assetId: string) =>
    requireDownloads().pause(assetId)
  );
  ipcMain.handle("downloads:resume", (_event, assetId: string) =>
    requireDownloads().resume(assetId)
  );
  ipcMain.handle("downloads:cancelAll", () => requireDownloads().cancelAll());
  ipcMain.handle("downloads:pauseAll", () => requireDownloads().pauseAll());
  ipcMain.handle("downloads:resumeAll", () => requireDownloads().resumeAll());
  ipcMain.handle("downloads:clearFinished", () => requireDownloads().clearFinished());
  ipcMain.handle("downloads:list", () => requireDownloads().list());

  ipcMain.handle("catalog:metadata:status", () => requireCatalogMetadata().status());
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
    libraryPath: join(app.getPath("documents"), "Megascans Library"),
    apiPort: 28241,
    discoveryPort: 28852,
    autoSyncEnabled: true,
    syncIntervalMinutes: 30,
    downloadDefaults: recommendedDownloadDefaults()
  };

  settingsStore = new SettingsStore(join(userData, "settings.json"), defaults);
  library = new LibraryService(
    () => settings().libraryPath,
    join(userData, "library-index.sqlite"),
    logger
  );

  authService = new AuthService(logger, notify);
  await authService.load();
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
}



