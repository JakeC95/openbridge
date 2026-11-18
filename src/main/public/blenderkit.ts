import { randomUUID } from "node:crypto";
import type { CategoryNode } from "../../shared/types";
import {
  PUBLIC_PROVIDER_LABELS,
  publicTypeLabel,
  type PublicAssetDetail,
  type PublicAssetSummary,
  type PublicCatalogQuery,
  type PublicCatalogStatus,
  type PublicFacetBucket,
  type PublicFacets,
  type PublicFile,
  type PublicPreview,
  type PublicQueryResult
} from "../../shared/public-providers";
import { hdriTimeOfDay } from "../../shared/hdri-time";
import { poliigonSkyCondition } from "../../shared/sky-conditions";
import type { Logger } from "../logger";
import { dict, numberValue, resolutionKey, resolutionPixels, sortFacetBuckets, stringList, text, unique } from "./common";
import type { BlenderKitAuthService } from "./blenderkit-auth";

const API = "https://www.blenderkit.com/api/v1";
const PAGE_SIZE = 60;
const SEARCH_TYPES = ["model", "material", "hdr", "brush"] as const;
const CATEGORY_TYPES = new Set(["model", "material", "hdr", "brush"]);

interface CategoryMap {
  nodes: CategoryNode[];
  pathBySlug: Map<string, string[]>;
}

function headers(apiKey?: string): Record<string, string> {
  const values: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "OpenBridge"
  };
  if (apiKey) values.Authorization = `Bearer ${apiKey}`;
  return values;
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function categoryLabel(slug: string): string {
  if (slug === "model") return "Models";
  if (slug === "material") return "Materials";
  if (slug === "hdr") return "HDRIs";
  if (slug === "brush") return "Brushes";
  return titleCase(slug);
}

function buildCategories(payload: unknown): CategoryMap {
  const root = dict(payload);
  const values = Array.isArray(root.results) ? root.results : [];
  const pathBySlug = new Map<string, string[]>();
  const convert = (raw: unknown, parents: string[]): CategoryNode | null => {
    const node = dict(raw);
    const slug = text(node.slug);
    const name = text(node.name) || categoryLabel(slug);
    if (!slug) return null;
    const path = [...parents, name];
    pathBySlug.set(slug, path);
    const children = (Array.isArray(node.children) ? node.children : [])
      .map(child => convert(child, path))
      .filter((child): child is CategoryNode => Boolean(child))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return {
      key: slug,
      label: parents.length === 0 ? categoryLabel(slug) : name,
      count: Math.max(
        numberValue(node.assetCountCumulative) ?? 0,
        numberValue(node.assetCount) ?? 0,
        children.reduce((sum, child) => sum + child.count, 0)
      ),
      children
    };
  };
  const nodes = values
    .map(raw => convert(raw, []))
    .filter((node): node is CategoryNode => Boolean(node))
    .filter(node => CATEGORY_TYPES.has(node.key))
    .sort((a, b) => SEARCH_TYPES.indexOf(a.key as (typeof SEARCH_TYPES)[number]) - SEARCH_TYPES.indexOf(b.key as (typeof SEARCH_TYPES)[number]));
  return { nodes, pathBySlug };
}

function licenseLabel(value: string): string {
  if (value === "cc_zero") return "CC0-1.0";
  if (value === "royalty_free") return "Royalty Free";
  return titleCase(value || "Unknown");
}

