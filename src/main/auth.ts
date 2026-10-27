import { app, BrowserWindow, safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AuthState, Profile } from "../shared/types";
import { legacyConfig, ssoUrl, apiUrl, USER_AGENT } from "./legacy-config";
import type { Logger } from "./logger";
import { jsonTransport } from "./network";

interface AuthRecord {
  token: string;
  refreshToken: string;
  email: string;
}

interface JwtPayload {
  email?: string;
  scope?: string;
  exp?: number;
  [key: string]: unknown;
}

function decodeJwt(token: string): JwtPayload | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const text = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    return JSON.parse(text) as JwtPayload;
  } catch {
    return null;
  }
}

function tokenExpiry(token: string): number | null {
  const exp = decodeJwt(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : null;
}

function isExpired(token: string, skewSeconds = 30): boolean {
  const exp = decodeJwt(token)?.exp;
  if (typeof exp !== "number") return false;
  return Date.now() / 1000 + skewSeconds >= exp;
}

function rolesFromToken(token: string): string[] {
  const scope = decodeJwt(token)?.scope;
  if (typeof scope !== "string") return [];
  return scope.split(/\s+/).filter(Boolean);
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 30000
): Promise<T> {
  return jsonTransport.request<T>(url, init, { timeoutMs, totalTimeoutMs: timeoutMs,
    label: "Account request", safeToRetry: (init.method ?? "GET") === "GET", allowEmpty: url.endsWith("/logout"), priority: 2 });
}

function pickToken(payload: unknown): AuthRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  const nested =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as Record<string, unknown>)
      : candidate;
  const token = nested.token ?? nested.accessToken ?? nested.access_token;
  const refreshToken = nested.refreshToken ?? nested.refresh_token ?? "";
  if (typeof token !== "string" || !token) return null;
  const payloadData = decodeJwt(token);
  return {
    token,
    refreshToken: typeof refreshToken === "string" ? refreshToken : "",
    email: typeof payloadData?.email === "string" ? payloadData.email : ""
  };
}

export class AuthService {
  private record: AuthRecord | null = null;
  private profileCache: Profile | null = null;
  private readonly authFile: string;
  private readonly legacyFile: string;
  private listeners = new Set<(state: AuthState) => void>();
  private generation = 0;
  private refreshFlight: Promise<string> | null = null;
  private profileFlight: Promise<Profile | null> | null = null;
  private profileAt = 0;

  sessionGeneration(): number { return this.generation; }

  constructor(
    private readonly logger: Logger,
    private readonly notify: (message: string, error?: boolean) => void
  ) {
    const userData = app.getPath("userData");
    mkdirSync(userData, { recursive: true });
    this.authFile = join(userData, "auth.bin");
    this.legacyFile = join(userData, "auth.json");
  }

  async load(): Promise<AuthState> {
    try {
      let json = "";
      if (existsSync(this.authFile) && safeStorage.isEncryptionAvailable()) {
        json = safeStorage.decryptString(readFileSync(this.authFile));
      } else if (existsSync(this.legacyFile)) {
        json = readFileSync(this.legacyFile, "utf8");
      }
      if (json) {
        const parsed = JSON.parse(json) as AuthRecord;
        if (parsed?.token) {
          this.record = parsed;
          this.generation++;
          this.logger.info("Loaded stored auth session", { email: parsed.email });
        }
      }
    } catch (error) {
      this.logger.warn("Could not load stored auth", { error });
      this.record = null;
    }
    const state = this.state();
    this.emit(state);
    return state;
  }

  state(): AuthState {
    const token = this.record?.token ?? "";
    return {
      loggedIn: Boolean(this.record?.token),
      email: this.record?.email || this.currentEmail(),
      roles: token ? rolesFromToken(token) : [],
      planId: this.profileCache?.subscription?.planId || "",
      expiresAt: token ? tokenExpiry(token) : null
    };
  }

  onChanged(callback: (state: AuthState) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getProfile(): Profile | null {
    return this.profileCache;
  }

  async ensureProfile(): Promise<Profile | null> {
    if (!this.record?.token) return null;
    if (this.profileCache && Date.now() - this.profileAt < 60_000) return this.profileCache;
    if (this.profileFlight) return this.profileFlight;
    const generation = this.generation;
    const work = (async () => {
      try {
        let token = await this.getToken();
        if (this.generation !== generation) return null;
        let raw: Profile;
        try { raw = await fetchJson<Profile>(apiUrl("v1/users/self"), { method: "GET", headers: this.headers({ Authorization: `Bearer ${token}` }) }); }
        catch (error) {
          if ((error as { status?: number }).status !== 401) throw error;
          token = await this.refresh(token);
          raw = await fetchJson<Profile>(apiUrl("v1/users/self"), { method: "GET", headers: this.headers({ Authorization: `Bearer ${token}` }) });
        }
        if (this.generation !== generation) return null;
        const profile = raw.profile ?? raw;
        this.profileCache = profile; this.profileAt = Date.now();
        return profile;
      } catch (error) {
        this.logger.warn("Could not load profile", { error });
        return null;
      }
    })();
    this.profileFlight = work;
    try { return await work; } finally { if (this.profileFlight === work) this.profileFlight = null; }
  }

  async login(parent: BrowserWindow | null): Promise<AuthState> {
    if (!legacyConfig.epicClientId) {
      throw new Error(
        "No Epic OAuth client ID configured. Set OPENBRIDGE_EPIC_CLIENT_ID or config.local.json."
      );
    }

    const generation = ++this.generation;
    const code = await this.openEpicWindow(parent);
    if (generation !== this.generation) throw new Error("Sign-in was cancelled because the session changed");
    this.logger.info("Epic OAuth code received");
    const payload = await fetchJson<unknown>(ssoUrl("login/epic"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({ code, realm: legacyConfig.realm })
    });
    const record = pickToken(payload);
    if (!record) throw new Error("Epic login did not return a token");
    if (generation !== this.generation) throw new Error("Sign-in was cancelled because the session changed");
    this.record = record;
    this.profileCache = null;
    this.profileFlight = null; this.refreshFlight = null; this.profileAt = 0;
    this.store();
    await this.ensureProfile();
    const state = this.state();
    this.emit(state);
    this.notify(`Signed in as ${state.email || "Epic user"}`);
    return state;
  }

  async logout(): Promise<void> {
    const token = this.record?.token;
    this.clearLocalSession();
    if (token) {
      try {
        await fetchJson(ssoUrl("logout"), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
          body: "{}"
        }, 10_000);
      } catch { /* best effort; local logout is already complete */ }
    }
  }

