import { app, nativeImage } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CACHE_DIR = () => join(app.getPath("userData"), "smart-thumbnails");
const MAX_CONCURRENCY = 4;
const ALPHA_THRESHOLD = 8;
const CROP_THRESHOLD = 0.94;

const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const queue: Array<() => void> = [];
let running = 0;

function schedule<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = (): void => {
      running += 1;
      work()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (running < MAX_CONCURRENCY) run();
    else queue.push(run);
  });
}

function sourcePath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

async function readSource(source: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { Accept: "image/*", "User-Agent": "OpenBridge" },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Thumbnail returned HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const path = sourcePath(source);
  if (!path) throw new Error("Unsupported thumbnail source");
  return readFile(path);
}

function alphaBounds(bitmap: Buffer, width: number, height: number): {
  x: number;
  y: number;
  width: number;
  height: number;
  transparent: boolean;
} | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let transparent = false;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const alpha = bitmap[row + x * 4 + 3];
      if (alpha < 255) transparent = true;
      if (alpha <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    transparent
  };
}

interface Pixel {
  b: number;
  g: number;
  r: number;
}

function pixelAt(bitmap: Buffer, width: number, x: number, y: number): Pixel {
  const offset = (y * width + x) * 4;
  return { b: bitmap[offset], g: bitmap[offset + 1], r: bitmap[offset + 2] };
}

function colorDistance(a: Pixel, b: Pixel): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

/**
 * Some opaque product renders sit on a large flat background. Crop that
 * background as well when the border is consistent, so the subject uses the
 * tile even without an alpha channel.
 */
function backgroundBounds(bitmap: Buffer, width: number, height: number): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const corners = [
    pixelAt(bitmap, width, 0, 0),
    pixelAt(bitmap, width, width - 1, 0),
    pixelAt(bitmap, width, 0, height - 1),
    pixelAt(bitmap, width, width - 1, height - 1)
  ];
  const cornerSpread = Math.max(
    ...corners.flatMap(a => corners.map(b => colorDistance(a, b)))
  );
  if (cornerSpread > 14) return null;
  const background = {
    r: Math.round(corners.reduce((sum, p) => sum + p.r, 0) / corners.length),
    g: Math.round(corners.reduce((sum, p) => sum + p.g, 0) / corners.length),
    b: Math.round(corners.reduce((sum, p) => sum + p.b, 0) / corners.length)
  };
  const step = Math.max(1, Math.floor(Math.min(width, height) / 60));
  let border = 0;
  let borderLike = 0;
  for (let x = 0; x < width; x += step) {
    for (const y of [0, height - 1]) {
      border += 1;
      if (colorDistance(pixelAt(bitmap, width, x, y), background) <= 22) borderLike += 1;
    }
  }
  for (let y = 0; y < height; y += step) {
    for (const x of [0, width - 1]) {
      border += 1;
      if (colorDistance(pixelAt(bitmap, width, x, y), background) <= 22) borderLike += 1;
    }
  }
  if (border === 0 || borderLike / border < 0.62) return null;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const offset = row + x * 4;
      if (bitmap[offset + 3] <= ALPHA_THRESHOLD) continue;
      const distance = colorDistance({ r: bitmap[offset + 2], g: bitmap[offset + 1], b: bitmap[offset] }, background);
      if (distance <= 22) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function contentBounds(bitmap: Buffer, width: number, height: number): {
  x: number;
  y: number;
  width: number;
  height: number;
  transparent: boolean;
} | null {
  const alpha = alphaBounds(bitmap, width, height);
  if (!alpha) return null;
  if (alpha.transparent) return alpha;
  const background = backgroundBounds(bitmap, width, height);
  return background ? { ...background, transparent: false } : alpha;
}

function unchanged(source: string): string {
  memory.set(source, source);
  return source;
}

/**
 * Crops the transparent or flat background margin from asset thumbnails so the
 * real subject uses the available tile. Opaque, gradient and already-full
 * images are returned unchanged. Results are cached by source identity.
 */
export async function smartThumbnail(source: string): Promise<string> {
  if (!source || !/^(?:https?|file):/i.test(source)) return source;
  const cached = memory.get(source);
  if (cached) return cached;
  const pending = inflight.get(source);
  if (pending) return pending;
  const promise = schedule(async () => {
    let keySource = source;
    const local = sourcePath(source);
    if (local) {
      const info = await stat(local).catch(() => null);
      if (info) keySource = `${source}:${info.size}:${Math.trunc(info.mtimeMs)}`;
    }
    const key = createHash("sha256").update(keySource).digest("hex");
    const destination = join(CACHE_DIR(), `${key}.png`);
    const existing = await stat(destination).catch(() => null);
    if (existing?.isFile()) {
      const url = pathToFileURL(destination).href;
      memory.set(source, url);
      return url;
    }
    const buffer = await readSource(source);
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return unchanged(source);
    const size = image.getSize();
    if (size.width <= 0 || size.height <= 0) return unchanged(source);
    const bounds = contentBounds(image.toBitmap(), size.width, size.height);
    if (!bounds) return unchanged(source);
    const coverage = Math.max(bounds.width / size.width, bounds.height / size.height);
    // A little transparent padding is normal; only re-crop when it is material.
    if (coverage >= CROP_THRESHOLD && bounds.width / size.width >= CROP_THRESHOLD
      && bounds.height / size.height >= CROP_THRESHOLD) {
      return unchanged(source);
    }
    const padding = Math.round(Math.max(size.width, size.height) * 0.015);
    const x = Math.max(0, bounds.x - padding);
    const y = Math.max(0, bounds.y - padding);
    const width = Math.min(size.width - x, bounds.width + padding * 2);
    const height = Math.min(size.height - y, bounds.height + padding * 2);
    const cropped = image.crop({ x, y, width, height });
    if (cropped.isEmpty()) return unchanged(source);
    await mkdir(CACHE_DIR(), { recursive: true });
    await writeFile(destination, cropped.toPNG());
    const url = pathToFileURL(destination).href;
    memory.set(source, url);
    return url;
  }).catch(() => source).finally(() => inflight.delete(source));
  inflight.set(source, promise);
  return promise;
}
