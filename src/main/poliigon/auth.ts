import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PoliigonAuthState } from "../../shared/types";
import type { Logger } from "../logger";
import { delay, isRetryable, retryAfter, retryDelay } from "../network";

const API_BASE = "https://apiv2.poliigon.com/api/v2";
const LOGIN_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 1_500;
const ACCOUNT_CACHE_MS = 60_000;

type Dict = Record<string, unknown>;

interface AuthRecord {
  token: string;
  userName: string;
  userId: number | null;
  savedAt: number;
}

export interface PoliigonApiResult {
  ok: boolean;
  status: number;
  body: Dict;
  error: string;
}

interface AccountSnapshot {
  userName: string;
  userId: number | null;
  planName: string;
  planPaused: boolean;
  isUnlimited: boolean;
  credits: number | null;
  onDemandCredits: number | null;
  ownedCount: number;
}

function dict(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function flattenResults(value: Dict): Dict {
  const results = value.results;
  if (!results || typeof results !== "object" || Array.isArray(results)) return value;
  const merged = { ...(results as Dict) };
  for (const [key, item] of Object.entries(value)) {
    if (key === "results") continue;
    if (!(key in merged)) merged[key] = item;
  }
  return merged;
}

function decodeJwt(token: string): Dict | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as Dict;
  } catch {
    return null;
  }
}

