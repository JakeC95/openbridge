import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  canonicalMapType,
  commonMapTypesForKind,
  DEFAULT_MAP_TYPES,
  mapTypesForKind,
  recommendedDownloadDefaults
} from "../shared/download-defaults";
import type { AppSettings, AssetDefaultsKind } from "../shared/types";


function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export class SettingsStore {
  private data: AppSettings;
  private readonly provided: Set<string>;

  constructor(
    private readonly filePath: string,
    defaults: AppSettings
  ) {
    const raw = this.read();
    this.provided = new Set(Object.keys(raw));
    this.data = { ...defaults, ...raw };
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
    // Keep existing Megascans libraries where they are, and place Poliigon next to them.
    // New installs get both providers under the configured root.
    if (!this.provided.has("poliigonLibraryPath")) {
      const megascans = String(this.data.libraryPath ?? "").trim();
      if (megascans) {
        const parent = dirname(megascans);
        this.data.poliigonLibraryPath = join(parent, "Poliigon");
        if (!this.provided.has("libraryRoot")) this.data.libraryRoot = parent;
      }
    }
    if (!this.provided.has("polyhavenLibraryPath")) {
      const megascans = String(this.data.libraryPath ?? "").trim();
      if (megascans) {
        const parent = dirname(megascans);
        this.data.polyhavenLibraryPath = join(parent, "PolyHaven");
        if (!this.provided.has("libraryRoot")) this.data.libraryRoot = parent;
      }
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
    this.data.libraryRoot = String(this.data.libraryRoot ?? "").trim();
    if (!this.data.libraryRoot && this.data.libraryPath) {
      this.data.libraryRoot = dirname(this.data.libraryPath);
    }
    this.data.poliigonLibraryPath = String(this.data.poliigonLibraryPath ?? "").trim();
    if (!this.data.poliigonLibraryPath) {
      this.data.poliigonLibraryPath = this.data.libraryRoot
        ? join(this.data.libraryRoot, "Poliigon")
        : "";
    }
    this.data.polyhavenLibraryPath = String(this.data.polyhavenLibraryPath ?? "").trim();
    if (!this.data.polyhavenLibraryPath) {
      this.data.polyhavenLibraryPath = this.data.libraryRoot
        ? join(this.data.libraryRoot, "PolyHaven")
        : "";
    }
    this.data.poliigonConfirmPurchases = this.data.poliigonConfirmPurchases !== false;
    this.data.apiPort = clampInt(this.data.apiPort, 1024, 65535, 28241);
    this.data.discoveryPort = clampInt(this.data.discoveryPort, 1024, 65535, 28852);
    this.data.autoSyncEnabled = Boolean(this.data.autoSyncEnabled);
    this.data.syncIntervalMinutes = clampInt(this.data.syncIntervalMinutes, 5, 1440, 30);
    const presets = this.data.downloadDefaults ?? recommendedDownloadDefaults();
    const normalized = recommendedDownloadDefaults();
    for (const kind of Object.keys(normalized) as AssetDefaultsKind[]) {
      const preset = presets[kind] ?? normalized[kind];
      let selectedMaps = Array.isArray(preset.selectedMaps)
        ? preset.selectedMaps.map(value => canonicalMapType(String(value)))
        : [...commonMapTypesForKind(kind)];
      if (
        kind === "surface" &&
        selectedMaps.length === DEFAULT_MAP_TYPES.length &&
        DEFAULT_MAP_TYPES.every(type => selectedMaps.includes(type))
      ) {
        selectedMaps = [...commonMapTypesForKind(kind)];
      }
      const allowedMaps = new Set(mapTypesForKind(kind));
      normalized[kind] = {
        resolution: [1024, 2048, 4096, 8192].includes(preset.resolution) ? preset.resolution : 8192,
        textureFormat: preset.textureFormat === "exr" ? "exr" : "jpg",
        meshFormat: preset.meshFormat === "abc" ? "abc" : "fbx",
        selectedMaps: [
          ...new Set(selectedMaps.filter(type => allowedMaps.has(type)))
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

