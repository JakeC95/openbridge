import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AssetRecord,
  LibraryCounts,
  LibraryHealthReport,
  LibraryIssue,
  LibraryQuery,
  LibraryQueryResult,
  LibraryRef,
  LibrarySnapshot,
  RepoKind
} from "../shared/types";
import type { Logger } from "./logger";

const SCHEMA_VERSION = 3;

interface AssetRow {
  rowid: number;
  path: string;
  id: string;
  name: string;
  type: string;
  categories: string;
  tags: string;
  repo: string;
  json_path: string;
  preview: string | null;
  thumb: string | null;
  mtime: number;
  preview_relative_size: string;
  search_str: string;
  folder_mtime: number;
  json_mtime: number;
  files: number;
  bytes: number;
  zero_bytes: number;
  meshes: number;
  textures: number;
  health_mtime: number;
  health_at: number;
  technical_json: string | null;
  issue_count?: number;
}

interface HealthRow {
  path: string;
  id: string;
  name: string;
  type: string;
  preview: string | null;
  folder_mtime: number;
}

interface AssetStats {
  files: number;
  bytes: number;
  zeroBytes: number;
  meshes: number;
  textures: number;
}

interface ColumnRow {
  value: string;
}

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function rowToAsset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    categories: parseList(row.categories),
    tags: parseList(row.tags),
    repo: row.repo as RepoKind,
    path: row.path,
    jsonPath: row.json_path,
    preview: row.preview,
    thumb: row.thumb,
    mtime: row.mtime,
    previewRelativeSize: row.preview_relative_size,
    searchStr: row.search_str,
    technical: row.technical_json
      ? (JSON.parse(row.technical_json) as AssetRecord["technical"])
      : undefined,
    sizeBytes: row.health_at > 0 ? row.bytes : undefined,
    fileCount: row.health_at > 0 ? row.files : undefined,
    issueCount: row.health_at > 0 ? row.issue_count ?? 0 : undefined
  };
}

function ftsQuery(value: string): string {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map(token => `${token}*`).join(" AND ");
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 300;
  return Math.min(2000, Math.max(1, Math.trunc(value ?? 300)));
}

export class LibraryIndex {
  private readonly db: DatabaseSync;

