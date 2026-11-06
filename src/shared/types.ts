export type TextureFormat = "jpg" | "exr";
export type MeshFormat = "fbx" | "abc";
export type DownloadMapFormat = "image/jpeg" | "image/x-exr" | "jpeg+exr";
export type AssetDefaultsKind = "3d" | "3dplant" | "surface" | "other";
export type AssetProvider = "megascans" | "poliigon" | "polyhaven";
export type ProviderScope = AssetProvider | "all";

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
  libraryRoot: string;
  libraryPath: string;
  poliigonLibraryPath: string;
  polyhavenLibraryPath: string;
  poliigonConfirmPurchases: boolean;
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
  mapFormats: string[];
  lodCount: number;
  lodTriangles: Array<{ label: string; tris: number }>;
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
  provider?: AssetProvider;
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
  provider?: AssetProvider;
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
  credit?: number;
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
  facetCountsPartial?: boolean;
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
  categoryPaths?: string[][];
  ids?: string[];
  points?: number;
  minSize?: number;
  maxSize?: number;
  sortBy?: string;
  pack?: PackRef;
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
  /** Provider asset id, used to match live transfer progress for this preview. */
  assetId?: number | string;
  map?: MapPreviewRequest;
  exposure?: { assetId: number | string; mapType?: string };
}

export interface MapPreviewRequest {
  type: string;
  textureSet?: string;
  referenceUri?: string;
  billboard?: boolean;
}

export type CatalogRequestScope = "discover" | "related" | "drawer" | "preview";

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

export interface PoliigonDownloadOptions {
  resolution: string;
  maps?: Array<{ type: string; format: string }>;
  lods?: string[];
  nativeMesh?: boolean;
  renderer?: string;
  software?: string;
}

export type AnyDownloadOptions = Partial<DownloadOptions> | Partial<PoliigonDownloadOptions> | Partial<PolyHavenDownloadOptions>;

export interface DownloadProgress {
  assetId: string;
  provider?: AssetProvider;
  name?: string;
  status: DownloadStatus;
  received: number;
  total: number;
  ratio: number;
  message?: string;
  path?: string;
  /** Transient preview fetch (map previews, HDR source) rather than a library download. */
  preview?: boolean;
  diagnostics?: DownloadDiagnostics;
}

export interface DownloadCompletion {
  id: number;
  assetId: string;
  name: string;
  path: string;
  bytes: number;
  completedAt: number;
}

export interface DownloadOverview {
  history: DownloadCompletion[];
  historyError?: string;
  session: { receivedBytes: number; completed: number; averageBytesPerSecond: number; peakBytesPerSecond: number };
  disk: { libraryPath: string; totalBytes: number | null; freeBytes: number | null;
    measuredLibraryBytes: number; measuredAssets: number; totalAssets: number; error?: string };
}

export interface DownloadSource {
  host: string;
  provider?: string;
  edgeCode?: string;
  location?: string;
  locationKind?: "edge" | "region";
  country?: string;
  countryCode?: string;
}

export interface DownloadDiagnostics {
  receiveBytesPerSecond: number;
  writeBytesPerSecond: number;
  activeTransfers: number;
  sources: DownloadSource[];
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
  poliigonLibraryPath?: string;
  polyhavenLibraryPath?: string;
}

export interface LibraryRef {
  id: string;
  path: string;
}

export interface LibraryCounts {
  all: number;
  megascans: number;
  poliigon: number;
  polyhaven: number;
  downloaded: number;
  custom: number;
  dhi: number;
}

export type LibrarySort = "recent" | "name" | "name-desc" | "type" | "resolution" | "triangles" | "maps" | "lods" | "variations" | "size" | "issues";

export interface PackRef {
  id?: string;
  name: string;
}

export interface PackSummary extends PackRef {
  count: number;
}

export interface LibraryQuery {
  query?: string;
  provider?: AssetProvider | "all";
  repo?: RepoKind | "all";
  sort?: LibrarySort;
  type?: string;
  categoryPath?: string[];
  ids?: string[];
  ready?: string[];
  maxTris?: number;
  pack?: string;
  packId?: string;
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
  categories: CategoryNode[];
  packs: PackSummary[];
}

