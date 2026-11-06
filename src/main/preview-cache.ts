import { app } from "electron";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** Caches that hold downloadable preview assets. Catalogue thumbnails are not stored here. */
export const PREVIEW_CACHE_ROOTS = [
  "poliigon-map-previews",
  "poliigon-map-highres",
  "poliigon-hdr-source",
  "polyhaven-map-previews",
  "polyhaven-map-highres",
  "polyhaven-hdr-source"
] as const;

/**
 * Anything at or below thumbnail size is kept; larger cached preview files are
 * temporary downloads and are flushed when the app quits.
 */
export const THUMBNAIL_CACHE_LIMIT = 256 * 1024;

export interface PreviewCacheFlush {
  removed: number;
  bytes: number;
}

/** Best-effort synchronous cleanup so the cache is gone before the process exits. */
export function flushLargePreviewCache(): PreviewCacheFlush {
  let removed = 0;
  let bytes = 0;
  const base = app.getPath("userData");

  const visit = (path: string): boolean => {
    let entries;
    try {
      entries = readdirSync(path, { withFileTypes: true });
    } catch {
      return false;
    }
    let empty = true;
    for (const entry of entries) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) {
        if (visit(target)) {
          try {
            rmSync(target, { recursive: true, force: true });
          } catch {
            empty = false;
          }
        } else {
          empty = false;
        }
        continue;
      }
      if (!entry.isFile()) {
        empty = false;
        continue;
      }
      try {
        const size = statSync(target).size;
        if (size > THUMBNAIL_CACHE_LIMIT) {
          rmSync(target, { force: true });
          removed += 1;
          bytes += size;
        } else {
          empty = false;
        }
      } catch {
        empty = false;
      }
    }
    return empty;
  };

  for (const root of PREVIEW_CACHE_ROOTS) visit(join(base, root));
  return { removed, bytes };
}
