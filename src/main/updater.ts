import { app, net } from "electron";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import type { UpdateInfo } from "../shared/types";
import { downloadFile } from "./downloader";
import { releaseAssetUrl } from "./project";
import type { Logger } from "./logger";

const UPDATE_MANIFEST =
  process.env.OPENBRIDGE_UPDATE_MANIFEST?.trim() ||
  releaseAssetUrl(process.platform === "linux" ? `latest-linux-${process.arch}.json` : "latest.json");

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

function extractUpdateArchive(archive: string, destination: string): Promise<void> {
  const tar =
    process.platform === "win32"
      ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ["-xf", archive, "-C", destination], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    child.stderr?.on("data", chunk => {
      if (stderr.length < 4000) stderr += String(chunk);
    });
    child.on("error", error =>
      finish(new Error(`Could not run tar: ${error.message}`))
    );
    child.on("exit", code => {
      if (code === 0) finish();
      else
        finish(
          new Error(
            `Update extraction failed (tar exit ${code})${stderr ? `: ${stderr.trim()}` : ""}`
          )
        );
    });
  });
}

export class UpdateService {
  private installing = false;

  constructor(private readonly logger: Logger) {}

  async check(): Promise<UpdateInfo> {
    const current = app.getVersion();
    const checkedAt = Date.now();
    if (!UPDATE_MANIFEST) {
      return {
        current,
        available: false,
        checkedAt,
        error: "Update repository is not configured for this build"
      };
    }

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
      const latest = typeof data.version === "string" && /^\d+\.\d+\.\d+$/.test(data.version) ? data.version : "";
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
    if (!app.isPackaged) throw new Error("Update this source checkout with Git, then rebuild OpenBridge.");
    if (this.installing) throw new Error("An update is already being installed.");
    this.installing = true;
    try {
      // Use the release manifest, rather than trusting package details supplied by the renderer.
      const update = await this.check();
      if (update.error) throw new Error(update.error);
      if (!update.available || update.latest !== info.latest) {
        throw new Error("The requested update is no longer available.");
      }
      if (!update.url || !Number.isSafeInteger(update.size) || (update.size ?? 0) <= 0 || !/^[a-f0-9]{64}$/i.test(update.sha256 ?? "")) {
        throw new Error("The update manifest is missing package verification details.");
      }
      if (process.platform === "linux") await this.installLinux(update);
      else if (process.platform === "win32") await this.installWindows(update);
      else throw new Error("Portable updates are unavailable on this platform.");
      app.quit();
    } catch (error) {
      this.installing = false;
      throw error;
    }
  }

  private async downloadAndExtract(info: UpdateInfo, tempRoot: string): Promise<string> {
    const archive = join(tempRoot, "update.archive");
    this.logger.info("Downloading update", { version: info.latest, url: info.url });
    await downloadFile(info.url!, archive, undefined, 60);

    if ((await stat(archive)).size !== info.size) {
      throw new Error("Update size verification failed");
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (hash.digest("hex") !== info.sha256?.toLowerCase()) {
      throw new Error("Update checksum verification failed");
    }

    const extracted = join(tempRoot, "extracted");
    await mkdir(extracted, { recursive: true });
    await extractUpdateArchive(archive, extracted);
    await rm(archive);
    return extracted;
  }

  private async installLinux(info: UpdateInfo): Promise<void> {
    const targetRoot = dirname(app.getPath("exe"));
    const parent = dirname(targetRoot);
    const stage = await mkdtemp(join(parent, ".openbridge-update-"));
    try {
      const extracted = await this.downloadAndExtract(info, stage);
      const source = join(extracted, `OpenBridge-${info.latest}-linux-${process.arch}-portable`);
      await access(join(source, "OpenBridge"), constants.X_OK);
      await access(join(source, "resources", "app", "package.json"), constants.R_OK);
      const backup = join(stage, "previous");
      const script = [
        'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
        'mv -T -- "$2" "$4" || exit 1',
        'if ! mv -T -- "$3" "$2"; then mv -T -- "$4" "$2"; exit 1; fi',
        'cd "$2" || exit 1',
        'shift 4',
        'exec "./OpenBridge" "$@"'
      ].join("\n");
      await this.launchInstaller("/bin/sh", [
        "-c", script, "openbridge-update", String(process.pid), targetRoot, source, backup, ...process.argv.slice(1)
      ], parent);
      this.logger.info("Linux update installer started", { targetRoot, backup });
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async installWindows(info: UpdateInfo): Promise<void> {
    const tempRoot = await mkdtemp(join(app.getPath("temp"), "openbridge-update-"));
    const extracted = await this.downloadAndExtract(info, tempRoot);
    const exe = await findFile(extracted, "OpenBridge.exe");
    if (!exe) throw new Error("Update package did not contain OpenBridge.exe");
    this.logger.info("Update extracted", { exe });

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

    await this.launchInstaller(
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
      tempRoot
    );
    this.logger.info("Update installer started", { sourceRoot, targetRoot });
  }

  private async launchInstaller(command: string, args: string[], cwd: string): Promise<void> {
    const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  }
}
