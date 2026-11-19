import { open } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import type { SharedModelFacts } from "./shared-model-facts";

// Budgets apply to all selected nodes together, including decompressed arrays.
const MAX_READ = 32 * 1024 * 1024;
const MAX_ARRAY = 8 * 1024 * 1024;
const MAX_DECODED = 24 * 1024 * 1024;
const MAX_NODES = 100_000;
const MAX_DEPTH = 48;
const MAX_STRING = 64 * 1024;
type Point = [number, number, number];
type Geometry = { vertices: number | null; verticesDecoded: boolean; triangles: number | null; maxIndex: number; normals: number | null; uvs: number | null; bounds: { min: Point; max: Point } | null };
class InspectionLimit extends Error {}

/** Selectively inspect binary FBX source records; never load plugins, image data or animation arrays. */
export async function inspectSharedFbxFacts(path: string, signal?: AbortSignal): Promise<SharedModelFacts> {
  const facts: SharedModelFacts = { format: "fbx", status: "ready", vertices: null, triangles: null,
    materials: null, textureImages: null, uvCoordinates: null, normals: null, bounds: null,
    materialLibraries: [], mapTypes: [], notes: [] };
  const file = await open(path);
  let bytesRead = 0, decoded = 0, nodes = 0;
  let materials = 0, images = 0;
  const geometries: Geometry[] = [];
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("The FBX source is no longer a regular file.");
    async function read(offset: number, size: number): Promise<Buffer> {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > info.size) throw new Error("Invalid or truncated FBX record.");
      if (bytesRead + size > MAX_READ) throw new InspectionLimit("FBX metadata exceeds the 32 MiB source-read budget.");
      bytesRead += size;
      const buffer = Buffer.alloc(size);
      let done = 0;
      while (done < size) {
        signal?.throwIfAborted();
        const result = await file.read(buffer, done, Math.min(size - done, 65536), offset + done);
        if (!result.bytesRead) throw new Error("The FBX changed or ended during inspection.");
        done += result.bytesRead;
      }
      return buffer;
    }
    if (info.size < 27) throw new Error("The FBX header is truncated.");
    const header = await read(0, 27);
    if (header.subarray(0, 23).toString("binary") !== "Kaydara FBX Binary  \0\x1a\0") {
      facts.status = "limited";
      facts.notes.push("FBX source inspection currently supports binary FBX only. ASCII FBX remains available in the 3D viewer.");
      return facts;
    }
    const version = header.readUInt32LE(23);
    if (version < 6100 || version > 7700) throw new Error("The binary FBX version is outside the supported metadata range.");
    const wide = version >= 7500, headerSize = wide ? 25 : 13;
    const integer = (buffer: Buffer, at: number): number => {
      const value = wide ? Number(buffer.readBigUInt64LE(at)) : buffer.readUInt32LE(at);
      if (!Number.isSafeInteger(value)) throw new Error("An FBX record offset exceeds the supported integer range.");
      return value;
    };
    async function properties(start: number, end: number, count: number, arrays: boolean): Promise<unknown[]> {
      const values: unknown[] = [];
      let cursor = start;
      if (count > 16) throw new Error("Unexpected FBX metadata property count.");
      async function take(size: number): Promise<Buffer> {
        if (cursor + size > end) throw new Error("An FBX property exceeds its declared record.");
        const result = await read(cursor, size); cursor += size; return result;
      }
      for (let i = 0; i < count; i++) {
        const type = (await take(1)).toString();
        if (type === "S" || type === "R") {
          const length = (await take(4)).readUInt32LE();
          if (length > MAX_STRING) throw new InspectionLimit("An FBX metadata string exceeds the inspection limit.");
          values.push((await take(length)).toString("utf8"));
        } else if ("YCFDIL".includes(type)) {
          const size = ({ Y: 2, C: 1, F: 4, D: 8, I: 4, L: 8 } as Record<string, number>)[type];
          const data = await take(size);
          values.push(type === "D" ? data.readDoubleLE() : type === "F" ? data.readFloatLE() : type === "L" ? Number(data.readBigInt64LE()) : type === "I" ? data.readInt32LE() : type === "Y" ? data.readInt16LE() : data[0]);
        } else if ("dfilbc".includes(type)) {
          const array = await take(12);
          const length = array.readUInt32LE(), encoding = array.readUInt32LE(4), packed = array.readUInt32LE(8);
          const width = type === "d" || type === "l" ? 8 : type === "f" || type === "i" ? 4 : 1;
          const size = length * width;
          if (!arrays || ![0, 1].includes(encoding) || (encoding === 0 && packed !== size)) throw new Error("Invalid FBX metadata array encoding.");
          if (size > MAX_ARRAY || packed > MAX_ARRAY || decoded + size > MAX_DECODED) {
            if (cursor + packed > end) throw new Error("An FBX array exceeds its declared record.");
            cursor += packed; // retain unrelated metadata without reading or allocating the large array
            facts.status = "limited";
            const note = "Some FBX geometry exceeds the bounded array-decompression budget. Stored vertex, normal and UV counts use declared array headers; skipped array contents are not decoded or validated. Their bounds and triangle counts remain unknown.";
            if (!facts.notes.includes(note)) facts.notes.push(note);
            values.push({ type, length, data: null });
            continue;
          }
          decoded += size;
          const source = await take(packed);
          const data = encoding === 0 ? source : inflateSync(source, { maxOutputLength: Math.max(size, 1) });
          if (data.length !== size) throw new Error("An FBX array has an inconsistent decoded length.");
          values.push({ type, length, data });
        } else throw new Error("Unsupported FBX metadata property type.");
      }
      if (cursor !== end) throw new Error("An FBX property list has an inconsistent length.");
      return values;
    }
    async function visit(start: number, parentEnd: number, depth: number, parent: string, geometry?: Geometry): Promise<number> {
      if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new InspectionLimit("FBX metadata exceeds the node or nesting budget.");
      const raw = await read(start, headerSize);
      const end = integer(raw, 0), count = integer(raw, wide ? 8 : 4), propertyBytes = integer(raw, wide ? 16 : 8);
      if (end === 0) {
        if (raw.some(value => value !== 0)) throw new Error("Invalid FBX null record.");
        if (parent && start + headerSize !== parentEnd) throw new Error("An FBX null record ends its parent prematurely.");
        return parentEnd;
      }
      const nameSize = raw[headerSize - 1];
      const propertyStart = start + headerSize + nameSize, propertyEnd = propertyStart + propertyBytes;
      if (end <= start || end > parentEnd || propertyEnd > end || !Number.isSafeInteger(propertyEnd)) throw new Error("Invalid FBX node boundaries.");
      const name = (await read(start + headerSize, nameSize)).toString("utf8");
      const selected = parent === "" ? ["Objects", "GlobalSettings"].includes(name)
        : parent === "Objects" ? ["Geometry", "Material", "Video"].includes(name)
        : parent === "GlobalSettings" ? name === "Properties70"
        : parent === "Properties70" ? name === "P"
        : parent === "Geometry" ? ["Vertices", "PolygonVertexIndex", "LayerElementNormal", "LayerElementUV"].includes(name)
        : parent === "LayerElementNormal" ? name === "Normals"
        : parent === "LayerElementUV" ? name === "UV" : false;
      if (!selected) return end;
      let current = geometry;
      if (parent === "Objects" && name === "Geometry") {
        const props = await properties(propertyStart, propertyEnd, count, false);
        if (props[2] !== "Mesh") return end;
        current = { vertices: null, verticesDecoded: false, triangles: null, maxIndex: -1, normals: 0, uvs: 0, bounds: null };
        geometries.push(current);
      } else if (parent === "Objects" && name === "Material") { materials++; return end; }
      else if (parent === "Objects" && name === "Video") { images++; return end; }
      else if (parent === "Properties70" && name === "P") {
        const props = await properties(propertyStart, propertyEnd, count, false);
        if (props[0] === "UnitScaleFactor") {
          const centimetresPerUnit = props[4];
          if (typeof centimetresPerUnit === "number" && Number.isFinite(centimetresPerUnit) && centimetresPerUnit / 100 > 0)
            facts.sourceUnits = { metresPerUnit: centimetresPerUnit / 100, basis: "FBX UnitScaleFactor" };
        }
        return end;
      } else if (current && ["Vertices", "PolygonVertexIndex", "Normals", "UV"].includes(name)) {
        const props = await properties(propertyStart, propertyEnd, count, true);
        const array = props[0] as { type: string; length: number; data: Buffer | null } | undefined;
        if (props.length !== 1 || !array || array.data === undefined) throw new Error("Invalid FBX geometry array.");
        if (name === "PolygonVertexIndex" ? array.type !== "i" : !["d", "f"].includes(array.type) || array.length % (name === "UV" ? 2 : 3)) {
          throw new Error("Invalid FBX coordinate or polygon-index array declaration.");
        }
        if (array.data === null) {
          if (name === "Vertices") current.vertices = array.length / 3;
          if (name === "Normals" && current.normals !== null) current.normals += array.length / 3;
          if (name === "UV" && current.uvs !== null) current.uvs += array.length / 2;
          return end;
        }
        if (name === "PolygonVertexIndex") {
          if (array.type !== "i") throw new Error("Invalid FBX polygon-index array type.");
          let corners = 0, triangles = 0;
          for (let i = 0; i < array.length; i++) {
            if (i % 16384 === 0) signal?.throwIfAborted();
            const value = array.data.readInt32LE(i * 4);
            current.maxIndex = Math.max(current.maxIndex, value < 0 ? ~value : value);
            corners++;
            if (value < 0) {
              if (corners < 3) throw new Error("An FBX polygon has fewer than three vertices.");
              triangles += corners - 2; corners = 0;
            }
          }
          if (corners) throw new Error("An FBX polygon-index array has an unterminated face.");
          current.triangles = triangles;
        } else {
          if (!["d", "f"].includes(array.type)) throw new Error("Invalid FBX coordinate array type.");
          const width = array.type === "d" ? 8 : 4, dimensions = name === "UV" ? 2 : 3;
          if (array.length % dimensions) throw new Error("An FBX coordinate array has an inconsistent length.");
          if (name === "Normals" && current.normals !== null) current.normals += array.length / 3;
          else if (name === "UV" && current.uvs !== null) current.uvs += array.length / 2;
          else if (name === "Normals" || name === "UV") return end;
          else {
            current.vertices = array.length / 3;
            current.verticesDecoded = true;
            const bounds = { min: [Infinity, Infinity, Infinity] as Point, max: [-Infinity, -Infinity, -Infinity] as Point };
            for (let i = 0; i < array.length; i++) {
              if (i % 16384 === 0) signal?.throwIfAborted();
              const value = width === 8 ? array.data.readDoubleLE(i * width) : array.data.readFloatLE(i * width);
              if (!Number.isFinite(value)) throw new Error("An FBX vertex coordinate is not finite.");
              const axis = i % 3; bounds.min[axis] = Math.min(bounds.min[axis], value); bounds.max[axis] = Math.max(bounds.max[axis], value);
            }
            if (current.vertices) current.bounds = bounds;
          }
        }
        return end;
      }
      let cursor = propertyEnd;
      while (cursor + headerSize <= end) cursor = await visit(cursor, end, depth + 1, name, current);
      if (cursor !== end) throw new Error("An FBX node has an incomplete child record.");
      return end;
    }
    let cursor = 27;
    while (cursor + headerSize <= info.size) {
      const next = await visit(cursor, info.size, 0, "");
      if (next === info.size) break; // top-level null record precedes the footer
      cursor = next;
    }
    facts.geometryCount = geometries.length;
    facts.materials = materials; facts.textureImages = images;
    facts.vertices = geometries.every(item => item.vertices !== null) ? geometries.reduce((sum, item) => sum + item.vertices!, 0) : null;
    facts.triangles = geometries.every(item => item.verticesDecoded && item.vertices !== null && item.triangles !== null && item.maxIndex < item.vertices) ? geometries.reduce((sum, item) => sum + item.triangles!, 0) : null;
    facts.normals = geometries.every(item => item.normals !== null) ? geometries.reduce((sum, item) => sum + item.normals!, 0) : null;
    facts.uvCoordinates = geometries.every(item => item.uvs !== null) ? geometries.reduce((sum, item) => sum + item.uvs!, 0) : null;
    if (geometries.length && geometries.every(item => item.bounds)) {
      const min: Point = [Infinity, Infinity, Infinity], max: Point = [-Infinity, -Infinity, -Infinity];
      for (const item of geometries) for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], item.bounds!.min[axis]); max[axis] = Math.max(max[axis], item.bounds!.max[axis]);
      }
      facts.bounds = { min, max, space: "mesh-local", unit: "unknown" };
    }
    if (facts.vertices === null || facts.triangles === null) facts.status = "limited";
  } catch (error) {
    signal?.throwIfAborted();
    facts.status = "limited";
    facts.notes.push(error instanceof Error ? error.message : "FBX metadata inspection failed.");
  } finally { await file.close(); }
  facts.notes.push("FBX counts describe stored mesh geometry, excluding scene transforms, repeated instances, skinning and subdivision. Polygon faces use n−2 triangles.");
  facts.notes.push("FBX bounds remain in mesh-local source coordinates. UnitScaleFactor, when present, separately specifies metres per source unit. Material and image counts describe stored Material and Video records; texture channel assignments are not inferred.");
  return facts;
}
