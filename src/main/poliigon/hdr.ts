export interface HdrImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** Texture-ready HDR pixels: half-float RGB, as uploaded to the WebGL viewer. */
export interface HdrTexture {
  width: number;
  height: number;
  resolution: string;
  data: Uint16Array;
}

/**
 * Minimal Radiance RGBE decoder for Poliigon's .hdr maps. Supports the common
 * new-style scanline RLE used by Radiance and most DCC exporters.
 */
export function decodeRadianceHdr(buffer: Buffer): HdrImage {
  let offset = 0;
  const readLine = (): string => {
    const end = buffer.indexOf(10, offset);
    if (end < 0) throw new Error("Truncated HDR header");
    const line = buffer.subarray(offset, end).toString("ascii");
    offset = end + 1;
    return line;
  };
  const magic = readLine();
  if (!magic.startsWith("#?RADIANCE") && !magic.startsWith("#?RGBE")) {
    throw new Error("Unsupported HDR format");
  }
  let line = readLine();
  while (line.length > 0) line = readLine();
  const resolution = readLine().trim();
  const match = /^([+-])Y (\d+) ([+-])X (\d+)$/.exec(resolution);
  if (!match) throw new Error(`Unsupported HDR resolution line: ${resolution}`);
  const ySign = match[1];
  const height = Number(match[2]);
  const xSign = match[3];
  const width = Number(match[4]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid HDR dimensions");
  }
  const output = new Float32Array(width * height * 3);
  const scanline = new Uint8Array(width * 4);
  const channel = new Uint8Array(width);
  const readByte = (): number => {
    if (offset >= buffer.length) throw new Error("Truncated HDR pixel data");
    return buffer[offset++];
  };
  for (let y = 0; y < height; y += 1) {
    const firstR = readByte();
    const firstG = readByte();
    const firstB = readByte();
    const firstE = readByte();
    const isNewRle =
      firstR === 2 &&
      firstG === 2 &&
      ((firstB << 8) | firstE) === width &&
      width >= 8 &&
      width <= 0x7fff;
    if (isNewRle) {
      // New-style Radiance RLE: each channel is independently run-length encoded.
      for (let c = 0; c < 4; c += 1) {
        let x = 0;
        while (x < width) {
          const count = readByte();
          if (count > 128) {
            const run = count - 128;
            if (run === 0) throw new Error("Invalid HDR run length");
            const value = readByte();
            const end = Math.min(width, x + run);
            while (x < end) channel[x++] = value;
          } else {
            if (count === 0) throw new Error("Invalid HDR literal length");
            const end = Math.min(width, x + count);
            while (x < end) channel[x++] = readByte();
          }
        }
        for (let x = 0; x < width; x += 1) scanline[x * 4 + c] = channel[x];
      }
    } else {
      let x = 0;
      let r = firstR;
      let g = firstG;
      let b = firstB;
      let e = firstE;
      while (x < width) {
        if (r === 1 && g === 1 && b === 1) {
          // Old-style run: repeat the previous pixel.
          const count = Math.min(e << 8 | readByte(), width - x);
          if (x === 0) throw new Error("Invalid HDR run at start of scanline");
          const source = (x - 1) * 4;
          for (let index = 0; index < count; index += 1) {
            const target = x * 4;
            scanline[target] = scanline[source];
            scanline[target + 1] = scanline[source + 1];
            scanline[target + 2] = scanline[source + 2];
            scanline[target + 3] = scanline[source + 3];
            x += 1;
          }
        } else {
          const target = x * 4;
          scanline[target] = r;
          scanline[target + 1] = g;
          scanline[target + 2] = b;
          scanline[target + 3] = e;
          x += 1;
        }
        if (x >= width) break;
        r = readByte();
        g = readByte();
        b = readByte();
        e = readByte();
      }
    }
    const targetY = ySign === "-" ? y : height - 1 - y;
    const row = targetY * width * 3;
    for (let x = 0; x < width; x += 1) {
      const sourceX = xSign === "+" ? x : width - 1 - x;
      const target = row + sourceX * 3;
      const exponent = scanline[x * 4 + 3];
      if (exponent === 0) continue;
      const scale = Math.pow(2, exponent - 136);
      output[target] = scanline[x * 4] * scale;
      output[target + 1] = scanline[x * 4 + 1] * scale;
      output[target + 2] = scanline[x * 4 + 2] * scale;
    }
  }
  return { width, height, data: output };
}

const FLOAT_BITS = new Float32Array(1);
const UINT_BITS = new Uint32Array(FLOAT_BITS.buffer);

/** IEEE-754 binary32 to binary16, clamping overflow and flushing tiny values. */
function floatToHalf(value: number): number {
  FLOAT_BITS[0] = value;
  const bits = UINT_BITS[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  let mantissa = bits & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7bff;
  const unbiased = exponent - 127;
  if (unbiased > 15) return sign | 0x7bff;
  if (unbiased < -14) return sign;
  mantissa += 0x1000;
  let halfExponent = unbiased + 15;
  if (mantissa & 0x800000) {
    mantissa = 0;
    halfExponent += 1;
    if (halfExponent > 30) return sign | 0x7bff;
  }
  return sign | (halfExponent << 10) | (mantissa >>> 13);
}

type Float16ArrayLike = { [index: number]: number; buffer: ArrayBuffer };
type Float16ArrayConstructor = new (length: number) => Float16ArrayLike;
const Float16Ctor = (globalThis as unknown as { Float16Array?: Float16ArrayConstructor }).Float16Array;

function clampHalf(value: number): number {
  return value > 65504 ? 65504 : value < -65504 ? -65504 : value;
}

/** Interleaved RGB float pixels to half-float RGBA, the format WebGL can mip. */
export function rgbToHalfRgba(rgb: Float32Array): Uint16Array {
  const pixels = Math.floor(rgb.length / 3);
  if (Float16Ctor) {
    const half = new Float16Ctor(pixels * 4);
    for (let source = 0, target = 0; source < rgb.length; source += 3) {
      half[target++] = clampHalf(rgb[source]);
      half[target++] = clampHalf(rgb[source + 1]);
      half[target++] = clampHalf(rgb[source + 2]);
      half[target++] = 1;
    }
    return new Uint16Array(half.buffer);
  }
  const out = new Uint16Array(pixels * 4);
  for (let source = 0, target = 0; source < rgb.length; source += 3) {
    out[target++] = floatToHalf(rgb[source]);
    out[target++] = floatToHalf(rgb[source + 1]);
    out[target++] = floatToHalf(rgb[source + 2]);
    out[target++] = 0x3c00;
  }
  return out;
}

/** RGBA float pixels to half-float RGBA with a normalized alpha channel. */
export function rgbaToHalfRgba(rgba: Float32Array): Uint16Array {
  const count = rgba.length;
  if (Float16Ctor) {
    const half = new Float16Ctor(count);
    for (let source = 0, target = 0; source < count; source += 4) {
      half[target++] = clampHalf(rgba[source]);
      half[target++] = clampHalf(rgba[source + 1]);
      half[target++] = clampHalf(rgba[source + 2]);
      half[target++] = 1;
    }
    return new Uint16Array(half.buffer);
  }
  const out = new Uint16Array(count);
  for (let source = 0, target = 0; source < count; source += 4) {
    out[target++] = floatToHalf(rgba[source]);
    out[target++] = floatToHalf(rgba[source + 1]);
    out[target++] = floatToHalf(rgba[source + 2]);
    out[target++] = 0x3c00;
  }
  return out;
}
