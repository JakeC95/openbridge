import { contextBridge, ipcRenderer } from "electron";
import { pathToFileURL } from "node:url";
import type {
  AppSettings,
  AuthState,
  BatchStartResult,
  CatalogIdResult,
  CatalogQuery,
  CatalogResult,
  CatalogMetadataRecord,
  CatalogMetadataStatus,
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
  PoliigonAssetDetail,
  PoliigonAuthState,
  PoliigonCatalogQuery,
  PoliigonCatalogStatus,
  PoliigonHdrData,
  PoliigonMapPreview,
  PoliigonQueryResult,
  PolyHavenAssetDetail,
  PolyHavenCatalogQuery,
  PolyHavenCatalogStatus,
  PolyHavenMapPreview,
  PolyHavenQueryResult,
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
  localPreviews: (assetId, indexedPath) => ipcRenderer.invoke("library:previews", assetId, indexedPath),
  libraryHealth: (force = false) =>
    ipcRenderer.invoke("library:health", force) as Promise<LibraryHealthReport>,
  cancelLibraryHealth: () => ipcRenderer.invoke("library:cancelHealth") as Promise<void>,
  onLibraryHealthProgress: callback => {
    const listener = (_event: unknown, progress: LibraryHealthProgress): void => callback(progress);
    ipcRenderer.on("library:healthProgress", listener);
    return () => ipcRenderer.removeListener("library:healthProgress", listener);
  },
  removeLibraryAssets: (assetIds, scope) =>
    ipcRenderer.invoke("library:removeAssets", assetIds, scope) as Promise<{ removed: number }>,
  exportLibraryAssets: (assetIds, folder, scope) =>
    ipcRenderer.invoke("library:exportAssets", assetIds, folder, scope) as Promise<string>,
  openPath: target => ipcRenderer.invoke("app:openPath", target) as Promise<void>,
  openExternal: url => ipcRenderer.invoke("app:openExternal", url) as Promise<void>,
  openLogs: () => ipcRenderer.invoke("app:openLogs") as Promise<void>,
  smartThumbnail: source => ipcRenderer.invoke("thumb:smart", source) as Promise<string>,
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
  catalogMetadata: () =>
    ipcRenderer.invoke("catalog:metadata:status") as Promise<CatalogMetadataStatus>,
  importCatalogMetadata: () =>
    ipcRenderer.invoke("catalog:metadata:import") as Promise<CatalogMetadataStatus>,
  downloadCatalogMetadata: () =>
    ipcRenderer.invoke("catalog:metadata:download") as Promise<CatalogMetadataStatus>,
  removeCatalogMetadata: () =>
    ipcRenderer.invoke("catalog:metadata:remove") as Promise<CatalogMetadataStatus>,
  catalogMetadataLookup: (ids: string[]) =>
    ipcRenderer.invoke("catalog:metadata:lookup", ids) as Promise<CatalogMetadataRecord[]>,
  catalogPacks: () => ipcRenderer.invoke("catalog:metadata:packs"),
  catalog: {
    search: (query: CatalogQuery, scope) =>
      ipcRenderer.invoke("catalog:search", query, scope) as Promise<CatalogResult>,
    ids: (query: CatalogQuery) =>
      ipcRenderer.invoke("catalog:ids", query) as Promise<CatalogIdResult>,
    categories: () => ipcRenderer.invoke("catalog:categories") as Promise<CategoryNode[]>,
    extended: (assetId: string, scope) =>
      ipcRenderer.invoke("catalog:extended", assetId, scope) as Promise<ExtendedAsset>,
    cancel: scope => ipcRenderer.invoke("catalog:cancel", scope),
    mapPreviews: (assetId: string) =>
      ipcRenderer.invoke("catalog:mapPreviews", assetId) as Promise<MapPreview[]>,
    highResolutionPreview: (assetId, map) => ipcRenderer.invoke("catalog:highResolutionPreview", assetId, map),
    acquired: () => ipcRenderer.invoke("catalog:acquired") as Promise<string[]>,
    favorites: () => ipcRenderer.invoke("catalog:favorites") as Promise<string[]>,
    addFavorite: (assetId: string) =>
      ipcRenderer.invoke("catalog:addFavorite", assetId) as Promise<void>,
    removeFavorite: (assetId: string) =>
      ipcRenderer.invoke("catalog:removeFavorite", assetId) as Promise<void>
  },
  poliigon: {
    status: () => ipcRenderer.invoke("poliigon:status") as Promise<PoliigonCatalogStatus>,
    refresh: () => ipcRenderer.invoke("poliigon:refresh") as Promise<PoliigonCatalogStatus>,
    categories: () => ipcRenderer.invoke("poliigon:categories") as Promise<CategoryNode[]>,
    search: (query: PoliigonCatalogQuery) =>
      ipcRenderer.invoke("poliigon:search", query) as Promise<PoliigonQueryResult>,
    ids: (query: PoliigonCatalogQuery) =>
      ipcRenderer.invoke("poliigon:ids", query) as Promise<number[]>,
    extended: (assetId: number) =>
      ipcRenderer.invoke("poliigon:extended", assetId) as Promise<PoliigonAssetDetail>,
    mapPreviews: (assetId: number) =>
      ipcRenderer.invoke("poliigon:mapPreviews", assetId) as Promise<PoliigonMapPreview[]>,
    highResolutionMapPreview: (assetId: number, mapType: string) =>
      ipcRenderer.invoke("poliigon:highResolutionMapPreview", assetId, mapType) as Promise<PoliigonMapPreview>,
    hdrPreview: (assetId: number) =>
      ipcRenderer.invoke("poliigon:hdrPreview", assetId) as Promise<PoliigonHdrData>,
    onStatus: callback => {
      const listener = (_event: unknown, status: PoliigonCatalogStatus): void => callback(status);
      ipcRenderer.on("poliigon:status", listener);
      return () => ipcRenderer.removeListener("poliigon:status", listener);
    },
    auth: {
      state: () => ipcRenderer.invoke("poliigon:auth:state") as Promise<PoliigonAuthState>,
      login: (email: string, password: string) =>
        ipcRenderer.invoke("poliigon:auth:login", email, password) as Promise<PoliigonAuthState>,
      loginBrowser: () =>
        ipcRenderer.invoke("poliigon:auth:loginBrowser") as Promise<PoliigonAuthState>,
      cancelBrowserLogin: () =>
        ipcRenderer.invoke("poliigon:auth:cancelBrowser") as Promise<void>,
      logout: () => ipcRenderer.invoke("poliigon:auth:logout") as Promise<void>,
      refresh: () =>
        ipcRenderer.invoke("poliigon:auth:refresh") as Promise<PoliigonAuthState | null>,
      owned: () => ipcRenderer.invoke("poliigon:auth:owned") as Promise<number[]>,
      recentDownloads: () =>
        ipcRenderer.invoke("poliigon:auth:recentDownloads") as Promise<number[]>,
      syncOwned: () => ipcRenderer.invoke("poliigon:auth:syncOwned") as Promise<number[]>,
      onChanged: callback => {
        const listener = (_event: unknown, state: PoliigonAuthState): void => callback(state);
        ipcRenderer.on("poliigon:auth:changed", listener);
        return () => ipcRenderer.removeListener("poliigon:auth:changed", listener);
      }
    }
  },
  polyhaven: {
    status: () => ipcRenderer.invoke("polyhaven:status") as Promise<PolyHavenCatalogStatus>,
    refresh: () => ipcRenderer.invoke("polyhaven:refresh") as Promise<PolyHavenCatalogStatus>,
    categories: () => ipcRenderer.invoke("polyhaven:categories") as Promise<CategoryNode[]>,
    search: (query: PolyHavenCatalogQuery) =>
      ipcRenderer.invoke("polyhaven:search", query) as Promise<PolyHavenQueryResult>,
    ids: (query: PolyHavenCatalogQuery) =>
      ipcRenderer.invoke("polyhaven:ids", query) as Promise<string[]>,
    extended: (assetId: string) =>
      ipcRenderer.invoke("polyhaven:extended", assetId) as Promise<PolyHavenAssetDetail>,
    mapPreviews: (assetId: string) =>
      ipcRenderer.invoke("polyhaven:mapPreviews", assetId) as Promise<PolyHavenMapPreview[]>,
    highResolutionMapPreview: (assetId: string, mapType: string) =>
      ipcRenderer.invoke("polyhaven:highResolutionMapPreview", assetId, mapType) as Promise<PolyHavenMapPreview>,
    hdrPreview: (assetId: string) =>
      ipcRenderer.invoke("polyhaven:hdrPreview", assetId) as Promise<PoliigonHdrData>,
    onStatus: callback => {
      const listener = (_event: unknown, status: PolyHavenCatalogStatus): void => callback(status);
      ipcRenderer.on("polyhaven:status", listener);
      return () => ipcRenderer.removeListener("polyhaven:status", listener);
    }
  },
  downloads: {
    start: (assetId: string, options?: import("../shared/types").AnyDownloadOptions, provider?: import("../shared/types").AssetProvider) =>
      ipcRenderer.invoke("downloads:start", assetId, options, provider) as Promise<void>,
    startMany: (assetIds: string[], options?: import("../shared/types").AnyDownloadOptions, provider?: import("../shared/types").AssetProvider) =>
      ipcRenderer.invoke("downloads:startMany", assetIds, options, provider) as Promise<BatchStartResult>,
    acquire: (assetId: string) =>
      ipcRenderer.invoke("downloads:acquire", assetId) as Promise<void>,
    cancel: (assetId: string) =>
      ipcRenderer.invoke("downloads:cancel", assetId) as Promise<void>,
    retry: (assetId: string) => ipcRenderer.invoke("downloads:retry", assetId) as Promise<void>,
    pause: (assetId: string) =>
      ipcRenderer.invoke("downloads:pause", assetId) as Promise<void>,
    resume: (assetId: string) =>
      ipcRenderer.invoke("downloads:resume", assetId) as Promise<void>,
    cancelAll: () => ipcRenderer.invoke("downloads:cancelAll") as Promise<void>,
    pauseAll: () => ipcRenderer.invoke("downloads:pauseAll") as Promise<void>,
    resumeAll: () => ipcRenderer.invoke("downloads:resumeAll") as Promise<void>,
    clearFinished: () => ipcRenderer.invoke("downloads:clearFinished") as Promise<void>,
    list: () => ipcRenderer.invoke("downloads:list") as Promise<DownloadProgress[]>,
    overview: () => ipcRenderer.invoke("downloads:overview") as Promise<import("../shared/types").DownloadOverview>,
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
