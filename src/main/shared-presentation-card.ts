import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import type { SharedPresentationCard } from "../shared/types";

const MAX_MANIFEST_BYTES = 256 * 1024;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Read only the small set of manifest fields the library card needs. This is
 * deliberately separate from readSharedPresentation so the grid never resolves
 * media or checks dependency paths. The scan uses it to add job and artist
 * names to the search string.
 */
export async function readPresentationCard(assetPath: string): Promise<SharedPresentationCard | null> {
  const folder = dirname(assetPath);
  const stem = basename(assetPath, extname(assetPath));
  const canonicalFolder = await realpath(folder).catch(() => null);
  if (!canonicalFolder) return null;
  for (const name of ["presentation.json", `${stem}.presentation.json`]) {
    const candidate = join(folder, name);
    const info = await lstat(candidate).catch(() => null);
    if (!info?.isFile() || info.size > MAX_MANIFEST_BYTES) continue;
    const canonical = await realpath(candidate).catch(() => null);
    if (!canonical) continue;
    const location = relative(canonicalFolder, canonical);
    if (!location || location.startsWith("..") || isAbsolute(location)) continue;
    let manifest: unknown;
    try {
      const file = await open(canonical, "r");
      try {
        const buffer = Buffer.alloc(info.size);
        const read = await file.read(buffer, 0, buffer.length, 0);
        manifest = JSON.parse(buffer.subarray(0, read.bytesRead).toString("utf8"));
      } finally {
        await file.close();
      }
    } catch {
      continue;
    }
    const root = record(manifest);
    if (!root || root.schemaVersion !== 1) continue;
    const original = record(root.original);
    const formats = Array.isArray(original?.formats)
      ? original.formats.map(value => cleanText(value, 60)).filter((value): value is string => Boolean(value)).slice(0, 8)
      : [];
    const card: SharedPresentationCard = {
      category: cleanText(root.category, 60),
      job: cleanText(root.job, 120),
      artist: cleanText(root.artist, 80),
      renderer: cleanText(root.renderer, 120),
      originalFormat: cleanText(original?.format, 120) ?? (formats.length ? formats.join(" / ") : undefined),
      originalFormats: formats,
      originalSize: cleanText(original?.size, 80),
      originalDetail: cleanText(original?.detail, 240)
    };
    return Object.values(card).some(Boolean) ? card : null;
  }
  return null;
}
