import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MODEL_IMAGE_EXTENSIONS,
  canonicalModelMapType,
  isRuntimeModelFormat,
  isUnsupportedNativeFormat,
  modelFormatFromExtension,
  modelPartMaterialKey,
  modelTextureMaterialKey,
  preferredTextureFormat,
  resolutionFromText,
  type ModelFormat,
  type ModelManifest,
  type ModelMapType,
  type ModelMeshVariant,
  type ModelTextureVariant
} from "../shared/model-preview";

interface FileInfo {
  path: string;
  name: string;
  relative: string;
  bytes: number;
}

interface CandidateMesh {
  file: FileInfo;
  format: ModelFormat;
  lod: number | null;
  quality: string | null;
  triangles: number | null;
}

const MAX_FILES = 20_000;
const MAX_DEPTH = 8;
const LOD_PATTERN = /(?:^|[^a-z0-9])lod[_\-\s]?(\d+)(?:[^0-9]|$)/i;
const QUALITY_PATTERN = /(?:^|[^a-z0-9])(lq|sq|hq)(?:[^a-z0-9]|$)/i;
const EXCLUDED_TEXTURE = /(?:^|[_\-\s])(preview|thumb|thumbnail|grid|icon|logo|billboard)(?:[_\-\s]|$)/i;

function fileFormatPriority(format: ModelFormat): number {
  if (format === "gltf" || format === "glb") return 0;
  if (format === "usd" || format === "usda" || format === "usdc" || format === "usdz") return 1;
  if (format === "fbx") return 2;
  if (format === "obj") return 3;
  if (format === "stl" || format === "ply" || format === "3mf" || format === "dae") return 4;
  return 9;
}

function lodFromText(value: string): number | null {
  const match = LOD_PATTERN.exec(value);
  if (!match) return null;
  const valueNumber = Number(match[1]);
  return Number.isFinite(valueNumber) ? valueNumber : null;
}

function qualityFromText(value: string): string | null {
  const match = QUALITY_PATTERN.exec(value);
  return match ? match[1].toUpperCase() : null;
}

async function listFiles(root: string): Promise<{ files: FileInfo[]; truncated: boolean }> {
  const files: FileInfo[] = [];
  let truncated = false;
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_DEPTH) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_FILES) { truncated = true; return; }
      const info = await stat(target).catch(() => null);
      if (!info) continue;
      files.push({
        path: target,
        name: entry.name,
        relative: relative(root, target),
        bytes: info.size
      });
    }
  };
  await visit(root, 0);
  return { files, truncated };
}

function textureVariant(file: FileInfo): ModelTextureVariant | null {
  const extension = extname(file.name).toLowerCase();
  if (!MODEL_IMAGE_EXTENSIONS.has(extension)) return null;
  if (EXCLUDED_TEXTURE.test(file.name) || EXCLUDED_TEXTURE.test(file.relative)) return null;
  const { mapType, normalSpace } = canonicalModelMapType(`${file.relative} ${file.name}`);
  if (mapType === "unknown") return null;
  const resolution = resolutionFromText(file.relative) ?? resolutionFromText(file.name);
  return {
    url: pathToFileURL(file.path).href,
    mapType,
    resolution,
    lod: lodFromText(file.relative) ?? lodFromText(file.name),
    materialKey: modelTextureMaterialKey(file.name),
    format: extension.replace(/^\./, ""),
    bytes: file.bytes,
    ...(normalSpace ? { normalSpace } : {})
  };
}

function chooseDefaultTexture(variants: ModelTextureVariant[]): ModelTextureVariant | null {
  return [...variants].sort((a, b) => {
    const resolutionA = a.resolution ?? Number.MAX_SAFE_INTEGER;
    const resolutionB = b.resolution ?? Number.MAX_SAFE_INTEGER;
    if (resolutionA !== resolutionB) return resolutionA - resolutionB;
    const format = preferredTextureFormat(a.format) - preferredTextureFormat(b.format);
    if (format !== 0) return format;
    return a.url.localeCompare(b.url);
  })[0] ?? null;
}

