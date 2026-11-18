import { createHash } from "node:crypto";
import { hdriTimeOfDay } from "../../shared/hdri-time";
import { poliigonSkyCondition } from "../../shared/sky-conditions";
import { publicHdriCategory } from "../../shared/public-categories";
import {
  ambientCgPanoramaUrl,
  PUBLIC_PROVIDER_LABELS,
  publicTypeLabel,
  type PublicAssetSummary,
  type PublicFile,
  type PublicPreview
} from "../../shared/public-providers";
import type { Logger } from "../logger";
import { dict, dimensionsText, numberValue, resolutionPixels, stringList, text, unique } from "./common";
import type { PublicProviderAdapter, PublicRefreshResult } from "./catalog";

const API = "https://ambientcg.com/api/v3/assets";
const CATEGORIES_API = "https://ambientcg.com/api/v3/categories";
const INCLUDE = [
  "title",
  "url",
  "type",
  "releaseDate",
  "shortDescription",
  "longDescription",
  "tags",
  "colors",
  "dimensions",
  "maps",
  "downloads",
  "previews",
  "thumbnails",
  "downloadStatistics",
  "technique",
  "relations",
  "collections"
].join(",");

interface CategoryRecord {
  id: string;
  title: string;
  type: string;
}

function headers(): Record<string, string> {
  return { Accept: "application/json", "User-Agent": "OpenBridge" };
}

async function fetchPage(offset: number): Promise<{ total: number; assets: unknown[] }> {
  const url = `${API}?limit=500&offset=${offset}&include=${encodeURIComponent(INCLUDE)}`;
  const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`ambientCG catalogue returned HTTP ${response.status}`);
  const payload = dict(await response.json());
  return {
    total: numberValue(payload.totalResults) ?? 0,
    assets: Array.isArray(payload.assets) ? payload.assets : []
  };
}

