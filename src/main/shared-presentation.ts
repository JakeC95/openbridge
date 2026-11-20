import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isInside } from "./shared-library";
import type {
  SharedPresentation,
  SharedPresentationCredit,
  SharedPresentationFact,
  SharedPresentationLink,
  SharedPresentationMap,
  SharedPresentationMedia,
  SharedPresentationOriginal,
  SharedPresentationPart,
  SharedPresentationResult,
  SharedPresentationVersion
} from "../shared/types";

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".m4v"]);
const LIMITS = {
  media: 24,
  facts: 24,
  parts: 64,
  maps: 64,
  versions: 24,
  links: 16,
  credits: 12,
  notes: 12
};

type UnknownRecord = Record<string, unknown>;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function cleanInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function cleanStringList(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value.slice(0, limit)) {
    const text = cleanText(entry, maxLength);
    if (text && !result.includes(text)) result.push(text);
  }
  return result;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function mimeType(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case ".mp4":
    case ".m4v": return "video/mp4";
    case ".webm": return "video/webm";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".avif": return "image/avif";
    case ".gif": return "image/gif";
    default: return undefined;
  }
}

async function manifestPath(folder: string, assetPath: string): Promise<string | null> {
  const stem = basename(assetPath, extname(assetPath));
  for (const name of ["presentation.json", `${stem}.presentation.json`]) {
    const path = join(folder, name);
    if (!isInside(folder, path)) continue;
    const info = await lstat(path).catch(() => null);
    if (info?.isFile()) return path;
  }
  return null;
}

interface ResolvedMedia {
  url: string;
  bytes: number;
}

async function resolveMedia(
  folder: string,
  canonicalFolder: string,
  reference: string,
  kind: "image" | "video",
  label: string,
  warnings: string[]
): Promise<ResolvedMedia | null> {
  const cleaned = reference.replace(/\\/g, "/").trim();
  if (!cleaned || cleaned.startsWith("/") || cleaned.startsWith("~") ||
      /^[a-z][a-z0-9+.-]*:/i.test(cleaned) || cleaned.split("/").includes("..")) {
    warnings.push(`${label} must use a relative path inside the presentation folder.`);
    return null;
  }
  const target = resolve(canonicalFolder, cleaned);
  if (!isInside(canonicalFolder, target)) {
    warnings.push(`${label} resolves outside the presentation folder.`);
    return null;
  }
  const info = await lstat(target).catch(() => null);
  if (!info?.isFile()) {
    warnings.push(`${label} file is missing: ${cleaned}.`);
    return null;
  }
  const canonical = await realpath(target).catch(() => null);
  if (!canonical || !isInside(canonicalFolder, canonical)) {
    warnings.push(`${label} resolves outside the presentation folder.`);
    return null;
  }
  const extension = extname(canonical).toLowerCase();
  const allowed = kind === "video" ? VIDEO_EXTENSIONS : IMAGE_EXTENSIONS;
  if (!allowed.has(extension)) {
    warnings.push(`${label} uses an unsupported ${kind} format: ${extension || "unknown"}.`);
    return null;
  }
  const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (info.size > limit) {
    warnings.push(`${label} is too large to preview (${Math.round(info.size / (1024 * 1024))} MiB).`);
    return null;
  }
  return { url: pathToFileURL(canonical).href, bytes: info.size };
}

async function parseMedia(
  value: unknown,
  folder: string,
  canonicalFolder: string,
  warnings: string[],
  fallbackLabel: string
): Promise<SharedPresentationMedia | null> {
  const entry = record(value);
  if (!entry) return null;
  const src = cleanText(entry.src, 600);
  if (!src) {
    warnings.push(`${fallbackLabel} has no source path.`);
    return null;
  }
  const kind = entry.kind === "video" ? "video" : entry.kind === "image" || !entry.kind
    ? (VIDEO_EXTENSIONS.has(extname(src).toLowerCase()) ? "video" : "image")
    : null;
  if (!kind) {
    warnings.push(`${fallbackLabel} has an unknown media kind.`);
    return null;
  }
  const label = cleanText(entry.label, 120) ?? fallbackLabel;
  const resolved = await resolveMedia(folder, canonicalFolder, src, kind, label, warnings);
  if (!resolved) return null;
  let poster: ResolvedMedia | null = null;
  const posterSource = cleanText(entry.poster, 600);
  if (kind === "video" && posterSource) {
    poster = await resolveMedia(folder, canonicalFolder, posterSource, "image", `${label} poster`, warnings);
  }
  return {
    kind,
    label,
    group: cleanText(entry.group, 80),
    caption: cleanText(entry.caption, 800),
    url: resolved.url,
    poster: poster?.url,
    mimeType: cleanText(entry.mimeType, 80) ?? mimeType(src),
    width: cleanInteger(entry.width),
    height: cleanInteger(entry.height),
    durationSeconds: cleanNumber(entry.durationSeconds),
    alt: cleanText(entry.alt, 240)
  };
}

