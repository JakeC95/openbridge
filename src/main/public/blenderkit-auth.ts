import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import type { BlenderKitAuthState } from "../../shared/public-providers";
import type { Logger } from "../logger";

export class BlenderKitAuthService {
  private key = "";
  private readonly listeners = new Set<(state: BlenderKitAuthState) => void>();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.load();
  }

  private load(): void {
    try {
      const buffer = readFileSync(this.filePath);
      if (safeStorage.isEncryptionAvailable()) {
        this.key = safeStorage.decryptString(buffer).trim();
      }
    } catch {
      this.key = "";
    }
  }

  private emit(): void {
    const state = this.state();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // ignore
      }
    }
  }

  state(): BlenderKitAuthState {
    return { hasKey: this.key.length > 0 };
  }

  apiKey(): string {
    return this.key;
  }

  onChanged(listener: (state: BlenderKitAuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setKey(value: string): BlenderKitAuthState {
    const key = value.trim();
    if (!key) return this.clear();
    try {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable; the API key was not saved.");
      const payload = safeStorage.encryptString(key);
      writeFileSync(this.filePath, payload);
      this.key = key;
      this.logger.info("BlenderKit API key saved");
    } catch (error) {
      this.logger.error("Could not save BlenderKit API key", { error });
      throw error;
    }
    this.emit();
    return this.state();
  }

  clear(): BlenderKitAuthState {
    try {
      unlinkSync(this.filePath);
    } catch {
      // already absent
    }
    this.key = "";
    this.emit();
    return this.state();
  }
}
