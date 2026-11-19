import { open } from "node:fs/promises";
import { extname } from "node:path";
import { inspectSharedFbxFacts } from "./shared-fbx-facts";

const MAX_TEXT_BYTES = 24 * 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_LINE_LENGTH = 1024 * 1024;
const MAX_JSON_RECORDS = 100_000;

type Point = [number, number, number];

export interface SharedModelFacts {
  format: "obj" | "gltf" | "glb" | "fbx" | "unsupported";
  status: "ready" | "limited" | "unsupported";
  /** Counts describe stored geometry, before instancing or subdivision. */
  vertices: number | null;
  triangles: number | null;
  materials: number | null;
  textureImages: number | null;
  uvCoordinates: number | null;
  normals: number | null;
  geometryCount?: number;
  sourceUnits?: { metresPerUnit: number; basis: "FBX UnitScaleFactor" };
  bounds: { min: Point; max: Point; space: "mesh-local"; unit: "metres" | "unknown" } | null;
  materialLibraries: string[];
  mapTypes: string[];
  notes: string[];
}

function empty(format: SharedModelFacts["format"]): SharedModelFacts {
  return {
    format, status: "ready", vertices: null, triangles: null, materials: null,
    textureImages: null, uvCoordinates: null, normals: null, bounds: null,
    materialLibraries: [], mapTypes: [], notes: []
  };
}

function point(value: unknown): Point | null {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === "number" && Number.isFinite(item))
    ? value as Point : null;
}

function include(bounds: { min: Point; max: Point }, value: Point): void {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], value[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], value[axis]);
  }
}

