import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CategoryNode } from "../../shared/types";
import type {
  PublicAssetDetail,
  PublicAssetSummary,
  PublicCatalogQuery,
  PublicCatalogStatus,
  PublicFacetBucket,
  PublicFacets,
  PublicProviderId,
  PublicQueryResult
} from "../../shared/public-providers";
import { publicTypeLabel } from "../../shared/public-providers";
import type { Logger } from "../logger";
import {
  buildCategoryTree,
  dict,
  numberValue,
  publicFtsQuery,
  sortFacetBuckets,
  stringList,
  text
} from "./common";

const SCHEMA_VERSION = "1";
const NORMALIZER_REVISION = "4";
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000;
const CATALOG_RETRY_COOLDOWN_MS = 15 * 60 * 1000;

export interface PublicRefreshResult {
  assets: PublicAssetSummary[];
  published?: number;
}

export interface PublicProviderAdapter {
  fetch(logger: Logger): Promise<PublicRefreshResult>;
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 120;
  return Math.min(300, Math.max(1, Math.trunc(value ?? 120)));
}

function facetBuckets(values: string[]): PublicFacetBucket[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function summaryToRow(summary: PublicAssetSummary): Array<string | number | null> {
  return [
    summary.id,
    summary.provider,
    summary.name,
    summary.type,
    summary.typeLabel,
    summary.category,
    JSON.stringify(summary.categories),
    JSON.stringify(summary.tags),
    summary.description,
    JSON.stringify(summary.authors),
    JSON.stringify(summary.attributes),
    summary.maxResolution,
    JSON.stringify(summary.resolutions),
    summary.dimensions,
    JSON.stringify(summary.dimensionsMm ?? []),
    summary.dimensionsMm && summary.dimensionsMm.length > 0
      ? Math.max(...summary.dimensionsMm) / 1000
      : null,
    summary.polycount,
    summary.texelDensity,
    summary.publishedAt,
    summary.downloadCount,
    summary.thumbnail,
    JSON.stringify(summary.previews),
    summary.timeOfDay,
    summary.weather,
    JSON.stringify(summary.mapCodes),
    JSON.stringify(summary.mapFormats),
    JSON.stringify(summary.modelFormats),
    summary.lodCount,
    summary.license,
    summary.free ? 1 : 0,
    summary.websiteUrl,
    summary.filesHash,
    JSON.stringify(summary.files),
    JSON.stringify(summary.attributes)
  ];
}

export class PublicCatalog {
  private readonly db: DatabaseSync;
  private refreshing: Promise<PublicCatalogStatus> | null = null;
  private closed = false;
  private lastAttemptAt = 0;
  private lastError = "";
  private readonly listeners = new Set<(status: PublicCatalogStatus) => void>();

  constructor(
    private readonly provider: PublicProviderId,
    filePath: string,
    private readonly adapter: PublicProviderAdapter,
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
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const existing = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as
      | { value: string }
      | undefined;
    if (existing && existing.value !== SCHEMA_VERSION) {
      this.db.exec(`
        DROP TABLE IF EXISTS assets_fts;
        DROP TABLE IF EXISTS assets;
        DELETE FROM meta WHERE key IN ('count', 'refreshed_at');
      `);
      this.db.exec("VACUUM;");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        type_label TEXT NOT NULL,
        category TEXT NOT NULL,
        categories TEXT NOT NULL,
        tags TEXT NOT NULL,
        description TEXT NOT NULL,
        authors TEXT NOT NULL,
        attributes TEXT NOT NULL,
        max_resolution INTEGER,
        resolutions TEXT NOT NULL,
        dimensions TEXT,
        dimensions_mm TEXT NOT NULL,
        size_m REAL,
        polycount INTEGER,
        texel_density TEXT,
        published_at INTEGER,
        download_count INTEGER NOT NULL DEFAULT 0,
        thumbnail TEXT,
        previews TEXT NOT NULL,
        time_of_day REAL,
        weather TEXT,
        map_codes TEXT NOT NULL,
        map_formats TEXT NOT NULL,
        model_formats TEXT NOT NULL,
        lod_count INTEGER NOT NULL DEFAULT 0,
        license TEXT NOT NULL,
        free INTEGER NOT NULL DEFAULT 1,
        website_url TEXT NOT NULL,
        files_hash TEXT NOT NULL,
        files TEXT NOT NULL,
        raw TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assets_provider_idx ON assets(provider);
      CREATE INDEX IF NOT EXISTS assets_type_idx ON assets(type);
      CREATE INDEX IF NOT EXISTS assets_category_idx ON assets(category);
      CREATE INDEX IF NOT EXISTS assets_published_idx ON assets(published_at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(name, tags, categories, category, description, content='');
    `);
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)").run(SCHEMA_VERSION);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.db.close();
  }

  onStatus(listener: (status: PublicCatalogStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    if (this.closed) return;
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

  status(): PublicCatalogStatus {
    if (this.closed) return { state: "empty", count: 0, refreshedAt: null };
    const count = Number(this.getMeta("count") ?? 0);
    const refreshedAt = Number(this.getMeta("refreshed_at") ?? 0) || null;
    if (this.refreshing) return { state: "refreshing", count, refreshedAt };
    if (this.lastError) return { state: "error", count, refreshedAt, error: this.lastError };
    return { state: count > 0 ? "ready" : "empty", count, refreshedAt };
  }

  async ensureReady(): Promise<void> {
    const status = this.status();
    if (status.count === 0) {
      if (Date.now() - this.lastAttemptAt < CATALOG_RETRY_COOLDOWN_MS && !this.refreshing) {
        if (status.error) throw new Error(status.error);
        return;
      }
      const refreshed = await this.refresh();
      if (refreshed.state === "error" && refreshed.count === 0) throw new Error(refreshed.error);
      return;
    }
    if (status.refreshedAt === null || Date.now() - status.refreshedAt > CATALOG_TTL_MS || this.getMeta("normalizer_revision") !== NORMALIZER_REVISION) {
      if (Date.now() - this.lastAttemptAt < CATALOG_RETRY_COOLDOWN_MS) return;
      void this.refresh();
    }
  }

  async refresh(): Promise<PublicCatalogStatus> {
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

  private async doRefresh(): Promise<PublicCatalogStatus> {
    this.lastError = "";
    this.emit();
    this.logger.info(`Refreshing ${this.provider} catalogue`);
    try {
      const result = await this.adapter.fetch(this.logger);
      if (this.closed) return { state: "empty", count: 0, refreshedAt: null };
      const assets = result.assets.filter(asset => asset.provider === this.provider);
      if (assets.length === 0) throw new Error(`${this.provider} returned an empty catalogue; the previous catalogue was preserved`);
      this.db.exec("BEGIN");
      try {
        this.db.exec("DELETE FROM assets");
        const insert = this.db.prepare(`
          INSERT OR REPLACE INTO assets (
            id, provider, name, type, type_label, category, categories, tags, description,
            authors, attributes, max_resolution, resolutions, dimensions, dimensions_mm, size_m,
            polycount, texel_density, published_at, download_count, thumbnail, previews,
            time_of_day, weather, map_codes, map_formats, model_formats, lod_count, license,
            free, website_url, files_hash, files, raw
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const asset of assets) insert.run(...summaryToRow(asset));
        this.rebuildFts();
        this.setMeta("count", String(assets.length));
        this.setMeta("published", String(result.published ?? assets.length));
        this.setMeta("refreshed_at", String(Date.now()));
        this.setMeta("normalizer_revision", NORMALIZER_REVISION);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.logger.info(`${this.provider} catalogue refreshed`, {
        inserted: assets.length,
        published: result.published ?? assets.length
      });
      return { ...this.status(), state: "ready" };
    } catch (error) {
      if (this.closed) return { state: "empty", count: 0, refreshedAt: null };
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error(`${this.provider} catalogue refresh failed`, { error });
      return { ...this.status(), state: "error", error: this.lastError };
    }
  }

  private rebuildFts(): void {
    this.db.exec(`
      DROP TABLE IF EXISTS assets_fts;
      CREATE VIRTUAL TABLE assets_fts USING fts5(
        name, tags, categories, category, description, content=''
      );
      INSERT INTO assets_fts (rowid, name, tags, categories, category, description)
      SELECT rowid, name, id || ' ' || tags, categories, category, description FROM assets;
    `);
  }

  private buildWhere(query: PublicCatalogQuery): {
    from: string;
    where: string[];
    params: Array<string | number>;
    fts: boolean;
  } {
    const from = "FROM assets a";
    const where: string[] = ["a.provider = ?"];
    const params: Array<string | number> = [this.provider];
    let fts = false;

    const term = (query.query ?? "").trim();
    if (term) {
      const match = publicFtsQuery(term);
      if (match) {
        where.push("assets_fts MATCH ?");
        params.push(match);
        fts = true;
      }
    }
    if (query.types && query.types.length > 0) {
      const values = query.types.filter(value => value && value !== "__none__");
      if (values.length === 0) where.push("0");
      else {
        where.push(`a.type IN (${values.map(() => "?").join(",")})`);
        params.push(...values);
      }
    }
    if (query.ids) {
      if (query.ids.length === 0) where.push("0");
      else {
        where.push(`a.id IN (${query.ids.map(() => "?").join(",")})`);
        params.push(...query.ids);
      }
    }
    if (query.categoryPaths && query.categoryPaths.length > 0) {
      const clauses = query.categoryPaths.map(() => "(a.category = ? OR a.category LIKE ?)");
      where.push(`(${clauses.join(" OR ")})`);
      for (const path of query.categoryPaths) params.push(path, `${path}/%`);
    }
    if (query.tags && query.tags.length > 0) {
      where.push(
        `EXISTS (SELECT 1 FROM json_each(a.tags) WHERE lower(json_each.value) IN (${query.tags
          .map(() => "?")
          .join(",")}))`
      );
      params.push(...query.tags.map(value => value.toLowerCase()));
    }
    if (query.licenses && query.licenses.length > 0) {
      where.push(`lower(a.license) IN (${query.licenses.map(() => "?").join(",")})`);
      params.push(...query.licenses.map(value => value.toLowerCase()));
    }
    if (query.freeOnly) where.push("a.free = 1");
    if (query.resolutions?.length) {
      where.push(`EXISTS (SELECT 1 FROM json_each(a.resolutions) WHERE lower(value) IN (${query.resolutions.map(() => "?").join(",")}))`);
      params.push(...query.resolutions.map(value => value.toLowerCase()));
    }
    if (query.weather?.length) {
      where.push(`a.weather IN (${query.weather.map(() => "?").join(",")})`);
      params.push(...query.weather);
    }
    for (const mapType of query.mapTypes ?? []) {
      where.push("a.map_codes LIKE ?");
      params.push(`%"${mapType}"%`);
    }
    for (const format of query.modelFormats ?? []) {
      where.push("a.model_formats LIKE ?");
      params.push(`%"${format}"%`);
    }
    if (typeof query.minSize === "number") {
      where.push("a.size_m IS NOT NULL AND a.size_m >= ?");
      params.push(query.minSize);
    }
    for (const [key, column, operator] of [["minResolution", "max_resolution", ">="], ["maxResolution", "max_resolution", "<="], ["minTris", "polycount", ">="], ["maxTris", "polycount", "<="]] as const) {
      if (typeof query[key] === "number" && Number.isFinite(query[key])) { where.push(`a.${column} IS NOT NULL AND a.${column} ${operator} ?`); params.push(query[key]!); }
    }
    for (const [key, operator] of [["minBytes", ">="], ["maxBytes", "<="]] as const) {
      if (typeof query[key] === "number" && Number.isFinite(query[key])) { where.push(`EXISTS (SELECT 1 FROM json_each(a.files) WHERE json_extract(value, '$.bytes') > 0 AND json_extract(value, '$.bytes') ${operator} ?)`); params.push(query[key]!); }
    }
    if (query.timeWindows?.length) {
      const windows = query.timeWindows.filter(window => Number.isFinite(window.start) && Number.isFinite(window.end));
      where.push(windows.length ? `(${windows.map(window => window.start <= window.end ? "(a.time_of_day >= ? AND a.time_of_day <= ?)" : "(a.time_of_day >= ? OR a.time_of_day <= ?)").join(" OR ")})` : "0");
      for (const window of windows) params.push(window.start, window.end);
    }
    if (typeof query.maxSize === "number") {
      where.push("a.size_m IS NOT NULL AND a.size_m <= ?");
      params.push(query.maxSize);
    }
    if (typeof query.timeStart === "number" && typeof query.timeEnd === "number") {
      const start = ((query.timeStart % 24) + 24) % 24;
      const end = query.timeEnd === 24 ? 24 : ((query.timeEnd % 24) + 24) % 24;
      if (start <= end) {
        where.push("a.time_of_day IS NOT NULL AND a.time_of_day >= ? AND a.time_of_day <= ?");
      } else {
        where.push("a.time_of_day IS NOT NULL AND (a.time_of_day >= ? OR a.time_of_day <= ?)");
      }
      params.push(start, end);
    }
    return { from: fts ? `${from} JOIN assets_fts ON assets_fts.rowid = a.rowid` : from, where, params, fts };
  }

  query(query: PublicCatalogQuery): PublicQueryResult {
    const started = performance.now();
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const { from, where, params, fts } = this.buildWhere(query);
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS count ${from} ${whereSql}`).get(...params) as
        | { count: number }
        | undefined)?.count ?? 0
    );
    const order = (() => {
      switch (query.sort) {
        case "newest": return "a.published_at DESC NULLS LAST, a.name COLLATE NOCASE";
        case "oldest": return "a.published_at ASC NULLS LAST, a.name COLLATE NOCASE";
        case "name": return "a.name COLLATE NOCASE ASC";
        case "name-desc": return "a.name COLLATE NOCASE DESC";
        case "type": return "a.type COLLATE NOCASE, a.name COLLATE NOCASE";
        case "resolution": return "a.max_resolution DESC NULLS LAST, a.name COLLATE NOCASE";
        case "downloads": return "a.download_count DESC, a.name COLLATE NOCASE";
        case "size": return "a.size_m DESC NULLS LAST, a.name COLLATE NOCASE";
        case "maps": return "json_array_length(a.map_codes) DESC, a.name COLLATE NOCASE";
        case "relevance":
        default:
          // Rank the match set once rather than running a correlated FTS
          // search for every candidate (very expensive for short prefixes).
          return fts ? "bm25(assets_fts) ASC, a.published_at DESC, a.rowid" : "a.published_at DESC NULLS LAST, a.name COLLATE NOCASE";
      }
    })();
    const rows = this.db
      .prepare(`SELECT a.* ${from} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Array<Record<string, unknown>>;
    const hits = rows.map(row => this.summaryFromRow(row));
    if (query.includeFacets === false) return {
      hits, total, offset, limit, hasMore: offset + hits.length < total,
      tookMs: performance.now() - started,
      facets: { types: [], resolutions: [], mapTypes: [], categories: [], licenses: [], modelFormats: [], weather: [], free: 0 }
    };

    const facetFilter = this.buildWhere({
      ...query,
      types: [],
      licenses: [],
      freeOnly: false,
      resolutions: [],
      mapTypes: [],
      modelFormats: [],
      weather: [],
      limit: 0,
      offset: 0
    });
    const facetRows = this.db
      .prepare(
        `SELECT a.type, a.resolutions, a.map_codes, a.model_formats, a.category, a.license, a.free, a.weather ${facetFilter.from} ${
          facetFilter.where.length > 0 ? `WHERE ${facetFilter.where.join(" AND ")}` : ""
        }`
      )
      .all(...facetFilter.params) as Array<Record<string, unknown>>;
    const types: string[] = [];
    const resolutions: string[] = [];
    const mapTypes: string[] = [];
    const modelFormats: string[] = [];
    const categories: string[] = [];
    const licenses: string[] = [];
    const weather: string[] = [];
    let free = 0;
    for (const row of facetRows) {
      types.push(text(row.type));
      resolutions.push(...stringList(JSON.parse(text(row.resolutions) || "[]")));
      mapTypes.push(...stringList(JSON.parse(text(row.map_codes) || "[]")));
      modelFormats.push(...stringList(JSON.parse(text(row.model_formats) || "[]")));
      categories.push(text(row.category));
      licenses.push(text(row.license));
      if (row.weather) weather.push(text(row.weather));
      if (Number(row.free ?? 0) === 1) free += 1;
    }
    const facets: PublicFacets = {
      types: facetBuckets(types),
      resolutions: sortFacetBuckets(facetBuckets(resolutions)),
      mapTypes: facetBuckets(mapTypes),
      categories: facetBuckets(categories),
      licenses: facetBuckets(licenses),
      modelFormats: facetBuckets(modelFormats),
      weather: facetBuckets(weather),
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

  ids(query: PublicCatalogQuery): string[] {
    const { from, where, params } = this.buildWhere(query);
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT a.id ${from} ${whereSql} ORDER BY a.name COLLATE NOCASE`)
      .all(...params) as Array<{ id: string }>;
    return rows.map(row => text(row.id));
  }

  categories(): CategoryNode[] {
    const rows = this.db
      .prepare("SELECT category, id FROM assets WHERE category <> ''")
      .all() as Array<{ category: string; id: string }>;
    return buildCategoryTree(rows);
  }

  findById(id: string): PublicAssetSummary | null {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.summaryFromRow(row) : null;
  }

  findByName(name: string): PublicAssetSummary | null {
    if (!name) return null;
    const row = this.db
      .prepare("SELECT * FROM assets WHERE lower(name) = lower(?) LIMIT 1")
      .get(name) as Record<string, unknown> | undefined;
    return row ? this.summaryFromRow(row) : null;
  }

  extended(id: string): PublicAssetDetail {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new Error(`${this.provider} asset ${id} is not in the catalogue`);
    const summary = this.summaryFromRow(row);
    return { ...summary, raw: dict(JSON.parse(text(row.raw) || "{}")) };
  }

  private summaryFromRow(row: Record<string, unknown>): PublicAssetSummary {
    return {
      id: text(row.id),
      provider: this.provider,
      name: text(row.name),
      type: text(row.type),
      typeLabel: text(row.type_label) || publicTypeLabel(this.provider, text(row.type)),
      categories: stringList(JSON.parse(text(row.categories) || "[]")),
      category: text(row.category),
      tags: stringList(JSON.parse(text(row.tags) || "[]")),
      description: text(row.description),
      authors: dict(JSON.parse(text(row.authors) || "{}")) as Record<string, string>,
      attributes: dict(JSON.parse(text(row.attributes) || "{}")),
      maxResolution: numberValue(row.max_resolution),
      resolutions: stringList(JSON.parse(text(row.resolutions) || "[]")),
      dimensions: text(row.dimensions) || null,
      dimensionsMm: numberList(JSON.parse(text(row.dimensions_mm) || "[]")),
      polycount: numberValue(row.polycount),
      texelDensity: text(row.texel_density) || null,
      publishedAt: numberValue(row.published_at),
      downloadCount: Number(row.download_count ?? 0),
      thumbnail: text(row.thumbnail) || null,
      previews: parsePreviews(JSON.parse(text(row.previews) || "[]")),
      timeOfDay: numberValue(row.time_of_day),
      weather: text(row.weather) || null,
      mapCodes: stringList(JSON.parse(text(row.map_codes) || "[]")),
      mapFormats: stringList(JSON.parse(text(row.map_formats) || "[]")),
      modelFormats: stringList(JSON.parse(text(row.model_formats) || "[]")),
      lodCount: Number(row.lod_count ?? 0),
      license: text(row.license) || "CC0",
      free: Number(row.free ?? 1) === 1,
      websiteUrl: text(row.website_url),
      filesHash: text(row.files_hash),
      enriched: true,
      files: parseFiles(JSON.parse(text(row.files) || "[]"))
    };
  }
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function parsePreviews(value: unknown): PublicAssetSummary["previews"] {
  return Array.isArray(value)
    ? value
        .map(item => {
          const preview = dict(item);
          return {
            type: text(preview.type) || "preview",
            label: text(preview.label) || "Preview",
            url: text(preview.url),
            map: text(preview.map) || undefined,
            width: numberValue(preview.width) ?? undefined,
            height: numberValue(preview.height) ?? undefined
          };
        })
        .filter(item => item.url.length > 0)
    : [];
}

function parseFiles(value: unknown): PublicAssetSummary["files"] {
  return Array.isArray(value)
    ? value
        .map(item => {
          const file = dict(item);
          return {
            role: (text(file.role) || "package") as PublicAssetSummary["files"][number]["role"],
            name: text(file.name),
            url: text(file.url),
            bytes: Number(file.bytes ?? 0),
            resolution: text(file.resolution) || undefined,
            format: text(file.format) || undefined,
            map: text(file.map) || undefined,
            downloadable: file.downloadable !== false,
            fileType: text(file.fileType) || undefined
          };
        })
        .filter(item => item.url.length > 0)
    : [];
}