async function parseMap(
  value: unknown,
  folder: string,
  canonicalFolder: string,
  warnings: string[]
): Promise<SharedPresentationMap | null> {
  const entry = record(value);
  if (!entry) return null;
  const channel = cleanText(entry.channel, 40);
  const label = cleanText(entry.label, 120) ?? channel;
  if (!channel || !label) {
    warnings.push("A map entry is missing its channel or label.");
    return null;
  }
  const tiles = Array.isArray(entry.tiles)
    ? entry.tiles.map(cleanInteger).filter((tile): tile is number => tile !== undefined).slice(0, 64)
    : [];
  const previewSource = cleanText(entry.preview, 600);
  const preview = previewSource
    ? await resolveMedia(folder, canonicalFolder, previewSource, "image", `${label} preview`, warnings)
    : null;
  const tilePreviews: Array<{ tile: number; url: string }> = [];
  if (Array.isArray(entry.tilePreviews)) {
    for (const raw of entry.tilePreviews.slice(0, 64)) {
      const tileEntry = record(raw);
      const tile = tileEntry ? cleanInteger(tileEntry.tile) : undefined;
      const source = tileEntry ? cleanText(tileEntry.src, 600) : undefined;
      if (tile === undefined || !source) continue;
      const resolved = await resolveMedia(folder, canonicalFolder, source, "image", `${label} tile ${tile}`, warnings);
      if (resolved) tilePreviews.push({ tile, url: resolved.url });
    }
  }
  return {
    channel,
    label,
    primary: entry.primary === true,
    part: cleanText(entry.part, 120),
    material: cleanText(entry.material, 120),
    tiles: tiles.length ? tiles : undefined,
    resolution: cleanText(entry.resolution, 80),
    format: cleanText(entry.format, 80),
    version: cleanText(entry.version, 40),
    note: cleanText(entry.note, 600),
    preview: preview?.url,
    tilePreviews: tilePreviews.length ? tilePreviews : undefined
  };
}

function parseFacts(value: unknown): SharedPresentationFact[] {
  if (!Array.isArray(value)) return [];
  const facts: SharedPresentationFact[] = [];
  for (const raw of value.slice(0, LIMITS.facts)) {
    const entry = record(raw);
    const label = entry ? cleanText(entry.label, 80) : undefined;
    const factValue = entry ? cleanText(entry.value, 600) : undefined;
    if (!label || !factValue) continue;
    facts.push({ label, value: factValue, detail: cleanText(entry!.detail, 600), primary: entry!.primary === true });
  }
  return facts;
}

async function parseParts(
  value: unknown,
  folder: string,
  canonicalFolder: string,
  warnings: string[]
): Promise<SharedPresentationPart[]> {
  if (!Array.isArray(value)) return [];
  const parts: SharedPresentationPart[] = [];
  for (const raw of value.slice(0, LIMITS.parts)) {
    const entry = record(raw);
    const name = entry ? cleanText(entry.name, 120) : undefined;
    if (!name) continue;
    const color = entry ? cleanText(entry.color, 32) : undefined;
    const previewSource = entry ? cleanText(entry.preview, 600) : undefined;
    const preview = previewSource
      ? await resolveMedia(folder, canonicalFolder, previewSource, "image", `${name} preview`, warnings)
      : null;
    parts.push({
      name,
      label: cleanText(entry!.label, 120),
      faces: cleanInteger(entry!.faces),
      vertices: cleanInteger(entry!.vertices),
      material: cleanText(entry!.material, 120),
      tile: cleanInteger(entry!.tile),
      color: color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined,
      note: cleanText(entry!.note, 600),
      preview: preview?.url
    });
  }
  return parts;
}

function parseVersions(value: unknown): SharedPresentationVersion[] {
  if (!Array.isArray(value)) return [];
  const versions: SharedPresentationVersion[] = [];
  for (const raw of value.slice(0, LIMITS.versions)) {
    const entry = record(raw);
    const label = entry ? cleanText(entry.label, 120) : undefined;
    if (!label) continue;
    versions.push({
      label,
      kind: cleanText(entry!.kind, 40),
      date: cleanText(entry!.date, 80),
      note: cleanText(entry!.note, 800),
      current: entry!.current === true
    });
  }
  return versions;
}

function parseLinks(value: unknown): SharedPresentationLink[] {
  if (!Array.isArray(value)) return [];
  const links: SharedPresentationLink[] = [];
  for (const raw of value.slice(0, LIMITS.links)) {
    const entry = record(raw);
    const label = entry ? cleanText(entry.label, 120) : undefined;
    if (!label) continue;
    const href = cleanText(entry!.href, 1000);
    links.push({
      label,
      value: cleanText(entry!.value, 600),
      href: href && /^https:\/\//i.test(href) ? href : undefined,
      note: cleanText(entry!.note, 600)
    });
  }
  return links;
}

