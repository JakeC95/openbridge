import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { basename, extname, join } from "node:path";
import type { AssetJson, AssetRecord, ExportAsset, ExportComponent } from "../shared/types";

const MAP_ALIASES: Record<string, string[]> = {
  albedo: ["albedo", "al", "color", "col", "basecolor", "ba", "txtr"],
  ao: ["ao"],
  brush: ["brush"],
  bump: ["bump"],
  cavity: ["cavity"],
  diffuse: ["diffuse", "diff"],
  displacement: ["displacement", "disp"],
  emission: ["emission"],
  fuzz: ["fuzz"],
  gloss: ["gloss"],
  mask: ["mask"],
  metalness: ["metalness", "metal", "me"],
  normal: ["normal_lod", "normal", "nor", "nrm", "no"],
  normalbump: ["normalbump"],
  opacity: ["opacity", "opac"],
  roughness: ["roughness", "rough", "rgh", "ro"],
  specular: ["specular", "spec", "refl", "reflection"],
  translucency: ["translucency"],
  transmission: ["transmission"]
};

function guessMapType(file: string): string | null {
  const lower = basename(file).toLowerCase();
  for (const [type, aliases] of Object.entries(MAP_ALIASES)) {
    for (const alias of aliases) {
      if (lower.includes(`_${alias}`) || lower.startsWith(alias)) return type;
    }
  }
  return null;
}

function resolutionFromName(file: string): string {
  const match = basename(file).toLowerCase().match(/_(256|512|1k|2k|4k|8k|16k)(?:_|\.)/);
  if (!match) return "8192";
  const token = match[1];
  if (!token) return "8192";
  return token.endsWith("k") ? String(Number.parseInt(token, 10) * 1024) : token;
}

function lodFromName(file: string): string {
  const match = basename(file).toLowerCase().match(/lod(\d+)/);
  return match ? `lod${match[1]}` : "lod0";
}

function isMesh(file: string): boolean {
  return /\.(fbx|obj|abc|usd|usdz|gltf|glb)$/i.test(file);
}

function isTexture(file: string): boolean {
  return /\.(jpg|jpeg|png|exr|tif|tiff|tga)$/i.test(file);
}

async function walk(dir: string, output: string[] = []): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return output;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const info = await stat(full);
      if (info.isDirectory()) await walk(full, output);
      else output.push(full);
    } catch {
      // ignore
    }
  }
  return output;
}

function exportName(asset: AssetRecord, file: string, resolution: string): string {
  const extension = extname(file).replace(".", "").toLowerCase();
  const mapName = guessMapType(file) ?? basename(file, extname(file));
  return `${asset.id}_${mapName}_${resolution}.${extension}`;
}

function folderName(asset: AssetRecord): string {
  return `${asset.id}_${asset.name}`.replace(/[\\/:*?"<>|]+/g, "_");
}

function componentFor(asset: AssetRecord, file: string, type: string): ExportComponent {
  const resolution = resolutionFromName(file);
  return {
    type,
    format: extname(file).replace(".", "").toLowerCase(),
    resolution,
    name: basename(file),
    nameOverride: exportName(asset, file, resolution),
    path: file,
    colorSpace: type === "normal" || type === "roughness" || type === "metalness" || type === "ao"
      ? "Linear"
      : "sRGB",
    physicalSize: "1x1",
    textureSets: ["default"],
    channelsData: []
  };
}

async function readJson(path: string): Promise<AssetJson> {
  try {
    return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, "")) as AssetJson;
  } catch {
    return {};
  }
}

export async function buildExportAsset(
  asset: AssetRecord,
  exportPath: string
): Promise<ExportAsset> {
  const json = await readJson(asset.jsonPath);
  const files = await walk(asset.path);
  const textures = files.filter(file => isTexture(file) && guessMapType(file));
  const billboards = files.filter(
    file => isTexture(file) && file.toLowerCase().includes(`${join("textures", "billboard")}`.toLowerCase())
  );
  const meshes = files.filter(isMesh);

  const components: ExportComponent[] = [];
  const seenTypes = new Set<string>();
  for (const file of textures) {
    const type = guessMapType(file);
    if (!type || seenTypes.has(type)) continue;
    seenTypes.add(type);
    components.push(componentFor(asset, file, type));
  }

  const meshList: ExportComponent[] = meshes.map(file => ({
    type: "model",
    format: extname(file).replace(".", "").toLowerCase(),
    resolution: "",
    name: basename(file),
    nameOverride: basename(file),
    path: file
  }));

  const lodList: ExportComponent[] = meshes
    .filter(file => /lod\d+/i.test(file))
    .map(file => ({
      type: "model",
      lod: lodFromName(file),
      variation: 1,
      format: extname(file).replace(".", "").toLowerCase(),
      resolution: "",
      name: basename(file),
      nameOverride: basename(file),
      lodObjectName: `${asset.id}_${lodFromName(file)}`,
      path: file
    }));

  const categories = asset.categories;
  const tags = asset.tags;
  const firstComponent = components[0];
  const firstMesh = meshList[0];
  const firstLod = lodList[0];
  const textureFormat: string = firstComponent ? firstComponent.format : "jpg";
  const meshFormat: string = firstMesh ? firstMesh.format : "";
  const firstResolution: string = firstComponent ? firstComponent.resolution : "8192";
  const activeLOD: string = firstLod ? String(firstLod.lod ?? "lod0") : "lod0";

  return {
    message: "export",
    version: 1,
    id: asset.id,
    name: asset.name,
    type: asset.type,
    category: typeof json.type === "string" ? json.type : asset.type,
    path: asset.path,
    exportPath,
    resolution: firstResolution,
    resolutionValue: Number.parseInt(firstResolution, 10) || 8192,
    textureFormat,
    meshFormat,
    exportAs: "default",
    activeLOD,
    minLOD: activeLOD,
    previewImage: asset.preview,
    averageColor: json.averageColor ?? null,
    tags,
    categories,
    meta: json.meta ?? [],
    materials: json.materials ?? {},
    textureSets: json.textureSets ?? {},
    workflow: "specular",
    origin:
      typeof json.origin === "string"
        ? json.origin
        : asset.repo === "custom"
          ? "mixer-created"
          : "megascans",
    variation: 1,
    isModularAsset: tags.includes("3d-mod-window"),
    isExternal: Boolean(json.isExternal) || asset.repo === "custom",
    guid: randomUUID(),
    namingConvention: "$id_$mapName_$resolution",
    folderNamingConvention: folderName(asset),
    mapNameOverride: Object.fromEntries(
      Object.keys(MAP_ALIASES).map(type => [type, type])
    ),
    components,
    meshList,
    lodList,
    meshVersion: existsSync(join(asset.path, "Var1")) ? 2 : 1,
    packedTextures: [],
    "components-billboard": billboards.map(file => ({
      type: guessMapType(file) ?? "billboard",
      format: extname(file).replace(".", "").toLowerCase(),
      resolution: resolutionFromName(file),
      name: basename(file),
      nameOverride: basename(file),
      path: file
    })),
    "packed-billboard": []
  };
}

export async function writeMegascansJson(folder: string, assets: ExportAsset[]): Promise<string> {
  await mkdir(folder, { recursive: true });
  const target = join(folder, "megascansAsset.json");
  await writeFile(target, JSON.stringify(assets, null, 2), "utf8");
  return target;
}

export function sendToSocket(
  port: number,
  assets: ExportAsset[],
  timeoutMs = 5000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const payload = JSON.stringify(assets);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to 127.0.0.1:${port}`));
    }, timeoutMs);

    socket.on("connect", () => {
      socket.end(payload, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
