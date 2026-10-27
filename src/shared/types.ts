export type TextureFormat = "jpg" | "exr";
export type MeshFormat = "fbx" | "abc";
export type DownloadMapFormat = "image/jpeg" | "image/x-exr" | "jpeg+exr";
export type AssetDefaultsKind = "3d" | "3dplant" | "surface" | "other";

export interface DownloadPreset {
  resolution: number;
  textureFormat: TextureFormat;
  meshFormat: MeshFormat;
  selectedMaps: string[];
  lods: boolean[];
  highpoly: boolean;
  ztool: boolean;
  brushes: boolean;
  uniqueMapsPerLod: boolean;
  billboards: boolean;
  downloadAllPlantLods: boolean;
}

export interface AppSettings {
  libraryPath: string;
  apiPort: number;
  discoveryPort: number;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  downloadDefaults: Record<AssetDefaultsKind, DownloadPreset>;
}

export type RepoKind = "downloaded" | "custom" | "dhi";

export interface DownloadMapOption {
  type: string;
  selected: boolean;
  mimeType: DownloadMapFormat;
}

export interface AssetTechnicalSummary {
  resolution: number | null;
  mapTypes: string[];
  mapCount: number;
  lodCount: number;
  maxTris: number;
  variationCount: number;
  billboardCount: number;
  tileable: boolean | null;
  tilingDirections: string[];
  scanArea: string | null;
  texelDensity: string | null;
  physicalSize: string | null;
  dimensions: string | null;
  height: string | null;
  variationDimensions: Array<{
    variation: number;
    width: string;
    length: string;
    height: string;
  }>;
  meshType: string | null;
  hasHighpoly: boolean;
  hasZtool: boolean;
  hasBrushes: boolean;
  closedMesh: boolean | null;
  scaleFixed: boolean | null;
  assembly: boolean | null;
  smallAsset: boolean | null;
  splitSubmeshes: boolean | null;
  modular: boolean;
  hasAlpha: boolean;
  materialWorkflow: "metal-rough" | "spec-gloss" | "mixed" | null;
  averageColor: string | null;
  packId: string | null;
  packName: string | null;
  revision: string | number | null;
  revised: string | number | boolean | null;
  semantic: {
    subjectMatter: string | null;
    color: string[];
    state: string[];
    interiorExterior: string[];
    industry: string[];
    theme: string[];
    descriptive: string[];
    contains: string[];
    orientation: string[];
  };
}

export interface CatalogMetadataStatus {
  available: boolean;
  count: number;
  generatedAt: number | null;
  version: number | null;
  importedAt: number | null;
}

export interface CatalogMetadataRecord {
  id: string;
  name: string;
  type: string;
  categories: string[];
  tags: string[];
  technical: AssetTechnicalSummary;
  generatedAt: number;
}

export interface AssetRecord {
  id: string;
  name: string;
  type: string;
  categories: string[];
  tags: string[];
  repo: RepoKind;
  path: string;
  jsonPath: string;
  preview: string | null;
  thumb: string | null;
  mtime: number;
  previewRelativeSize: string;
  searchStr: string;
  technical?: AssetTechnicalSummary;
  sizeBytes?: number;
  fileCount?: number;
  issueCount?: number;
}

export interface LegacyConfig {
  epicClientId: string;
  algoliaAppId: string;
  algoliaApiKey: string;
  algoliaIndex: string;
  apiBaseUrl: string;
  ssoBaseUrl: string;
  signedUrlBase: string;
  realm: string;
}

export interface AuthState {
  loggedIn: boolean;
  email: string;
  roles: string[];
  planId: string;
  expiresAt: number | null;
}

export interface Profile {
  email?: string;
  name?: string;
  points?: number;
  subscription?: {
    planId?: string;
    status?: string;
    isArchViz?: boolean;
    [key: string]: unknown;
  };
  drops?: { assetIds?: string[] };
  profile?: Profile;
  [key: string]: unknown;
}