  private clearLocalSession(): void {
    this.record = null;
    this.generation++;
    this.refreshFlight = null; this.profileFlight = null; this.profileAt = 0;
    this.profileCache = null;
    this.emit(this.state());
    try {
      if (existsSync(this.authFile)) rmSync(this.authFile);
      if (existsSync(this.legacyFile)) rmSync(this.legacyFile);
    } catch {
      // ignore
    }
  }

  async getToken(): Promise<string> {
    if (!this.record) throw new Error("Not signed in");
    if (!isExpired(this.record.token)) return this.record.token;
    return this.refresh();
  }

  async refresh(rejectedToken?: string): Promise<string> {
    if (rejectedToken && this.record?.token && this.record.token !== rejectedToken) return this.getToken();
    if (this.refreshFlight) return this.refreshFlight;
    if (!this.record?.refreshToken) {
      throw new Error("Session expired. Please sign in again.");
    }
    const record = this.record;
    const generation = this.generation;
    const email = record.email || this.currentEmail();
    const work = (async () => {
      const payload = await fetchJson<unknown>(ssoUrl("login"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify({ email, token: record.token, refreshToken: record.refreshToken, realm: legacyConfig.realm })
      });
      const next = pickToken(payload);
      if (!next) throw new Error("Could not refresh the Epic session");
      if (this.generation !== generation || this.record !== record) throw new Error("Session changed while refreshing. Sign in again.");
      this.record = { ...next, email: next.email || email };
      this.store();
      this.emit(this.state());
      return this.record.token;
    })();
    this.refreshFlight = work;
    try { return await work; }
    catch (error) {
      if (this.generation === generation && this.record === record && [400, 401, 403].includes((error as { status: number }).status)) {
        this.clearLocalSession();
        throw new Error("Session expired. Please sign in again.");
      }
      throw error;
    } finally { if (this.refreshFlight === work) this.refreshFlight = null; }
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.record?.token ?? ""}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      ...extra
    };
  }

  private currentEmail(): string {
    if (!this.record?.token) return "";
    return decodeJwt(this.record.token)?.email ?? this.record.email;
  }

  private store(): void {
    if (!this.record) return;
    const json = JSON.stringify(this.record);
    try {
      if (safeStorage.isEncryptionAvailable()) {
        writeFileSync(this.authFile, safeStorage.encryptString(json));
        if (existsSync(this.legacyFile)) rmSync(this.legacyFile);
      } else {
        mkdirSync(dirname(this.legacyFile), { recursive: true });
        writeFileSync(this.legacyFile, json, "utf8");
      }
    } catch (error) {
      this.logger.error("Could not persist auth", { error });
    }
  }

  private emit(state: AuthState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // ignore
      }
    }
  }

  private openEpicWindow(parent: BrowserWindow | null): Promise<string> {
    return new Promise((resolve, reject) => {
      const loginUrl = `https://www.epicgames.com/id/login?client_id=${encodeURIComponent(
        legacyConfig.epicClientId
      )}&response_type=code`;
      const win = new BrowserWindow({
        width: 520,
        height: 720,
        parent: parent ?? undefined,
        modal: Boolean(parent),
        show: true,
        title: "Epic Games",
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      });
      win.removeMenu();

      let settled = false;
      const finish = (code: string | null, error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code) {
          resolve(code);
        } else {
          reject(error ?? new Error("Epic login was cancelled"));
        }
        if (!win.isDestroyed()) win.close();
      };

      const inspect = (target: string): void => {
        try {
          const url = new URL(target);
          const code = url.searchParams.get("code");
          if (code) {
            this.logger.info("Epic OAuth redirect captured", { host: url.host });
            finish(code);
            return;
          }
          const error = url.searchParams.get("error");
          if (error) finish(null, new Error(url.searchParams.get("error_description") ?? error));
        } catch {
          // ignore
        }
      };

      const timer = setTimeout(
        () => finish(null, new Error("Epic login timed out after 10 minutes")),
        10 * 60 * 1000
      );

      win.webContents.on("will-redirect", (_event, url) => inspect(url));
      win.webContents.on("will-navigate", (_event, url) => inspect(url));
      win.webContents.on("did-navigate", (_event, url) => inspect(url));
      win.on("closed", () => finish(null, new Error("Epic login window was closed")));
      win.loadURL(loginUrl).catch(error => finish(null, error as Error));
    });
  }
}