export interface LibrarySnapshot {
  refs: LibraryRef[];
  total: number;
  counts: LibraryCounts;
  scannedAt: number;
  libraryPath: string;
  poliigonLibraryPath?: string;
  polyhavenLibraryPath?: string;
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
  poliigonLibraryPath?: string;
  polyhavenLibraryPath?: string;
  scannedAt: number;
  assets: number;
  files: number;
  totalBytes: number;
  byType: Record<string, LibraryTypeStats>;
  issues: LibraryIssue[];
  duplicates: Array<{ assetId: string; paths: string[] }>;
}

export interface PoliigonPreview {
  fileName: string;
  baseUrl: string;
  url: string;
  type?: string;
  position?: number | null;
  role?: string | null;
  mapCode?: string;
}

export interface PoliigonPhysicalSize {
  width?: number;
  height?: number;
  depth?: number;
}

export interface PoliigonAssetSummary {
  id: number;
  name: string;
  assetName: string;
  type: string;
  typeLabel: string;
  slug: string;
  websiteUrl: string;
  description: string;
  tags: string[];
  categoryIds: number[];
  categories: string[];
  credit: number;
  free: boolean;
  convention: number;
  publishedAt: string | null;
  updatedAt: string | null;
  releaseStatus?: string | null;
  resolutions: string[];
  maxResolution: number | null;
  defaultResolution: string | null;
  thumbnail: string | null;
  previews: PoliigonPreview[];
  toolboxPreviews: PoliigonPreview[];
  videoPreviews: PoliigonPreview[];
  physicalSize: string | null;
  physicalSizeCm: PoliigonPhysicalSize | null;
  creationMethod: string | null;
  mapCodes: string[];
  mapFormats: string[];
  lodCount: number;
  maxTris: number | null;
  hasModel: boolean;
  software: string[];
  /** Estimated hour of day (0..24) for HDRIs, if known. */
  timeOfDay?: number | null;
}

