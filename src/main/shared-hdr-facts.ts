import { open } from "node:fs/promises";
import { extname } from "node:path";

const MAX_HEADER_BYTES = 1024 * 1024;
const EXR_MAGIC = 20000630;
const COMPRESSION = [
  "None", "RLE", "ZIPS", "ZIP", "PIZ", "PXR24", "B44", "B44A", "DWAA", "DWAB"
];

/** Filename suffixes are only an allowlist; the header identifies the encoding. */
export function detectHdrFormat(buffer: Buffer): "exr" | "hdr" {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === EXR_MAGIC) return "exr";
  if (/^#\?(?:RADIANCE|RGBE)\r?\n/.test(buffer.toString("ascii", 0, Math.min(buffer.length, 16)))) return "hdr";
  throw new Error("Invalid OpenEXR or Radiance HDR header.");
}

export interface SharedHdrFacts {
  format: "exr" | "hdr";
  width: number;
  height: number;
  /** A 2:1 image is a candidate panorama. Aspect ratio alone cannot prove projection. */
  projectionHint: "equirectangular" | "flat";
  projectionBasis: "aspect-ratio";
  channels: Array<{ name: string; type: "half" | "float" | "uint" | "rgbe"; bits: number }>;
  bitDepth: number | null;
  compression: string | null;
  views: string[];
  tiled: boolean;
  deep: boolean;
  multipart: boolean;
}

function validDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || width > 1_000_000 || height > 1_000_000) {
    throw new Error("HDR dimensions are missing or invalid.");
  }
}

function projection(width: number, height: number): SharedHdrFacts["projectionHint"] {
  const ratio = width / height;
  return ratio >= 1.95 && ratio <= 2.05 ? "equirectangular" : "flat";
}

function parseExr(buffer: Buffer): SharedHdrFacts {
  if (buffer.length < 8 || buffer.readUInt32LE(0) !== EXR_MAGIC) {
    throw new Error("Invalid OpenEXR header.");
  }
  const version = buffer.readUInt32LE(4);
  let offset = 8;
  const string = (): string => {
    const end = buffer.indexOf(0, offset);
    if (end < offset || end - offset > 1024) throw new Error("Invalid OpenEXR header string.");
    const text = buffer.toString("utf8", offset, end);
    offset = end + 1;
    return text;
  };
  let width = 0;
  let height = 0;
  let compression: string | null = null;
  const channels: SharedHdrFacts["channels"] = [];
  const views: string[] = [];
  let terminated = false;

  while (offset < buffer.length) {
    const name = string();
    if (!name) { terminated = true; break; }
    const type = string();
    if (offset + 4 > buffer.length) throw new Error("Truncated OpenEXR header.");
    const length = buffer.readUInt32LE(offset);
    offset += 4;
    const end = offset + length;
    if (end > buffer.length) throw new Error("OpenEXR header exceeds the bounded inspection limit.");
    if (name === "dataWindow" && type === "box2i" && length === 16) {
      width = buffer.readInt32LE(offset + 8) - buffer.readInt32LE(offset) + 1;
      height = buffer.readInt32LE(offset + 12) - buffer.readInt32LE(offset + 4) + 1;
    } else if (name === "compression" && type === "compression" && length === 1) {
      compression = COMPRESSION[buffer[offset]] ?? `Unknown (${buffer[offset]})`;
    } else if (name === "channels" && type === "chlist") {
      let position = offset;
      let channelEnd = false;
      while (position < end) {
        const zero = buffer.indexOf(0, position);
        if (zero < position || zero >= end || zero - position > 1024) {
          throw new Error("Invalid OpenEXR channel name.");
        }
        if (zero === position) { channelEnd = true; break; }
        const channelName = buffer.toString("utf8", position, zero);
        position = zero + 1;
        if (position + 16 > end || channels.length >= 256) throw new Error("Invalid OpenEXR channel list.");
        const pixelType = buffer.readInt32LE(position);
        const xSampling = buffer.readInt32LE(position + 8);
        const ySampling = buffer.readInt32LE(position + 12);
        if (pixelType < 0 || pixelType > 2 || xSampling < 1 || ySampling < 1) {
          throw new Error("Invalid OpenEXR channel definition.");
        }
        channels.push({
          name: channelName,
          type: pixelType === 0 ? "uint" : pixelType === 1 ? "half" : "float",
          bits: pixelType === 1 ? 16 : 32
        });
        position += 16;
      }
      if (!channelEnd) throw new Error("Unterminated OpenEXR channel list.");
    } else if (name === "multiView" && type === "stringvector") {
      let position = offset;
      while (position < end) {
        if (position + 4 > end || views.length >= 64) throw new Error("Invalid OpenEXR view list.");
        const size = buffer.readUInt32LE(position);
        position += 4;
        if (size > 1024 || position + size > end) throw new Error("Invalid OpenEXR view name.");
        views.push(buffer.toString("utf8", position, position + size));
        position += size;
      }
    }
    offset = end;
  }
  if (!terminated) throw new Error("OpenEXR header exceeds the bounded inspection limit.");
  validDimensions(width, height);
  const bitDepths = new Set(channels.map(channel => channel.bits));
  return {
    format: "exr", width, height, projectionHint: projection(width, height), projectionBasis: "aspect-ratio",
    channels, bitDepth: bitDepths.size === 1 ? channels[0].bits : null,
    compression, views,
    tiled: Boolean(version & 0x200), deep: Boolean(version & 0x800), multipart: Boolean(version & 0x1000)
  };
}

function parseRadiance(buffer: Buffer): SharedHdrFacts {
  const header = buffer.toString("ascii", 0, Math.min(buffer.length, 65536));
  if (!/^#\?(?:RADIANCE|RGBE)\r?\n/.test(header)) throw new Error("Invalid Radiance HDR header.");
  const layout = /(?:^|\n)FORMAT=([^\r\n]+)/.exec(header)?.[1];
  if (layout !== "32-bit_rle_rgbe") throw new Error("Unsupported Radiance HDR pixel encoding.");
  const size = /(?:^|\n)[+-]Y\s+(\d+)\s+[+-]X\s+(\d+)(?:\r?\n|$)/.exec(header);
  if (!size) throw new Error("Radiance HDR dimensions are missing.");
  const width = Number(size[2]);
  const height = Number(size[1]);
  validDimensions(width, height);
  return {
    format: "hdr", width, height, projectionHint: projection(width, height), projectionBasis: "aspect-ratio",
    channels: ["R", "G", "B", "Exponent"].map(name => ({ name, type: "rgbe", bits: 8 })),
    // RGBE uses a shared exponent. Its 8-bit components are not ordinary 8-bit RGB precision.
    bitDepth: null, compression: "Radiance RGBE / RLE", views: [],
    tiled: false, deep: false, multipart: false
  };
}

/** Read at most one MiB. Pixel payloads are never allocated or decoded by this probe. */
export async function inspectSharedHdrFacts(path: string): Promise<SharedHdrFacts> {
  const extension = extname(path).toLowerCase();
  if (extension !== ".exr" && extension !== ".hdr") throw new Error("Expected an HDR or EXR source.");
  const file = await open(path);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("The HDR source is no longer a regular file.");
    const header = Buffer.alloc(Math.min(info.size, MAX_HEADER_BYTES));
    let length = 0;
    while (length < header.length) {
      const read = await file.read(header, length, header.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const buffer = header.subarray(0, length);
    return detectHdrFormat(buffer) === "exr" ? parseExr(buffer) : parseRadiance(buffer);
  } finally { await file.close(); }
}
