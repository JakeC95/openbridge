import { net } from "electron";

export class HttpError extends Error {
  constructor(public readonly status: number, label = "Server request", public readonly retryAfterMs = 0) {
    super(status === 429
      ? `${label} is rate-limited (HTTP 429). ${retryAfterMs > 0 ? `Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.` : "Please try again shortly."}`
      : `${label} failed (HTTP ${status})`);
    this.name = "HttpError";
  }
}

export function abortError(): Error { return new DOMException("Request cancelled", "AbortError"); }
export function isCancelled(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
export function isRetryable(error: unknown): boolean {
  if (isCancelled(error)) return false;
  const status = (error as { status?: number })?.status;
  if (typeof status === "number") return [408, 425, 429, 500, 502, 503, 504].includes(status);
  return error instanceof TypeError || (error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "ResponseFormatError" ||
      /net::ERR_|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|terminated|stalled|premature close/i.test(error.message)));
}

export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, Math.min(delay, 60 * 60 * 1000)) : 0;
}

export function retryDelay(attempt: number, minimum = 0): number {
  return Math.max(minimum, Math.round((250 * 2 ** attempt) * (0.5 + Math.random())));
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? abortError()); return; }
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

interface Waiter { priority: number; start(): void; cancel(): void }

class RequestPool {
  private active = 0;
  private queue: Waiter[] = [];
  async acquire(signal: AbortSignal, priority: number): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active >= 6) {
      if (this.queue.length >= 256) throw new Error("Too many queued server requests. Try again shortly.");
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          priority,
          start: () => { signal.removeEventListener("abort", waiter.cancel); resolve(); },
          cancel: () => { this.queue = this.queue.filter(item => item !== waiter); reject(signal.reason ?? abortError()); }
        };
        this.queue.push(waiter);
        this.queue.sort((a, b) => b.priority - a.priority);
        signal.addEventListener("abort", waiter.cancel, { once: true });
      });
    } else this.active++;
    if (signal.aborted) { this.release(); signal.throwIfAborted(); }
    let released = false;
    return () => { if (!released) { released = true; this.release(); } };
  }
  private release(): void {
    const next = this.queue.shift();
    if (next) next.start();
    else this.active--;
  }
}

export interface JsonRequestOptions {
  signal?: AbortSignal;
  safeToRetry?: boolean;
  timeoutMs?: number;
  totalTimeoutMs?: number;
  attempts?: number;
  priority?: number;
  label?: string;
  allowEmpty?: boolean;
  validate?(value: unknown): boolean;
}

// Chromium's net stack retains OS proxy/TLS settings, connection pooling and HTTP/2 support.
export class JsonTransport {
  private origins = new Map<string, { pool: RequestPool; blockedUntil: number }>();
  constructor(private readonly fetcher: typeof net.fetch = (...args) => net.fetch(...args)) {}

  async request<T>(url: string, init: RequestInit = {}, options: JsonRequestOptions = {}): Promise<T> {
    const deadline = AbortSignal.timeout(options.totalTimeoutMs ?? 45_000);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const safe = options.safeToRetry ?? (init.method ?? "GET").toUpperCase() === "GET";
    const attempts = safe ? Math.max(1, Math.min(options.attempts ?? 3, 4)) : 1;
    const origin = new URL(url).origin;
    let server = this.origins.get(origin);
    if (!server) { server = { pool: new RequestPool(), blockedUntil: 0 }; this.origins.set(origin, server); }
    const end = Date.now() + (options.totalTimeoutMs ?? 45_000);
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal.throwIfAborted();
      const cooldown = server.blockedUntil - Date.now();
      if (cooldown > 0) await delay(cooldown, signal);
      let release = await server.pool.acquire(signal, options.priority ?? 0);
      while (server.blockedUntil > Date.now()) {
        release(); await delay(server.blockedUntil - Date.now(), signal);
        release = await server.pool.acquire(signal, options.priority ?? 0);
      }
      try {
        // Include response-body reads in the timeout; receiving headers is not completion.
        const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)]);
        const response = await this.fetcher(url, { ...init, signal: attemptSignal });
        if (!response.ok) {
          const wait = retryAfter(response.headers.get("retry-after"));
          if ((response.status === 429 || response.status === 503) && wait > 0) server.blockedUntil = Math.max(server.blockedUntil, Date.now() + wait);
          await response.body?.cancel().catch(() => undefined);
          throw new HttpError(response.status, options.label, wait);
        }
        const text = await response.text();
        if (!text && (options.allowEmpty || response.status === 204 || response.status === 205)) return null as T;
        try {
          const value = JSON.parse(text) as T;
          if (options.validate && !options.validate(value)) throw new Error("Invalid response shape");
          return value;
        }
        catch {
          const error = new Error(`${options.label ?? "Server"} returned invalid JSON`);
          error.name = "ResponseFormatError";
          throw error;
        }
      } catch (error) {
        signal.throwIfAborted();
        if (!safe || attempt + 1 >= attempts || !isRetryable(error)) throw error;
        const wait = retryDelay(attempt, (error as HttpError).retryAfterMs ?? 0);
        if (wait >= end - Date.now()) throw error;
        // Release this slot before backing off so interactive requests can continue.
        release();
        await delay(wait, signal);
      } finally { release(); }
    }
    throw new Error("Server request failed");
  }
}

interface Flight<T> { controller: AbortController; promise: Promise<T>; users: number; settled: boolean }

// Bounded, clone-on-read caches: one caller cannot mutate another's result. Cancel only when the
// final subscriber leaves, so an abandoned drawer never cancels an active download's metadata.
export class RequestCache {
  private entries = new Map<string, { value: unknown; expiresAt: number }>();
  private flights = new Map<string, Flight<unknown>>();
  constructor(private readonly limit = 128) {}

  get<T>(key: string, ttlMs: number, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.entries.delete(key); this.entries.set(key, cached);
      return Promise.resolve(structuredClone(cached.value) as T);
    }
    this.entries.delete(key);
    let flight = this.flights.get(key) as Flight<T> | undefined;
    if (flight?.controller.signal.aborted) { this.flights.delete(key); flight = undefined; }
    if (!flight) {
      const current: Flight<T> = { controller: new AbortController(), promise: null!, users: 0, settled: false };
      current.promise = Promise.resolve().then(() => load(current.controller.signal)).then(value => {
        current.controller.signal.throwIfAborted();
        if (!current.controller.signal.aborted && this.flights.get(key) === current && ttlMs > 0) {
          this.entries.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlMs });
          if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
        }
        return value;
      }).finally(() => { current.settled = true; if (this.flights.get(key) === current) this.flights.delete(key); });
      this.flights.set(key, current as Flight<unknown>);
      flight = current;
    }
    const active = flight;
    active.users++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true; signal?.removeEventListener("abort", abort);
        if (--active.users === 0 && !active.settled) active.controller.abort(abortError());
        return true;
      };
      const abort = () => { if (finish()) reject(signal?.reason ?? abortError()); };
      signal?.addEventListener("abort", abort, { once: true });
      active.promise.then(value => { if (finish()) resolve(structuredClone(value)); }, error => { if (finish()) reject(error); });
    });
  }

  invalidate(prefix = ""): void {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
    for (const [key, flight] of this.flights) if (key.startsWith(prefix)) {
      this.flights.delete(key); flight.controller.abort(abortError());
    }
  }
}

export const jsonTransport = new JsonTransport();
