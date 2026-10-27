import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createGzip } from "node:zlib";
import { catalogMetadataRecord } from "../shared/asset-metadata";
import { searchCatalogIds } from "./legacy-api";
import type { LegacyApi } from "./legacy-api";
import type { Logger } from "./logger";

interface BuildOptions {
  limit?: number;
  concurrency?: number;
}

export class CatalogPackBuilder {
  constructor(
    private readonly api: LegacyApi,
    private readonly logger: Logger
  ) {}

  async build(outputPath: string, options: BuildOptions = {}): Promise<number> {
    await mkdir(dirname(outputPath), { recursive: true });
    const started = Date.now();
    const idResult = await searchCatalogIds({ query: "", page: 0 });
    const ids = idResult.entries
      .map(entry => entry.id)
      .filter(Boolean)
      .slice(0, options.limit ?? idResult.entries.length);
    if (ids.length === 0) throw new Error("No catalogue ids available");

    const output = createWriteStream(outputPath);
    const gzip = createGzip({ level: 9 });
    gzip.pipe(output);
    const write = (line: string): Promise<void> =>
      new Promise((resolve, reject) => {
        gzip.write(`${line}\n`, error => (error ? reject(error) : resolve()));
      });

    await write(
      JSON.stringify({
        format: "openbridge-catalog-metadata",
        version: 1,
        generatedAt: Date.now(),
        count: ids.length
      })
    );

    let next = 0;
    let completed = 0;
    let failed = 0;
    const concurrency = Math.max(1, options.concurrency ?? 8);
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next;
        next += 1;
        const id = ids[index];
        if (!id) return;
        try {
          let asset: Awaited<ReturnType<LegacyApi["extended"]>> | null = null;
          let lastError: unknown = null;
          for (let attempt = 0; attempt < 4; attempt += 1) {
            try {
              asset = await this.api.extended(id);
              break;
            } catch (error) {
              lastError = error;
              const status = (error as { status?: number }).status;
              if (status && status !== 429 && status < 500) throw error;
              await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
            }
          }
          if (!asset) throw lastError;
          const record = catalogMetadataRecord(asset);
          await write(JSON.stringify(record));
        } catch (error) {
          failed += 1;
          this.logger.warn("Catalogue metadata fetch failed", { id, error });
        }
        completed += 1;
        if (completed % 100 === 0 || completed === ids.length) {
          this.logger.info("Catalogue metadata progress", {
            completed,
            total: ids.length,
            failed
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, ids.length) }, () => worker())
    );
    await new Promise<void>((resolve, reject) => {
      gzip.end(() => resolve());
      gzip.once("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      output.once("finish", resolve);
      output.once("error", reject);
    });

    this.logger.info("Catalogue metadata pack built", {
      outputPath,
      records: completed - failed,
      failed,
      milliseconds: Date.now() - started
    });
    return completed - failed;
  }
}
