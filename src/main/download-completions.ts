import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DownloadCompletion } from "../shared/types";

/** Separate from the rebuildable asset index: rescanning or switching libraries must not erase history. */
export class DownloadCompletions {
  private db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS download_completions (
        id INTEGER PRIMARY KEY, asset_id TEXT NOT NULL, name TEXT NOT NULL,
        path TEXT NOT NULL, bytes INTEGER NOT NULL, completed_at INTEGER NOT NULL
      );`);
  }
  record(item: Omit<DownloadCompletion, "id">): void {
    this.db.prepare(`INSERT INTO download_completions (asset_id,name,path,bytes,completed_at) VALUES (?,?,?,?,?)`)
      .run(item.assetId, item.name, item.path, item.bytes, item.completedAt);
    // Bound local history without tying its lifetime to the transient queue.
    this.db.exec("DELETE FROM download_completions WHERE id NOT IN (SELECT id FROM download_completions ORDER BY id DESC LIMIT 5000)");
  }
  recent(): DownloadCompletion[] {
    return this.db.prepare(`SELECT id, asset_id AS assetId, name, path, bytes, completed_at AS completedAt
      FROM download_completions ORDER BY id DESC LIMIT 30`).all() as unknown as DownloadCompletion[];
  }
  close(): void { this.db.close(); }
}