async function fetchCategories(): Promise<CategoryRecord[]> {
  try {
    const response = await fetch(CATEGORIES_API, { headers: headers(), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return [];
    const payload = await response.json();
    const values = Array.isArray(payload) ? payload : [];
    return values
      .map(item => {
        const record = dict(item);
        return {
          id: text(record.id),
          title: text(record.title),
          type: text(record.type)
        };
      })
      .filter(item => item.title.length > 0);
  } catch {
    return [];
  }
}

function categoryFor(assetType: string, id: string, name: string, tags: string[], categories: CategoryRecord[]): string {
  const lowerTags = new Set(tags.map(tag => tag.toLowerCase()));
  const matchingType = categories.filter(category => category.type === assetType);
  const matched = matchingType.filter(category => category.id && id.toLowerCase().startsWith(category.id.toLowerCase())).sort((a, b) => b.id.length - a.id.length)[0]?.title
    ?? matchingType.filter(category => category.title && lowerTags.has(category.title.toLowerCase())).sort((a, b) => b.title.length - a.title.length)[0]?.title;

  if (assetType === "hdri") {
    return publicHdriCategory(name, tags);
  }
  if (assetType === "hdri-element") return "HDRIs/Elements";
  if (assetType === "3d-model") return `3D Models/${matched ?? "General"}`;
  if (assetType === "material") return `Materials/${matched ?? "General"}`;
  if (assetType === "substance") return `Substances/${matched ?? "General"}`;
  if (assetType === "decal") return `Decals/${matched ?? "General"}`;
  if (assetType === "atlas") return `Atlases/${matched ?? "General"}`;
  if (assetType === "brush") return "Brushes";
  if (assetType === "terrain") return "Terrains";
  if (assetType === "plain-image") return `Photo Textures/${matched ?? "General"}`;
  return `Other/${publicTypeLabel("ambientcg", assetType)}`;
}

function mapLabel(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes("color") || lower.includes("albedo")) return "Color";
  if (lower.includes("normal")) return "Normal";
  if (lower.includes("rough")) return "Roughness";
  if (lower.includes("metal")) return "Metalness";
  if (lower.includes("ambient") || lower.includes("_ao")) return "Ambient Occlusion";
  if (lower.includes("disp") || lower.includes("height")) return "Displacement";
  if (lower.includes("opacity") || lower.includes("alpha")) return "Opacity";
  if (lower.includes("gloss")) return "Gloss";
  if (lower.includes("spec")) return "Specular";
  return "Preview";
}

function extractPreviewImages(previews: unknown[], thumbnails: Record<string, unknown>): PublicPreview[] {
  const images: PublicPreview[] = [];
  const seen = new Set<string>();
  for (const raw of previews) {
    const preview = dict(raw);
    const url = text(preview.url);
    const candidates = url.match(/https?:\/\/[^&\s"',#=]+\.(?:jpg|jpeg|png|webp|exr)(?:\?[^&\s"',]*)?/gi) ?? [];
    for (const imageUrl of candidates) {
      if (seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      const hdr = /\.exr$/i.test(new URL(imageUrl).pathname);
      if (!/\.(?:jpg|jpeg|png|webp|exr)$/i.test(new URL(imageUrl).pathname)) continue;
      images.push({
        type: hdr ? "hdr-source" : "map",
        label: hdr ? /_HQ\./i.test(imageUrl) ? "HDR panorama HQ" : "HDR panorama LQ" : mapLabel(imageUrl),
        url: imageUrl,
        map: hdr ? undefined : mapLabel(imageUrl).toLowerCase().replace(/\s+/g, "-")
      });
    }
  }
  const thumb =
    text(thumbnails["1024-PNG"]) ||
    text(thumbnails["1024-JPG-242424"]) ||
    text(thumbnails["512-PNG"]) ||
    text(thumbnails["512-JPG-242424"]);
  if (thumb && !seen.has(thumb)) {
    images.unshift({ type: "thumbnail", label: "Preview", url: thumb });
    seen.add(thumb);
  }
  return images;
}

function parseDownloads(value: unknown, type: string): { files: PublicFile[]; resolutions: string[]; formats: string[] } {
  const files: PublicFile[] = [];
  const resolutions = new Set<string>();
  const formats = new Set<string>();
  for (const raw of Array.isArray(value) ? value : []) {
    const download = dict(raw);
    const url = text(download.url);
    if (!url) continue;
    const attributes = text(download.attributes);
    const extension = text(download.extension) || "zip";
    const resolution = /^(\d+(?:\.\d+)?K)/i.exec(attributes)?.[1]?.toUpperCase() ?? null;
    const format = attributes.includes("-")
      ? attributes.split("-").slice(1).join("-").toUpperCase()
      : extension.toUpperCase();
    if (resolution) resolutions.add(resolution);
    if (format) formats.add(format.toLowerCase());
    files.push({
      role: type === "hdri" || type === "hdri-element" ? "hdri" : "package",
      name: `${attributes || "download"}.${extension}`,
      url,
      bytes: numberValue(download.size) ?? 0,
      resolution: resolution ?? undefined,
      format: format.toLowerCase(),
      downloadable: true
    });
  }
  return { files, resolutions: [...resolutions], formats: [...formats] };
}

function normalize(raw: unknown, categories: CategoryRecord[]): PublicAssetSummary | null {
  const asset = dict(raw);
  const id = text(asset.id);
  const name = text(asset.title);
  const type = text(asset.type);
  if (!id || !name || !type) return null;

  const tags = unique(stringList(asset.tags).map(tag => tag.toLowerCase()));
  const category = categoryFor(type, id, name, tags, categories);
  const dimensions = dict(asset.dimensions);
  const rawDimensions = ["width", "height", "depth"]
    .map(key => numberValue(dimensions[key]) ?? 0)
    .filter(value => value > 0);
  const dimensionsMm = rawDimensions.map(value => value * 10);
  const downloads = parseDownloads(asset.downloads, type);
  const thumbnails = dict(asset.thumbnails);
  const previews = extractPreviewImages(Array.isArray(asset.previews) ? asset.previews : [], thumbnails);
  const isHdri = type === "hdri" || type === "hdri-element";
  // ambientCG's thumbnail set is a sphere render. Its LQ panorama JPG sits next
  // to the EXR preview and is the real, lowest-resolution content preview.
  const thumbnail =
    (isHdri ? ambientCgPanoramaUrl(previews, "LQ") : null) ||
    text(thumbnails["1024-PNG"]) ||
    text(thumbnails["1024-JPG-242424"]) ||
    previews[0]?.url ||
    null;
  const releaseDate = text(asset.releaseDate);
  const publishedAt = releaseDate ? Date.parse(releaseDate) : null;
  const stats = dict(asset.downloadStatistics);
  const downloadStats = {
    total: numberValue(stats.total) ?? 0,
    lastMonth: numberValue(stats.lastMonth) ?? 0,
    lastWeek: numberValue(stats.lastWeek) ?? 0,
    lastDay: numberValue(stats.lastDay) ?? 0
  };
  const relationRecord = dict(asset.relations);
  const relations = {
    parents: stringList(relationRecord.parents),
    children: stringList(relationRecord.children),
    variations: stringList(relationRecord.variations),
    next: text(relationRecord.next),
    previous: text(relationRecord.previous)
  };
  const techniques = text(asset.technique);
  const longDescription = text(asset.longDescription);
  const collections = Array.isArray(asset.collections)
    ? asset.collections.map(item => (typeof item === "string" ? item : text(dict(item).title))).filter(Boolean)
    : [];
  const timeOfDay = type === "hdri" && !/Interiors|Studio/.test(category)
    ? hdriTimeOfDay({ name, tags, categories: [category] })
    : null;
  const weather = type === "hdri" && !/Interiors|Studio/.test(category)
    ? poliigonSkyCondition({ name, tags, categories: [category] })
    : null;
  const maxResolution = Math.max(
    0,
    ...downloads.resolutions.map(resolution => resolutionPixels(resolution) ?? 0)
  );

  return {
    id,
    provider: "ambientcg",
    name,
    type,
    typeLabel: publicTypeLabel("ambientcg", type),
    categories: [category],
    category,
    tags,
    description: text(asset.shortDescription) || text(asset.longDescription),
    authors: { "Lennart Demes": "Creator" },
    attributes: {
      technique: techniques,
      colors: stringList(asset.colors),
      maps: stringList(asset.maps),
      collections,
      relations,
      downloadStats,
      longDescription
    },
    maxResolution: maxResolution || null,
    resolutions: downloads.resolutions,
    dimensions: dimensionsText(dimensionsMm),
    dimensionsMm: dimensionsMm.length > 0 ? dimensionsMm : null,
    polycount: null,
    texelDensity: null,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
    downloadCount: downloadStats.total,
    thumbnail,
    previews,
    timeOfDay,
    weather,
    mapCodes: stringList(asset.maps),
    mapFormats: downloads.formats,
    modelFormats: type === "3d-model" || type === "terrain" ? downloads.formats : [],
    lodCount: 0,
    license: "CC0-1.0",
    free: true,
    websiteUrl: text(asset.url) || `https://ambientcg.com/a/${id}`,
    filesHash: createHash("sha256").update(JSON.stringify({ files: downloads.files, previews: previews.map(preview => preview.url), releaseDate })).digest("hex"),
    enriched: true,
    files: downloads.files
  };
}

export class AmbientCgAdapter implements PublicProviderAdapter {
  async fetch(logger: Logger): Promise<PublicRefreshResult> {
    const categories = await fetchCategories();
    const first = await fetchPage(0);
    const assets = [...first.assets];
    for (let offset = first.assets.length; offset < first.total; offset += 500) {
      const page = await fetchPage(offset);
      assets.push(...page.assets);
      logger.info(`${PUBLIC_PROVIDER_LABELS.ambientcg} catalogue page`, {
        loaded: assets.length,
        total: first.total
      });
      if (page.assets.length === 0) break;
    }
    const normalized = assets
      .map(asset => normalize(asset, categories))
      .filter((asset): asset is PublicAssetSummary => Boolean(asset));
    const uniqueAssets = [...new Map(normalized.map(asset => [asset.id, asset])).values()];
    if (uniqueAssets.length !== first.total) throw new Error(`ambientCG catalogue was incomplete (${uniqueAssets.length} of ${first.total}); the previous catalogue was preserved`);
    return { assets: uniqueAssets, published: first.total };
  }
}
