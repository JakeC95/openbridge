import { createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_MAP_TYPES, recommendedDownloadDefaults } from "../shared/download-defaults";
import type { AppSettings, AssetDefaultsKind } from "../shared/types";

const LEGACY_KEY = Buffer.from("REDACTED", "utf8");
const LEGACY_IV = Buffer.from("REDACTED", "utf8");

export interface LegacySettings {
  megascansPath?: string;
  offlineMegascansPath?: string;
  zipPaths?: string[];
  userEmail?: string;
}

/**
 * Reads the old Bridge settings.dat (base64 AES-256-CBC) if it exists. Only used
 * to migrate the user's own library path; nothing from it is ever uploaded.
 */
export function readLegacySettings(appDataDir: string): LegacySettings | null {
  const file = join(appDataDir, "Megascans Bridge", "settings.dat");
  if (!existsSync(file)) return null;

  try {
    const decipher = createDecipheriv("aes-256-cbc", LEGACY_KEY, LEGACY_IV);
    let text = decipher.update(readFileSync(file, "utf8"), "base64", "utf8");
    text += decipher.final("utf8");
    const end = text.lastIndexOf("}");
    if (end === -1) return null;
    return JSON.parse(text.slice(0, end + 1)) as LegacySettings;
  } catch {
    return null;
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export class SettingsStore {
  private data: AppSettings;

  constructor(
    private readonly filePath: string,
    defaults: AppSettings
  ) {
    this.data = { ...defaults, ...this.read() };
    this.migrate();
    this.normalise();
  }

  get(): AppSettings {
    return { ...this.data };
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...patch };
    this.normalise();
    this.save();
    return this.get();
  }

  private migrate(): void {
    const old = this.data as AppSettings & Record<string, unknown>;
    if (!old.downloadDefaults || typeof old.downloadDefaults !== "object") {
      const defaults = recommendedDownloadDefaults();
      const resolution = clampInt(old.defaultResolution, 1024, 8192, 8192);
      const textureFormat = old.defaultTextureFormat === "exr" ? "exr" : "jpg";
      const meshFormat = old.defaultMeshFormat === "abc" ? "abc" : "fbx";
      for (const kind of Object.keys(defaults) as AssetDefaultsKind[]) {
        defaults[kind] = { ...defaults[kind], resolution, textureFormat, meshFormat };
      }
      old.downloadDefaults = defaults;
    }
    delete old.offlineLibraryPath;
    delete old.downloadConcurrency;
    delete old.downloadTimeoutSec;
    delete old.autoDownloadAcquired;
    delete old.updateFeedUrl;
    delete old.defaultResolution;
    delete old.defaultTextureFormat;
    delete old.defaultMeshFormat;
  }

  private normalise(): void {
    this.data.libraryPath = String(this.data.libraryPath ?? "").trim();
    this.data.apiPort = clampInt(this.data.apiPort, 1024, 65535, 28241);
    this.data.discoveryPort = clampInt(this.data.discoveryPort, 1024, 65535, 28852);
    this.data.autoSyncEnabled = Boolean(this.data.autoSyncEnabled);
    this.data.syncIntervalMinutes = clampInt(this.data.syncIntervalMinutes, 5, 1440, 30);
    const presets = this.data.downloadDefaults ?? recommendedDownloadDefaults();
    const normalized = recommendedDownloadDefaults();
    for (const kind of Object.keys(normalized) as AssetDefaultsKind[]) {
      const preset = presets[kind] ?? normalized[kind];
      const selectedMaps = Array.isArray(preset.selectedMaps)
        ? preset.selectedMaps
        : DEFAULT_MAP_TYPES;
      normalized[kind] = {
        resolution: [1024, 2048, 4096, 8192].includes(preset.resolution) ? preset.resolution : 8192,
        textureFormat: preset.textureFormat === "exr" ? "exr" : "jpg",
        meshFormat: preset.meshFormat === "abc" ? "abc" : "fbx",
        selectedMaps: [
          ...new Set(
            selectedMaps
              .map(value => String(value).trim().toLowerCase())
              .filter(Boolean)
          )
        ],
        lods: Array.from({ length: 9 }, (_, index) => preset.lods?.[index] ?? true),
        highpoly: Boolean(preset.highpoly),
        ztool: Boolean(preset.ztool),
        brushes: Boolean(preset.brushes),
        uniqueMapsPerLod: preset.uniqueMapsPerLod ?? true,
        billboards: preset.billboards ?? true,
        downloadAllPlantLods: preset.downloadAllPlantLods ?? true
      };
    }
    this.data.downloadDefaults = normalized;
  }

  private read(): Partial<AppSettings> {
    try {
      if (!existsSync(this.filePath)) return {};
      const text = readFileSync(this.filePath, "utf8").replace(/^\uFEFF/, "");
      return JSON.parse(text) as Partial<AppSettings>;
    } catch {
      return {};
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }
}

