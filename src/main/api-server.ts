import http from "node:http";
import type { AddressInfo } from "node:net";
import type { AppSettings, AssetRecord, ExportAsset, ScanResult } from "../shared/types";
import { buildExportAsset } from "./exporter";
import type { LibraryService } from "./library";
import type { Logger } from "./logger";

const POSSIBLE_REQUESTS = [
  "/GetMegascansFolder/",
  "/GetSelectedAssets/",
  "/GetSelectedAsset/",
  "/GetDownloadedAssets/",
  "/GetCustomAssets/",
  "/Reload/",
  "/log/",
  "/analytics/",
  "/error/"
];

export interface ApiServerOptions {
  getSettings: () => AppSettings;
  library: LibraryService;
  logger: Logger;
  exportPath: string;
  notify: (message: string, error?: boolean) => void;
  onReload: () => void;
}

export class LocalApiServer {
  private server: http.Server | null = null;
  private selection = new Set<string>();
  private port = 0;

  constructor(private readonly options: ApiServerOptions) {}

  get address(): number {
    return this.port;
  }

  setSelection(ids: string[]): void {
    this.selection = new Set(ids);
  }

  async start(): Promise<number> {
    await this.stop();
    const desired = this.options.getSettings().apiPort;

    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.handle(request, response);
      });
      server.on("error", error => {
        this.options.logger.error("Local API server error", { error, port: desired });
        reject(error);
      });
      server.listen(desired, "127.0.0.1", () => {
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        this.options.logger.info("Local API listening", { port: this.port });
        resolve(this.port);
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = request.url ?? "/";
    response.setHeader("Content-Type", "application/json; charset=utf-8");

    try {
      if (url.endsWith("/GetMegascansFolder/")) {
        return this.json(response, { folder: this.options.getSettings().libraryPath });
      }

      if (
        url.includes("/GetDownloadedAssets/") ||
        url.includes("/GetAllAssets/") ||
        url.includes("/Search/")
      ) {
        const query = this.lastSegment(url);
        const result = await this.options.library.scan();
        const records = query
          ? result.assets
              .filter(asset => asset.searchStr.includes(query.toLowerCase()))
              .slice(0, 10)
          : result.assets;
        return this.json(response, await this.toExports(records));
      }

      if (url.endsWith("/GetSelectedAssets/") || url.endsWith("/GetSelectedAsset/")) {
        const result = await this.options.library.scan();
        return this.json(
          response,
          await this.toExports(result.assets.filter(asset => this.selection.has(asset.id)))
        );
      }

      if (url.endsWith("/GetCustomAssets/")) {
        const result = await this.options.library.scan();
        return this.json(
          response,
          await this.toExports(result.assets.filter(asset => asset.repo === "custom"))
        );
      }

      if (url.endsWith("/Reload/")) {
        this.options.library.invalidate();
        this.options.onReload();
        return this.text(response, "Assets reloaded");
      }

      if (url.endsWith("/getLastExport/")) {
        return this.json(response, []);
      }

      if (url.endsWith("/clearLastExport/")) {
        return this.text(response, "");
      }

      if (url.startsWith("/log/")) {
        const body = await this.readBody(request);
        this.options.logger.info("Log request from plugin", { body });
        return this.text(response, request.method === "POST" ? "DONE LOGGING POST" : "DONE LOGGING STR");
      }

      if (url.startsWith("/analytics/")) {
        const body = await this.readBody(request);
        this.options.logger.info("Analytics request from plugin", { body });
        return this.text(response, "Analytics message sent");
      }

      if (url.startsWith("/error/")) {
        const body = await this.readBody(request);
        this.options.logger.error("Plugin reported an error", { body });
        this.options.notify(body || "A plugin reported an error", true);
        return this.text(response, "Reported Error");
      }

      return this.json(response, {
        possibleRequests: POSSIBLE_REQUESTS,
        youSent: url,
        status: "Error : Invalid request"
      });
    } catch (error) {
      this.options.logger.error("Local API request failed", { url, error });
      return this.json(response, { error: "Error: No Data" }, 500);
    }
  }

  private lastSegment(url: string): string {
    const clean = url.split("?")[0] ?? url;
    const parts = clean.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    if (["GetDownloadedAssets", "GetAllAssets", "Search"].includes(last)) return "";
    return decodeURIComponent(last);
  }

  private async toExports(records: AssetRecord[]): Promise<ExportAsset[]> {
    const output: ExportAsset[] = [];
    for (const record of records) {
      try {
        output.push(await buildExportAsset(record, this.options.exportPath));
      } catch (error) {
        this.options.logger.warn("Could not format asset for export", { id: record.id, error });
      }
    }
    return output;
  }

  private async readBody(request: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8").slice(0, 64 * 1024);
  }

  private json(response: http.ServerResponse, value: unknown, status = 200): void {
    response.statusCode = status;
    response.end(JSON.stringify(value));
  }

  private text(response: http.ServerResponse, value: string): void {
    response.end(value);
  }
}

export type { ScanResult };