function boundsAccumulator(): { min: Point; max: Point } {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function inspectObj(text: string, signal?: AbortSignal): SharedModelFacts {
  const facts = empty("obj");
  let vertices = 0, triangles = 0, uvCoordinates = 0, normals = 0;
  let invalidGeometry = false, maxIndex = 0, polygonFaces = false;
  const bounds = boundsAccumulator();
  const materials = new Set<string>();
  const libraries = new Set<string>();
  let offset = 0;
  let lines = 0;
  while (offset < text.length) {
    if (++lines % 2048 === 0) signal?.throwIfAborted();
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    if (end - offset > MAX_LINE_LENGTH) throw new Error("An OBJ line exceeds the metadata inspection limit.");
    const line = text.slice(offset, end).trim();
    offset = end + 1;
    if (!line || line.startsWith("#")) continue;
    const match = /^(\S+)[ \t]+(.*)$/.exec(line);
    if (!match) continue;
    const [, kind, content] = match;
    if (kind === "v") {
      const parts = content.split(/\s+/).map(Number);
      let xyz = parts.slice(0, 3) as Point;
      vertices++;
      if (xyz.length !== 3 || xyz.some(value => !Number.isFinite(value))) { invalidGeometry = true; continue; }
      if (parts.length === 4) {
        const weight = parts[3];
        if (!Number.isFinite(weight) || weight === 0) { invalidGeometry = true; continue; }
        xyz = xyz.map(value => value / weight) as Point;
      }
      include(bounds, xyz);
    } else if (kind === "vt") {
      uvCoordinates++;
    } else if (kind === "vn") {
      normals++;
    } else if (kind === "f") {
      const corners = content.replace(/[ \t]+#.*$/, "").trim().split(/\s+/);
      if (corners.length < 3) { invalidGeometry = true; continue; }
      for (const corner of corners) {
        const token = corner.split("/", 1)[0];
        const index = /^[+-]?\d+$/.test(token) ? Number(token) : NaN;
        if (!Number.isSafeInteger(index) || index === 0 || (index < 0 && vertices + index < 0)) invalidGeometry = true;
        if (index > 0) maxIndex = Math.max(maxIndex, index);
      }
      triangles += corners.length - 2;
      polygonFaces ||= corners.length > 3;
    } else if (kind === "usemtl" && content.trim()) {
      materials.add(content.trim());
    } else if (kind === "mtllib" && content.trim()) {
      libraries.add(content.trim());
    }
  }
  signal?.throwIfAborted();
  invalidGeometry ||= maxIndex > vertices;
  facts.vertices = vertices;
  facts.uvCoordinates = uvCoordinates;
  facts.normals = normals;
  facts.materials = materials.size;
  facts.materialLibraries = [...libraries];
  if (!invalidGeometry) {
    facts.triangles = triangles;
    if (vertices) facts.bounds = { ...bounds, space: "mesh-local", unit: "unknown" };
  } else {
    facts.status = "limited";
    facts.notes.push("Invalid vertex coordinates or face references prevent reliable geometry bounds and triangle counts.");
  }
  if (polygonFaces) facts.notes.push("Polygon faces are counted as n−2 triangles. Runtime triangulation can differ for malformed polygons.");
  facts.notes.push("OBJ coordinates have no declared physical unit. Material count describes names assigned by usemtl.");
  if (libraries.size) facts.notes.push("Material libraries are recorded as references. This inspection does not read their textures.");
  return facts;
}

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function records(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_JSON_RECORDS) throw new Error("The glTF metadata has too many records to inspect.");
  return value.map(record);
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function accessorIndex(value: unknown, length: number): number | null {
  const index = count(value);
  return index !== null && index < length ? index : null;
}

function inspectGltf(text: string, format: "gltf" | "glb", signal?: AbortSignal): SharedModelFacts {
  const document = record(JSON.parse(text));
  if (record(document.asset).version !== "2.0") throw new Error("Only glTF 2.0 metadata is supported.");
  const facts = empty(format);
  const accessors = records(document.accessors);
  const meshes = records(document.meshes);
  const materials = records(document.materials);
  const nodes = records(document.nodes);
  const images = records(document.images);
  const bounds = boundsAccumulator();
  const positions = new Set<number>();
  const normals = new Set<number>();
  const uvs = new Set<number>();
  const mapTypes = new Set<string>();
  let triangles = 0, triangleCountKnown = true, boundsKnown = true;
  let primitivesSeen = 0, dynamicGeometry = false;
  const sum = (indices: Set<number>): number | null => {
    let total = 0;
    for (const index of indices) {
      const value = count(accessors[index].count);
      if (value === null) return null;
      total += value;
    }
    return Number.isSafeInteger(total) ? total : null;
  };
  for (const mesh of meshes) {
    signal?.throwIfAborted();
    for (const primitive of records(mesh.primitives)) {
      if (++primitivesSeen > MAX_JSON_RECORDS) throw new Error("The glTF has too many primitives to inspect.");
      const attributes = record(primitive.attributes);
      const position = accessorIndex(attributes.POSITION, accessors.length);
      const normal = accessorIndex(attributes.NORMAL, accessors.length);
      const uv = accessorIndex(attributes.TEXCOORD_0, accessors.length);
      if (position === null || accessors[position].type !== "VEC3") {
        triangleCountKnown = false; boundsKnown = false; continue;
      }
      positions.add(position);
      if (normal !== null) normals.add(normal);
      if (uv !== null) uvs.add(uv);
      const min = point(accessors[position].min), max = point(accessors[position].max);
      if (!min || !max || min.some((value, axis) => value > max[axis])) boundsKnown = false;
      else { include(bounds, min); include(bounds, max); }
      const indexed = primitive.indices !== undefined;
      const index = accessorIndex(primitive.indices, accessors.length);
      const vertexCount = indexed ? index === null ? null : count(accessors[index].count) : count(accessors[position].count);
      const mode = primitive.mode ?? 4;
      if (vertexCount === null) triangleCountKnown = false;
      else if (mode === 4) {
        if (vertexCount % 3 !== 0) triangleCountKnown = false;
        else triangles += vertexCount / 3;
      } else if (mode === 5 || mode === 6) triangles += Math.max(0, vertexCount - 2);
      else if (![0, 1, 2, 3].includes(mode as number)) triangleCountKnown = false;
      dynamicGeometry ||= Array.isArray(primitive.targets) && primitive.targets.length > 0;
    }
  }
  for (const material of materials) {
    const pbr = record(material.pbrMetallicRoughness);
    if (pbr.baseColorTexture) mapTypes.add("basecolor");
    if (pbr.metallicRoughnessTexture) { mapTypes.add("metalness"); mapTypes.add("roughness"); }
    if (material.normalTexture) mapTypes.add("normal");
    if (material.occlusionTexture) mapTypes.add("ao");
    if (material.emissiveTexture) mapTypes.add("emissive");
    if ((material.alphaMode === "MASK" || material.alphaMode === "BLEND") && pbr.baseColorTexture) mapTypes.add("opacity");
  }
  facts.vertices = sum(positions);
  facts.normals = sum(normals);
  facts.uvCoordinates = sum(uvs);
  facts.triangles = triangleCountKnown && Number.isSafeInteger(triangles) ? triangles : null;
  facts.materials = materials.length;
  facts.textureImages = images.length;
  facts.mapTypes = [...mapTypes];
  if (boundsKnown && positions.size) facts.bounds = { ...bounds, space: "mesh-local", unit: "metres" };
  facts.notes.push("glTF bounds use accessor metadata in mesh-local space. Scene transforms and repeated instances are excluded from geometry counts.");
  if (nodes.some(node => node.matrix || node.translation || node.scale || node.rotation)) {
    facts.notes.push("Scene transforms are present. Mesh-local bounds do not describe the assembled scene dimensions.");
  }
  if (dynamicGeometry || records(document.skins).length) facts.notes.push("Morph targets or skinning can change the displayed bounds.");
  if (!boundsKnown || !triangleCountKnown) {
    facts.status = "limited";
    facts.notes.push("Some geometry lacks complete accessor metadata. Unknown facts remain unset.");
  }
  return facts;
}

async function readExactly(file: Awaited<ReturnType<typeof open>>, length: number, offset: number, signal?: AbortSignal): Promise<Buffer> {
  const body = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    signal?.throwIfAborted();
    const read = await file.read(body, total, Math.min(64 * 1024, length - total), offset + total);
    if (!read.bytesRead) throw new Error("The model changed or ended during metadata inspection.");
    total += read.bytesRead;
  }
  return body;
}

/** Inspect bounded metadata without loading geometry buffers, images, DCC plugins or scripts. */
export async function inspectSharedModelFacts(path: string, signal?: AbortSignal): Promise<SharedModelFacts> {
  signal?.throwIfAborted();
  const extension = extname(path).toLowerCase();
  if (extension === ".fbx") return inspectSharedFbxFacts(path, signal);
  if (![".obj", ".gltf", ".glb"].includes(extension)) {
    return { ...empty("unsupported"), status: "unsupported", notes: ["Geometry metadata inspection supports OBJ, binary FBX and glTF 2.0 files."] };
  }
  const format = extension.slice(1) as "obj" | "gltf" | "glb";
  const file = await open(path);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("The model source is no longer a regular file.");
    let offset = 0, length = info.size;
    if (format === "glb") {
      if (info.size < 20) throw new Error("The GLB header is truncated.");
      const header = await readExactly(file, 20, 0, signal);
      if (header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2 ||
          header.readUInt32LE(16) !== 0x4e4f534a || header.readUInt32LE(8) !== info.size) {
        throw new Error("The GLB does not have a valid glTF 2.0 JSON header.");
      }
      offset = 20;
      length = header.readUInt32LE(12);
      if (length % 4 !== 0 || offset + length > info.size) throw new Error("The GLB JSON chunk is invalid.");
    }
    const limit = format === "obj" ? MAX_TEXT_BYTES : MAX_JSON_BYTES;
    if (length > limit) {
      return { ...empty(format), status: "limited", notes: [`This metadata source exceeds the ${limit / 1024 / 1024} MiB inspection limit.`] };
    }
    const body = await readExactly(file, length, offset, signal);
    const text = body.toString("utf8").replace(/^\uFEFF/, "");
    return format === "obj" ? inspectObj(text, signal) : inspectGltf(text, format, signal);
  } finally { await file.close(); }
}