function normalizeResult(value: unknown, categories: CategoryMap): PublicAssetSummary | null {
  const asset = dict(value);
  const id = text(asset.assetBaseId) || text(asset.id);
  const name = text(asset.displayName) || text(asset.name);
  const assetType = text(asset.assetType);
  if (!id || !name || !SEARCH_TYPES.includes(assetType as (typeof SEARCH_TYPES)[number])) return null;

  const categorySlug = text(asset.category);
  const categoryPath = categories.pathBySlug.get(categorySlug) ?? [titleCase(categorySlug || "General")];
  const category = categoryPath.join(" / ");
  const tags = unique([
    ...stringList(asset.tags),
    categorySlug,
    ...categoryPath
  ].filter(Boolean));
  const parameters = dict(asset.dictParameters);
  const files: PublicFile[] = [];
  const resolutions = new Set<string>();
  const modelFormats = new Set<string>();
  for (const rawFile of Array.isArray(asset.files) ? asset.files : []) {
    const file = dict(rawFile);
    const fileType = text(file.fileType);
    if (!fileType || fileType === "thumbnail") continue;
    const url = text(file.downloadUrl);
    if (!url) continue;
    const resolutionMatch = /^resolution_(.+)$/i.exec(fileType);
    const resolution = resolutionMatch ? resolutionMatch[1].replace(/_/g, ".").toUpperCase() : undefined;
    if (resolution) resolutions.add(resolution);
    const filename = text(file.filename);
    const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
    if (assetType === "model" && extension && ["blend", "glb", "gltf", "fbx", "obj", "usd"].includes(extension)) modelFormats.add(extension);
    files.push({
      role: "package",
      name: filename || `${id}_${fileType}`,
      url,
      bytes: numberValue(file.fileUploadSize) ?? 0,
      resolution,
      format: extension || fileType,
      fileType,
      downloadable: true
    });
  }
  const thumbnails = {
    large: (assetType === "hdr" ? text(asset.thumbnailLargeUrlNonsquared) : "") || text(asset.thumbnailLargeUrl) || text(asset.thumbnailMiddleUrl) || text(asset.thumbnailSmallUrl),
    xlarge: (assetType === "hdr" ? text(asset.thumbnailXlargeUrlNonsquared) : "") || text(asset.thumbnailXlargeUrl) || text(asset.thumbnailLargeUrl),
    small: text(asset.thumbnailSmallUrl)
  };
  const previews: PublicPreview[] = unique([thumbnails.xlarge, thumbnails.large, thumbnails.small].filter(Boolean))
    .map((url, index) => ({
      type: index === 0 ? "thumbnail" : "preview",
      label: index === 0 ? "Preview" : `Preview ${index + 1}`,
      url
    }));
  const dimensions = ["dimensionX", "dimensionY", "dimensionZ"]
    .map(key => numberValue(parameters[key]))
    .filter((value): value is number => value !== null && value > 0);
  const dimensionsMm = dimensions.map(value => value * 1000);
  const maxResolution =
    numberValue(parameters.textureResolutionMax) ??
    Math.max(0, ...[...resolutions].map(value => resolutionPixels(value) ?? 0)) ??
    null;
  const outdoor = assetType === "hdr" && !/indoor|studio/i.test(category);
  const timeOfDay = outdoor
    ? hdriTimeOfDay({ name, tags, categories: [category] })
    : null;
  const weather = outdoor
    ? poliigonSkyCondition({ name, tags, categories: [category] })
    : null;
  const created = text(asset.created);
  const publishedAt = created ? Date.parse(created) : null;
  const ratingsAverage = dict(asset.ratingsAverage);
  const ratingsCount = dict(asset.ratingsCount);
  const rating = numberValue(ratingsAverage.quality);
  const ratingCount = numberValue(ratingsCount.quality) ?? 0;
  const bookmarks = numberValue(ratingsCount.bookmarks) ?? 0;
  const verification = text(asset.verificationStatus);
  const versionNumber = numberValue(asset.versionNumber);
  const sourceApp = [text(asset.sourceAppName), text(asset.sourceAppVersion)].filter(Boolean).join(" ");
  const videoUrl = text(asset.videoLink);
  const formats = unique(files.map(file => file.format).filter((value): value is string => Boolean(value)));
  const author = dict(asset.author);
  const license = text(asset.license);

  return {
    id,
    provider: "blenderkit",
    name,
    type: assetType,
    typeLabel: publicTypeLabel("blenderkit", assetType),
    categories: [category],
    category,
    tags,
    description: text(asset.description),
    authors: {
      [text(author.fullName) || text(author.firstName) || "Unknown"]: "Creator"
    },
    attributes: {
      ...parameters,
      access: text(asset.accessLabel) || (asset.isFree ? "Free" : "Full"),
      canDownload: asset.canDownload === true,
      downloadError: text(asset.canDownloadError),
      license: licenseLabel(license),
      categorySlug,
      downloadBytes: numberValue(asset.filesSize),
      created,
      rating,
      ratingCount,
      bookmarks,
      verification,
      versionNumber,
      sourceApp,
      videoUrl
    },
    maxResolution: maxResolution && maxResolution > 0 ? maxResolution : null,
    resolutions: [...resolutions],
    dimensions: dimensions.length > 0
      ? `${dimensions.map(value => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, ""))).join(" x ")} m`
      : null,
    dimensionsMm: dimensionsMm.length > 0 ? dimensionsMm : null,
    polycount: numberValue(parameters.faceCount) ?? numberValue(parameters.faceCountRender),
    texelDensity: null,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
    downloadCount: bookmarks,
    thumbnail: thumbnails.large || null,
    previews,
    timeOfDay,
    weather,
    mapCodes: [],
    mapFormats: formats,
    modelFormats: [...modelFormats],
    lodCount: 0,
    license: licenseLabel(license),
    free: asset.isFree === true,
    websiteUrl: `https://www.blenderkit.com/asset-gallery-detail/${id}/`,
    filesHash: `${id}:${text(asset.lastBlendUpload) || created}`,
    enriched: true,
    files
  };
}

