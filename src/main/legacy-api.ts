import { net } from "electron";
import type {
  CatalogHit,
  CatalogIdResult,
  CatalogQuery,
  CatalogResult,
  CategoryNode,
  ExtendedAsset,
  Profile
} from "../shared/types";
import type { AuthService } from "./auth";
import { apiUrl, legacyConfig, USER_AGENT } from "./legacy-config";
import type { Logger } from "./logger";

export interface FileDescriptor {
  uri: string;
  saveAs?: string;
  contentLength?: number;
  type?: string;
  [key: string]: unknown;
}

export interface DownloadResponse {
  json?: FileDescriptor | FileDescriptor[] | ExtendedAsset;
  previews?: FileDescriptor[];
  components?: FileDescriptor[];
  meshes?: FileDescriptor[];
  brushes?: FileDescriptor[];
  billboards?: FileDescriptor[];
  [key: string]: unknown;
}

interface AcquiredEntry {
  assetID?: string;
  id?: string;
  [key: string]: unknown;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    return text as unknown as T;
  }
}

export class LegacyApi {
  private signedMaps: { url: string; expiresAt: number } | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly logger: Logger
  ) {}

  async get<T>(path: string, retry = true): Promise<T> {
    return this.request<T>(path, { method: "GET" }, retry);
  }

  async post<T>(path: string, body: unknown = {}, retry = true): Promise<T> {
    return this.request<T>(
      path,
      { method: "POST", body: JSON.stringify(body) },
      retry
    );
  }

  async put<T>(path: string, body: unknown = {}, retry = true): Promise<T> {
    return this.request<T>(path, { method: "PUT", body: JSON.stringify(body) }, retry);
  }

  async del<T>(path: string, retry = true): Promise<T> {
    return this.request<T>(path, { method: "DELETE" }, retry);
  }

  async favorites(): Promise<string[]> {
    const result = await this.get<unknown>("v1/assets/favorites");
    const container = result as Record<string, unknown> | unknown[] | null;
    const list: unknown[] = Array.isArray(container)
      ? container
      : container && typeof container === "object"
        ? (["assets", "data", "favorites", "results", "items"]
            .map(key => (container as Record<string, unknown>)[key])
            .find(Array.isArray) as unknown[] | undefined) ?? []
        : [];
    const ids = list
      .map(entry => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const record = entry as AcquiredEntry;
          const id = record.assetID ?? record.id ?? record.assetId;
          return typeof id === "string" ? id : "";
        }
        return "";
      })
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return [...new Set(ids)];
  }

  async addFavorite(assetId: string): Promise<void> {
    await this.post(`v1/assets/favorites/${encodeURIComponent(assetId)}`);
  }

  async removeFavorite(assetId: string): Promise<void> {
    await this.del(`v1/assets/favorites/${encodeURIComponent(assetId)}`);
  }

  async profile(): Promise<Profile> {
    return this.get<Profile>("v1/users/self");
  }

  async acquired(): Promise<string[]> {
    const result = await this.get<unknown>("v1/assets/acquired");
    const container = result as Record<string, unknown> | unknown[] | null;
    const list: unknown[] = Array.isArray(container)
      ? container
      : container && typeof container === "object"
        ? (["assets", "data", "acquired", "results", "items"]
            .map(key => (container as Record<string, unknown>)[key])
            .find(Array.isArray) as unknown[] | undefined) ?? []
        : [];
    return list
      .map(entry => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") {
          const record = entry as AcquiredEntry;
          const id = record.assetID ?? record.id ?? record.assetId;
          return typeof id === "string" ? id : "";
        }
        return "";
      })
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  async extended(assetId: string): Promise<ExtendedAsset> {
    const result = await this.get<ExtendedAsset & { asset?: ExtendedAsset; data?: ExtendedAsset }>(
      `v1/assets/${encodeURIComponent(assetId)}/extended`
    );
    return result.asset ?? result.data ?? result;
  }

  async acquire(assetId: string): Promise<unknown> {
    return this.post("v1/acl", { assetID: assetId });
  }

  async requestDownload(payload: Record<string, unknown>): Promise<DownloadResponse> {
    return this.post<DownloadResponse>("v1/downloads", payload);
  }

  async syncCreated(date: string, limit: number, page: number): Promise<unknown> {
    const query = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (date) query.set("createdAt", date);
    return this.get(`v1/assets/created?${query.toString()}`);
  }

  async syncUpdated(date: string, limit: number, page: number): Promise<unknown> {
    const query = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (date) query.set("updatedAt", date);
    return this.get(`v1/assets/updated?${query.toString()}`);
  }

  async syncDeleted(date: string, limit: number, page: number): Promise<unknown> {
    const query = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (date) query.set("deletedAt", date);
    return this.get(`v1/assets/deleted?${query.toString()}`);
  }

  async signedMapsUrl(retry = true): Promise<string> {
    if (this.signedMaps && this.signedMaps.expiresAt > Date.now() + 60_000) {
      return this.signedMaps.url;
    }

    const token = await this.auth.getToken();
    const url = new URL("generateSignedUrl", legacyConfig.signedUrlBase).toString();
    const response = await net.fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT
      }
    });
    if (response.status === 401 && retry) {
      await this.auth.refresh();
      return this.signedMapsUrl(false);
    }
    const body = await readJson<{
      url?: string;
      expiresIn?: number;
      expiresAt?: string;
      message?: unknown;
    }>(response);
    if (!response.ok) {
      throw new Error(
        body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : `Signed URL HTTP ${response.status}`
      );
    }
    if (!body || typeof body.url !== "string") {
      throw new Error("Signed URL response did not include a URL");
    }
    const expiresAt =
      typeof body.expiresAt === "string" && Number.isFinite(Date.parse(body.expiresAt))
        ? Date.parse(body.expiresAt)
        : Date.now() + (body.expiresIn ?? 3_600_000);
    this.signedMaps = { url: body.url, expiresAt };
    return body.url;
  }

  async signedUrl(): Promise<{ url?: string; expiresIn?: number }> {
    return { url: await this.signedMapsUrl() };
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: string },
    retry: boolean
  ): Promise<T> {
    const token = await this.auth.getToken();
    const response = await net.fetch(apiUrl(path), {
      method: init.method,
      headers: {
        ...this.auth.headers(),
        Authorization: `Bearer ${token}`
      },
      body: init.body
    });

    if (response.status === 401 && retry) {
      this.logger.info("Legacy API returned 401; refreshing token");
      await this.auth.refresh();
      return this.request<T>(path, init, false);
    }

    const body = await readJson<T>(response);
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : `HTTP ${response.status} ${response.statusText}`;
      const error = new Error(message) as Error & { status?: number; body?: unknown };
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }
}