export interface PoliigonAssetDetail extends PoliigonAssetSummary {
  maps: Array<{
    type?: string;
    workflow?: string;
    maps?: string[];
    file_formats?: string[];
  }>;
  lods: string[];
  softwares: Array<{ software: string; render_engines: string[] }>;
  specifications: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface PoliigonMapPreview {
  type: string;
  label: string;
  url: string;
  bytes?: number;
}

export interface PoliigonHdrData {
  width: number;
  height: number;
  /** Half-float RGBA pixels, ready for an RGBA16F WebGL texture. */
  data: Uint16Array;
  resolution: string;
}

export type PoliigonSort =
  | "relevance"
  | "newest"
  | "oldest"
  | "name"
  | "name-desc"
  | "resolution"
  | "triangles"
  | "maps"
  | "lods"
  | "size"
  | "credit";

export interface PoliigonCatalogQuery {
  query?: string;
  type?: string;
  ids?: number[];
  categoryIds?: number[];
  freeOnly?: boolean;
  minSize?: number;
  maxSize?: number;
  resolutions?: string[];
  creationMethods?: string[];
  mapTypes?: string[];
  /** Start of the HDRI time-of-day falloff window, in hours (0..24). */
  timeStart?: number;
  /** End of the HDRI time-of-day falloff window; may be lower than start to cross midnight. */
  timeEnd?: number;
  sort?: PoliigonSort;
  limit?: number;
  offset?: number;
}

export interface PoliigonFacetBucket {
  value: string;
  count: number;
}

export interface PoliigonFacets {
  types: PoliigonFacetBucket[];
  resolutions: PoliigonFacetBucket[];
  creationMethods: PoliigonFacetBucket[];
  mapTypes: PoliigonFacetBucket[];
  free: number;
}

export interface PoliigonQueryResult {
  hits: PoliigonAssetSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  tookMs: number;
  facets: PoliigonFacets;
}

export type PolyHavenAssetType = "hdris" | "textures" | "models";

export type PolyHavenSort =
  | "relevance"
  | "newest"
  | "oldest"
  | "name"
  | "name-desc"
  | "resolution"
  | "triangles"
  | "maps"
  | "size"
  | "downloads";

export interface PolyHavenFileEntry {
  url: string;
  size?: number;
  md5?: string;
}

export interface PolyHavenAssetSummary {
  id: string;
  name: string;
  type: PolyHavenAssetType;
  typeLabel: string;
  categories: string[];
  category: string;
  tags: string[];
  description: string;
  authors: Record<string, string>;
  attributes: Record<string, unknown>;
  maxResolution: number | null;
  resolutions: string[];
  dimensions: string | null;
  dimensionsMm: number[] | null;
  polycount: number | null;
  texelDensity: string | null;
  publishedAt: number | null;
  downloadCount: number;
  thumbnail: string | null;
  timeOfDay: number | null;
  mapCodes: string[];
  mapFormats: string[];
  modelFormats: string[];
  lodCount: number;
  collections: string[];
  filesHash: string;
  enriched: boolean;
}

export interface PolyHavenAssetDetail extends PolyHavenAssetSummary {
  /** Raw `/files/{id}` response, keyed by map name and resolution. */
  files: Record<string, unknown>;
  /** Raw `/assets?t=...` summary, including provider-specific fields. */
  raw: Record<string, unknown>;
}

export interface PolyHavenDownloadOptions {
  /** Resolution key such as `1k`, `2k`, `4k`, `8k` or `16k`. */
  resolution?: string;
  /** HDRI/image format such as `hdr`, `exr`, `jpg` or `png`. */
  format?: string;
  maps?: Array<{ type: string; format?: string }>;
  /** Model package format such as `blend`, `fbx`, `gltf` or `usd`. */
  modelFormat?: string;
}

export interface PolyHavenCatalogQuery {
  query?: string;
  type?: PolyHavenAssetType | string;
  ids?: string[];
  /** Category tree paths such as `Furniture/Seating/Chairs`. */
  categoryPaths?: string[];
  /** Flat Poly Haven category tags such as `furniture` or `sunrise-sunset`. */
  categories?: string[];
  collections?: string[];
  resolutions?: string[];
  mapTypes?: string[];
  /** Provider attribute filters keyed by attributes field (weather, condition, ...). */
  attributes?: Record<string, string[]>;
  minSize?: number;
  maxSize?: number;
  timeStart?: number;
  timeEnd?: number;
  sort?: PolyHavenSort;
  limit?: number;
  offset?: number;
}

export interface PolyHavenFacetBucket {
  value: string;
  count: number;
}

export interface PolyHavenFacets {
  types: PolyHavenFacetBucket[];
  resolutions: PolyHavenFacetBucket[];
  mapTypes: PolyHavenFacetBucket[];
  categories: PolyHavenFacetBucket[];
  collections: PolyHavenFacetBucket[];
  attributes: Record<string, PolyHavenFacetBucket[]>;
}

export interface PolyHavenQueryResult {
  hits: PolyHavenAssetSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  tookMs: number;
  facets: PolyHavenFacets;
}

export interface PolyHavenCatalogStatus {
  state: "empty" | "refreshing" | "ready" | "error";
  count: number;
  enriched: number;
  refreshedAt: number | null;
  error?: string;
}

export interface PolyHavenMapPreview {
  type: string;
  label: string;
  url: string;
  bytes?: number;
}

export interface PoliigonAuthState {
  loggedIn: boolean;
  userName: string;
  userId: number | null;
  planName: string;
  planPaused: boolean;
  isUnlimited: boolean;
  credits: number | null;
  onDemandCredits: number | null;
  ownedCount: number;
  expiresAt: number | null;
}

export interface PoliigonCatalogStatus {
  state: "empty" | "refreshing" | "ready" | "error";
  count: number;
  published: number;
  refreshedAt: number | null;
  error?: string;
}

export interface OpenBridgeApi {
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  chooseDirectory(): Promise<string | null>;
  listAssets(force?: boolean): Promise<ScanResult>;
  librarySnapshot(force?: boolean): Promise<LibrarySnapshot>;
  queryLibrary(query: LibraryQuery): Promise<LibraryQueryResult>;
  queryLibraryIds(query: LibraryQuery): Promise<string[]>;
  localPreviews(assetId: string, indexedPath?: string): Promise<{ renders: MapPreview[]; maps: MapPreview[] }>;
  libraryHealth(force?: boolean): Promise<LibraryHealthReport>;
  cancelLibraryHealth(): Promise<void>;
  onLibraryHealthProgress(callback: (progress: LibraryHealthProgress) => void): () => void;
  removeLibraryAssets(assetIds: string[], scope?: LibraryQuery): Promise<{ removed: number }>;
  exportLibraryAssets(assetIds: string[], folder: string, scope?: LibraryQuery): Promise<string>;
  openPath(target: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openLogs(): Promise<void>;
  smartThumbnail(source: string): Promise<string>;
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
  catalogPacks(): Promise<PackSummary[]>;
  catalog: {
    search(query: CatalogQuery, scope?: "discover" | "related"): Promise<CatalogResult>;
    ids(query: CatalogQuery): Promise<CatalogIdResult>;
    categories(): Promise<CategoryNode[]>;
    extended(assetId: string, scope?: "drawer"): Promise<ExtendedAsset>;
    cancel(scope: CatalogRequestScope): Promise<void>;
    mapPreviews(assetId: string): Promise<MapPreview[]>;
    highResolutionPreview(assetId: string, map: MapPreviewRequest): Promise<MapPreview>;
    acquired(): Promise<string[]>;
    favorites(): Promise<string[]>;
    addFavorite(assetId: string): Promise<void>;
    removeFavorite(assetId: string): Promise<void>;
  };
  poliigon: {
    status(): Promise<PoliigonCatalogStatus>;
    refresh(): Promise<PoliigonCatalogStatus>;
    categories(): Promise<CategoryNode[]>;
    search(query: PoliigonCatalogQuery): Promise<PoliigonQueryResult>;
    ids(query: PoliigonCatalogQuery): Promise<number[]>;
    extended(assetId: number): Promise<PoliigonAssetDetail>;
    mapPreviews(assetId: number): Promise<PoliigonMapPreview[]>;
    highResolutionMapPreview(assetId: number, mapType: string): Promise<PoliigonMapPreview>;
    hdrPreview(assetId: number): Promise<PoliigonHdrData>;
    onStatus(callback: (status: PoliigonCatalogStatus) => void): () => void;
    auth: {
      state(): Promise<PoliigonAuthState>;
      login(email: string, password: string): Promise<PoliigonAuthState>;
      loginBrowser(): Promise<PoliigonAuthState>;
      cancelBrowserLogin(): Promise<void>;
      logout(): Promise<void>;
      refresh(): Promise<PoliigonAuthState | null>;
      owned(): Promise<number[]>;
      recentDownloads(): Promise<number[]>;
      syncOwned(): Promise<number[]>;
      onChanged(callback: (state: PoliigonAuthState) => void): () => void;
    };
  };
  polyhaven: {
    status(): Promise<PolyHavenCatalogStatus>;
    refresh(): Promise<PolyHavenCatalogStatus>;
    categories(): Promise<CategoryNode[]>;
    search(query: PolyHavenCatalogQuery): Promise<PolyHavenQueryResult>;
    ids(query: PolyHavenCatalogQuery): Promise<string[]>;
    extended(assetId: string): Promise<PolyHavenAssetDetail>;
    mapPreviews(assetId: string): Promise<PolyHavenMapPreview[]>;
    highResolutionMapPreview(assetId: string, mapType: string): Promise<PolyHavenMapPreview>;
    hdrPreview(assetId: string): Promise<PoliigonHdrData>;
    onStatus(callback: (status: PolyHavenCatalogStatus) => void): () => void;
  };
  downloads: {
    start(
      assetId: string,
      options?: AnyDownloadOptions,
      provider?: AssetProvider
    ): Promise<void>;
    startMany(
      assetIds: string[],
      options?: AnyDownloadOptions,
      provider?: AssetProvider
    ): Promise<BatchStartResult>;
    acquire(assetId: string): Promise<void>;
    cancel(assetId: string): Promise<void>;
    retry(assetId: string): Promise<void>;
    pause(assetId: string): Promise<void>;
    resume(assetId: string): Promise<void>;
    cancelAll(): Promise<void>;
    pauseAll(): Promise<void>;
    resumeAll(): Promise<void>;
    clearFinished(): Promise<void>;
    list(): Promise<DownloadProgress[]>;
    overview(): Promise<DownloadOverview>;
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