function groupPoliigonMeshes(meshes: ModelMeshVariant[]): ModelMeshVariant[] {
  const groups = new Map<string, ModelMeshVariant[]>();
  for (const mesh of meshes) {
    const key = `${mesh.lod ?? "none"}:${mesh.quality ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(mesh);
    else groups.set(key, [mesh]);
  }
  const output: ModelMeshVariant[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) {
      output.push(group[0]);
      continue;
    }
    output.push({
      ...group[0],
      label: `${group.length} parts`,
      bytes: group.reduce((sum, mesh) => sum + mesh.bytes, 0),
      triangles: group.reduce((sum, mesh) => sum + (mesh.triangles ?? 0), 0) || null,
      parts: group.map(mesh => ({
        url: mesh.url,
        format: mesh.format,
        label: mesh.label,
        materialKey: modelPartMaterialKey(mesh.label),
        ...(mesh.mtlUrl ? { mtlUrl: mesh.mtlUrl } : {})
      })),
      partsLayout: "row"
    });
  }
  return output.sort((a, b) => (a.lod ?? 0) - (b.lod ?? 0) || a.label.localeCompare(b.label));
}

/**
 * Build a runtime manifest for a local library folder. It deliberately does
 * not parse unsupported DCC formats; those are reported so the drawer can show
 * a useful "download-only" message instead of a failed canvas.
 */
export async function scanLocalModel(
  root: string,
  assetId: string,
  provider: string,
  type: string
): Promise<ModelManifest> {
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error("The local asset folder is not available.");
  const { files, truncated } = await listFiles(root);
  const candidates: CandidateMesh[] = [];
  const unsupported: ModelManifest["unsupported"] = [];
  const textureVariants: ModelTextureVariant[] = [];

  for (const file of files) {
    const extension = extname(file.name).toLowerCase();
    const format = modelFormatFromExtension(extension);
    if (format) {
      if (isRuntimeModelFormat(format)) {
        candidates.push({
          file,
          format,
          lod: lodFromText(file.relative),
          quality: qualityFromText(file.relative),
          triangles: null
        });
      } else if (isUnsupportedNativeFormat(format) || format === "abc") {
        unsupported.push({
          format,
          url: pathToFileURL(file.path).href,
          reason: format === "abc"
            ? "Alembic geometry cache; a glTF/FBX/OBJ/ USD runtime mesh is required for the viewer."
            : "Native DCC file; download a glTF/FBX/OBJ/USD runtime variant to preview."
        });
      }
      continue;
    }
    const texture = textureVariant(file);
    if (texture) textureVariants.push(texture);
  }

  const bestFormat = [...candidates].sort((a, b) =>
    fileFormatPriority(a.format) - fileFormatPriority(b.format)
    || a.file.relative.localeCompare(b.file.relative)
  )[0]?.format;

  // OBJ materials live beside the mesh. Include the first matching sidecar.
  const mtlByBase = new Map(files
    .filter(file => extname(file.name).toLowerCase() === ".mtl")
    .map(file => [file.name.replace(/\.mtl$/i, "").toLowerCase(), pathToFileURL(file.path).href]));

  const meshes: ModelMeshVariant[] = candidates
    .filter(candidate => candidate.format === bestFormat)
    .map(candidate => {
      const base = candidate.file.name.replace(/\.[^.]+$/, "").toLowerCase();
      return {
        url: pathToFileURL(candidate.file.path).href,
        format: candidate.format,
        label: candidate.file.name,
        lod: candidate.lod,
        quality: candidate.quality,
        bytes: candidate.file.bytes,
        triangles: candidate.triangles,
        ...(candidate.format === "obj" && mtlByBase.has(base) ? { mtlUrl: mtlByBase.get(base)! } : {})
      };
    });

  // Prefer one mesh per LOD, but keep all variants when filenames do not carry
  // LOD information (e.g. a single glTF/OBJ mesh).
  const dedupedMeshes = [...new Map(meshes.map(mesh => [`${mesh.lod ?? "none"}:${mesh.quality ?? ""}:${mesh.url}`, mesh])).values()]
    .sort((a, b) => (a.lod ?? 0) - (b.lod ?? 0) || a.label.localeCompare(b.label));

  // Poliigon Generic packages can ship a collection as several geometry files
  // at the same LOD. Treat same-LOD files as an assembly, not as alternatives.
  const groupedMeshes = provider === "poliigon" ? groupPoliigonMeshes(dedupedMeshes) : dedupedMeshes;

  const defaultMesh = groupedMeshes.reduce<ModelMeshVariant | null>((selected, mesh) => {
    if (!selected) return mesh;
    if (mesh.lod === null) return selected;
    if (selected.lod === null) return mesh;
    return mesh.lod > selected.lod ? mesh : selected;
  }, null) ?? groupedMeshes[0] ?? null;

  const textureMapTypes = [...new Set(textureVariants.map(texture => texture.mapType))];
  const availableQualities = [...new Set(textureVariants
    .map(texture => texture.resolution)
    .filter((value): value is number => typeof value === "number" && value > 0))]
    .sort((a, b) => a - b);
  const availableLods = [...new Set(groupedMeshes
    .map(mesh => mesh.lod)
    .filter((value): value is number => typeof value === "number"))]
    .sort((a, b) => a - b);
  const alpha = /plant|foliage|leaf|leaves/i.test(type)
    || textureMapTypes.includes("opacity")
    || files.some(file => /alpha|opacity|mask|billboard/i.test(file.name));
  const notes: string[] = [];
  if (truncated) notes.push("The folder scan was truncated; only the first files were indexed.");
  if (groupedMeshes.length === 0) {
    notes.push(unsupported.some(item => item.format === "abc")
      ? "This asset contains an Alembic mesh but no runtime FBX/glTF/OBJ/USD mesh. Download a runtime format to preview."
      : "No runtime 3D mesh was found. Download a glTF/FBX/OBJ/USD version to preview.");
  }
  if (!textureVariants.length) notes.push("No browser-readable texture maps were found; the model will use a neutral material.");

  return {
    assetId,
    provider,
    name: assetId,
    source: "local",
    meshes: groupedMeshes,
    textures: textureVariants,
    defaultMesh,
    availableQualities,
    availableLods,
    alpha,
    notes,
    unsupported
  };
}