function queryParts(query: PublicCatalogQuery, type: string): string {
  const parts = [`asset_type:${type}`];
  const licenses = query.licenses?.map(license => license === "CC0-1.0" ? "cc_zero" : license === "Royalty Free" ? "royalty_free" : license.toLowerCase());
  if (licenses?.length) {
    parts.push(`license:${licenses.join(",")}`);
  }
  if (query.freeOnly) parts.push("is_free:true");
  for (const [field, token] of [["minResolution", "textureResolutionMax_gte"], ["maxResolution", "textureResolutionMax_lte"], ["minTris", "faceCount_gte"], ["maxTris", "faceCount_lte"], ["minBytes", "files_size_gte"], ["maxBytes", "files_size_lte"]] as const) {
    if (typeof query[field] === "number" && Number.isFinite(query[field])) parts.push(`${token}:${query[field]}`);
  }
  const categories = query.categoryPaths?.map(path => path.split("/").pop()?.trim()).filter(Boolean) ?? [];
  if (categories.length) parts.push(`category_subtree:${categories.join(",")}`);
  const term = (query.query ?? "").trim();
  if (term) parts.push(term);
  parts.push(`order:${query.sort === "newest" ? "-created" : query.sort === "oldest" ? "created" : "_score"}`);
  return parts.join(" ");
}