const CATEGORY_TOP_LEVEL_ORDER = [
  "3D asset",
  "3D plant",
  "surface",
  "decal",
  "atlas",
  "imperfection",
  "displacement",
  "brush"
];

const CATEGORY_TOP_LEVEL_LABELS: Record<string, string> = {
  "3D asset": "3D Assets",
  "3D plant": "3D Plants",
  surface: "Surfaces",
  decal: "Decals",
  atlas: "Atlases",
  imperfection: "Imperfections",
  displacement: "Displacements",
  brush: "Brushes"
};

function titleCase(key: string): string {
  return key
    .split(" ")
    .map(word =>
      word.toLowerCase() === "3d"
        ? "3D"
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

function categoryLabel(key: string, topLevel: boolean): string {
  if (topLevel) return CATEGORY_TOP_LEVEL_LABELS[key] ?? titleCase(key);
  return titleCase(key);
}

function sortCategoryChildren(nodes: CategoryNode[]): CategoryNode[] {
  return [...nodes].sort((a, b) => {
    const aOther = a.key === "other" || a.key === "misc";
    const bOther = b.key === "other" || b.key === "misc";
    if (aOther !== bOther) return aOther ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

function transformCategoryTree(
  node: unknown,
  path: string[],
  facets: Record<string, number>
): CategoryNode[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [];
  const out: CategoryNode[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key.startsWith("_") || !value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const nodePath = [...path, key];
    const facetCount = facets[nodePath.join(" | ")];
    const ownCount =
      typeof record._nbHits === "number"
        ? record._nbHits
        : typeof record._nbHits_all === "number"
          ? record._nbHits_all
          : 0;
    out.push({
      key,
      label: categoryLabel(key, path.length === 0),
      count: typeof facetCount === "number" ? facetCount : ownCount,
      children: sortCategoryChildren(
        transformCategoryTree(record, nodePath, facets)
      )
    });
  }
  if (path.length === 0) {
    out.sort((a, b) => {
      const ai = CATEGORY_TOP_LEVEL_ORDER.indexOf(a.key);
      const bi = CATEGORY_TOP_LEVEL_ORDER.indexOf(b.key);
      if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }
  return out;
}

async function fetchCategoryFacets(): Promise<Record<string, number>> {
  if (!legacyConfig.algoliaAppId || !legacyConfig.algoliaApiKey) return {};
  try {
    const params = new URLSearchParams({
      query: "",
      hitsPerPage: "0",
      facets: "assetCategories",
      maxValuesPerFacet: "1000"
    });
    const url = `https://${legacyConfig.algoliaAppId}-dsn.algolia.net/1/indexes/${encodeURIComponent(
      legacyConfig.algoliaIndex
    )}/query`;
    const response = await net.fetch(url, {
      method: "POST",
      headers: {
        "X-Algolia-API-Key": legacyConfig.algoliaApiKey,
        "X-Algolia-Application-Id": legacyConfig.algoliaAppId,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({ params: params.toString() })
    });
    if (!response.ok) return {};
    const body = await readJson<{
      facets?: { assetCategories?: Record<string, number> };
    }>(response);
    return body.facets?.assetCategories ?? {};
  } catch {
    return {};
  }
}

export async function fetchCategories(): Promise<CategoryNode[]> {
  try {
    const response = await net.fetch(apiUrl("v1/assets/categorytree/v3"), {
      method: "GET",
      headers: { "User-Agent": USER_AGENT }
    });
    if (response.ok) {
      const data = await readJson<Record<string, unknown>>(response);
      const tree =
        data && typeof data === "object" && "tree" in data
          ? (data.tree as unknown)
          : data;
      const facets = await fetchCategoryFacets();
      const parsed = transformCategoryTree(tree, [], facets);
      if (parsed.length) return parsed;
    }
  } catch {
    // fall through to the static type list
  }

  return CATEGORY_TOP_LEVEL_ORDER.map(key => ({
    key,
    label: CATEGORY_TOP_LEVEL_LABELS[key] ?? titleCase(key),
    count: 0,
    children: []
  }));
}

function buildAlgoliaParams(
  params: CatalogQuery,
  page: number,
  hitsPerPage: number,
  attributesToRetrieve?: string[]
): URLSearchParams {
  const query = new URLSearchParams({
    query: params.query ?? "",
    page: String(page),
    hitsPerPage: String(hitsPerPage)
  });
  if (attributesToRetrieve?.length) {
    query.set("attributesToRetrieve", attributesToRetrieve.join(","));
  } else {
    query.set("facets", params.facets?.length ? params.facets.join(",") : "*");
    query.set("maxValuesPerFacet", "100");
  }

  const filters: string[] = [];
  if (params.type) filters.push(`type:"${params.type.toLowerCase().replace(/"/g, "")}"`);
  if (params.category)
    filters.push(`category:"${params.category.toLowerCase().replace(/"/g, "")}"`);
  if (params.categoryPath && params.categoryPath.length) {
    filters.push(
      `assetCategories:"${params.categoryPath.join(" | ").replace(/"/g, "")}"`
    );
  }
  if (params.ids && params.ids.length) {
    filters.push(
      `(${params.ids.map(id => `objectID:${id.replace(/"/g, "")}`).join(" OR ")})`
    );
  }
  if (typeof params.points === "number") {
    filters.push(`points:${params.points}`);
  }
  if (filters.length) query.set("filters", filters.join(" AND "));
  const numericFilters: string[] = [];
  if (typeof params.minSize === "number") numericFilters.push(`minSize>=${params.minSize}`);
  if (typeof params.maxSize === "number") numericFilters.push(`maxSize<=${params.maxSize}`);
  if (numericFilters.length) query.set("numericFilters", JSON.stringify(numericFilters));
  if (params.facetFilters) {
    const facetFilters = Object.entries(params.facetFilters)
      .filter(([, values]) => values.length > 0)
      .map(([key, values]) =>
        values.map(value => `${key}:${value.replace(/"/g, "")}`)
      );
    if (facetFilters.length) {
      query.set("facetFilters", JSON.stringify(facetFilters));
    }
  }
  return query;
}

async function algoliaQuery<T>(query: URLSearchParams): Promise<T> {
  if (!legacyConfig.algoliaAppId || !legacyConfig.algoliaApiKey) {
    throw new Error(
      "No Algolia credentials configured. Set OPENBRIDGE_ALGOLIA_APP_ID and OPENBRIDGE_ALGOLIA_API_KEY."
    );
  }
  const url = `https://${legacyConfig.algoliaAppId}-dsn.algolia.net/1/indexes/${encodeURIComponent(
    legacyConfig.algoliaIndex
  )}/query`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await net.fetch(url, {
        method: "POST",
        headers: {
          "X-Algolia-API-Key": legacyConfig.algoliaApiKey,
          "X-Algolia-Application-Id": legacyConfig.algoliaAppId,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT
        },
        body: JSON.stringify({ params: query.toString() }),
        signal: controller.signal
      });
      const body = await readJson<unknown>(response);
      if (response.ok) return body as T;
      lastError = new Error(
        body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : `Algolia HTTP ${response.status}`
      );
      if (response.status !== 429 && response.status < 500) {
        (lastError as Error & { fatal?: boolean }).fatal = true;
        throw lastError;
      }
    } catch (error) {
      if (error && typeof error === "object" && (error as { fatal?: boolean }).fatal) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 2) throw lastError;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }

  throw lastError ?? new Error("Algolia search failed");
}

export async function searchCatalog(params: CatalogQuery): Promise<CatalogResult> {
  const hitsPerPage = params.hitsPerPage ?? 48;
  if (params.ids && params.ids.length === 0) {
    return {
      hits: [],
      nbHits: 0,
      page: 0,
      nbPages: 0,
      hitsPerPage
    };
  }

  const query = buildAlgoliaParams(params, params.page ?? 0, hitsPerPage);
  return algoliaQuery<CatalogResult>(query);
}

export async function searchCatalogIds(params: CatalogQuery): Promise<CatalogIdResult> {
  if (params.ids && params.ids.length === 0) {
    return { entries: [], nbHits: 0 };
  }

  const pageSize = 1000;
  const entries = new Map<string, { id: string; points?: number }>();
  let nbHits = 0;

  for (let page = 0; page < 100; page += 1) {
    const query = buildAlgoliaParams(params, page, pageSize, ["id", "points"]);
    const body = await algoliaQuery<{
      hits?: Array<{ id?: string; objectID?: string; points?: number }>;
      nbHits?: number;
    }>(query);
    nbHits = typeof body.nbHits === "number" ? body.nbHits : nbHits;
    const hits = body.hits ?? [];
    for (const hit of hits) {
      const id = typeof hit.id === "string" ? hit.id : hit.objectID;
      if (!id) continue;
      entries.set(id, {
        id,
        points: typeof hit.points === "number" ? hit.points : undefined
      });
    }
    if (hits.length < pageSize || entries.size >= nbHits) break;
  }

  return { entries: [...entries.values()], nbHits };
}

export function catalogThumb(hit: CatalogHit): string | null {
  const images = hit.previews?.images;
  return (
    images?.thumbJpg ??
    images?.thumb ??
    images?.thumbGridJpg ??
    images?.thumbRetinaJpg ??
    images?.preview ??
    images?.thumbRetina ??
    null
  );
}

export function catalogPreview(hit: CatalogHit): string | null {
  const images = hit.previews?.images;
  return images?.preview ?? images?.thumbJpg ?? images?.thumb ?? null;
}