function tokenExpiry(token: string): number | null {
  const exp = decodeJwt(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : null;
}

function mapError(result: PoliigonApiResult): string {
  const message = text(result.body.message);
  const errorCode = text(result.body.error_code);
  if (result.status === 401) return "Not authorized";
  if (result.status === 403) return "Poliigon access was denied";
  if (result.status === 429) return "Poliigon unlimited fair-use limit reached. Try again later.";
  if (errorCode === "insufficient-credits") return "Not enough credits for this asset.";
  if (message) return message;
  if (result.status === 422) return "Poliigon rejected the request.";
  return result.error || `Poliigon request failed (HTTP ${result.status})`;
}

export class PoliigonAuthService {
  private record: AuthRecord | null = null;
  private account: AccountSnapshot | null = null;
  private accountAt = 0;
  private owned = new Set<number>();
  private ownedAt = 0;
  private readonly authFile: string;
  private readonly legacyFile: string;
  private readonly listeners = new Set<(state: PoliigonAuthState) => void>();
  private browserAbort: AbortController | null = null;
  private accountFlight: Promise<PoliigonAuthState | null> | null = null;
  private ownedFlight: Promise<number[]> | null = null;
  private generation = 0;

  constructor(
    private readonly logger: Logger,
    private readonly openExternal: (url: string) => void,
    private readonly notify: (message: string, error?: boolean) => void
  ) {
    const userData = app.getPath("userData");
    mkdirSync(userData, { recursive: true });
    this.authFile = join(userData, "poliigon-auth.bin");
    this.legacyFile = join(userData, "poliigon-auth.json");
  }

  async load(): Promise<PoliigonAuthState> {
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
          const expiry = tokenExpiry(parsed.token);
          if (expiry !== null && Date.now() > expiry) {
            this.clearPersisted();
          } else {
            this.record = parsed;
            this.logger.info("Loaded stored Poliigon session");
          }
        }
      }
    } catch (error) {
      this.logger.warn("Could not load stored Poliigon session", { error });
      this.record = null;
    }
    const state = this.state();
    this.emit(state);
    if (this.record) {
      void this.refreshAccount(true);
      void this.syncOwned();
    }
    return state;
  }

  state(): PoliigonAuthState {
    const token = this.record?.token ?? "";
    return {
      loggedIn: Boolean(this.record?.token),
      userName: this.account?.userName || this.record?.userName || "",
      userId: this.account?.userId ?? this.record?.userId ?? null,
      planName: this.account?.planName || "",
      planPaused: this.account?.planPaused ?? false,
      isUnlimited: this.account?.isUnlimited ?? false,
      credits: this.account?.credits ?? null,
      onDemandCredits: this.account?.onDemandCredits ?? null,
      ownedCount: this.account?.ownedCount ?? this.owned.size,
      expiresAt: token ? tokenExpiry(token) : null
    };
  }

  onChanged(callback: (state: PoliigonAuthState) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  ownedIds(): number[] {
    return [...this.owned];
  }

  ownedSyncedAt(): number | null {
    return this.ownedAt > 0 ? this.ownedAt : null;
  }

  async login(email: string, password: string): Promise<PoliigonAuthState> {
    if (!email.trim() || !password) throw new Error("Enter your Poliigon email and password");
    const result = await this.request("/login", {
      method: "POST",
      body: { email: email.trim(), password, platform: "addon-blender" },
      format: false
    });
    if (!result.ok) {
      const message = mapError(result);
      throw new Error(
        /do not match|incorrect|invalid/i.test(message)
          ? "The Poliigon email or password is incorrect."
          : message
      );
    }
    const token = text(result.body.access_token);
    if (!token) throw new Error("Poliigon login did not return an access token");
    const user = dict(result.body.user);
    await this.establishSession(token, text(user.name), numberValue(user.id));
    return this.state();
  }

  async loginWithBrowser(): Promise<PoliigonAuthState> {
    this.cancelBrowserLogin();
    const abort = new AbortController();
    this.browserAbort = abort;
    try {
      const initiated = await this.request(
        "/initiate/login",
        {
          method: "POST",
          body: {
            platform: "addon-blender",
            meta: {
              addon_version: app.getVersion(),
              software_version: "",
              software_name: "OpenBridge"
            }
          },
          format: false
        },
        abort.signal
      );
      if (!initiated.ok) throw new Error(mapError(initiated));
      const loginToken = text(initiated.body.login_token);
      const loginUrl = text(initiated.body.login_url);
      if (!loginToken || !loginUrl) {
        throw new Error("Poliigon did not return a browser sign-in link");
      }
      this.openExternal(loginUrl);
      this.notify("Complete the Poliigon sign-in in your browser");

      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await delay(POLL_INTERVAL_MS, abort.signal);
        const validated = await this.request(
          "/validate/login",
          {
            method: "POST",
            body: {
              platform: "addon-blender",
              login_token: loginToken,
              meta: {
                optin: false,
                addon_version: app.getVersion(),
                software_version: "",
                software_name: "OpenBridge"
              }
            },
            format: false
          },
          abort.signal
        );
        if (validated.ok) {
          const token = text(validated.body.access_token);
          if (token) {
            await this.establishSession(token, "", null);
            return this.state();
          }
          continue;
        }
        if (validated.status === 401 || validated.status === 404) continue;
        throw new Error(mapError(validated));
      }
      throw new Error("Poliigon sign-in timed out. Try again.");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Poliigon sign-in was cancelled");
      }
      throw error;
    } finally {
      if (this.browserAbort === abort) this.browserAbort = null;
    }
  }

  cancelBrowserLogin(): void {
    this.browserAbort?.abort();
    this.browserAbort = null;
  }

  async logout(): Promise<void> {
    const token = this.record?.token;
    this.clearSession();
    if (token) {
      try {
        await this.request("/logout", { method: "POST", body: {}, token });
      } catch {
        // Local sign-out is already complete.
      }
    }
    this.notify("Signed out of Poliigon");
  }

  async refreshAccount(force = false): Promise<PoliigonAuthState | null> {
    if (!this.record?.token) return null;
    if (!force && this.account && Date.now() - this.accountAt < ACCOUNT_CACHE_MS) {
      return this.state();
    }
    if (this.accountFlight) return this.accountFlight;
    const generation = this.generation;
    const work = (async () => {
      const result = await this.request("/me", { method: "POST", body: {} });
      if (generation !== this.generation) return null;
      if (result.status === 401) {
        if (this.record) this.expireSession();
        return null;
      }
      if (!result.ok) throw new Error(mapError(result));
      const user = dict(result.body.user);
      const credits = dict(result.body.credits);
      const assets = dict(result.body.assets);
      const subscription = dict(result.body.subscription);
      const ownedCount =
        numberValue(assets.purchases) ?? numberValue(result.body.asset_ids_count) ?? this.owned.size;
      this.account = {
        userName: text(user.name) || this.record?.userName || "",
        userId: numberValue(user.id) ?? this.record?.userId ?? null,
        planName: text(subscription.plan_name) || "No plan active",
        planPaused: Boolean(subscription.paused_info),
        isUnlimited: Boolean(subscription.unlimited),
        credits: numberValue(credits.available_balance),
        onDemandCredits: numberValue(credits.ondemand_balance),
        ownedCount
      };
      this.accountAt = Date.now();
      if (this.record) {
        this.record.userName = this.account.userName || this.record.userName;
        this.record.userId = this.account.userId ?? this.record.userId;
        this.persist();
      }
      this.emit(this.state());
      return this.state();
    })();
    this.accountFlight = work;
    try {
      return await work;
    } catch (error) {
      this.logger.warn("Could not load Poliigon account", { error });
      return null;
    } finally {
      if (this.accountFlight === work) this.accountFlight = null;
    }
  }

  async syncOwned(): Promise<number[]> {
    if (!this.record?.token) return [];
    if (this.ownedFlight) return this.ownedFlight;
    const generation = this.generation;
    const work = (async () => {
      const result = await this.request("/assets/list/ids", { method: "GET" });
      if (generation !== this.generation) return [...this.owned];
      if (result.status === 401) {
        if (this.record) this.expireSession();
        return [];
      }
      if (!result.ok) throw new Error(mapError(result));
      const list = Array.isArray(result.body.asset_ids) ? result.body.asset_ids : [];
      this.owned = new Set(
        list
          .map(numberValue)
          .filter((value): value is number => value !== null)
      );
      this.ownedAt = Date.now();
      if (this.account) this.account.ownedCount = this.owned.size;
      this.emit(this.state());
      return [...this.owned];
    })();
    this.ownedFlight = work;
    try {
      return await work;
    } catch (error) {
      this.logger.warn("Could not sync Poliigon owned assets", { error });
      return [...this.owned];
    } finally {
      if (this.ownedFlight === work) this.ownedFlight = null;
    }
  }

  async recentDownloads(): Promise<number[]> {
    if (!this.record?.token) return [];
    const generation = this.generation;
    const result = await this.request("/downloads/ids", { method: "GET" });
    if (generation !== this.generation) return [];
    if (result.status === 401) {
      if (this.record) this.expireSession();
      return [];
    }
    if (!result.ok) throw new Error(mapError(result));
    const list = Array.isArray(result.body.asset_ids) ? result.body.asset_ids : [];
    return list
      .map(numberValue)
      .filter((value): value is number => value !== null);
  }

  /** Authenticated API call for provider features such as download manifests. */
  apiRequest(
    path: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: unknown;
    } = {},
    signal?: AbortSignal
  ): Promise<PoliigonApiResult> {
    return this.request(path, options, signal);
  }

  private async establishSession(
    token: string,
    userName: string,
    userId: number | null
  ): Promise<void> {
    this.generation++;
    this.record = { token, userName, userId, savedAt: Date.now() };
    this.account = null;
    this.accountAt = 0;
    this.owned = new Set();
    this.ownedAt = 0;
    this.persist();
    this.emit(this.state());
    const state = await this.refreshAccount(true);
    void this.syncOwned();
    this.notify(`Signed in to Poliigon${state?.userName ? ` as ${state.userName}` : ""}`);
  }

  private async request(
    path: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: unknown;
      token?: string;
      format?: boolean;
    } = {},
    signal?: AbortSignal
  ): Promise<PoliigonApiResult> {
    const url = new URL(`${API_BASE}${path}`);
    if (options.format !== false) url.searchParams.set("format", "plain");
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const token = options.token ?? this.record?.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const timeout = AbortSignal.timeout(30_000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

      let response: Response;
      try {
        response = await fetch(url.toString(), {
          method: options.method ?? "GET",
          headers,
          body,
          signal: combined
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (attempt + 1 < attempts && isRetryable(error)) {
          const wait = retryDelay(attempt, 800);
          this.logger.warn("Could not reach Poliigon; retrying", { path, attempt: attempt + 1, wait });
          await delay(wait, signal);
          continue;
        }
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new Error(
          "Could not reach Poliigon. Check your connection and try again."
        );
      }

      const raw = await response.text();
      if (!response.ok && attempt + 1 < attempts && isRetryable({ status: response.status })) {
        const serverWait = retryAfter(response.headers.get("retry-after"));
        // A long server-imposed wait must not stall the UI; surface the rate
        // limit immediately and let the caller offer a retry.
        if (serverWait <= 5_000) {
          const wait = retryDelay(attempt, Math.max(400, serverWait));
          this.logger.warn("Poliigon request failed; retrying", {
            path,
            status: response.status,
            attempt: attempt + 1,
            wait
          });
          await delay(wait, signal);
          continue;
        }
      }
      let parsed: Dict = {};
      try {
        parsed = raw ? (JSON.parse(raw) as Dict) : {};
      } catch {
        parsed = {};
      }
      const flattened = flattenResults(parsed);
      return {
        ok: response.ok,
        status: response.status,
        body: flattened,
        error: text(flattened.message) || `Poliigon request failed (HTTP ${response.status})`
      };
    }
    throw new Error("Poliigon request failed after retries");
  }

  private expireSession(): void {
    this.logger.warn("Poliigon session expired");
    this.clearSession();
    this.notify("Your Poliigon session expired. Sign in again.", true);
  }

  private clearSession(): void {
    this.generation++;
    this.record = null;
    this.account = null;
    this.accountAt = 0;
    this.owned = new Set();
    this.ownedAt = 0;
    this.accountFlight = null;
    this.ownedFlight = null;
    this.cancelBrowserLogin();
    this.clearPersisted();
    this.emit(this.state());
  }

  private persist(): void {
    if (!this.record) return;
    const json = JSON.stringify(this.record);
    try {
      if (safeStorage.isEncryptionAvailable()) {
        writeFileSync(this.authFile, safeStorage.encryptString(json));
        if (existsSync(this.legacyFile)) rmSync(this.legacyFile);
      } else {
        writeFileSync(this.legacyFile, json, "utf8");
      }
    } catch (error) {
      this.logger.error("Could not persist Poliigon session", { error });
    }
  }

  private clearPersisted(): void {
    try {
      if (existsSync(this.authFile)) rmSync(this.authFile);
      if (existsSync(this.legacyFile)) rmSync(this.legacyFile);
    } catch {
      // ignore
    }
  }

  private emit(state: PoliigonAuthState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // ignore
      }
    }
  }
}