  constructor(
    filePath: string,
    private readonly logger: Logger
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
    `);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  ensureLibraryPath(libraryPath: string): void {
    const current = this.getMeta("library_path");
    if (!current) {
      this.setMeta("library_path", libraryPath);
      return;
    }
    if (current === libraryPath) return;
    this.transaction(() => {
      this.db.exec("DELETE FROM assets;");
      this.setMeta("library_path", libraryPath);
      this.setMeta("scanned_at", "0");
    });
  }

  getCachedRow(path: string): AssetRow | null {
    const row = this.db
      .prepare("SELECT * FROM assets WHERE path = ?")
      .get(path) as AssetRow | undefined;
    return row ?? null;
  }

  upsert(asset: AssetRecord, folderMtime: number, jsonMtime: number): void {
    this.upsertMany([{ asset, folderMtime, jsonMtime }]);
  }

  upsertMany(
    entries: Array<{ asset: AssetRecord; folderMtime: number; jsonMtime: number }>
  ): void {
    if (entries.length === 0) return;
    const statement = this.db.prepare(
      `INSERT INTO assets (
        path, id, name, type, categories, tags, repo, json_path, preview, thumb,
        mtime, preview_relative_size, search_str, folder_mtime, json_mtime, technical_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        id = excluded.id,
        name = excluded.name,
        type = excluded.type,
        categories = excluded.categories,
        tags = excluded.tags,
        repo = excluded.repo,
        json_path = excluded.json_path,
        preview = excluded.preview,
        thumb = excluded.thumb,
        mtime = excluded.mtime,
        preview_relative_size = excluded.preview_relative_size,
        search_str = excluded.search_str,
        folder_mtime = excluded.folder_mtime,
        json_mtime = excluded.json_mtime,
        technical_json = excluded.technical_json,
        health_mtime = 0`
    );
    this.transaction(() => {
      for (const { asset, folderMtime, jsonMtime } of entries) {
        statement.run(
          asset.path,
          asset.id,
          asset.name,
          asset.type,
          JSON.stringify(asset.categories),
          JSON.stringify(asset.tags),
          asset.repo,
          asset.jsonPath,
          asset.preview,
          asset.thumb,
          Math.trunc(asset.mtime),
          asset.previewRelativeSize,
          asset.searchStr,
          Math.trunc(folderMtime),
          Math.trunc(jsonMtime),
          asset.technical ? JSON.stringify(asset.technical) : null
        );
      }
    });
  }

  deleteMissing(paths: Set<string>): number {
    const rows = this.db.prepare("SELECT path FROM assets").all() as Array<{ path: string }>;
    const remove = rows.filter(row => !paths.has(row.path));
    if (remove.length === 0) return 0;
    const statement = this.db.prepare("DELETE FROM assets WHERE path = ?");
    this.transaction(() => {
      for (const row of remove) statement.run(row.path);
    });
    return remove.length;
  }

  setScannedAt(value: number): void {
    this.setMeta("scanned_at", String(value));
  }

  getScannedAt(): number {
    return Number(this.getMeta("scanned_at") ?? 0) || 0;
  }

  getSnapshot(libraryPath: string): LibrarySnapshot {
    const counts = this.counts();
    return {
      refs: this.refs(),
      total: counts.all,
      counts,
      scannedAt: this.getScannedAt(),
      libraryPath
    };
  }

  refs(): LibraryRef[] {
    return this.db
      .prepare("SELECT id, path FROM assets ORDER BY mtime DESC")
      .all() as unknown as LibraryRef[];
  }

  counts(): LibraryCounts {
    const counts: LibraryCounts = { all: 0, downloaded: 0, custom: 0, dhi: 0 };
    const rows = this.db
      .prepare("SELECT repo, COUNT(*) AS total FROM assets GROUP BY repo")
      .all() as Array<{ repo: string; total: number }>;
    for (const row of rows) {
      if (row.repo === "downloaded" || row.repo === "custom" || row.repo === "dhi") {
        counts[row.repo] = Number(row.total);
      }
      counts.all += Number(row.total);
    }
    return counts;
  }

  getById(id: string): AssetRecord | null {
    const row = this.db
      .prepare("SELECT a.*, (SELECT COUNT(*) FROM issues i WHERE i.path = a.path) AS issue_count FROM assets a WHERE a.id = ? ORDER BY a.mtime DESC LIMIT 1")
      .get(id) as unknown as AssetRow | undefined;
    return row ? rowToAsset(row) : null;
  }

  getByIds(ids: string[]): AssetRecord[] {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];
    const rows: AssetRow[] = [];
    for (let index = 0; index < unique.length; index += 500) {
      const chunk = unique.slice(index, index + 500);
      const placeholders = chunk.map(() => "?").join(",");
      const found = this.db
        .prepare(
          `SELECT a.*, (SELECT COUNT(*) FROM issues i WHERE i.path = a.path) AS issue_count FROM assets a WHERE a.id IN (${placeholders}) ORDER BY a.mtime DESC`
        )
        .all(...chunk) as unknown as AssetRow[];
      rows.push(...found);
    }
    return rows.map(rowToAsset);
  }
  allAssets(): AssetRecord[] {
    const rows = this.db
      .prepare("SELECT a.*, (SELECT COUNT(*) FROM issues i WHERE i.path = a.path) AS issue_count FROM assets a ORDER BY a.mtime DESC")
      .all() as unknown as AssetRow[];
    return rows.map(rowToAsset);
  }

  query(options: LibraryQuery): LibraryQueryResult {
    const started = performance.now();
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const parts = this.queryParts(options);
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total ${parts.from} ${parts.where}`)
      .get(...parts.params) as { total: number } | undefined;
    const total = Number(totalRow?.total ?? 0);
    const rows = this.db
      .prepare(
        `SELECT a.*, (SELECT COUNT(*) FROM issues i WHERE i.path = a.path) AS issue_count ${parts.from} ${parts.where}
         ORDER BY ${parts.order}
         LIMIT ? OFFSET ?`
      )
      .all(...parts.params, limit, offset) as unknown as AssetRow[];

    return {
      assets: rows.map(rowToAsset),
      total,
      counts: this.counts(),
      offset,
      limit,
      hasMore: offset + rows.length < total,
      tookMs: performance.now() - started
    };
  }

