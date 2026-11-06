import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import type {
  CategoryNode,
  PoliigonAssetDetail,
  PoliigonAssetSummary,
  PoliigonCatalogQuery,
  PoliigonCatalogStatus,
  PoliigonFacetBucket,
  PoliigonFacets,
  PoliigonPhysicalSize,
  PoliigonPreview,
  PoliigonQueryResult
} from "../../shared/types";
import type { Logger } from "../logger";
import { hdriTimeOfDay } from "../../shared/hdri-time";
import { canonicalPoliigonMapCode } from "../../shared/poliigon-maps";

const API_BASE = "https://apiv2.poliigon.com/api/v2";
// Poliigon adds assets continuously; re-check the public catalogue several times a day.
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
// Failed checks back off so window focus cannot hammer the provider.
const CATALOG_RETRY_COOLDOWN_MS = 15 * 60 * 1000;
const SCHEMA_VERSION = "9";

type PreviewKind = "gallery" | "toolbox" | "video";

type Dict = Record<string, unknown>;

interface CategoryRecord {
  id: number;
  name: string;
  path: string;
  parentId: number | null;
  parents: string[];
}

interface Normalized {
  summary: PoliigonAssetSummary;
  raw: Uint8Array;
}

function dict(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizePreview(value: unknown, kind: PreviewKind): PoliigonPreview | null {
  const item = dict(value);
  const fileName = text(item.fileName);
  const baseUrl = text(item.baseUrl);
  if (!fileName || !baseUrl) return null;
  const position = numberValue(item.position);
  const url = kind === "gallery"
    ? `${baseUrl.replace(/\/$/, "")}/2000px`
    : `${baseUrl.replace(/\/$/, "")}/${fileName}`;
  return {
    fileName,
    baseUrl,
    url,
    type: text(item.type) || undefined,
    position,
    role: text(item.role) || null
  };
}

function normalizePreviews(value: unknown, kind: PreviewKind): PoliigonPreview[] {
  if (!Array.isArray(value)) return [];
  const output: PoliigonPreview[] = [];
  for (const item of value) {
    const preview = normalizePreview(item, kind);
    if (preview) output.push(preview);
  }
  return output;
}

function previewThumb(previews: PoliigonPreview[]): string | null {
  if (previews.length === 0) return null;
  const primary =
    previews.find(item => item.role === "sphere") ??
    previews.find(item => item.position === 0) ??
    previews[0];
  return primary ? `${primary.baseUrl.replace(/\/$/, "")}/600px` : null;
}

function typeLabel(type: string): string {
  switch (type.toLowerCase()) {
    case "textures":
      return "Texture";
    case "models":
      return "Model";
    case "hdrs":
    case "hdris":
      return "HDRI";
    case "brushes":
      return "Brush";
    default:
      return type || "Asset";
  }
}

function resolutionValue(value: string): number | null {
  const k = /^(\d+(?:\.\d+)?)k$/i.exec(value.trim());
  if (k) return Math.round(Number(k[1]) * 1024);
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function maxResolution(resolutions: string[]): number | null {
  let max: number | null = null;
  for (const resolution of resolutions) {
    const value = resolutionValue(resolution);
    if (value !== null && (max === null || value > max)) max = value;
  }
  return max;
}

function formatCentimetres(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function physicalSizeText(size: PoliigonPhysicalSize | null, type: string): string | null {
  if (!size) return null;
  const values = [size.width, size.height, size.depth].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (values.length === 0) return null;
  const largest = Math.max(...values);
  const unit = largest > 99 ? "m" : "cm";
  const divisor = unit === "m" ? 100 : 1;
  const parts = values.map(value => formatCentimetres(value / divisor));
  if (unit === "m" && type.toLowerCase() === "textures") {
    return `${parts.slice(0, 2).join(" x ")} m`;
  }
  return `${parts.join(" x ")} ${unit}`;
}

function normalizeAsset(value: unknown, categories: Map<number, CategoryRecord>): Normalized | null {
  const asset = dict(value);
  const id = numberValue(asset.AssetID);
  const name = text(asset.Name);
  const assetName = text(asset.AssetName);
  if (id === null || !name || !assetName) return null;

  const type = text(asset.Type) || "Unsupported";
  const specs = dict(asset.Specifications);
  const sizeRaw = dict(specs.physical_size_cm);
  const physicalSizeCm: PoliigonPhysicalSize = {};
  for (const key of ["width", "height", "depth"] as const) {
    const value = numberValue(sizeRaw[key]);
    if (value !== null) physicalSizeCm[key] = value;
  }
  if (Object.keys(physicalSizeCm).length === 0) {
    // Textures expose their dimensions as width/height at the specification root.
    for (const key of ["width", "height"] as const) {
      const value = numberValue(specs[key]);
      if (value !== null) physicalSizeCm[key] = value;
    }
  }

  const categoryIds = (Array.isArray(asset.Categories)
    ? asset.Categories
    : Array.isArray(asset.CategoryIDs)
      ? asset.CategoryIDs
      : [])
    .map(numberValue)
    .filter((item): item is number => item !== null);
  const categoryPaths = unique(
    categoryIds
      .map(categoryId => categories.get(categoryId)?.parents.join(" / ") ?? "")
      .filter(Boolean)
  );
  // The API includes every ancestor ID for an asset. Keep only the most specific paths.
  const categoriesForAsset = categoryPaths.filter(
    path => !categoryPaths.some(other => other !== path && other.startsWith(`${path} / `))
  );

  const rawMaps = Array.isArray(asset.Maps) ? asset.Maps : [];
  const mapCodes: string[] = [];
  for (const rawMap of rawMaps) {
    const map = dict(rawMap);
    const codes = stringList(map.maps);
    if (codes.length > 0) mapCodes.push(...codes);
    const single = text(map.type);
    if (single) mapCodes.push(single);
  }  const mapFormats = unique([
    ...stringList(specs.map_file_formats),
    ...rawMaps.flatMap(rawMap => stringList(dict(rawMap).file_formats))
  ]);

  const lods = stringList(asset.LODs);
  const triangleMap = dict(specs.lods);
  let maxTris: number | null = null;
  for (const value of Object.values(triangleMap)) {
    const triangles = numberValue(value);
    if (triangles !== null && (maxTris === null || triangles > maxTris)) maxTris = triangles;
  }
  const polycount = numberValue(specs.polycount);
  if (maxTris === null && polycount !== null) maxTris = polycount;

  const softwares = (Array.isArray(asset.Softwares) ? asset.Softwares : [])
    .map(dict)
    .map(item => text(item.software))
    .filter(Boolean);

  const previews = normalizePreviews(asset.Previews, "gallery");
  const toolboxPreviews = normalizePreviews(asset.ToolboxPreviews, "toolbox");
  const videoPreviews = normalizePreviews(asset.VideoPreviews, "video");
  const resolutions = stringList(asset.Resolutions);
  const credit = numberValue(asset.Credit) ?? 1;
  const publishedAt = text(asset.PublishedAt) || null;
  const updatedAt = text(asset.UpdatedAt) || null;
  const description = text(asset.WebsiteDescription) || text(asset.InternalDescription);
  const tags = stringList(asset.Tags);
  const sunPosition = Array.isArray(specs.sun_position)
    ? specs.sun_position.filter((value): value is number => typeof value === "number")
    : null;
  const timeOfDay = type === "HDRS"
    ? hdriTimeOfDay({ name, tags, categories: categoriesForAsset, sunPosition })
    : null;

  const summary: PoliigonAssetSummary = {
    id,
    name,
    assetName,
    type,
    typeLabel: typeLabel(type),
    slug: text(asset.Slug),
    websiteUrl: text(asset.WebsiteUrl),
    description,
    tags,
    categoryIds: unique(categoryIds.map(String)).map(Number),
    categories: categoriesForAsset,    credit,
    free: credit === 0,
    convention: numberValue(asset.Convention) ?? 0,
    publishedAt,
    updatedAt,
    releaseStatus: text(asset.ReleaseStatus) || null,
    resolutions,
    maxResolution: maxResolution(resolutions),
    defaultResolution: text(asset.DefaultResolution) || null,
    thumbnail: previewThumb(previews),
    previews,
    toolboxPreviews,
    videoPreviews,
    physicalSize: physicalSizeText(physicalSizeCm, type),
    physicalSizeCm: Object.keys(physicalSizeCm).length > 0 ? physicalSizeCm : null,
    creationMethod: text(specs.creation_method) || null,
    mapCodes: unique(mapCodes.map(canonicalPoliigonMapCode)),
    mapFormats,
    lodCount: lods.length,
    maxTris,
    hasModel: type.toLowerCase() === "models",
    software: unique(softwares),
    timeOfDay
  };

  return { summary, raw: gzipSync(Buffer.from(JSON.stringify({
    description,
    previews,
    toolboxPreviews,
    videoPreviews,
    maps: rawMaps,
    lods: asset.LODs ?? [],
    softwares: asset.Softwares ?? [],
    specifications: specs
  }), "utf8")) };
}

function flattenCategories(value: unknown, parents: string[] = [], parentId: number | null = null, output: CategoryRecord[] = []): CategoryRecord[] {
  if (!Array.isArray(value)) return output;
  for (const rawNode of value) {
    const node = dict(rawNode);
    const id = numberValue(node.id);
    const name = text(node.name);
    if (id === null || !name) continue;
    const nextParents = [...parents, name];
    output.push({ id, name, path: text(node.path), parentId, parents: nextParents });
    flattenCategories(node.children, nextParents, id, output);
  }
  return output;
}

function parseFtsQuery(value: string): string {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map(token => `${token}*`).join(" AND ");
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 120;
  return Math.min(300, Math.max(1, Math.trunc(value ?? 120)));
}

function uniqueBuckets(values: Array<string | null | undefined>): PoliigonFacetBucket[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export class PoliigonCatalog {
  private readonly db: DatabaseSync;
  private refreshing: Promise<PoliigonCatalogStatus> | null = null;
  private lastAttemptAt = 0;
  private lastError = "";
  private readonly listeners = new Set<(status: PoliigonCatalogStatus) => void>();

  constructor(
    filePath: string,
    private readonly logger: Logger
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const existing = this.db
      .prepare("SELECT value FROM meta WHERE key = 'schema'")
      .get() as { value: string } | undefined;
    if (existing && existing.value !== SCHEMA_VERSION) {
      this.db.exec(`
        DROP TABLE IF EXISTS assets_fts;
        DROP TABLE IF EXISTS asset_categories;
        DROP TABLE IF EXISTS assets;
        DELETE FROM meta WHERE key IN ('count', 'published', 'refreshed_at', 'categories');
      `);
      this.db.exec("VACUUM;");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        asset_name TEXT NOT NULL,
        type TEXT NOT NULL,
        slug TEXT NOT NULL,
        website_url TEXT NOT NULL,
        tags TEXT NOT NULL,
        category_ids TEXT NOT NULL,
        categories TEXT NOT NULL,
        credit INTEGER NOT NULL,
        free INTEGER NOT NULL,
        convention INTEGER NOT NULL,
        release_status TEXT NOT NULL,
        published_at TEXT,
        updated_at TEXT,
        resolutions TEXT NOT NULL,
        max_resolution INTEGER,
        default_resolution TEXT,
        thumbnail TEXT,
        physical_size TEXT,
        physical_size_cm TEXT NOT NULL,
        creation_method TEXT,
        map_codes TEXT NOT NULL,
        map_formats TEXT NOT NULL,
        lod_count INTEGER NOT NULL,
        max_tris INTEGER,
        has_model INTEGER NOT NULL,
        software TEXT NOT NULL,
        time_of_day REAL,
        detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asset_categories (
        asset_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        PRIMARY KEY (asset_id, category_id)
      );
      CREATE INDEX IF NOT EXISTS asset_categories_category ON asset_categories(category_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
        name, asset_name, tags, categories, description, content=''
      );
    `);
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(SCHEMA_VERSION);
  }

  close(): void {
    this.db.close();
  }

  onStatus(listener: (status: PoliigonCatalogStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // ignore listener failures
      }
    }
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  private categoryRecords(): CategoryRecord[] {
    try {
      const parsed = JSON.parse(this.getMeta("categories") ?? "[]") as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(item => dict(item))
        .map(item => ({
          id: numberValue(item.id) ?? -1,
          name: text(item.name),
          path: text(item.path),
          parentId: numberValue(item.parentId),
          parents: stringList(item.parents)
        }))
        .filter(item => item.id >= 0 && item.name.length > 0);
    } catch {
      return [];
    }
  }

  status(): PoliigonCatalogStatus {
    const count = Number(this.getMeta("count") ?? "0");
    const published = Number(this.getMeta("published") ?? "0");
    const refreshed = this.getMeta("refreshed_at");
    const refreshedAt = refreshed ? Number(refreshed) : null;
    const state = this.refreshing
      ? "refreshing"
      : count > 0
        ? "ready"
        : this.lastError
          ? "error"
          : "empty";
    return {
      state,
      count,
      published,
      refreshedAt: Number.isFinite(refreshedAt) ? refreshedAt : null,
      error: this.lastError || undefined
    };
  }

  async ensureReady(): Promise<void> {
    const status = this.status();
    if (this.refreshing) return;
    if (status.count === 0) {
      if (Date.now() - this.lastAttemptAt < CATALOG_RETRY_COOLDOWN_MS) return;
      await this.refresh();
      return;
    }
    if (status.refreshedAt === null || Date.now() - status.refreshedAt > CATALOG_TTL_MS) {
      if (Date.now() - this.lastAttemptAt < CATALOG_RETRY_COOLDOWN_MS) return;
      void this.refresh();
    }
  }

  async refresh(): Promise<PoliigonCatalogStatus> {
    if (this.refreshing) return this.refreshing;
    this.lastAttemptAt = Date.now();
    this.refreshing = this.doRefresh();
    this.emit();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
      this.emit();
    }
    return this.status();
  }

  private async doRefresh(): Promise<PoliigonCatalogStatus> {
    this.lastError = "";
    this.emit();
    this.logger.info("Refreshing Poliigon catalogue");
    try {
      const [assetsResponse, categoriesResponse] = await Promise.all([
        fetch(`${API_BASE}/all?language_code=en`, {
          headers: { Accept: "application/json", "User-Agent": "OpenBridge" },
          signal: AbortSignal.timeout(180_000)
        }),
        fetch(`${API_BASE}/category/list?language_code=en`, {
          headers: { Accept: "application/json", "User-Agent": "OpenBridge" },
          signal: AbortSignal.timeout(60_000)
        })
      ]);
      if (!assetsResponse.ok) {
        throw new Error(`Poliigon catalogue returned HTTP ${assetsResponse.status}`);
      }
      const assetsPayload = (await assetsResponse.json()) as Dict;
      const assetsRoot = dict(assetsPayload.results);
      const assets = Array.isArray(assetsRoot.data) ? assetsRoot.data : Array.isArray(assetsPayload.data) ? assetsPayload.data : [];

      const categories: CategoryRecord[] = [];
      if (categoriesResponse.ok) {
        const categoriesPayload = (await categoriesResponse.json()) as Dict;
        const categoriesRoot = dict(categoriesPayload.results);
        const categoryNodes = Array.isArray(categoriesRoot.data)
          ? categoriesRoot.data
          : Array.isArray(categoriesPayload.data)
            ? categoriesPayload.data
            : [];
        flattenCategories(categoryNodes, [], null, categories);
      }
      const categoryMap = new Map(categories.map(item => [item.id, item]));

      const insertAsset = this.db.prepare(`
        INSERT OR REPLACE INTO assets (
          id, name, asset_name, type, slug, website_url, tags,
          category_ids, categories, credit, free, convention, release_status,
          published_at, updated_at, resolutions, max_resolution, default_resolution,
          thumbnail, physical_size, physical_size_cm, creation_method, map_codes,
          map_formats, lod_count, max_tris, has_model, software, time_of_day, detail
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertCategory = this.db.prepare(
        "INSERT OR IGNORE INTO asset_categories (asset_id, category_id) VALUES (?, ?)"
      );

      let published = 0;
      let inserted = 0;
      this.db.exec("BEGIN");
      try {
        this.db.exec(`
          DROP TABLE IF EXISTS assets_fts;
          CREATE VIRTUAL TABLE assets_fts USING fts5(
            name, asset_name, tags, categories, description, content=''
          );
        `);
        const insertFts = this.db.prepare(
          "INSERT INTO assets_fts (rowid, name, asset_name, tags, categories, description) VALUES (?, ?, ?, ?, ?, ?)"
        );
        this.db.exec("DELETE FROM assets; DELETE FROM asset_categories;");
        for (const rawAsset of assets) {
          const normalized = normalizeAsset(rawAsset, categoryMap);
          if (!normalized) continue;
          const { summary, raw } = normalized;
          const releaseStatus = text(dict(rawAsset).ReleaseStatus) || "Production";
          if (releaseStatus === "Unpublished") continue;
          insertAsset.run(
            summary.id,
            summary.name,
            summary.assetName,
            summary.type,
            summary.slug,
            summary.websiteUrl,
            JSON.stringify(summary.tags),
            JSON.stringify(summary.categoryIds),
            JSON.stringify(summary.categories),
            summary.credit,
            summary.free ? 1 : 0,
            summary.convention,
            releaseStatus,
            summary.publishedAt,
            summary.updatedAt,
            JSON.stringify(summary.resolutions),
            summary.maxResolution,
            summary.defaultResolution,
            summary.thumbnail,
            summary.physicalSize,
            JSON.stringify(summary.physicalSizeCm ?? {}),
            summary.creationMethod,
            JSON.stringify(summary.mapCodes),
            JSON.stringify(summary.mapFormats),
            summary.lodCount,
            summary.maxTris,
            summary.hasModel ? 1 : 0,
            JSON.stringify(summary.software),
            summary.timeOfDay ?? null,
            raw
          );
          for (const categoryId of summary.categoryIds) {
            insertCategory.run(summary.id, categoryId);
          }
          insertFts.run(
            summary.id,
            summary.name,
            summary.assetName,
            [
              ...summary.tags,
              summary.slug,
              summary.websiteUrl,
              ...summary.mapCodes,
              ...summary.resolutions
            ].join(" "),
            summary.categories.join(" "),
            summary.description
          );
          inserted += 1;
          published += 1;
        }
        this.setMeta("categories", JSON.stringify(categories));
        this.setMeta("count", String(inserted));
        this.setMeta("published", String(published));
        this.setMeta("refreshed_at", String(Date.now()));
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.logger.info("Poliigon catalogue refreshed", { inserted, published, categories: categories.length });
      return this.status();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error("Poliigon catalogue refresh failed", { error });
      return this.status();
    }
  }

  categories(): CategoryNode[] {
    const records = this.categoryRecords();
    if (records.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT ac.category_id AS id, ac.asset_id AS assetId
         FROM asset_categories ac
         JOIN assets a ON a.id = ac.asset_id
         WHERE a.release_status <> 'Unpublished'`
      )
      .all() as Array<{ id: number; assetId: number }>;
    const direct = new Map<number, Set<number>>();
    for (const row of rows) {
      const set = direct.get(row.id) ?? new Set<number>();
      set.add(row.assetId);
      direct.set(row.id, set);
    }

    const byId = new Map<number, CategoryNode & { parentId: number | null }>();
    for (const record of records) {
      byId.set(record.id, {
        key: String(record.id),
        label: record.name,
        count: 0,
        children: [],
        parentId: record.parentId
      });
    }
    const roots: CategoryNode[] = [];
    for (const record of records) {
      const node = byId.get(record.id);
      if (!node) continue;
      if (record.parentId !== null && byId.has(record.parentId)) {
        byId.get(record.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const aggregate = (node: CategoryNode): Set<number> => {
      const assets = new Set<number>(direct.get(Number(node.key)) ?? []);
      for (const child of node.children) {
        for (const assetId of aggregate(child)) assets.add(assetId);
      }
      node.count = assets.size;
      return assets;
    };
    for (const root of roots) aggregate(root);
    return roots;
  }

  private descendantCategoryIds(categoryIds: number[]): number[] {
    const records = this.categoryRecords();
    const children = new Map<number, number[]>();
    for (const record of records) {
      if (record.parentId === null) continue;
      const list = children.get(record.parentId) ?? [];
      list.push(record.id);
      children.set(record.parentId, list);
    }
    const output = new Set<number>();
    const visit = (id: number): void => {
      if (output.has(id)) return;
      output.add(id);
      for (const child of children.get(id) ?? []) visit(child);
    };
    for (const id of categoryIds) visit(id);
    return [...output];
  }

  private buildWhere(query: PoliigonCatalogQuery): { from: string; where: string[]; params: Array<string | number | null>; fts: boolean } {
    const from = "FROM assets a";
    const where: string[] = ["a.release_status <> 'Unpublished'"];
    const params: Array<string | number | null> = [];
    let fts = false;

    const term = (query.query ?? "").trim();
    if (term) {
      const match = parseFtsQuery(term);
      if (match) {
        where.push("assets_fts MATCH ?");
        params.push(match);
        fts = true;
      }
    }
    if (query.type) {
      where.push("a.type = ?");
      params.push(query.type);
    }
    if (query.ids) {
      if (query.ids.length === 0) {
        where.push("0");
      } else {
        where.push(`a.id IN (${query.ids.map(() => "?").join(",")})`);
        params.push(...query.ids);
      }
    }
    if (query.categoryIds && query.categoryIds.length > 0) {
      const ids = this.descendantCategoryIds(query.categoryIds);
      if (ids.length > 0) {
        where.push(`a.id IN (SELECT asset_id FROM asset_categories WHERE category_id IN (${ids.map(() => "?").join(",")}))`);
        params.push(...ids);
      }
    }
    if (query.freeOnly) where.push("a.free = 1");
    if (typeof query.minSize === "number" || typeof query.maxSize === "number") {
      const size = `(MAX(
        COALESCE(CAST(json_extract(a.physical_size_cm, '$.width') AS REAL), 0),
        COALESCE(CAST(json_extract(a.physical_size_cm, '$.height') AS REAL), 0),
        COALESCE(CAST(json_extract(a.physical_size_cm, '$.depth') AS REAL), 0)
      ) / 100.0)`;
      if (typeof query.minSize === "number") {
        where.push(`${size} >= ?`);
        params.push(query.minSize);
      }
      if (typeof query.maxSize === "number") {
        where.push(`${size} <= ?`);
        params.push(query.maxSize);
      }
    }
    for (const resolution of query.resolutions ?? []) {
      where.push("a.resolutions LIKE ?");
      params.push(`%"${resolution}"%`);
    }
    if (query.creationMethods && query.creationMethods.length > 0) {
      where.push(`a.creation_method IN (${query.creationMethods.map(() => "?").join(",")})`);
      params.push(...query.creationMethods);
    }
    for (const mapType of query.mapTypes ?? []) {
      where.push("a.map_codes LIKE ?");
      params.push(`%"${canonicalPoliigonMapCode(mapType)}"%`);
    }
    if (
      query.type === "HDRS" &&
      typeof query.timeStart === "number" &&
      typeof query.timeEnd === "number"
    ) {
      const start = ((query.timeStart % 24) + 24) % 24;
      const end = ((query.timeEnd % 24) + 24) % 24;
      if (start <= end) {
        where.push("a.time_of_day IS NOT NULL AND a.time_of_day >= ? AND a.time_of_day <= ?");
      } else {
        where.push("a.time_of_day IS NOT NULL AND (a.time_of_day >= ? OR a.time_of_day <= ?)");
      }
      params.push(start, end);
    }
    return {
      from: fts ? `${from} JOIN assets_fts ON assets_fts.rowid = a.id` : from,
      where,
      params,
      fts
    };
  }

  private summaryFromRow(row: Dict): PoliigonAssetSummary {
    const id = Number(row.id);
    const type = text(row.type);
    return {
      id,
      name: text(row.name),
      assetName: text(row.asset_name),
      type,
      typeLabel: typeLabel(type),
      slug: text(row.slug),
      websiteUrl: text(row.website_url),
      description: "",
      tags: stringList(JSON.parse(text(row.tags) || "[]")),
      categoryIds: (JSON.parse(text(row.category_ids) || "[]") as unknown[])
        .map(numberValue)
        .filter((item): item is number => item !== null),
      categories: stringList(JSON.parse(text(row.categories) || "[]")),
      credit: Number(row.credit ?? 1),
      free: Number(row.free ?? 0) === 1,
      convention: Number(row.convention ?? 0),
      publishedAt: text(row.published_at) || null,
      updatedAt: text(row.updated_at) || null,
      releaseStatus: text(row.release_status) || null,
      resolutions: stringList(JSON.parse(text(row.resolutions) || "[]")),
      maxResolution: numberValue(row.max_resolution),
      defaultResolution: text(row.default_resolution) || null,
      thumbnail: text(row.thumbnail) || null,
      previews: [],
      toolboxPreviews: [],
      videoPreviews: [],
      physicalSize: text(row.physical_size) || null,
      physicalSizeCm: dict(JSON.parse(text(row.physical_size_cm) || "{}")) as PoliigonPhysicalSize,
      creationMethod: text(row.creation_method) || null,
      mapCodes: stringList(JSON.parse(text(row.map_codes) || "[]")),
      mapFormats: stringList(JSON.parse(text(row.map_formats) || "[]")),
      lodCount: Number(row.lod_count ?? 0),
      maxTris: numberValue(row.max_tris),
      hasModel: Number(row.has_model ?? 0) === 1,
      software: stringList(JSON.parse(text(row.software) || "[]")),
      timeOfDay: row.time_of_day == null ? null : Number(row.time_of_day)
    };
  }

  query(query: PoliigonCatalogQuery): PoliigonQueryResult {
    const started = performance.now();
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const { from, where, params, fts } = this.buildWhere(query);
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count ${from} ${whereSql}`)
      .get(...params) as { count: number } | undefined;
    const total = Number(countRow?.count ?? 0);

    const order = (() => {
      if (
        query.type === "HDRS" &&
        typeof query.timeStart === "number" &&
        typeof query.timeEnd === "number" &&
        (!query.sort || query.sort === "relevance")
      ) {
        const start = ((query.timeStart % 24) + 24) % 24;
        const end = ((query.timeEnd % 24) + 24) % 24;
        const width = start <= end ? end - start : 24 - start + end;
        const center = (start + width / 2) % 24;
        const distance = `MIN(ABS(a.time_of_day - ${center}), 24 - ABS(a.time_of_day - ${center}))`;
        return `${distance}, ${fts ? "bm25(assets_fts), " : ""}a.published_at DESC`;
      }
      switch (query.sort) {
        case "relevance":
          return fts ? "bm25(assets_fts), a.published_at DESC" : "a.published_at DESC, a.name COLLATE NOCASE";
        case "oldest":
          return "a.published_at ASC, a.name COLLATE NOCASE";
        case "name":
          return "a.name COLLATE NOCASE ASC";
        case "name-desc":
          return "a.name COLLATE NOCASE DESC";
        case "resolution":
          return "a.max_resolution DESC, a.name COLLATE NOCASE";
        case "triangles":
          return "a.max_tris DESC, a.name COLLATE NOCASE";
        case "maps":
          return "json_array_length(a.map_codes) DESC, a.name COLLATE NOCASE";
        case "lods":
          return "a.lod_count DESC, a.name COLLATE NOCASE";
        case "size":
          return `(MAX(
            COALESCE(CAST(json_extract(a.physical_size_cm, '$.width') AS REAL), 0),
            COALESCE(CAST(json_extract(a.physical_size_cm, '$.height') AS REAL), 0),
            COALESCE(CAST(json_extract(a.physical_size_cm, '$.depth') AS REAL), 0)
          )) DESC, a.name COLLATE NOCASE`;
        case "credit":
          return "a.free DESC, a.credit ASC, a.name COLLATE NOCASE";
        case "newest":
          return "a.published_at DESC, a.name COLLATE NOCASE";
        default:
          return fts ? "bm25(assets_fts), a.published_at DESC" : "a.published_at DESC, a.name COLLATE NOCASE";
      }
    })();

    const rows = this.db
      .prepare(`SELECT a.* ${from} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Dict[];
    const hits = rows.map(row => this.summaryFromRow(row));

    const facetFilter = this.buildWhere({
      ...query,
      resolutions: [],
      creationMethods: [],
      mapTypes: []
    });
    const facetRows = this.db
      .prepare(
        `SELECT a.type, a.resolutions, a.creation_method, a.map_codes, a.free ${facetFilter.from} ${
          facetFilter.where.length > 0 ? `WHERE ${facetFilter.where.join(" AND ")}` : ""
        }`
      )
      .all(...facetFilter.params) as Dict[];
    const resolutions: string[] = [];
    const creationMethods: string[] = [];
    const mapTypes: string[] = [];
    const types: string[] = [];
    let free = 0;
    for (const row of facetRows) {
      types.push(text(row.type));
      if (Number(row.free ?? 0) === 1) free += 1;
      resolutions.push(...stringList(JSON.parse(text(row.resolutions) || "[]")));
      const method = text(row.creation_method);
      if (method) creationMethods.push(method);
      mapTypes.push(...stringList(JSON.parse(text(row.map_codes) || "[]")));
    }
    const facets: PoliigonFacets = {
      types: uniqueBuckets(types),
      resolutions: uniqueBuckets(resolutions),
      creationMethods: uniqueBuckets(creationMethods),
      mapTypes: uniqueBuckets(mapTypes),
      free
    };

    return {
      hits,
      total,
      offset,
      limit,
      hasMore: offset + hits.length < total,
      tookMs: Math.round((performance.now() - started) * 100) / 100,
      facets
    };
  }

  findByAssetName(assetName: string): PoliigonAssetSummary | null {
    if (!assetName) return null;
    const row = this.db
      .prepare("SELECT * FROM assets WHERE asset_name = ? LIMIT 1")
      .get(assetName) as Dict | undefined;
    return row ? this.summaryFromRow(row) : null;
  }

  ids(query: PoliigonCatalogQuery): number[] {
    const { from, where, params } = this.buildWhere(query);
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT a.id ${from} ${whereSql} ORDER BY a.id`)
      .all(...params) as Array<{ id: number }>;
    return rows.map(row => Number(row.id));
  }

  extended(assetId: number): PoliigonAssetDetail {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as Dict | undefined;
    if (!row) throw new Error(`Poliigon asset ${assetId} is not in the catalogue`);
    const summary = this.summaryFromRow(row);
    const stored = row.detail;
    const raw = dict(JSON.parse(
      Buffer.isBuffer(stored) || stored instanceof Uint8Array
        ? gunzipSync(Buffer.from(stored as Uint8Array)).toString("utf8")
        : text(stored) || "{}"
    ));
    const maps = (Array.isArray(raw.maps) ? raw.maps : [])
      .map(dict)
      .map(item => ({
        type: text(item.type) || undefined,
        workflow: text(item.workflow) || undefined,
        maps: stringList(item.maps),
        file_formats: stringList(item.file_formats)
      }));
    const softwares = (Array.isArray(raw.softwares) ? raw.softwares : [])
      .map(dict)
      .map(item => ({
        software: text(item.software),
        render_engines: stringList(item.render_engines)
      }))
      .filter(item => item.software.length > 0);
    return {
      ...summary,
      description: text(raw.description),
      previews: Array.isArray(raw.previews) ? (raw.previews as PoliigonPreview[]) : [],
      toolboxPreviews: Array.isArray(raw.toolboxPreviews) ? (raw.toolboxPreviews as PoliigonPreview[]) : [],
      videoPreviews: Array.isArray(raw.videoPreviews) ? (raw.videoPreviews as PoliigonPreview[]) : [],
      maps,
      lods: stringList(raw.lods),
      softwares,
      specifications: dict(raw.specifications),
      raw
    };
  }
}
