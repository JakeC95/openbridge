import type { AppSettings, SyncStatus } from "../shared/types";
import type { DownloadManager } from "./download-manager";
import type { LegacyApi } from "./legacy-api";
import type { LibraryService } from "./library";
import type { Logger } from "./logger";

export class SyncService {
  private status: SyncStatus = {
    running: false,
    lastSynced: null,
    acquired: 0,
    missing: 0
  };
  private timer: ReturnType<typeof setInterval> | undefined;
  private listeners = new Set<(status: SyncStatus) => void>();

  constructor(
    private readonly api: LegacyApi,
    private readonly downloads: DownloadManager,
    private readonly library: LibraryService,
    private readonly getSettings: () => AppSettings,
    private readonly logger: Logger,
    private readonly notify: (message: string, error?: boolean) => void
  ) {}

  current(): SyncStatus {
    return { ...this.status };
  }

  onStatus(callback: (status: SyncStatus) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  start(): void {
    this.stop();
    if (!this.getSettings().autoSyncEnabled) return;
    const minutes = Math.max(5, this.getSettings().syncIntervalMinutes);
    this.timer = setInterval(() => void this.run(), minutes * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  restart(): void {
    this.start();
  }

  async run(): Promise<SyncStatus> {
    if (this.status.running) return this.current();
    this.update({ ...this.status, running: true, message: "Checking acquired assets..." });

    try {
      const acquired = await this.api.acquired();
      const library = await this.library.scan(true);
      const local = new Set(library.assets.map(asset => asset.id));
      const missing = acquired.filter(id => !local.has(id));

      this.update({
        running: true,
        acquired: acquired.length,
        missing: missing.length,
        lastSynced: this.status.lastSynced,
        message: missing.length ? `${missing.length} acquired asset(s) not in the library` : "Library is up to date"
      });

      const finished: SyncStatus = {
        running: false,
        lastSynced: Date.now(),
        acquired: acquired.length,
        missing: missing.length,
        message: missing.length ? `${missing.length} missing` : "Up to date"
      };
      this.update(finished);
      this.logger.info("Sync complete", { ...finished });
      return finished;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: SyncStatus = {
        running: false,
        lastSynced: this.status.lastSynced,
        acquired: this.status.acquired,
        missing: this.status.missing,
        message
      };
      this.update(failed);
      this.logger.warn("Sync failed", { error });
      return failed;
    }
  }

  private update(status: SyncStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      try {
        listener({ ...status });
      } catch {
        // ignore
      }
    }
  }
}


