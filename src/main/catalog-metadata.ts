import { createReadStream, mkdirSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { dirname, join } from "node:path";
import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import type {
  CatalogMetadataRecord,
  CatalogMetadataStatus
} from "../shared/types";
import type { PackRef, PackSummary } from "../shared/types";
import { downloadFile } from "./downloader";
import { releaseAssetUrl } from "./project";
import type { Logger } from "./logger";

const METADATA_PACK_URL = releaseAssetUrl("catalog-metadata.json.gz");
const BATCH_SIZE = 500;

interface PackHeader {
  format?: string;
  version?: number;
  generatedAt?: number;
  count?: number;
}

export class CatalogMetadataProvider {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;

  constructor(
    filePath: string,
    private readonly logger: Logger
  ) {
    this.dbPath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS catalog_metadata (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  status(): CatalogMetadataStatus {
    const count = Number(
      (this.db.prepare("SELECT COUNT(*) AS n FROM catalog_metadata").get() as
        | { n: number }
        | undefined)?.n ?? 0
    );
    const generatedAt = Number(this.getMeta("generated_at") ?? 0) || null;
    const importedAt = Number(this.getMeta("imported_at") ?? 0) || null;
    const version = Number(this.getMeta("version") ?? 0) || null;
    return {
      available: count > 0,
      count,
      generatedAt,
      importedAt,
      version
    };
  }

  lookup(ids: string[]): CatalogMetadataRecord[] {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];
    const output: CatalogMetadataRecord[] = [];
    for (let index = 0; index < unique.length; index += BATCH_SIZE) {
      const chunk = unique.slice(index, index + BATCH_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = this.db
        .prepare(
          `SELECT data FROM catalog_metadata WHERE id IN (${placeholders})`
        )
        .all(...chunk) as Array<{ data: string }>;
      for (const row of rows) {
        try {
          output.push(JSON.parse(row.data) as CatalogMetadataRecord);
        } catch {
          // ignore malformed rows
        }
      }
    }
    return output;
  }

  packs(): PackSummary[] {
    const rows = this.db.prepare(`SELECT json_extract(data, '$.technical.packId') AS pack_id,
      json_extract(data, '$.technical.packName') AS pack_name, COUNT(*) AS count
      FROM catalog_metadata GROUP BY pack_id, pack_name HAVING pack_name IS NOT NULL OR pack_id IS NOT NULL`).all() as
      Array<{ pack_id: string | null; pack_name: string | null; count: number }>;
    return rows.map(row => ({ id: row.pack_id || undefined, name: row.pack_name || row.pack_id || "Pack",
      count: Number(row.count) })).sort((a, b) => a.name.localeCompare(b.name));
  }

  packIds(pack: PackRef): string[] {
    const field = pack.id ? "packId" : "packName";
    return (this.db.prepare(`SELECT id FROM catalog_metadata
      WHERE json_extract(data, '$.technical.${field}') = ?`).all(pack.id || pack.name) as
      Array<{ id: string }>).map(row => row.id);
  }

  async installFromUrl(url = METADATA_PACK_URL): Promise<CatalogMetadataStatus> {
    if (!url) throw new Error("No metadata pack URL configured");
    const target = join(app.getPath("temp"), "openbridge-catalog-metadata.json.gz");
    await rm(target, { force: true });
    try {
      this.logger.info("Downloading catalogue metadata pack", { url });
      await downloadFile(url, target, undefined, 120);
      return await this.importPack(target);
    } finally {
      await rm(target, { force: true }).catch(() => undefined);
    }
  }

  async importPack(filePath: string): Promise<CatalogMetadataStatus> {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Metadata pack is not a file");
    const compressed = filePath.toLowerCase().endsWith(".gz");
    const input = createReadStream(filePath);
    const decompressed = compressed ? input.pipe(createGunzip()) : input;
    const reader = createInterface({ input: decompressed, crlfDelay: Infinity });
    let header: PackHeader | null = null;
    let batch: CatalogMetadataRecord[] = [];
    let count = 0;

    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO catalog_metadata (id, data) VALUES (?, ?)"
    );
    const writeBatch = (): void => {
      for (const record of batch) {
        if (!record?.id) continue;
        insert.run(record.id, JSON.stringify(record));
      }
      batch = [];
    };

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.exec("DELETE FROM catalog_metadata;");
      for await (const line of reader) {
        const text = line.trim();
        if (!text) continue;
        const parsed = JSON.parse(text) as unknown;
        if (!header && parsed && typeof parsed === "object" && "format" in parsed) {
          header = parsed as PackHeader;
          if (header.format !== "openbridge-catalog-metadata") {
            throw new Error("Unrecognised catalogue metadata pack");
          }
          continue;
        }
        const record = parsed as CatalogMetadataRecord;
        if (!record || typeof record.id !== "string" || !record.id) continue;
        batch.push(record);
        count += 1;
        if (batch.length >= BATCH_SIZE) writeBatch();
      }
      writeBatch();
      this.setMeta("generated_at", String(header?.generatedAt ?? Date.now()));
      this.setMeta("version", String(header?.version ?? 1));
      this.setMeta("imported_at", String(Date.now()));
      this.setMeta("source", filePath);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    } finally {
      reader.close();
      input.destroy();
    }

    const formattedCount = count.toLocaleString();
    this.logger.info("Catalogue metadata pack imported", {
      filePath,
      records: count
    });
    const status = this.status();
    this.logger.info(`Catalogue metadata ready for ${formattedCount} assets`, {
      version: status.version
    });
    return status;
  }

  remove(): CatalogMetadataStatus {
    this.db.exec("DELETE FROM catalog_metadata;");
    this.db.exec("DELETE FROM meta;");
    return this.status();
  }

  private getMeta(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }
}