function facetBuckets(values: string[]): PublicFacetBucket[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

export class BlenderKitCatalog {
  private refreshing: Promise<PublicCatalogStatus> | null = null;
  private categoriesCache: CategoryMap = { nodes: [], pathBySlug: new Map() };
  private refreshedAt: number | null = null;
  private lastError = "";
  private readonly rawById = new Map<string, unknown>();
  private readonly summaryById = new Map<string, PublicAssetSummary>();
  private readonly listeners = new Set<(status: PublicCatalogStatus) => void>();
  private readonly pages = new Map<string, { expires: number; pending: Promise<Record<string, unknown>> }>();
  private readonly downloadSession = randomUUID();

  constructor(
    private readonly auth: BlenderKitAuthService,
    private readonly logger: Logger
  ) {}

  onStatus(listener: (status: PublicCatalogStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // ignore
      }
    }
  }

  status(): PublicCatalogStatus {
    if (this.refreshing) return { state: "refreshing", count: 0, refreshedAt: this.refreshedAt };
    if (this.lastError) return { state: "error", count: 0, refreshedAt: this.refreshedAt, error: this.lastError };
    return { state: "ready", count: 0, refreshedAt: this.refreshedAt };
  }

  async ensureReady(): Promise<void> {
    if (this.categoriesCache.nodes.length === 0) {
      await this.refresh();
    }
  }

  async refresh(): Promise<PublicCatalogStatus> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      this.lastError = "";
      this.emit();
      this.logger.info(`${PUBLIC_PROVIDER_LABELS.blenderkit} online provider ready`);
      try {
        const key = this.auth.apiKey();
        let response = await fetch(`${API}/categories/`, {
          headers: headers(key || undefined),
          signal: AbortSignal.timeout(60_000)
        });
        if (response.status === 401 && key) response = await fetch(`${API}/categories/`, { headers: headers(), signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`BlenderKit categories returned HTTP ${response.status}`);
        this.categoriesCache = buildCategories(await response.json());
        this.refreshedAt = Date.now();
        return this.status();
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.logger.error(`${PUBLIC_PROVIDER_LABELS.blenderkit} categories failed`, { error });
        return this.status();
      }
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
      this.emit();
    }
  }

  categories(): CategoryNode[] {
    return this.categoriesCache.nodes;
  }

  private async page(url: string): Promise<Record<string, unknown>> {
    const cached = this.pages.get(url);
    if (cached && cached.expires > Date.now()) return cached.pending;
    const pending = (async () => {
      const key = this.auth.apiKey();
      let response = await fetch(url, { headers: headers(key || undefined), signal: AbortSignal.timeout(60_000) });
      // A bad/expired key must not make public browsing unusable; fall back to anonymous results.
      if (response.status === 401 && key) response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`BlenderKit search returned HTTP ${response.status}`);
      return dict(await response.json());
    })();
    this.pages.set(url, { expires: Date.now() + 5 * 60_000, pending });
    if (this.pages.size > 64) this.pages.delete(this.pages.keys().next().value!);
    try { return await pending; } catch (error) { this.pages.delete(url); throw error; }
  }

  private async requestSearch(query: PublicCatalogQuery, type: string, limit: number, offset: number): Promise<{
    count: number;
    results: unknown[];
    hasMore: boolean;
  }> {
    const pageSize = offset === 0 && limit <= 3 ? Math.max(1, limit) : 100;
    const page = Math.floor(offset / pageSize) + 1;
    const url = `${API}/search/?query=${encodeURIComponent(queryParts(query, type))}&page_size=${pageSize}&page=${page}&dict_parameters=1`;
    const payload = await this.page(url);
    const allResults = Array.isArray(payload.results) ? payload.results : [];
    const start = offset % pageSize;
    let results = allResults.slice(start, start + limit);
    if (results.length < limit && payload.next) {
      const nextUrl = new URL(String(payload.next));
      if (nextUrl.origin !== new URL(API).origin) throw new Error("Unexpected BlenderKit pagination origin");
      const body = await this.page(nextUrl.href);
      results = [...results, ...(Array.isArray(body.results) ? body.results : []).slice(0, limit - results.length)];
    }
    return {
      count: numberValue(payload.count) ?? 0,
      results,
      hasMore: offset + results.length < (numberValue(payload.count) ?? 0)
    };
  }

  async search(query: PublicCatalogQuery): Promise<PublicQueryResult> {
    const started = performance.now();
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit || PAGE_SIZE)));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const emptyFacets: PublicFacets = { types: [], resolutions: [], mapTypes: [], categories: [], licenses: [], modelFormats: [], weather: [], free: 0 };
    if (query.ids?.length === 0 || query.types?.includes("__none__")) return { hits: [], total: 0, offset, limit, hasMore: false, tookMs: 0, facets: emptyFacets };
    if (query.ids) {
      const ids = unique(query.ids);
      if (ids.length > 2000) throw new Error("BlenderKit scoped browsing is limited to 2,000 IDs. Narrow the selection first.");
      const assets: PublicAssetDetail[] = [];
      for (let index = 0; index < ids.length; index += 6) assets.push(...await Promise.all(ids.slice(index, index + 6).map(id => this.extended(id))));
      const matches = assets.filter(hit => this.matches(hit, query));
      const numeric = (hit: PublicAssetSummary): number | null => query.sort === "resolution" ? hit.maxResolution : hit.publishedAt;
      matches.sort((a, b) => query.sort === "name" ? a.name.localeCompare(b.name) : query.sort === "name-desc" ? b.name.localeCompare(a.name) : query.sort === "oldest" ? (numeric(a) ?? Infinity) - (numeric(b) ?? Infinity) : query.sort === "newest" || query.sort === "resolution" ? (numeric(b) ?? -Infinity) - (numeric(a) ?? -Infinity) : 0);
      return { hits: matches.slice(offset, offset + limit), total: matches.length, offset, limit, hasMore: offset + limit < matches.length, tookMs: performance.now() - started, facets: emptyFacets };
    }
    if (query.weather?.length || query.timeWindows?.length || query.timeStart !== undefined || query.timeEnd !== undefined || query.minSize !== undefined || query.maxSize !== undefined || query.resolutions?.length || query.mapTypes?.length || query.modelFormats?.length) {
      throw new Error("BlenderKit does not publish reliable global facets for this filter. Use its supported native-resolution, polygon, licence and category filters instead.");
    }
    const requestedTypes = query.types?.filter(type => SEARCH_TYPES.includes(type as (typeof SEARCH_TYPES)[number]));
    if (query.types?.length && !requestedTypes?.length) return { hits: [], total: 0, offset, limit, hasMore: false, tookMs: 0, facets: emptyFacets };
    const types = requestedTypes && requestedTypes.length > 0
      ? unique(requestedTypes)
      : [...SEARCH_TYPES];
    // A global offset indexes concatenated type streams. Do not apply the same
    // offset to every stream: doing that skips most assets in a multi-type page.
    const countsOnly = await Promise.all(types.map(type => this.requestSearch(query, type, 1, 0)));
    const responses = countsOnly;
    let skipped = offset;
    let remaining = limit;
    const results: unknown[] = [];
    for (let index = 0; index < types.length && remaining > 0; index++) {
      const count = countsOnly[index].count;
      if (skipped >= count) { skipped -= count; continue; }
      const page = await this.requestSearch(query, types[index], Math.min(remaining, count - skipped), skipped);
      results.push(...page.results); remaining -= page.results.length; skipped = 0;
    }
    const hits: PublicAssetSummary[] = [];
    for (const raw of results) {
      const summary = normalizeResult(raw, this.categoriesCache);
      if (!summary) continue;
      this.rawById.set(summary.id, raw);
      this.summaryById.set(summary.id, summary);
      if (this.summaryById.size > 1000) { const oldest = this.summaryById.keys().next().value!; this.summaryById.delete(oldest); this.rawById.delete(oldest); }
      if (!hits.some(hit => hit.id === summary.id)) hits.push(summary);
    }
    const counts = new Map(types.map((type, index) => [type, responses[index]?.count ?? 0]));
    const licenses = facetBuckets(hits.map(hit => hit.license));
    const resolutions = facetBuckets(hits.flatMap(hit => hit.resolutions));
    const modelFormats = facetBuckets(hits.flatMap(hit => hit.modelFormats));
    const categories = facetBuckets(hits.map(hit => hit.category));
    const facets: PublicFacets = {
      types: types.map(type => ({
        value: type,
        count: counts.get(type) ?? 0
      })),
      resolutions: sortFacetBuckets(resolutions),
      mapTypes: [],
      categories,
      licenses,
      modelFormats,
      weather: [],
      free: hits.filter(hit => hit.free).length,
      sampleFacets: true
    };
    const total = responses.reduce((sum, response) => sum + response.count, 0);
    const hasMore = hits.length > 0 && offset + hits.length < total;
    return {
      hits,
      total,
      offset,
      limit,
      hasMore,
      tookMs: Math.round((performance.now() - started) * 100) / 100,
      facets
    };
  }

  async ids(query: PublicCatalogQuery): Promise<string[]> {
    const ids: string[] = [];
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
      const result = await this.search({ ...query, limit: 100, offset });
      for (const hit of result.hits) if (!ids.includes(hit.id)) ids.push(hit.id);
      if (!result.hasMore || result.hits.length === 0) return ids;
      offset += 100;
    }
    throw new Error("BlenderKit selection exceeds 2,000 assets. Narrow the search or select loaded assets instead.");
  }

  async extended(id: string): Promise<PublicAssetDetail> {
    let raw = this.rawById.get(id);
    let summary = this.summaryById.get(id);
    if (!raw || !summary) {
      const key = this.auth.apiKey();
      const url = `${API}/search/?query=${encodeURIComponent(`asset_base_id:${id}`)}&page_size=1&dict_parameters=1`;
      let response = await fetch(url, { headers: headers(key || undefined), signal: AbortSignal.timeout(60_000) });
      if (response.status === 401 && key) response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`BlenderKit asset returned HTTP ${response.status}`);
      const payload = dict(await response.json());
      const results = Array.isArray(payload.results) ? payload.results : [];
      raw = results[0];
      summary = normalizeResult(raw, this.categoriesCache) ?? undefined;
      if (!raw || !summary) throw new Error(`BlenderKit asset ${id} was not found`);
      if (summary.id !== id) throw new Error("BlenderKit returned a different asset than the requested ID");
      this.rawById.set(id, raw);
      this.summaryById.set(id, summary);
    }
    return { ...summary, raw: dict(raw) };
  }

  private matches(hit: PublicAssetSummary, query: PublicCatalogQuery): boolean {
    if (query.types?.length && !query.types.includes(hit.type) || query.freeOnly && !hit.free || query.licenses?.length && !query.licenses.includes(hit.license)) return false;
    const words = `${hit.id} ${hit.name} ${hit.description} ${hit.tags.join(" ")}`.toLowerCase();
    if ((query.query ?? "").trim().split(/\s+/).filter(Boolean).some(term => !words.includes(term.toLowerCase()))) return false;
    if (query.categoryPaths?.length) {
      const slug = text(hit.attributes.categorySlug), path = this.categoriesCache.pathBySlug.get(slug) ?? [];
      if (!query.categoryPaths.some(value => value === slug || (() => { const parent = this.categoriesCache.pathBySlug.get(value); return parent && parent.every((part, index) => path[index] === part); })())) return false;
    }
    if (query.tags?.length && !query.tags.some(tag => hit.tags.some(value => value.toLowerCase() === tag.toLowerCase()))) return false;
    if (query.weather?.length && (!hit.weather || !query.weather.includes(hit.weather))) return false;
    if (query.resolutions?.length && !query.resolutions.some(value => hit.resolutions.includes(value))) return false;
    if (query.modelFormats?.length && !query.modelFormats.every(value => hit.modelFormats.includes(value))) return false;
    if (query.mapTypes?.length && !query.mapTypes.every(value => hit.mapCodes.includes(value))) return false;
    const size = hit.dimensionsMm?.length ? Math.max(...hit.dimensionsMm) / 1000 : null;
    for (const [min, max, value] of [[query.minSize, query.maxSize, size], [query.minResolution, query.maxResolution, hit.maxResolution], [query.minTris, query.maxTris, hit.polycount], [query.minBytes, query.maxBytes, numberValue(hit.attributes.downloadBytes)]] as const) {
      if (min !== undefined && (value === null || value < min) || max !== undefined && (value === null || value > max)) return false;
    }
    const inWindow = (start: number, end: number): boolean => hit.timeOfDay !== null && (start <= end ? hit.timeOfDay >= start && hit.timeOfDay <= end : hit.timeOfDay >= start || hit.timeOfDay <= end);
    if (query.timeStart !== undefined && query.timeEnd !== undefined && !inWindow(query.timeStart, query.timeEnd)) return false;
    if (query.timeWindows?.length && !query.timeWindows.some(window => inWindow(window.start, window.end))) return false;
    return true;
  }

  async testKey(): Promise<{ ok: boolean; userName?: string; plan?: string; error?: string }> {
    const key = this.auth.apiKey();
    if (!key) return { ok: false, error: "No BlenderKit API key is saved." };
    try {
      const response = await fetch(`${API}/me`, { headers: headers(key), signal: AbortSignal.timeout(20_000) });
      if (response.status === 401) return { ok: false, error: "BlenderKit rejected this API key." };
      if (!response.ok) return { ok: false, error: `BlenderKit key check returned HTTP ${response.status}.` };
      const profile = dict(await response.json());
      const user = dict(profile.user);
      const plan = dict(profile.plan);
      return {
        ok: true,
        userName: text(user.firstName) || text(profile.firstName) || text(profile.userName) || text(user.username) || "Validated account",
        plan: text(plan.name) || text(profile.planName) || text(profile.planType) || undefined
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async resolveDownload(fileUrl: string): Promise<string> {
    const source = new URL(fileUrl);
    if (source.protocol !== "https:" || source.hostname !== "www.blenderkit.com" || !source.pathname.startsWith("/api/v1/downloads/")) throw new Error("Invalid BlenderKit download endpoint");
    const key = this.auth.apiKey();
    if (!key) throw new Error("Add a BlenderKit API key in Settings to download this asset.");
    source.searchParams.set("scene_uuid", this.downloadSession);
    const response = await fetch(source.href, {
      headers: headers(key),
      redirect: "manual",
      signal: AbortSignal.timeout(60_000)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) return this.reachableDownload([new URL(location, fileUrl).toString()]);
    }
    if (response.status === 401) {
      throw new Error("BlenderKit rejected the API key. Check it in Settings.");
    }
    if (response.status === 403) throw new Error("BlenderKit denied access. Check the API key, asset availability and your plan entitlement.");
    if (!response.ok) throw new Error(`BlenderKit download resolver returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = dict(await response.json());
      const candidates: unknown[] = [
        payload.filePaths,
        payload.url,
        payload.downloadUrl,
        payload.download_url,
        payload.filePath,
        payload.file_path,
        payload.filePaths,
        payload.file_paths
      ];
      const urls: string[] = [];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.length > 0) urls.push(candidate);
        if (Array.isArray(candidate)) {
          for (const item of candidate) {
            if (typeof item === "string" && item.length > 0) urls.push(item);
            const url = text(dict(item).url);
            if (url) urls.push(url);
          }
        }
      }
      return this.reachableDownload(urls);
    }
    if (response.url && response.url !== source.href) return this.reachableDownload([response.url]);
    throw new Error("BlenderKit did not return a downloadable file URL.");
  }

  private async reachableDownload(candidates: string[]): Promise<string> {
    const urls = unique(candidates).filter(candidate => {
      try { const url = new URL(candidate); return url.protocol === "https:" && !url.username && !url.password && !url.pathname.startsWith("/api/v1/"); }
      catch { return false; }
    }).slice(0, 4);
    if (!urls.length) throw new Error("BlenderKit returned no valid HTTPS download sources");
    for (const url of urls) {
      for (const method of ["HEAD", "GET"]) {
        try {
          // Resolver credentials never travel to storage/CDN hosts. A range GET is
          // used only when HEAD is rejected; its body is cancelled immediately.
          const response = await fetch(url, { method, headers: method === "GET" ? { Range: "bytes=0-0" } : {}, signal: AbortSignal.timeout(5000) });
          await response.body?.cancel();
          if (response.status === 200 || response.status === 206) return url;
          if (response.status === 429) throw new Error("BlenderKit download storage is rate limited. Retry later.");
          if (method === "HEAD" && [403, 405, 501].includes(response.status)) continue;
          break;
        } catch (error) {
          if (error instanceof Error && /rate limited/.test(error.message)) throw error;
          break;
        }
      }
    }
    throw new Error("None of the BlenderKit download sources are currently reachable. Retry to refresh the delivery URLs.");
  }

  clearSearchCache(): void {
    this.pages.clear();
    this.rawById.clear();
    this.summaryById.clear();
  }

  close(): void {
    this.listeners.clear();
    this.clearSearchCache();
  }
}
