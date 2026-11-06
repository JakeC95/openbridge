import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CategoryNode,
  PolyHavenAssetDetail,
  PolyHavenAssetSummary,
  PolyHavenAssetType,
  PolyHavenCatalogQuery,
  PolyHavenCatalogStatus,
  PolyHavenFacetBucket,
  PolyHavenFacets,
  PolyHavenQueryResult
} from "../../shared/types";
import type { Logger } from "../logger";
import {
  polyHavenMapLabel,
  polyHavenResolutionValue,
  polyHavenTimeOfDay,
  polyHavenTypeFromCode,
  polyHavenTypeLabel
} from "../../shared/polyhaven";

const API_BASE = "https://api.polyhaven.com";
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const CATALOG_RETRY_COOLDOWN_MS = 15 * 60 * 1000;
const SCHEMA_VERSION = "2";
const ENRICH_CONCURRENCY = 8;
const ENRICH_TIMEOUT_MS = 45_000;

type Dict = Record<string, unknown>;

interface Normalized {
  summary: PolyHavenAssetSummary;
  sizeM: number | null;
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

function numberList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatMetric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Poly Haven publishes dimensions in millimetres. Display the same metric
 * vocabulary as the other providers, switching to metres for larger assets.
 */
function dimensionsText(values: number[]): string | null {
  if (values.length === 0) return null;
  const largest = Math.max(...values);
  if (largest <= 0) return null;
  const metres = largest >= 1000;
  const parts = values.map(value => (metres ? value / 1000 : value / 10));
  return `${parts.map(formatMetric).join(" x ")} ${metres ? "m" : "cm"}`;
}

function normalizeAsset(id: string, value: unknown): Normalized | null {
  const asset = dict(value);
  const name = text(asset.name) || id;
  const type = polyHavenTypeFromCode(asset.type);
  const attributes = dict(asset.attributes);
  const categories = stringList(asset.categories);
  const tags = stringList(asset.tags);
  const category = text(asset.category);
  const dimensionsMm = numberList(asset.dimensions);
  const resolution = numberList(asset.max_resolution);
  const maxResolution = resolution.length > 0 ? Math.max(...resolution) : null;
  const collections = stringList(asset.collections);
  const authors = Object.fromEntries(
    Object.entries(dict(asset.authors))
      .map(([author, role]) => [author, text(role)] as const)
      .filter(([author]) => author.length > 0)
  );
  const publishedSeconds = numberValue(asset.date_published);
  const timeOfDay = type === "hdris"
    ? polyHavenTimeOfDay(attributes, {
        name,
        tags,
        categories: [...categories, category]
      })
    : null;
  const lodCount = attributes.lods === true ? 1 : 0;

  return {
    summary: {
      id,
      name,
      type,
      typeLabel: polyHavenTypeLabel(type),
      categories,
      category,
      tags,
      description: text(asset.description),
      authors,
      attributes,
      maxResolution,
      resolutions: [],
      dimensions: dimensionsText(dimensionsMm),
      dimensionsMm: dimensionsMm.length > 0 ? dimensionsMm : null,
      polycount: numberValue(asset.polycount),
      texelDensity: numberValue(asset.texel_density) !== null
        ? formatMetric(numberValue(asset.texel_density)!)
        : null,
      publishedAt: publishedSeconds !== null ? Math.round(publishedSeconds * 1000) : null,
      downloadCount: numberValue(asset.download_count) ?? 0,
      thumbnail: text(asset.thumbnail_url) || null,
      timeOfDay,
      mapCodes: [],
      mapFormats: [],
      modelFormats: [],
      lodCount,
      collections,
      filesHash: text(asset.files_hash),
      enriched: false
    },
    sizeM: dimensionsMm.length > 0 ? Math.max(...dimensionsMm) / 1000 : null
  };
}

function isResolutionKey(value: string): boolean {
  return /^\d+(?:\.\d+)?k$/i.test(value.trim());
}

function sortResolutionKeys(values: string[]): string[] {
  return [...values].sort((a, b) => polyHavenResolutionValue(a) - polyHavenResolutionValue(b));
}

function parseFiles(files: Dict, type: PolyHavenAssetType): {
  resolutions: string[];
  mapCodes: string[];
  mapFormats: string[];
  modelFormats: string[];
} {
  const resolutions = new Set<string>();
  const mapCodes = new Set<string>();
  const formats = new Set<string>();
  const modelFormats = new Set<string>();

  if (type === "hdris") {
    const hdri = dict(files.hdri);
    for (const [resolution, value] of Object.entries(hdri)) {
      if (!isResolutionKey(resolution)) continue;
      resolutions.add(resolution.toLowerCase());
      for (const format of Object.keys(dict(value))) {
        if (format === "hdr" || format === "exr") formats.add(format);
      }
    }
    if (Object.keys(dict(files.tonemapped)).length > 0) {
      mapCodes.add("JPG");
      formats.add("jpg");
    }
    if (resolutions.size > 0) {
      mapCodes.add("HDR");
      formats.add("hdr");
    }
    return {
      resolutions: sortResolutionKeys([...resolutions]),
      mapCodes: [...mapCodes],
      mapFormats: [...formats],
      modelFormats: []
    };
  }

  for (const [code, value] of Object.entries(files)) {
    const lower = code.toLowerCase();
    if (["blend", "gltf", "usd", "fbx", "obj", "mtlx"].includes(lower)) {
      modelFormats.add(lower);
      continue;
    }
    if (["hdri", "tonemapped", "colorchart"].includes(lower)) continue;
    const entry = dict(value);
    const resolutionKeys = Object.keys(entry).filter(isResolutionKey);
    if (resolutionKeys.length === 0) continue;
    mapCodes.add(code);
    for (const resolution of resolutionKeys) {
      resolutions.add(resolution.toLowerCase());
      for (const format of Object.keys(dict(entry[resolution]))) {
        if (["jpg", "jpeg", "png", "exr", "hdr", "tif", "tiff"].includes(format.toLowerCase())) {
          formats.add(format.toLowerCase());
        }
      }
    }
  }

  return {
    resolutions: sortResolutionKeys([...resolutions]),
    mapCodes: [...mapCodes].sort((a, b) =>
      polyHavenMapLabel(a).localeCompare(polyHavenMapLabel(b))
    ),
    mapFormats: [...formats],
    modelFormats: [...modelFormats].sort()
  };
}

function parseFtsQuery(value: string): string {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map(token => `${token}*`).join(" AND ");
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 120;
  return Math.min(300, Math.max(1, Math.trunc(value ?? 120)));
}

function uniqueBuckets(values: Array<string | null | undefined>): PolyHavenFacetBucket[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export class PolyHavenCatalog {
  private readonly db: DatabaseSync;
  private refreshing: Promise<PolyHavenCatalogStatus> | null = null;
  private enriching: Promise<void> | null = null;
  private closed = false;
  private lastAttemptAt = 0;
  private lastError = "";
  private readonly listeners = new Set<(status: PolyHavenCatalogStatus) => void>();

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
        DROP TABLE IF EXISTS assets;
        DELETE FROM meta WHERE key IN ('count', 'refreshed_at');
      `);
      this.db.exec("VACUUM;");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        categories TEXT NOT NULL,
        tags TEXT NOT NULL,
        collections TEXT NOT NULL,
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
        download_count INTEGER NOT NULL,
        thumbnail TEXT,
        time_of_day REAL,
        map_codes TEXT NOT NULL,
        map_formats TEXT NOT NULL,
        model_formats TEXT NOT NULL,
        lod_count INTEGER NOT NULL,
        files_hash TEXT NOT NULL,
        files TEXT,
        raw TEXT NOT NULL DEFAULT '{}',
        enriched_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
        name, tags, categories, category, description, content=''
      );
    `);
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)")
      .run(SCHEMA_VERSION);
  }

  close(): void {
    this.closed = true;
    this.db.close();
  }

  onStatus(listener: (status: PolyHavenCatalogStatus) => void): () => void {
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

  status(): PolyHavenCatalogStatus {
    const count = Number(this.getMeta("count") ?? "0");
    const enriched = Number(
      (this.db.prepare("SELECT COUNT(*) AS count FROM assets WHERE enriched_at > 0").get() as
        | { count: number }
        | undefined)?.count ?? 0
    );
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
      enriched,
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

  async refresh(): Promise<PolyHavenCatalogStatus> {
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

  private async doRefresh(): Promise<PolyHavenCatalogStatus> {
    this.lastError = "";
    this.emit();
    this.logger.info("Refreshing Poly Haven catalogue");
    try {
      const responses = await Promise.all(
        (["hdris", "textures", "models"] as const).map(async type => {
          const response = await fetch(`${API_BASE}/assets?t=${type}`, {
            headers: { Accept: "application/json", "User-Agent": "OpenBridge" },
            signal: AbortSignal.timeout(180_000)
          });
          if (!response.ok) {
            throw new Error(`Poly Haven ${type} catalogue returned HTTP ${response.status}`);
          }
          return { type, payload: (await response.json()) as unknown };
        })
      );

      const insert = this.db.prepare(`
        INSERT INTO assets (
          id, name, type, category, categories, tags, collections, description, authors,
          attributes, max_resolution, resolutions, dimensions, dimensions_mm, size_m,
          polycount, texel_density, published_at, download_count, thumbnail, time_of_day,
          map_codes, map_formats, model_formats, lod_count, files_hash, raw
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          category = excluded.category,
          categories = excluded.categories,
          tags = excluded.tags,
          collections = excluded.collections,
          description = excluded.description,
          authors = excluded.authors,
          attributes = excluded.attributes,
          max_resolution = excluded.max_resolution,
          dimensions = excluded.dimensions,
          dimensions_mm = excluded.dimensions_mm,
          size_m = excluded.size_m,
          polycount = excluded.polycount,
          texel_density = excluded.texel_density,
          published_at = excluded.published_at,
          download_count = excluded.download_count,
          thumbnail = excluded.thumbnail,
          time_of_day = excluded.time_of_day,
          lod_count = excluded.lod_count,
          files_hash = excluded.files_hash,
          raw = excluded.raw,
          resolutions = CASE
            WHEN assets.files_hash = excluded.files_hash AND assets.files IS NOT NULL
            THEN assets.resolutions ELSE '[]' END,
          map_codes = CASE
            WHEN assets.files_hash = excluded.files_hash AND assets.files IS NOT NULL
            THEN assets.map_codes ELSE '[]' END,
          map_formats = CASE
            WHEN assets.files_hash = excluded.files_hash AND assets.files IS NOT NULL
            THEN assets.map_formats ELSE '[]' END,
          model_formats = CASE
            WHEN assets.files_hash = excluded.files_hash AND assets.files IS NOT NULL
            THEN assets.model_formats ELSE '[]' END,
          files = CASE
            WHEN assets.files_hash = excluded.files_hash AND assets.files IS NOT NULL
            THEN assets.files ELSE NULL END,
          enriched_at = CASE
            WHEN assets.files_hash = excluded.files_hash AND assets.files IS NOT NULL
            THEN assets.enriched_at ELSE 0 END
      `);

      const ids: string[] = [];
      this.db.exec("BEGIN");
      try {
        for (const { payload } of responses) {
          const root = dict(payload);
          for (const [id, value] of Object.entries(root)) {
            const normalized = normalizeAsset(id, value);
            if (!normalized) continue;
            const { summary, sizeM } = normalized;
            insert.run(
              summary.id,
              summary.name,
              summary.type,
              summary.category,
              JSON.stringify(summary.categories),
              JSON.stringify(summary.tags),
              JSON.stringify(summary.collections),
              summary.description,
              JSON.stringify(summary.authors),
              JSON.stringify(summary.attributes),
              summary.maxResolution,
              JSON.stringify(summary.resolutions),
              summary.dimensions,
              JSON.stringify(summary.dimensionsMm ?? []),
              sizeM,
              summary.polycount,
              summary.texelDensity,
              summary.publishedAt,
              summary.downloadCount,
              summary.thumbnail,
              summary.timeOfDay,
              JSON.stringify(summary.mapCodes),
              JSON.stringify(summary.mapFormats),
              JSON.stringify(summary.modelFormats),
              summary.lodCount,
              summary.filesHash,
              JSON.stringify(value)
            );
            ids.push(summary.id);
          }
        }
        this.db
          .prepare("DELETE FROM assets WHERE id NOT IN (SELECT value FROM json_each(?))")
          .run(JSON.stringify(ids));
        this.rebuildFts();
        this.setMeta("count", String(ids.length));
        this.setMeta("refreshed_at", String(Date.now()));
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.logger.info("Poly Haven catalogue refreshed", { inserted: ids.length });
      this.startEnrichment();
      return this.status();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error("Poly Haven catalogue refresh failed", { error });
      return this.status();
    }
  }

  private rebuildFts(): void {
    this.db.exec(`
      DELETE FROM assets_fts;
      INSERT INTO assets_fts (rowid, name, tags, categories, category, description)
      SELECT rowid, name, id || ' ' || tags, categories, category, description FROM assets;
    `);
  }

  private startEnrichment(): void {
    if (this.enriching || this.closed) return;
    this.enriching = this.enrich().finally(() => {
      this.enriching = null;
      this.emit();
    });
    void this.enriching;
  }

  /**
   * Resolutions and map lists live behind a second per-asset endpoint. The
   * catalogue becomes searchable first, then details are filled in with a
   * small worker pool and cached by `files_hash`.
   */
  private async enrich(): Promise<void> {
    const rows = this.db
      .prepare(
        `SELECT id, type, files_hash FROM assets
         WHERE enriched_at = 0 OR files IS NULL
         ORDER BY published_at DESC`
      )
      .all() as Array<{ id: string; type: string; files_hash: string }>;
    if (rows.length === 0) return;
    let cursor = 0;
    let completed = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.closed) return;
        const row = rows[cursor++];
        if (!row) return;
        try {
          const response = await fetch(`${API_BASE}/files/${encodeURIComponent(row.id)}`, {
            headers: { Accept: "application/json", "User-Agent": "OpenBridge" },
            signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS)
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const files = dict(await response.json());
          const parsed = parseFiles(files, polyHavenTypeFromCode(row.type));
          this.db
            .prepare(
              `UPDATE assets SET
                 files = ?,
                 resolutions = ?,
                 map_codes = ?,
                 map_formats = ?,
                 model_formats = ?,
                 enriched_at = ?
               WHERE id = ? AND files_hash = ?`
            )
            .run(
              JSON.stringify(files),
              JSON.stringify(parsed.resolutions),
              JSON.stringify(parsed.mapCodes),
              JSON.stringify(parsed.mapFormats),
              JSON.stringify(parsed.modelFormats),
              Date.now(),
              row.id,
              row.files_hash
            );
        } catch (error) {
          this.logger.warn("Poly Haven file metadata unavailable", { id: row.id, error });
        }
        completed += 1;
        if (completed % 25 === 0) this.emit();
      }
    };
    await Promise.all(Array.from({ length: ENRICH_CONCURRENCY }, () => worker()));
    this.logger.info("Poly Haven file metadata enriched", { enriched: completed });
  }

  private summaryFromRow(row: Dict): PolyHavenAssetSummary {
    const type = text(row.type) as PolyHavenAssetType;
    return {
      id: text(row.id),
      name: text(row.name),
      type,
      typeLabel: polyHavenTypeLabel(type),
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
      timeOfDay: row.time_of_day == null ? null : Number(row.time_of_day),
      mapCodes: stringList(JSON.parse(text(row.map_codes) || "[]")),
      mapFormats: stringList(JSON.parse(text(row.map_formats) || "[]")),
      modelFormats: stringList(JSON.parse(text(row.model_formats) || "[]")),
      lodCount: Number(row.lod_count ?? 0),
      collections: stringList(JSON.parse(text(row.collections) || "[]")),
      filesHash: text(row.files_hash),
      enriched: Number(row.enriched_at ?? 0) > 0
    };
  }

  private descendantCategorySql(paths: string[]): { sql: string; params: string[] } {
    const clauses: string[] = [];
    const params: string[] = [];
    for (const path of paths) {
      clauses.push("(a.category = ? OR a.category LIKE ?)");
      params.push(path, `${path}/%`);
    }
    return { sql: `(${clauses.join(" OR ")})`, params };
  }

  private buildWhere(query: PolyHavenCatalogQuery): {
    from: string;
    where: string[];
    params: Array<string | number | null>;
    fts: boolean;
  } {
    const from = "FROM assets a";
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    let fts = false;

    const term = (query.query ?? "").trim();
    if (term) {
      const urlMatch = /polyhaven\.com\/a\/([\w.-]+)/i.exec(term);
      const searchTerm = urlMatch ? urlMatch[1] : term;
      const match = parseFtsQuery(searchTerm);
      if (match) {
        const looksLikeId = Boolean(urlMatch) || (/^[\w.-]+$/.test(searchTerm) && /[_\-]/.test(searchTerm));
        if (looksLikeId) {
          where.push(
            "(a.rowid IN (SELECT rowid FROM assets_fts WHERE assets_fts MATCH ?) OR lower(a.id) = lower(?))"
          );
          params.push(match, searchTerm);
        } else {
          where.push("assets_fts MATCH ?");
          params.push(match);
          fts = true;
        }
      }
    }
    if (query.type) {
      if (query.type === "__none__") where.push("0");
      else {
        where.push("a.type = ?");
        params.push(query.type);
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
      const clause = this.descendantCategorySql(query.categoryPaths);
      where.push(clause.sql);
      params.push(...clause.params);
    }
    if (query.categories && query.categories.length > 0) {
      where.push(
        `EXISTS (SELECT 1 FROM json_each(a.categories) WHERE lower(json_each.value) IN (${query.categories
          .map(() => "?")
          .join(",")}))`
      );
      params.push(...query.categories.map(value => value.toLowerCase()));
    }
    if (query.collections && query.collections.length > 0) {
      where.push(
        `EXISTS (SELECT 1 FROM json_each(a.collections) WHERE lower(json_each.value) IN (${query.collections
          .map(() => "?")
          .join(",")}))`
      );
      params.push(...query.collections.map(value => value.toLowerCase()));
    }
    if (typeof query.minSize === "number" || typeof query.maxSize === "number") {
      if (typeof query.minSize === "number") {
        where.push("a.size_m IS NOT NULL AND a.size_m >= ?");
        params.push(query.minSize);
      }
      if (typeof query.maxSize === "number") {
        where.push("a.size_m IS NOT NULL AND a.size_m <= ?");
        params.push(query.maxSize);
      }
    }
    for (const resolution of query.resolutions ?? []) {
      where.push("a.resolutions LIKE ?");
      params.push(`%"${resolution}"%`);
    }
    for (const mapType of query.mapTypes ?? []) {
      where.push("a.map_codes LIKE ?");
      params.push(`%"${mapType}"%`);
    }
    for (const [key, values] of Object.entries(query.attributes ?? {})) {
      if (!/^[a-z0-9_]+$/i.test(key) || values.length === 0) continue;
      const path = `$.${key}`;
      where.push(`
        EXISTS (
          SELECT 1 FROM json_each(
            CASE WHEN json_type(a.attributes, ?) = 'array'
              THEN json_extract(a.attributes, ?)
              ELSE json_array(json_extract(a.attributes, ?))
            END
          ) e
          WHERE CASE
            WHEN typeof(e.value) = 'integer' AND e.value IN (0, 1)
              THEN CASE e.value WHEN 1 THEN 'yes' ELSE 'no' END
            ELSE lower(CAST(e.value AS TEXT))
          END IN (${values.map(() => "?").join(",")})
        )
      `);
      params.push(path, path, path, ...values.map(value => value.toLowerCase()));
    }
    if (
      query.type === "hdris" &&
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
      from: fts ? `${from} JOIN assets_fts ON assets_fts.rowid = a.rowid` : from,
      where,
      params,
      fts
    };
  }

  query(query: PolyHavenCatalogQuery): PolyHavenQueryResult {
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
      if (
        query.type === "hdris" &&
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
        case "newest":
          return "a.published_at DESC, a.name COLLATE NOCASE";
        case "oldest":
          return "a.published_at ASC, a.name COLLATE NOCASE";
        case "name":
          return "a.name COLLATE NOCASE ASC";
        case "name-desc":
          return "a.name COLLATE NOCASE DESC";
        case "resolution":
          return "a.max_resolution DESC, a.name COLLATE NOCASE";
        case "triangles":
          return "a.polycount DESC, a.name COLLATE NOCASE";
        case "maps":
          return "json_array_length(a.map_codes) DESC, a.name COLLATE NOCASE";
        case "size":
          return "a.size_m DESC NULLS LAST, a.name COLLATE NOCASE";
        case "downloads":
          return "a.download_count DESC, a.name COLLATE NOCASE";
        case "relevance":
        default:
          return fts ? "bm25(assets_fts), a.published_at DESC" : "a.published_at DESC, a.name COLLATE NOCASE";
      }
    })();

    const rows = this.db
      .prepare(`SELECT a.* ${from} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Dict[];
    const hits = rows.map(row => this.summaryFromRow(row));

    const facetFilter = this.buildWhere({ ...query, resolutions: [], mapTypes: [], attributes: {} });
    const facetRows = this.db
      .prepare(
        `SELECT a.type, a.resolutions, a.map_codes, a.categories, a.collections, a.attributes ${facetFilter.from} ${
          facetFilter.where.length > 0 ? `WHERE ${facetFilter.where.join(" AND ")}` : ""
        }`
      )
      .all(...facetFilter.params) as Dict[];
    const types: string[] = [];
    const resolutions: string[] = [];
    const mapTypes: string[] = [];
    const categories: string[] = [];
    const collections: string[] = [];
    const attributeCounts = new Map<string, Map<string, number>>();
    const addAttribute = (key: string, value: string): void => {
      if (!key || !value) return;
      const bucket = attributeCounts.get(key) ?? new Map<string, number>();
      bucket.set(value, (bucket.get(value) ?? 0) + 1);
      attributeCounts.set(key, bucket);
    };
    for (const row of facetRows) {
      types.push(text(row.type));
      resolutions.push(...stringList(JSON.parse(text(row.resolutions) || "[]")));
      mapTypes.push(...stringList(JSON.parse(text(row.map_codes) || "[]")));
      categories.push(...stringList(JSON.parse(text(row.categories) || "[]")));
      collections.push(...stringList(JSON.parse(text(row.collections) || "[]")));
      for (const [key, rawValue] of Object.entries(dict(JSON.parse(text(row.attributes) || "{}")))) {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        for (const value of values) {
          if (typeof value === "boolean") addAttribute(key, value ? "yes" : "no");
          else if (typeof value === "string" || typeof value === "number") addAttribute(key, String(value));
        }
      }
    }
    const attributes: Record<string, PolyHavenFacetBucket[]> = {};
    for (const [key, counts] of attributeCounts) {
      attributes[key] = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    }
    const facets: PolyHavenFacets = {
      types: uniqueBuckets(types),
      resolutions: uniqueBuckets(resolutions),
      mapTypes: uniqueBuckets(mapTypes),
      categories: uniqueBuckets(categories),
      collections: uniqueBuckets(collections),
      attributes
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

  categories(): CategoryNode[] {
    const rows = this.db
      .prepare("SELECT category, id FROM assets WHERE category <> ''")
      .all() as Array<{ category: string; id: string }>;
    interface MutableNode extends CategoryNode {
      children: MutableNode[];
    }
    const roots: MutableNode[] = [];
    const index = new Map<string, MutableNode>();
    for (const row of rows) {
      const parts = row.category.split("/").map(part => part.trim()).filter(Boolean);
      let nodes = roots;
      let trail = "";
      for (const part of parts) {
        trail = trail ? `${trail}/${part}` : part;
        let node = index.get(trail);
        if (!node) {
          node = { key: trail, label: part, count: 0, children: [] };
          index.set(trail, node);
          nodes.push(node);
        }
        node.count += 1;
        nodes = node.children;
      }
    }
    const sort = (nodes: MutableNode[]): CategoryNode[] =>
      nodes
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(node => ({ ...node, children: sort(node.children) }));
    return sort(roots);
  }

  ids(query: PolyHavenCatalogQuery): string[] {
    const { from, where, params } = this.buildWhere(query);
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT a.id ${from} ${whereSql} ORDER BY a.name COLLATE NOCASE`)
      .all(...params) as Array<{ id: string }>;
    return rows.map(row => text(row.id));
  }

  findById(id: string): PolyHavenAssetSummary | null {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Dict | undefined;
    return row ? this.summaryFromRow(row) : null;
  }

  findByName(name: string): PolyHavenAssetSummary | null {
    if (!name) return null;
    const row = this.db
      .prepare("SELECT * FROM assets WHERE id = ? OR lower(name) = lower(?) LIMIT 1")
      .get(name, name) as Dict | undefined;
    return row ? this.summaryFromRow(row) : null;
  }

  async extended(assetId: string): Promise<PolyHavenAssetDetail> {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as
      | Dict
      | undefined;
    if (!row) throw new Error(`Poly Haven asset ${assetId} is not in the catalogue`);
    const summary = this.summaryFromRow(row);
    const raw = dict(JSON.parse(text(row.raw) || "{}"));
    let files = text(row.files) ? dict(JSON.parse(text(row.files))) : {};
    if (Object.keys(files).length === 0) {
      const response = await fetch(`${API_BASE}/files/${encodeURIComponent(assetId)}`, {
        headers: { Accept: "application/json", "User-Agent": "OpenBridge" },
        signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`Poly Haven files returned HTTP ${response.status}`);
      files = dict(await response.json());
      const parsed = parseFiles(files, summary.type);
      this.db
        .prepare(
          `UPDATE assets SET files = ?, resolutions = ?, map_codes = ?, map_formats = ?,
             model_formats = ?, enriched_at = ? WHERE id = ?`
        )
        .run(
          JSON.stringify(files),
          JSON.stringify(parsed.resolutions),
          JSON.stringify(parsed.mapCodes),
          JSON.stringify(parsed.mapFormats),
          JSON.stringify(parsed.modelFormats),
          Date.now(),
          assetId
        );
      const refreshed = this.summaryFromRow(
        this.db.prepare("SELECT * FROM assets WHERE id = ?").get(assetId) as Dict
      );
      return { ...refreshed, files, raw };
    }
    return { ...summary, files, raw };
  }
}
