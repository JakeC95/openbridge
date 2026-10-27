import { app, net } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import type { UpdateInfo } from "../shared/types";
import { downloadFile, extractZip } from "./downloader";
import type { Logger } from "./logger";

const UPDATE_MANIFEST =
  "https://github.com/example-owner/openbridge/releases/latest/download/latest.json";

function versionParts(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map(part => Number.parseInt(part, 10))
    .map(value => (Number.isFinite(value) ? value : 0));
}

function isNewer(candidate: string, current: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(current);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}

async function findFile(root: string, name: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return target;
    if (entry.isDirectory()) {
      const nested = await findFile(target, name);
      if (nested) return nested;
    }
  }
  return null;
}

export class UpdateService {
  constructor(private readonly logger: Logger) {}

  async check(): Promise<UpdateInfo> {
    const current = app.getVersion();
    const checkedAt = Date.now();

    try {
      const response = await net.fetch(UPDATE_MANIFEST, {
        method: "GET",
        headers: { "User-Agent": `OpenBridge/${current}` }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from update manifest`);
      const data = (await response.json()) as {
        version?: string;
        url?: string;
        sha256?: string;
        size?: number;
        notes?: string;
        releaseNotes?: string;
      };
      const latest = data.version ?? "";
      const info: UpdateInfo = {
        current,
        latest,
        available: Boolean(latest) && isNewer(latest, current),
        url: data.url,
        sha256: data.sha256,
        size: typeof data.size === "number" ? data.size : undefined,
        notes: data.notes ?? data.releaseNotes,
        checkedAt
      };
      this.logger.info("Update check complete", { ...info });
      return info;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("Update check failed", { error });
      return { current, available: false, checkedAt, error: message };
    }
  }

  async install(info: UpdateInfo): Promise<void> {
    if (process.platform !== "win32") {
      throw new Error("Automatic updates are currently supported on Windows only");
    }
    if (!info.url) throw new Error("This update has no download URL");

    const tempRoot = join(app.getPath("temp"), "openbridge-update");
    const zipPath = join(tempRoot, "update.zip");
    await rm(tempRoot, { recursive: true, force: true });
    await mkdir(tempRoot, { recursive: true });
    this.logger.info("Downloading update", { version: info.latest, url: info.url });
    await downloadFile(info.url, zipPath, undefined, 60);

    const file = await readFile(zipPath);
    if (info.size && file.byteLength !== info.size) {
      throw new Error("Update size verification failed");
    }
    if (info.sha256) {
      const hash = createHash("sha256").update(file).digest("hex");
      if (hash.toLowerCase() !== info.sha256.toLowerCase()) {
        throw new Error("Update checksum verification failed");
      }
    }

    const extracted = join(tempRoot, "extracted");
    await mkdir(extracted, { recursive: true });
    await extractZip(zipPath, extracted);
    const exe = await findFile(extracted, "OpenBridge.exe");
    if (!exe) throw new Error("Update package did not contain OpenBridge.exe");

    const sourceRoot = dirname(exe);
    const targetRoot = dirname(app.getPath("exe"));
    const scriptPath = join(tempRoot, "install-update.ps1");
    const script = [
      "param([int]$ParentId, [string]$Source, [string]$Target)",
      "Wait-Process -Id $ParentId -ErrorAction SilentlyContinue",
      "Start-Sleep -Milliseconds 800",
      "robocopy $Source $Target /E /R:3 /W:2 /NFL /NDL /NJH /NJS | Out-Null",
      "$exe = Join-Path $Target \"OpenBridge.exe\"",
      "Start-Process -FilePath $exe -WorkingDirectory $Target"
    ].join("\r\n");
    await writeFile(scriptPath, script, "utf8");

    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        scriptPath,
        String(process.pid),
        sourceRoot,
        targetRoot
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
    this.logger.info("Update installer started", { sourceRoot, targetRoot });
    app.quit();
  }
}