export interface CatalogHit {
  objectID: string;
  id: string;
  name: string;
  type: string;
  category?: string;
  subCategory?: string;
  subCategory2?: string;
  subCategory3?: string;
  asset_type?: string;
  categories?: string[];
  tags?: string[];
  _tags?: string[];
  assetCategories?: string[];
  previews?: {
    images?: {
      thumb?: string;
      thumbJpg?: string;
      thumbRetina?: string;
      thumbRetinaJpg?: string;
      thumbGridJpg?: string;
      thumbGridRetinaJpg?: string;
      preview?: string;
      tiny?: string;
      aspectRatio?: number;
    };
    relativeSize?: string;
  };
  points?: number;
  resolution?: number;
  biome?: string;
  region?: string;
  physicalSize?: string;
  minSize?: number;
  maxSize?: number;
  contains?: string[];
  metadata?: CatalogMetadataRecord;
  locations?: string[];
  [key: string]: unknown;
}

export interface CatalogResult {
  hits: CatalogHit[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  nextCursor?: string | null;
  hasMore?: boolean;
  facets?: Record<string, Record<string, number>>;
}

export interface CatalogQuery {
  query: string;
  page: number;
  hitsPerPage?: number;
  type?: string;
  category?: string;
  categoryPath?: string[];
  ids?: string[];
  points?: number;
  minSize?: number;
  maxSize?: number;
  sortBy?: string;
  facets?: string[];
  facetFilters?: Record<string, string[]>;
}

export interface CatalogIdEntry {
  id: string;
  points?: number;
}

export interface CatalogIdResult {
  entries: CatalogIdEntry[];
  nbHits: number;
}

export interface BatchStartResult {
  queued: number;
  skipped: number;
}

export interface CategoryNode {
  key: string;
  label: string;
  count: number;
  children: CategoryNode[];
}

export interface JsonValidationReport {
  ok: boolean;
  assetId: string;
  jsonPath: string;
  name?: string;
  categories?: string[];
  components?: number;
  meshes?: number;
  lods?: number;
  warnings?: string[];
  error?: string;
}

export interface AssetMapDescriptor {
  type: string;
  resolution?: string | number;
  mimeType?: string;
  uris?: Array<{
    resolution?: string;
    physicalSize?: string;
    resolutions?: Array<{
      resolution?: string;
      physicalSize?: string;
      formats?: Array<{ mimeType?: string; uri?: string; tris?: number; contentLength?: number; lodType?: string }>;
    }>;
    formats?: Array<{ mimeType?: string; uri?: string; tris?: number; contentLength?: number; lodType?: string }>;
  }>;
  textureSets?: string[];
  lodType?: string;
  lod?: number;
  [key: string]: unknown;
}

export interface AssetModelDescriptor {
  type?: string;
  lod?: number;
  mimeType?: string;
  tris?: number;
  contentLength?: number;
  uri?: string;
  uris?: Array<{ mimeType?: string; contentLength?: number; uri?: string; [key: string]: unknown }>;
  variations?: number[];
  variation?: number;
  [key: string]: unknown;
}

export interface AssetPreviewMap {
  type?: string;
  uri?: string;
  mimeType?: string;
  resolution?: string;
  textureSets?: string[];
  [key: string]: unknown;
}

export interface ExtendedAsset {
  id: string;
  name: string;
  categories?: string[];
  tags?: string[];
  _tags?: string[];
  type?: string;
  asset_type?: string;
  version?: number;
  points?: number;
  acl?: { resolution?: number; exrAccess?: string; [key: string]: unknown };
  maps?: AssetMapDescriptor[];
  components?: AssetMapDescriptor[];
  billboards?: AssetMapDescriptor[];
  models?: AssetModelDescriptor[];
  meshes?: AssetModelDescriptor[];
  previews?: unknown;
  similarAssets?: CatalogHit[];
  referencePreviews?: {
    maps?: AssetPreviewMap[];
    models?: AssetModelDescriptor[];
    [key: string]: unknown;
  };
  meta?: Array<{ key?: string; value?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface MapPreview {
  type: string;
  label: string;
  url: string;
  resolution?: string;
}

export interface DownloadOptions {
  resolution: number;
  textureFormat: TextureFormat;
  components: DownloadMapOption[];
  meshFormat: MeshFormat;
  lods: boolean[];
  downloadAllPlantLods: boolean;
  highpoly: boolean;
  ztool: boolean;
  brushes: boolean;
  uniqueMapsPerLod: boolean;
  billboards: boolean;
  variation: number;
}

export type DownloadStatus =
  | "queued"
  | "requesting"
  | "downloading"
  | "extracting"
  | "paused"
  | "complete"
  | "error"
  | "cancelled";

export interface DownloadProgress {
  assetId: string;
  name?: string;
  status: DownloadStatus;
  received: number;
  total: number;
  ratio: number;
  message?: string;
  path?: string;
}

export interface SyncStatus {
  running: boolean;
  lastSynced: number | null;
  acquired: number;
  missing: number;
  message?: string;
}

export interface UpdateInfo {
  current: string;
  latest?: string;
  available: boolean;
  url?: string;
  sha256?: string;
  size?: number;
  notes?: string;
  checkedAt: number;
  error?: string;
}

export interface ExportComponent {
  type: string;
  format: string;
  resolution: string;
  name: string;
  nameOverride: string;
  path: string;
  colorSpace?: string;
  physicalSize?: string;
  textureSets?: string[];
  channelsData?: unknown[];
  [key: string]: unknown;
}

export interface ExportAsset {
  message: "export";
  version: number;
  id: string;
  name: string;
  type: string;
  category: string;
  path: string;
  exportPath: string;
  resolution: string;
  resolutionValue: number;
  textureFormat: string;
  meshFormat: string;
  exportAs: string;
  activeLOD: string;
  minLOD: string;
  previewImage: string | null;
  averageColor: unknown;
  tags: string[];
  categories: string[];
  meta: unknown;
  materials: unknown;
  textureSets: unknown;
  workflow: string;
  origin: string;
  variation: number;
  isModularAsset: boolean;
  isExternal: boolean;
  guid: string;
  namingConvention: string;
  folderNamingConvention: string;
  mapNameOverride: Record<string, string>;
  components: ExportComponent[];
  meshList: ExportComponent[];
  lodList: ExportComponent[];
  meshVersion: number;
  packedTextures: ExportComponent[];
  "components-billboard": ExportComponent[];
  "packed-billboard": ExportComponent[];
  [key: string]: unknown;
}

export interface AssetJson {
  id?: string;
  name?: string;
  type?: string;
  categories?: string[];
  tags?: string[];
  origin?: string;
  isExternal?: boolean;
  previews?: { relativeSize?: string };
  averageColor?: unknown;
  meta?: unknown;
  materials?: unknown;
  textureSets?: unknown;
  models?: unknown[];
  maps?: unknown[];
  [key: string]: unknown;
}

export interface ScanResult {
  assets: AssetRecord[];
  scannedAt: number;
  libraryPath: string;
}

export interface LibraryRef {
  id: string;
  path: string;
}

export interface LibraryCounts {
  all: number;
  downloaded: number;
  custom: number;
  dhi: number;
}

export type LibrarySort = "recent" | "name" | "type";

export interface LibraryQuery {
  query?: string;
  repo?: RepoKind | "all";
  sort?: LibrarySort;
  ready?: string[];
  maxTris?: number;
  pack?: string;
  color?: string;
  state?: string;
  interiorExterior?: string;
  limit?: number;
  offset?: number;
}

export interface LibraryQueryResult {
  assets: AssetRecord[];
  total: number;
  counts: LibraryCounts;
  offset: number;
  limit: number;
  hasMore: boolean;
  tookMs: number;
}

export interface LibrarySnapshot {
  refs: LibraryRef[];
  total: number;
  counts: LibraryCounts;
  scannedAt: number;
  libraryPath: string;
}

export type LibraryIssueKind =
  | "invalid-json"
  | "missing-preview"
  | "missing-mesh"
  | "missing-texture"
  | "zero-byte"
  | "duplicate-id"
  | "empty-folder";

export interface LibraryIssue {
  kind: LibraryIssueKind;
  severity: "error" | "warning";
  assetId?: string;
  name?: string;
  path: string;
  message: string;
}

export interface LibraryTypeStats {
  assets: number;
  bytes: number;
  files: number;
}

export interface LibraryHealthProgress {
  checked: number;
  total: number;
  percent: number;
}

export interface LibraryHealthReport {
  libraryPath: string;
  scannedAt: number;
  assets: number;
  files: number;
  totalBytes: number;
  byType: Record<string, LibraryTypeStats>;
  issues: LibraryIssue[];
  duplicates: Array<{ assetId: string; paths: string[] }>;
}

export interface OpenBridgeApi {
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  chooseDirectory(): Promise<string | null>;
  listAssets(force?: boolean): Promise<ScanResult>;
  librarySnapshot(force?: boolean): Promise<LibrarySnapshot>;
  queryLibrary(query: LibraryQuery): Promise<LibraryQueryResult>;
  queryLibraryIds(query: LibraryQuery): Promise<string[]>;
  libraryHealth(force?: boolean): Promise<LibraryHealthReport>;
  onLibraryHealthProgress(callback: (progress: LibraryHealthProgress) => void): () => void;
  removeLibraryAssets(assetIds: string[]): Promise<{ removed: number }>;
  exportLibraryAssets(assetIds: string[], folder: string): Promise<string>;
  openPath(target: string): Promise<void>;
  openLogs(): Promise<void>;
  sendExport(port: number, data: ExportAsset[]): Promise<void>;
  writeExport(folder: string, data: ExportAsset[]): Promise<string>;
  exportAssetToFolder(assetId: string, folder: string): Promise<string>;
  exportAssetToPort(assetId: string, port: number): Promise<void>;
  downloadFile(url: string, destination: string): Promise<string>;
  importFolder(): Promise<string | null>;
  importZip(): Promise<string | null>;
  validateAssetJson(assetId: string): Promise<JsonValidationReport>;
  toFileUrl(target: string): string;
  onLibraryUpdated(callback: (result: LibrarySnapshot) => void): () => void;
  onNotification(callback: (message: { message: string; error: boolean }) => void): () => void;
  onSearchPaste(callback: (payload: { text: string; search: boolean }) => void): () => void;
  contextMenu: {
    asset(payload: {
      assetId: string;
      localPath?: string | null;
      link?: string | null;
    }): Promise<void>;
    search(): Promise<void>;
  };
  versions(): Promise<{ app: string; electron: string; chrome: string; node: string }>;
  auth: {
    state(): Promise<AuthState>;
    login(): Promise<AuthState>;
    logout(): Promise<void>;
    profile(): Promise<Profile | null>;
    onChanged(callback: (state: AuthState) => void): () => void;
  };
  catalogMetadata(): Promise<CatalogMetadataStatus>;
  importCatalogMetadata(): Promise<CatalogMetadataStatus>;
  downloadCatalogMetadata(): Promise<CatalogMetadataStatus>;
  removeCatalogMetadata(): Promise<CatalogMetadataStatus>;
  catalogMetadataLookup(ids: string[]): Promise<CatalogMetadataRecord[]>;
  catalog: {
    search(query: CatalogQuery): Promise<CatalogResult>;
    ids(query: CatalogQuery): Promise<CatalogIdResult>;
    categories(): Promise<CategoryNode[]>;
    extended(assetId: string): Promise<ExtendedAsset>;
    mapPreviews(assetId: string): Promise<MapPreview[]>;
    acquired(): Promise<string[]>;
    favorites(): Promise<string[]>;
    addFavorite(assetId: string): Promise<void>;
    removeFavorite(assetId: string): Promise<void>;
  };
  downloads: {
    start(assetId: string, options?: Partial<DownloadOptions>): Promise<void>;
    startMany(
      assetIds: string[],
      options?: Partial<DownloadOptions>
    ): Promise<BatchStartResult>;
    acquire(assetId: string): Promise<void>;
    cancel(assetId: string): Promise<void>;
    pause(assetId: string): Promise<void>;
    resume(assetId: string): Promise<void>;
    cancelAll(): Promise<void>;
    pauseAll(): Promise<void>;
    resumeAll(): Promise<void>;
    clearFinished(): Promise<void>;
    list(): Promise<DownloadProgress[]>;
    onProgress(callback: (progress: DownloadProgress) => void): () => void;
  };
  sync: {
    status(): Promise<SyncStatus>;
    run(): Promise<SyncStatus>;
    onStatus(callback: (status: SyncStatus) => void): () => void;
  };
  updates: {
    check(): Promise<UpdateInfo>;
    install(info: UpdateInfo): Promise<void>;
  };
}