  ids(options: LibraryQuery): string[] {
    const parts = this.queryParts(options);
    const rows = this.db
      .prepare(
        `SELECT a.id ${parts.from} ${parts.where}
         ORDER BY ${parts.order}`
      )
      .all(...parts.params) as Array<{ id: string }>;
    return rows.map(row => row.id);
  }

  private queryParts(options: LibraryQuery): {
    from: string;
    where: string;
    order: string;
    params: Array<string | number>;
  } {
    const searchTokens = ftsQuery(options.query ?? "");
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.repo && options.repo !== "all") {
      clauses.push("a.repo = ?");
      params.push(options.repo);
    }
    if (searchTokens) {
      clauses.push("assets_fts MATCH ?");
      params.push(searchTokens);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const from = searchTokens
      ? "FROM assets a JOIN assets_fts ON assets_fts.rowid = a.rowid"
      : "FROM assets a";
    const order =
      options.sort === "name"
        ? "a.name COLLATE NOCASE ASC, a.id ASC"
        : options.sort === "type"
          ? "a.type COLLATE NOCASE ASC, a.name COLLATE NOCASE ASC"
          : "a.mtime DESC, a.name COLLATE NOCASE ASC";
    return { from, where, order, params };
  }

  healthRows(force: boolean): HealthRow[] {
    const rows = this.db
      .prepare(
        `SELECT path, id, name, type, preview, folder_mtime
         FROM assets
         WHERE ? = 1 OR health_at = 0 OR health_mtime != folder_mtime
         ORDER BY mtime DESC`
      )
      .all(force ? 1 : 0) as unknown as HealthRow[];
    return rows;
  }

  setHealth(path: string, stats: AssetStats, issues: LibraryIssue[]): void {
    this.setHealthMany([{ path, stats, issues }]);
  }

  setHealthMany(
    entries: Array<{ path: string; stats: AssetStats; issues: LibraryIssue[] }>
  ): void {
    if (entries.length === 0) return;
    const update = this.db.prepare(
      `UPDATE assets SET
        files = ?, bytes = ?, zero_bytes = ?, meshes = ?, textures = ?,
        health_at = ?, health_mtime = folder_mtime
       WHERE path = ?`
    );
    const clear = this.db.prepare("DELETE FROM issues WHERE path = ?");
    const insert = this.db.prepare(
      `INSERT INTO issues (path, asset_id, name, kind, severity, message)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const now = Date.now();
    this.transaction(() => {
      for (const entry of entries) {
        const { path, stats, issues } = entry;
        update.run(
          stats.files,
          stats.bytes,
          stats.zeroBytes,
          stats.meshes,
          stats.textures,
          now,
          path
        );
        clear.run(path);
        for (const issue of issues) {
          insert.run(
            issue.path,
            issue.assetId ?? null,
            issue.name ?? null,
            issue.kind,
            issue.severity,
            issue.message
          );
        }
      }
    });
  }

  healthReport(libraryPath: string): LibraryHealthReport {
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS assets,
          COALESCE(SUM(files), 0) AS files,
          COALESCE(SUM(bytes), 0) AS bytes
         FROM assets`
      )
      .get() as { assets: number; files: number; bytes: number };
    const byTypeRows = this.db
      .prepare(
        `SELECT type, COUNT(*) AS assets,
          COALESCE(SUM(bytes), 0) AS bytes,
          COALESCE(SUM(files), 0) AS files
         FROM assets GROUP BY type`
      )
      .all() as Array<{ type: string; assets: number; bytes: number; files: number }>;
    const byType: LibraryHealthReport["byType"] = {};
    for (const row of byTypeRows) {
      byType[row.type] = {
        assets: Number(row.assets),
        bytes: Number(row.bytes),
        files: Number(row.files)
      };
    }

    const issueRows = this.db
      .prepare(
        `SELECT asset_id, name, kind, severity, path, message
         FROM issues
         ORDER BY CASE severity WHEN 'error' THEN 0 ELSE 1 END, path`
      )
      .all() as Array<{
      asset_id: string | null;
      name: string | null;
      kind: LibraryIssue["kind"];
      severity: LibraryIssue["severity"];
      path: string;
      message: string;
    }>;
    const duplicateRows = this.db
      .prepare(
        `SELECT id, GROUP_CONCAT(path, char(10)) AS paths, COUNT(*) AS total
         FROM assets GROUP BY id HAVING COUNT(*) > 1`
      )
      .all() as Array<{ id: string; paths: string; total: number }>;
    const duplicates = duplicateRows.map(row => ({
      assetId: row.id,
      paths: row.paths.split("\n").filter(Boolean)
    }));
    const issues: LibraryIssue[] = issueRows.map(row => ({
      kind: row.kind,
      severity: row.severity,
      assetId: row.asset_id ?? undefined,
      name: row.name ?? undefined,
      path: row.path,
      message: row.message
    }));
    for (const duplicate of duplicates) {
      issues.push({
        kind: "duplicate-id",
        severity: "warning",
        assetId: duplicate.assetId,
        path: duplicate.paths.join("; "),
        message: `Asset ID appears in ${duplicate.paths.length} locations`
      });
    }

    return {
      libraryPath,
      scannedAt: Date.now(),
      assets: Number(totals.assets),
      files: Number(totals.files),
      totalBytes: Number(totals.bytes),
      byType,
      issues,
      duplicates
    };
  }

