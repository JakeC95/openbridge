import { contextBridge, ipcRenderer } from "electron";
import { pathToFileURL } from "node:url";
import type {
  AppSettings,
  AuthState,
  BatchStartResult,
  CatalogIdResult,
  CatalogQuery,
  CatalogResult,
  CategoryNode,
  DownloadOptions,
  DownloadProgress,
  ExportAsset,
  ExtendedAsset,
  JsonValidationReport,
  LibraryHealthProgress,
  LibraryHealthReport,
  LibraryQuery,
  LibraryQueryResult,
  LibrarySnapshot,
  MapPreview,
  OpenBridgeApi,
  Profile,
  ScanResult,
  SyncStatus,
  UpdateInfo
} from "../shared/types";

const api: OpenBridgeApi = {
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke("settings:update", patch) as Promise<AppSettings>,
  chooseDirectory: () => ipcRenderer.invoke("dialog:selectDirectory") as Promise<string | null>,
  listAssets: (force = false) => ipcRenderer.invoke("library:list", force) as Promise<ScanResult>,
  librarySnapshot: (force = false) =>
    ipcRenderer.invoke("library:snapshot", force) as Promise<LibrarySnapshot>,
  queryLibrary: (query: LibraryQuery) =>
    ipcRenderer.invoke("library:query", query) as Promise<LibraryQueryResult>,
  queryLibraryIds: (query: LibraryQuery) =>
    ipcRenderer.invoke("library:ids", query) as Promise<string[]>,
  libraryHealth: (force = false) =>
    ipcRenderer.invoke("library:health", force) as Promise<LibraryHealthReport>,
  onLibraryHealthProgress: callback => {
    const listener = (_event: unknown, progress: LibraryHealthProgress): void => callback(progress);
    ipcRenderer.on("library:healthProgress", listener);
    return () => ipcRenderer.removeListener("library:healthProgress", listener);
  },
  removeLibraryAssets: (assetIds: string[]) =>
    ipcRenderer.invoke("library:removeAssets", assetIds) as Promise<{ removed: number }>,
  exportLibraryAssets: (assetIds: string[], folder: string) =>
    ipcRenderer.invoke("library:exportAssets", assetIds, folder) as Promise<string>,
  openPath: target => ipcRenderer.invoke("app:openPath", target) as Promise<void>,
  openLogs: () => ipcRenderer.invoke("app:openLogs") as Promise<void>,
  sendExport: (port, data: ExportAsset[]) =>
    ipcRenderer.invoke("export:send", port, data) as Promise<void>,
  writeExport: (folder, data: ExportAsset[]) =>
    ipcRenderer.invoke("export:writeJson", folder, data) as Promise<string>,
  exportAssetToFolder: (assetId, folder) =>
    ipcRenderer.invoke("export:assetToFolder", assetId, folder) as Promise<string>,
  exportAssetToPort: (assetId, port) =>
    ipcRenderer.invoke("export:assetToPort", assetId, port) as Promise<void>,
  downloadFile: (url, destination) =>
    ipcRenderer.invoke("download:file", url, destination) as Promise<string>,
  importFolder: () => ipcRenderer.invoke("library:importFolder") as Promise<string | null>,
  importZip: () => ipcRenderer.invoke("library:importZip") as Promise<string | null>,
  validateAssetJson: assetId =>
    ipcRenderer.invoke("library:validateJson", assetId) as Promise<JsonValidationReport>,
  toFileUrl: target => pathToFileURL(target).href,
  onLibraryUpdated: callback => {
    const listener = (_event: unknown, result: LibrarySnapshot): void => callback(result);
    ipcRenderer.on("library:updated", listener);
    return () => ipcRenderer.removeListener("library:updated", listener);
  },
  onNotification: callback => {
    const listener = (
      _event: unknown,
      payload: { message: string; error: boolean }
    ): void => callback(payload);
    ipcRenderer.on("app:notification", listener);
    return () => ipcRenderer.removeListener("app:notification", listener);
  },
  onSearchPaste: callback => {
    const listener = (
      _event: unknown,
      payload: { text: string; search: boolean }
    ): void => callback(payload);
    ipcRenderer.on("search:paste", listener);
    return () => ipcRenderer.removeListener("search:paste", listener);
  },
  contextMenu: {
    asset: payload => ipcRenderer.invoke("context-menu:asset", payload) as Promise<void>,
    search: () => ipcRenderer.invoke("context-menu:search") as Promise<void>
  },
  versions: () =>
    ipcRenderer.invoke("app:versions") as Promise<{
      app: string;
      electron: string;
      chrome: string;
      node: string;
    }>,
  auth: {
    state: () => ipcRenderer.invoke("auth:state") as Promise<AuthState>,
    login: () => ipcRenderer.invoke("auth:login") as Promise<AuthState>,
    logout: () => ipcRenderer.invoke("auth:logout") as Promise<void>,
    profile: () => ipcRenderer.invoke("auth:profile") as Promise<Profile | null>,
    onChanged: callback => {
      const listener = (_event: unknown, state: AuthState): void => callback(state);
      ipcRenderer.on("auth:changed", listener);
      return () => ipcRenderer.removeListener("auth:changed", listener);
    }
  },
  catalog: {
    search: (query: CatalogQuery) =>
      ipcRenderer.invoke("catalog:search", query) as Promise<CatalogResult>,
    ids: (query: CatalogQuery) =>
      ipcRenderer.invoke("catalog:ids", query) as Promise<CatalogIdResult>,
    categories: () => ipcRenderer.invoke("catalog:categories") as Promise<CategoryNode[]>,
    extended: (assetId: string) =>
      ipcRenderer.invoke("catalog:extended", assetId) as Promise<ExtendedAsset>,
    mapPreviews: (assetId: string) =>
      ipcRenderer.invoke("catalog:mapPreviews", assetId) as Promise<MapPreview[]>,
    acquired: () => ipcRenderer.invoke("catalog:acquired") as Promise<string[]>,
    favorites: () => ipcRenderer.invoke("catalog:favorites") as Promise<string[]>,
    addFavorite: (assetId: string) =>
      ipcRenderer.invoke("catalog:addFavorite", assetId) as Promise<void>,
    removeFavorite: (assetId: string) =>
      ipcRenderer.invoke("catalog:removeFavorite", assetId) as Promise<void>
  },
  downloads: {
    start: (assetId: string, options?: Partial<DownloadOptions>) =>
      ipcRenderer.invoke("downloads:start", assetId, options) as Promise<void>,
    startMany: (assetIds: string[], options?: Partial<DownloadOptions>) =>
      ipcRenderer.invoke("downloads:startMany", assetIds, options) as Promise<BatchStartResult>,
    acquire: (assetId: string) =>
      ipcRenderer.invoke("downloads:acquire", assetId) as Promise<void>,
    cancel: (assetId: string) =>
      ipcRenderer.invoke("downloads:cancel", assetId) as Promise<void>,
    pause: (assetId: string) =>
      ipcRenderer.invoke("downloads:pause", assetId) as Promise<void>,
    resume: (assetId: string) =>
      ipcRenderer.invoke("downloads:resume", assetId) as Promise<void>,
    cancelAll: () => ipcRenderer.invoke("downloads:cancelAll") as Promise<void>,
    pauseAll: () => ipcRenderer.invoke("downloads:pauseAll") as Promise<void>,
    resumeAll: () => ipcRenderer.invoke("downloads:resumeAll") as Promise<void>,
    clearFinished: () => ipcRenderer.invoke("downloads:clearFinished") as Promise<void>,
    list: () => ipcRenderer.invoke("downloads:list") as Promise<DownloadProgress[]>,
    onProgress: callback => {
      const listener = (_event: unknown, progress: DownloadProgress): void => callback(progress);
      ipcRenderer.on("downloads:progress", listener);
      return () => ipcRenderer.removeListener("downloads:progress", listener);
    }
  },
  sync: {
    status: () => ipcRenderer.invoke("sync:status") as Promise<SyncStatus>,
    run: () => ipcRenderer.invoke("sync:run") as Promise<SyncStatus>,
    onStatus: callback => {
      const listener = (_event: unknown, status: SyncStatus): void => callback(status);
      ipcRenderer.on("sync:status", listener);
      return () => ipcRenderer.removeListener("sync:status", listener);
    }
  },
  updates: {
    check: () => ipcRenderer.invoke("updates:check") as Promise<UpdateInfo>,
    install: (info: UpdateInfo) =>
      ipcRenderer.invoke("updates:install", info) as Promise<void>
  }
};

contextBridge.exposeInMainWorld("openbridge", api);
