import { crc32, deflateSync } from "node:zlib";
import type { PoliigonHdrData } from "../../shared/types";

export const PUBLIC_PREVIEW_MAX_BYTES = 160 * 1024 * 1024;
export const PUBLIC_HDR_MAX_WIDTH = 8192;
export const PUBLIC_HDR_MAX_PIXELS = 8192 * 4096;

export interface HdrLimits {
  maxWidth: number;
  maxPixels: number;
}

const DEFAULT_HDR_LIMITS: HdrLimits = { maxWidth: PUBLIC_HDR_MAX_WIDTH, maxPixels: PUBLIC_HDR_MAX_PIXELS };

/** Inspect dimensions before invoking a decoder that allocates full float buffers. */
export function checkHdrDimensions(buffer: Buffer, extension: string, limits: HdrLimits = DEFAULT_HDR_LIMITS): { width: number; height: number } {
  let width = 0, height = 0;
  if (extension.toLowerCase() === ".exr") {
    if (buffer.length < 8 || buffer.readUInt32LE(0) !== 20000630) throw new Error("Invalid OpenEXR source");
    const flags = buffer.readUInt32LE(4);
    if (flags & (0x200 | 0x800 | 0x1000)) throw new Error("Tiled, deep or multipart EXRs are not supported for live preview");
    let offset = 8;
    const string = (): string => {
      const end = buffer.indexOf(0, offset);
      if (end < 0 || end - offset > 1024) throw new Error("Invalid EXR header");
      const value = buffer.toString("utf8", offset, end); offset = end + 1; return value;
    };
    while (offset < Math.min(buffer.length, 1024 * 1024)) {
      const name = string(); if (!name) break;
      const type = string();
      if (offset + 4 > buffer.length) throw new Error("Truncated EXR header");
      const size = buffer.readUInt32LE(offset); offset += 4;
      if (offset + size > buffer.length) throw new Error("Truncated EXR attribute");
      if (name === "dataWindow" && type === "box2i" && size === 16) {
        width = buffer.readInt32LE(offset + 8) - buffer.readInt32LE(offset) + 1;
        height = buffer.readInt32LE(offset + 12) - buffer.readInt32LE(offset + 4) + 1;
        break;
      }
      offset += size;
    }
  } else {
    const header = buffer.toString("ascii", 0, Math.min(buffer.length, 65536));
    const match = /(?:^|\n)[+-]Y\s+(\d+)\s+[+-]X\s+(\d+)/.exec(header);
    if (match) { width = Number(match[2]); height = Number(match[1]); }
  }
  if (width < 1 || height < 1) throw new Error("HDR source dimensions were not found");
  if (width > limits.maxWidth || height > limits.maxWidth || width * height > limits.maxPixels) {
    throw new Error(`This HDR source exceeds the safe live-preview budget (${limits.maxWidth}px maximum axis). Use the published tone-mapped panorama or download the original for your DCC.`);
  }
  return { width, height };
}

/** Live exposure is capped at 8K for every provider, including 16K-only sources. */
export function hdrLimitsFor(_provider: string): HdrLimits {
  return DEFAULT_HDR_LIMITS;
}

export function hdrMaxBytesFor(_provider: string): number {
  return PUBLIC_PREVIEW_MAX_BYTES;
}

function half(value: number): number {
  const sign = value & 0x8000 ? -1 : 1, exponent = value >> 10 & 31, fraction = value & 1023;
  if (exponent === 31) return fraction ? 0 : sign * 65504;
  return sign * (exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15));
}

/** The same ACES/sRGB transform used by the GPU viewer, written as a small PNG. */
export function toneMappedPng(hdr: PoliigonHdrData, maxWidth = 2048): Buffer {
  const width = Math.min(hdr.width, maxWidth), height = Math.max(1, Math.round(hdr.height * width / hdr.width));
  const rows = Buffer.alloc((width * 4 + 1) * height);
  const channel = (value: number): number => {
    const x = Math.max(0, half(value));
    const linear = Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
    return Math.round(255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055));
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (Math.min(hdr.height - 1, Math.floor(y * hdr.height / height)) * hdr.width + Math.floor(x * hdr.width / width)) * 4;
    const target = y * (width * 4 + 1) + 1 + x * 4;
    rows[target] = channel(hdr.data[source]); rows[target + 1] = channel(hdr.data[source + 1]); rows[target + 2] = channel(hdr.data[source + 2]); rows[target + 3] = 255;
  }
  const chunk = (type: string, body: Buffer): Buffer => {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(body.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, body])));
    return Buffer.concat([length, name, body, checksum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