function parseCredits(value: unknown): SharedPresentationCredit[] {
  if (!Array.isArray(value)) return [];
  const credits: SharedPresentationCredit[] = [];
  for (const raw of value.slice(0, LIMITS.credits)) {
    const entry = record(raw);
    const role = entry ? cleanText(entry.role, 80) : undefined;
    const name = entry ? cleanText(entry.name, 120) : undefined;
    if (role && name) credits.push({ role, name });
  }
  return credits;
}

function parseOriginal(value: unknown): SharedPresentationOriginal | undefined {
  const entry = record(value);
  if (!entry) return undefined;
  const formats = Array.isArray(entry.formats)
    ? entry.formats.map(item => cleanText(item, 60)).filter((item): item is string => Boolean(item)).slice(0, 12)
    : [];
  const format = cleanText(entry.format, 120);
  const size = cleanText(entry.size, 80);
  const detail = cleanText(entry.detail, 600);
  if (!format && !formats.length && !size && !detail) return undefined;
  return { format, formats: formats.length ? formats : undefined, size, detail };
}

export async function readSharedPresentation(assetPath: string): Promise<SharedPresentationResult> {
  const folder = await realpath(dirname(assetPath)).catch(() => null);
  if (!folder) return { presentation: null };
  const source = await manifestPath(folder, assetPath);
  if (!source) return { presentation: null };
  const info = await lstat(source).catch(() => null);
  if (!info?.isFile() || info.size > MAX_MANIFEST_BYTES) {
    return { presentation: null, error: "presentation.json is too large to read." };
  }
  let manifest: UnknownRecord;
  try {
    const file = await open(source, "r");
    try {
      const buffer = Buffer.alloc(info.size);
      const read = await file.read(buffer, 0, buffer.length, 0);
      manifest = JSON.parse(buffer.subarray(0, read.bytesRead).toString("utf8")) as UnknownRecord;
    } finally {
      await file.close();
    }
  } catch {
    return { presentation: null, error: "presentation.json is not valid JSON." };
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { presentation: null, error: "presentation.json must contain an object." };
  }
  if (manifest.schemaVersion !== 1) {
    return { presentation: null, error: "presentation.json must declare schemaVersion 1." };
  }

  const warnings: string[] = [];
  const media: SharedPresentationMedia[] = [];
  if (Array.isArray(manifest.media)) {
    for (const [index, raw] of manifest.media.slice(0, LIMITS.media).entries()) {
      const parsed = await parseMedia(raw, folder, folder, warnings, `Media ${index + 1}`);
      if (parsed) media.push(parsed);
    }
  }
  let hero: SharedPresentationMedia | null = null;
  if (manifest.hero !== undefined) {
    hero = await parseMedia(manifest.hero, folder, folder, warnings, "Hero media");
    if (hero?.kind === "video" && !hero.poster) {
      const fallback = media.find(entry => entry.kind === "image");
      if (fallback) hero.poster = fallback.url;
    }
  }

  const maps: SharedPresentationMap[] = [];
  if (Array.isArray(manifest.maps)) {
    for (const raw of manifest.maps.slice(0, LIMITS.maps)) {
      const parsed = await parseMap(raw, folder, folder, warnings);
      if (parsed) maps.push(parsed);
    }
  }
  const parts = await parseParts(manifest.parts, folder, folder, warnings);

  const presentation: SharedPresentation = {
    schemaVersion: 1,
    title: cleanText(manifest.title, 120),
    subtitle: cleanText(manifest.subtitle, 200),
    category: cleanText(manifest.category, 60),
    summary: cleanText(manifest.summary, 1600),
    job: cleanText(manifest.job, 120),
    artist: cleanText(manifest.artist, 80),
    renderer: cleanText(manifest.renderer, 120),
    original: parseOriginal(manifest.original),
    hero: hero ?? undefined,
    media,
    facts: parseFacts(manifest.facts),
    parts,
    maps,
    versions: parseVersions(manifest.versions),
    links: parseLinks(manifest.links),
    credits: parseCredits(manifest.credits),
    notes: cleanStringList(manifest.notes, LIMITS.notes, 1200),
    warnings
  };

  const hasContent = Boolean(presentation.title || presentation.subtitle || presentation.summary ||
    presentation.job || presentation.artist || presentation.renderer || presentation.original ||
    presentation.hero || presentation.media.length ||
    presentation.facts.length || presentation.parts.length || presentation.maps.length ||
    presentation.versions.length || presentation.links.length || presentation.credits.length ||
    presentation.notes.length);
  if (!hasContent) return { presentation: null, error: "presentation.json has no displayable details." };
  return { presentation };
}