  getMeta(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(key) as ColumnRow | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  private migrate(): void {
    const versionRow = this.db.prepare("PRAGMA user_version").get() as
      | { user_version: number }
      | undefined;
    const version = Number(versionRow?.user_version ?? 0);
    if (version === SCHEMA_VERSION) return;

    this.logger.info("Creating library index", { version: SCHEMA_VERSION });
    this.db.exec(`
      DROP TRIGGER IF EXISTS assets_ai;
      DROP TRIGGER IF EXISTS assets_ad;
      DROP TRIGGER IF EXISTS assets_au;
      DROP TABLE IF EXISTS issues;
      DROP TABLE IF EXISTS assets_fts;
      DROP TABLE IF EXISTS assets;
      DROP TABLE IF EXISTS meta;

      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE assets (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        categories TEXT NOT NULL,
        tags TEXT NOT NULL,
        repo TEXT NOT NULL,
        json_path TEXT NOT NULL,
        preview TEXT,
        thumb TEXT,
        mtime INTEGER NOT NULL,
        preview_relative_size TEXT NOT NULL,
        search_str TEXT NOT NULL,
        folder_mtime INTEGER NOT NULL,
        json_mtime INTEGER NOT NULL,
        files INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        zero_bytes INTEGER NOT NULL DEFAULT 0,
        meshes INTEGER NOT NULL DEFAULT 0,
        textures INTEGER NOT NULL DEFAULT 0,
        health_at INTEGER NOT NULL DEFAULT 0,
        health_mtime INTEGER NOT NULL DEFAULT 0,
        technical_json TEXT
      );

      CREATE INDEX assets_id_idx ON assets(id);
      CREATE INDEX assets_type_idx ON assets(type);
      CREATE INDEX assets_repo_idx ON assets(repo);
      CREATE INDEX assets_mtime_idx ON assets(mtime DESC);

      CREATE TABLE issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL REFERENCES assets(path) ON DELETE CASCADE,
        asset_id TEXT,
        name TEXT,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE INDEX issues_path_idx ON issues(path);

      CREATE VIRTUAL TABLE assets_fts USING fts5(
        id, name, type, categories, tags, search_str,
        content='assets', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER assets_ai AFTER INSERT ON assets BEGIN
        INSERT INTO assets_fts(rowid, id, name, type, categories, tags, search_str)
        VALUES (new.rowid, new.id, new.name, new.type, new.categories, new.tags, new.search_str);
      END;
      CREATE TRIGGER assets_ad AFTER DELETE ON assets BEGIN
        INSERT INTO assets_fts(assets_fts, rowid, id, name, type, categories, tags, search_str)
        VALUES ('delete', old.rowid, old.id, old.name, old.type, old.categories, old.tags, old.search_str);
      END;
      CREATE TRIGGER assets_au AFTER UPDATE OF id, name, type, categories, tags, search_str ON assets BEGIN
        INSERT INTO assets_fts(assets_fts, rowid, id, name, type, categories, tags, search_str)
        VALUES ('delete', old.rowid, old.id, old.name, old.type, old.categories, old.tags, old.search_str);
        INSERT INTO assets_fts(rowid, id, name, type, categories, tags, search_str)
        VALUES (new.rowid, new.id, new.name, new.type, new.categories, new.tags, new.search_str);
      END;

      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }

  private transaction(run: () => void): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      run();
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }
}
