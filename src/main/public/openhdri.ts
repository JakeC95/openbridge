import { poliigonSkyCondition } from "../../shared/sky-conditions";
import { publicHdriCategory } from "../../shared/public-categories";
import {
  OPENHDRI_PREVIEW_WIDTH,
  openHdriImageUrl,
  PUBLIC_PROVIDER_LABELS,
  type PublicAssetSummary,
  type PublicPreview
} from "../../shared/public-providers";
import type { Logger } from "../logger";
import { numberValue, unique } from "./common";
import type { PublicProviderAdapter, PublicRefreshResult } from "./catalog";

const SITE = "https://openhdri.org";

function headers(): Record<string, string> {
  return { Accept: "text/html", "User-Agent": "OpenBridge" };
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaValue(html: string, name: string): string {
  const match = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i").exec(html);
  return match ? stripHtml(match[1]) : "";
}

function valueForRow(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}:<\\/div><div[^>]*>([\\s\\S]*?)<\\/div>`, "i").exec(html);
  return match ? stripHtml(match[1]).replace(/\s+\/\s+.*$/, "") : "";
}

function parseAsset(slug: string, html: string): PublicAssetSummary | null {
  const title = stripHtml(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "");
  if (!title) return null;
  // The provider's preview is a 4:3 render: a real 2:1 panorama area with a
  // material-ball/checkerboard strip composited below. PNG avoids AVIF, which
  // Electron's nativeImage cannot decode, and lets the UI crop that strip.
  const previewUrl = openHdriImageUrl(slug, OPENHDRI_PREVIEW_WIDTH);
  const thumbUrl = openHdriImageUrl(slug, 512);
  const downloadMatch = /href="(https:\/\/dl\.openhdri\.org\/file\/openexr\/[^"]+?\.exr)"/i.exec(html);
  const downloadUrl = downloadMatch?.[1];
  if (!downloadUrl) throw new Error(`OpenHDRI download link missing for ${slug}`);
  const publishedResolution = /_(\d+(?:\.\d+)?)K\.exr$/i.exec(new URL(downloadUrl).pathname)?.[1];
  const resolution = publishedResolution ? `${publishedResolution}K` : undefined;
  const colorchecker = /href="(https:\/\/dl\.openhdri\.org\/file\/openexr\/[^"]+?_colorchecker\.exr)"/i.exec(html)?.[1] ?? "";
  const categorySlugs = unique([...html.matchAll(/href="\/c\/([^"]+)"/g)].map(match => match[1].toLowerCase()));
  const tagSlugs = unique([...html.matchAll(/href="\/t\/([^"]+)"/g)].map(match => match[1].toLowerCase()));
  const categories = categorySlugs;
  const category = categories.includes("sky") && !categories.includes("indoor") && !categories.includes("studio")
    ? "HDRIs/Skies"
    : publicHdriCategory(title, [...categories, ...tagSlugs]);
  const tags = unique([...categories, ...tagSlugs]);
  const description = metaValue(html, "description") ||
    stripHtml(/About this HDRI:?<\/[^>]+>([\s\S]*?)Categories:/i.exec(html)?.[1] ?? "");
  const fileFormat = valueForRow(html, "File Format") || "32-bit Float OpenEXR (.exr)";
  const dynamicRange = valueForRow(html, "Dynamic Range");
  const whiteBalance = valueForRow(html, "White Balance");
  const captureDate = valueForRow(html, "Capture Date");
  const location = valueForRow(html, "Location");
  const uploadDate = valueForRow(html, "Upload Date");
  const publishedAt = uploadDate ? Date.parse(uploadDate) : null;
  const author = metaValue(html, "author") || "Open HDRI";
  const license = valueForRow(html, "License") || "CC0";
  const downloadSizeLabel = /DOWNLOAD[\s\S]{0,160}?<span>([^<]+)<\/span>/i.exec(html)?.[1] ?? "";
  const downloads = numberValue(/Downloads:<\/div><div[^>]*>([\d.,]+)/i.exec(html)?.[1]?.replace(/,/g, "")) ?? 0;
  const indoor = categories.includes("indoor") || categories.includes("studio");
  const clock = /at (\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(captureDate);
  const timeOfDay = !indoor && clock ? (Number(clock[1]) % 12) + (clock[3].toUpperCase() === "PM" ? 12 : 0) + Number(clock[2]) / 60 : null;
  const weather = indoor ? null : poliigonSkyCondition({ name: title, tags, categories: [category] });
  // This is a content-only render, not an equirectangular texture. The real
  // 360° preview is generated from the published OpenEXR source. The separate
  // `thumbnail` field above remains the small card image.
  const previews: PublicPreview[] = [
    { type: "preview", label: "Environment preview", url: previewUrl }
  ];

  return {
    id: slug,
    provider: "openhdri",
    name: title,
    type: "hdri",
    typeLabel: "HDRI",
    categories: [category],
    category,
    tags,
    description,
    authors: { [author]: "Creator" },
    attributes: {
      fileFormat,
      dynamicRange,
      whiteBalance,
      captureDate,
      uploadDate,
      location,
      downloadSize: downloadSizeLabel,
      colorChecker: colorchecker,
      trueHDR: true
    },
    maxResolution: publishedResolution ? Number(publishedResolution) * 1024 : null,
    resolutions: resolution ? [resolution] : [],
    dimensions: null,
    dimensionsMm: null,
    polycount: null,
    texelDensity: null,
    publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
    downloadCount: downloads,
    thumbnail: thumbUrl,
    previews,
    timeOfDay,
    weather,
    mapCodes: ["HDR", "JPG"],
    mapFormats: ["exr", "jpg"],
    modelFormats: [],
    lodCount: 0,
    license: license.toLowerCase().includes("cc0") ? "CC0-1.0" : license,
    free: true,
    websiteUrl: `${SITE}/h/${slug}`,
    filesHash: `${slug}:${resolution ?? "original"}`,
    enriched: true,
    files: [
      {
        role: "hdri",
        name: new URL(downloadUrl).pathname.split("/").at(-1)!,
        url: downloadUrl,
        bytes: 0, // The website shows rounded GB, not an exact byte count for verification.
        resolution,
        format: "exr",
        downloadable: true
      },
      ...(colorchecker
        ? [{
            role: "colorchart" as const,
            name: `${slug}_colorchecker.exr`,
            url: colorchecker,
            bytes: 0,
            format: "exr",
            fileType: "colorchecker",
            downloadable: true
          }]
        : [])
    ]
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`OpenHDRI returned HTTP ${response.status} for ${url}`);
  return response.text();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

export class OpenHdriAdapter implements PublicProviderAdapter {
  async fetch(logger: Logger): Promise<PublicRefreshResult> {
    const home = await fetchText(`${SITE}/`);
    const slugs = unique([...home.matchAll(/href="\/h\/([^"]+)"/g)].map(match => match[1]));
    if (slugs.length === 0) throw new Error("OpenHDRI catalogue links were not found");
    logger.info(`${PUBLIC_PROVIDER_LABELS.openhdri} catalogue links`, { count: slugs.length });
    const assets = await mapLimit(slugs, 2, async slug => {
      const html = await fetchText(`${SITE}/h/${slug}`);
      return parseAsset(slug, html);
    });
    const normalized = assets.filter((asset): asset is PublicAssetSummary => Boolean(asset));
    if (normalized.length !== slugs.length) {
      throw new Error(`OpenHDRI catalogue was incomplete (${normalized.length} of ${slugs.length}); the previous catalogue was preserved`);
    }
    return { assets: normalized, published: normalized.length };
  }
}
