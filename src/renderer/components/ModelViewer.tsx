import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { USDLoader } from "three/addons/loaders/USDLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import type { ModelManifest, ModelLodMode, ModelMeshVariant, ModelTextureVariant, ModelMapType } from "../../shared/model-preview";
import { modelLodLabel, modelQualityLabel, normalizeModelMaterialKey, preferredTextureFormat } from "../../shared/model-preview";
import environmentUrl from "../assets/monochrome_studio_02_1k.hdr";
import { CloseIcon } from "../icons";
import { useModalFocus } from "../use-modal-focus";
import { surfaceManifest, type SurfacePreviewMap } from "../surface-preview";

type MaterialSlot = {
  mapType: ModelMapType;
  variant: ModelTextureVariant;
};

function textureFormatRank(format: string, mapType: ModelMapType): number {
  const lower = format.toLowerCase();
  if (["basecolor", "emissive", "displacement", "opacity", "translucency"].includes(mapType)) {
    // Masks and bump/displacement previews do not need EXR and are more
    // reliable as 8-bit images; some single-channel EXRs are unsupported.
    return preferredTextureFormat(lower);
  }
  if (lower === "exr" || lower === "tif" || lower === "tiff") return 0;
  if (lower === "png") return 1;
  if (lower === "webp") return 2;
  if (lower === "jpg" || lower === "jpeg") return 3;
  return 4;
}

function chooseVariant(
  variants: ModelTextureVariant[],
  quality: number,
  meshLod: number | null,
  mapType: ModelMapType
): ModelTextureVariant | null {
  if (!variants.length) return null;
  const generic = variants.filter(variant => variant.lod === null);
  let lodPool: ModelTextureVariant[];
  if (meshLod === null) {
    lodPool = generic.length ? generic : variants;
  } else {
    const exact = variants.filter(variant => variant.lod === meshLod);
    if (exact.length) {
      lodPool = exact;
    } else if (generic.length) {
      // A generic source map is usually the full-resolution master and is a
      // better fallback than a differently numbered LOD map.
      lodPool = generic;
    } else {
      const distance = Math.min(...variants.map(variant => Math.abs((variant.lod ?? meshLod) - meshLod)));
      lodPool = variants.filter(variant => Math.abs((variant.lod ?? meshLod) - meshLod) === distance);
    }
  }
  const byResolution = (items: ModelTextureVariant[]): ModelTextureVariant[] => [...items].sort((a, b) => {
    const resolutionA = a.resolution ?? Number.MAX_SAFE_INTEGER;
    const resolutionB = b.resolution ?? Number.MAX_SAFE_INTEGER;
    if (resolutionA !== resolutionB) return resolutionA - resolutionB;
    const format = textureFormatRank(a.format, mapType) - textureFormatRank(b.format, mapType);
    return format !== 0 ? format : a.url.localeCompare(b.url);
  });
  const pick = (items: ModelTextureVariant[]): ModelTextureVariant | null => {
    const sorted = byResolution(items);
    return sorted.find(variant => variant.normalSpace !== "dx") ?? sorted[0] ?? null;
  };
  const exactResolution = lodPool.filter(variant => variant.resolution === quality);
  if (exactResolution.length) return pick(exactResolution);
  const lower = lodPool.filter(variant => variant.resolution !== null && variant.resolution < quality);
  if (lower.length) {
    const highest = Math.max(...lower.map(variant => variant.resolution ?? 0));
    return pick(lower.filter(variant => variant.resolution === highest));
  }
  return pick(lodPool);
}

function chooseMesh(manifest: ModelManifest, lod: ModelLodMode): ModelMeshVariant | null {
  if (!manifest.meshes.length) return null;
  if (typeof lod === "number") {
    return manifest.meshes.find(mesh => mesh.lod === lod) ?? manifest.defaultMesh ?? manifest.meshes[0];
  }
  if (manifest.meshes.every(mesh => mesh.lod === null)) return manifest.meshes[0];
  const sorted = [...manifest.meshes].sort((a, b) => (a.lod ?? 0) - (b.lod ?? 0));
  return lod === "highest" ? sorted[0] : sorted[sorted.length - 1];
}

function selectedTextures(
  manifest: ModelManifest,
  quality: number,
  meshLod: number | null,
  materialKey?: string
): Record<string, MaterialSlot> {
  const wanted = normalizeModelMaterialKey(materialKey);
  const output: Record<string, MaterialSlot> = {};
  for (const mapType of ["basecolor", "normal", "roughness", "metalness", "ao", "orm", "opacity", "emissive", "specular", "gloss", "displacement", "translucency"] as ModelMapType[]) {
    const all = manifest.textures.filter(texture => texture.mapType === mapType);
    let variants = all;
    if (wanted) {
      const exact = all.filter(texture => normalizeModelMaterialKey(texture.materialKey) === wanted);
      const generic = all.filter(texture => !texture.materialKey);
      // Never borrow another material's map. A missing trunk mask must not
      // fall back to the needle mask, and a pot must not receive a leaf alpha.
      variants = exact.length ? exact : generic;
    }
    const variant = chooseVariant(variants, quality, meshLod, mapType);
    if (variant) output[mapType] = { mapType, variant };
  }
  // Keep every published map here. The PBR material decides which maps to use,
  // while the inspector exposes all of them as standalone channel views.
  return output;
}

/** Automatic full-screen upgrades stop at 250 MB so an 8K texture set cannot silently start a multi-GB transfer. */
const FULLSCREEN_AUTO_QUALITY_BUDGET = 250 * 1024 * 1024;
const FULLSCREEN_AUTO_TEXTURE_BUDGET = 512 * 1024 * 1024;

function estimateQualityCosts(manifest: ModelManifest, quality: number, lod: ModelLodMode) {
  const mesh = chooseMesh(manifest, lod);
  let bytes = mesh?.bytes ?? 0;
  let textureBytes = 0;
  const seen = new Set<string>();
  const keys = [...new Set(manifest.textures
    .map(texture => texture.materialKey)
    .filter((key): key is string => Boolean(key)))];
  for (const key of keys.length ? keys : [undefined]) {
    for (const slot of Object.values(selectedTextures(manifest, quality, mesh?.lod ?? null, key))) {
      if (seen.has(slot.variant.url)) continue;
      seen.add(slot.variant.url);
      const base = slot.variant.bytes;
      // Estimate mipmapped sidecars, conservatively treating maps as square.
      // Embedded textures and driver overhead are not in the manifest.
      const edge = Math.max(quality, slot.variant.resolution ?? 0);
      const bytesPerPixel = slot.variant.format.toLowerCase() === "exr" ? 8 : 4;
      textureBytes += edge * edge * bytesPerPixel * 4 / 3;
      if (!base) continue;
      const actual = slot.variant.resolution;
      bytes += actual && quality > actual
        ? base * Math.pow(quality / actual, 2)
        : base;
    }
  }
  return { bytes, textureBytes };
}

function chooseAutoFullscreenQuality(
  manifest: ModelManifest,
  lod: ModelLodMode,
  currentQuality: number
): { quality: number; note: string } {
  const options = [...new Set(manifest.availableQualities.filter(value => value > 0))].sort((a, b) => a - b);
  // Full screen upgrades to 4K only; 8K stays an explicit user choice even
  // when a small mesh would keep the transfer under the automatic budget.
  const automatic = options.filter(value => {
    if (value <= currentQuality || value > 4096) return false;
    const { bytes, textureBytes } = estimateQualityCosts(manifest, value, lod);
    return bytes <= FULLSCREEN_AUTO_QUALITY_BUDGET && textureBytes <= FULLSCREEN_AUTO_TEXTURE_BUDGET;
  });
  if (automatic.length) return { quality: automatic[automatic.length - 1], note: "" };
  if (options.some(value => value > currentQuality)) {
    return {
      quality: currentQuality,
      note: "Higher quality is available manually. Automatic upgrades stop at 4K and stay within the estimated transfer and texture memory budgets."
    };
  }
  return { quality: options[options.length - 1] ?? currentQuality, note: "" };
}

async function loadTexture(url: string, format: string, color: boolean, manager: THREE.LoadingManager, flipY = true): Promise<THREE.Texture> {
  const lower = format.toLowerCase();
  let texture: THREE.Texture;
  if (lower === "exr") {
    const loader = new EXRLoader(manager);
    const result = await loader.loadAsync(url);
    texture = result;
    texture.type = THREE.HalfFloatType;
  } else if (lower === "tga") {
    texture = await new TGALoader(manager).loadAsync(url);
  } else {
    texture = await new THREE.TextureLoader(manager).loadAsync(url);
  }
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  // glTF textures are sampled with flipY=false by GLTFLoader. Separately
  // downloaded sidecars (notably foliage alpha sheets) must match the rest of
  // the material's textures or the cutout is vertically mirrored.
  texture.flipY = flipY;
  texture.needsUpdate = true;
  return texture;
}

interface LoadedMaps {
  baseColor: THREE.Texture | null;
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
  metalness: THREE.Texture | null;
  ao: THREE.Texture | null;
  orm: THREE.Texture | null;
  opacity: THREE.Texture | null;
  emissive: THREE.Texture | null;
  specular: THREE.Texture | null;
  gloss: THREE.Texture | null;
  displacement: THREE.Texture | null;
  translucency: THREE.Texture | null;
}

function emptyLoadedMaps(): LoadedMaps {
  return {
    baseColor: null,
    normal: null,
    roughness: null,
    metalness: null,
    ao: null,
    orm: null,
    opacity: null,
    emissive: null,
    specular: null,
    gloss: null,
    displacement: null,
    translucency: null
  };
}

function materialKeyForObject(object: THREE.Object3D): string {
  let current: THREE.Object3D | null = object;
  while (current) {
    const key = current.userData.materialKey;
    if (typeof key === "string" && key) return key;
    current = current.parent;
  }
  return "";
}

/** Every distinct material prefix published alongside this mesh. */
function modelMaterialKeys(manifest: ModelManifest): string[] {
  const keys = new Map<string, string>();
  for (const texture of manifest.textures) {
    if (!texture.materialKey) continue;
    const normalized = normalizeModelMaterialKey(texture.materialKey);
    if (normalized && !keys.has(normalized)) keys.set(normalized, texture.materialKey);
  }
  return [...keys.values()];
}

function matchModelMaterialKey(candidates: string[], keys: string[]): string {
  if (!keys.length) return "";
  const normalized = keys
    .map(key => ({ key, normalized: normalizeModelMaterialKey(key) }))
    .filter(item => item.normalized)
    .sort((a, b) => b.normalized.length - a.normalized.length);
  for (const candidate of candidates) {
    const value = normalizeModelMaterialKey(candidate);
    if (!value) continue;
    const exact = normalized.find(item => item.normalized === value);
    if (exact) return exact.key;
    const partial = normalized.find(item =>
      Math.min(item.normalized.length, value.length) >= 4
      && (value.includes(item.normalized) || item.normalized.includes(value))
    );
    if (partial) return partial.key;
  }
  return "";
}

function materialCandidates(object: THREE.Object3D, source: THREE.Material): string[] {
  const candidates: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.trim() && !candidates.includes(value)) candidates.push(value);
  };
  // Source material names distinguish slots when one mesh carries an array of
  // materials; the part key is only a fallback for generic DCC names.
  add(source.name);
  add(object.name);
  add(materialKeyForObject(object));
  let parent = object.parent;
  while (parent) {
    add(parent.name);
    parent = parent.parent;
  }
  return candidates;
}

function materialKeyForSlot(object: THREE.Object3D, source: THREE.Material, keys: string[]): string {
  return matchModelMaterialKey(materialCandidates(object, source), keys);
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function applyGlossInversion(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\n\troughnessFactor = 1.0 - roughnessFactor;"
    );
  };
  material.customProgramCacheKey = () => "openbridge-gloss-inverted";
}

const surfaceNormalUniform = new WeakMap<THREE.Material, { value: number }>();

function createPreviewMaterial(maps: LoadedMaps, alpha: boolean, normalSpace?: "gl" | "dx", bakedSurface = false): THREE.MeshPhysicalMaterial {
  const roughnessMap = maps.roughness ?? maps.orm ?? maps.gloss;
  const metalnessMap = maps.metalness ?? maps.orm;
  const aoMap = maps.ao ?? maps.orm;
  const material = new THREE.MeshPhysicalMaterial({
    color: maps.baseColor ? 0xffffff : 0xb9b9b9,
    roughness: roughnessMap ? 1 : 0.55,
    metalness: metalnessMap ? 1 : 0,
    map: maps.baseColor,
    normalMap: maps.normal,
    roughnessMap,
    metalnessMap,
    aoMap,
    aoMapIntensity: 1,
    alphaMap: maps.opacity,
    emissiveMap: maps.emissive,
    emissive: maps.emissive ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveIntensity: 1,
    bumpMap: !maps.normal && !bakedSurface ? maps.displacement : null,
    bumpScale: 0.02,
    specularColorMap: maps.specular,
    specularColor: new THREE.Color(0xffffff),
    specularIntensity: 1,
    thicknessMap: maps.translucency,
    thickness: maps.translucency ? 0.35 : 0,
    transmission: maps.translucency ? 0.08 : 0,
    attenuationDistance: 1,
    ior: 1.5,
    alphaTest: alpha ? 0.35 : 0,
    alphaToCoverage: alpha,
    transparent: !alpha && Boolean(maps.opacity),
    side: THREE.DoubleSide,
    envMapIntensity: 1
  });
  if (!maps.roughness && !maps.orm && maps.gloss) applyGlossInversion(material);
  if (bakedSurface) {
    const applyExisting = material.onBeforeCompile;
    const shaderKey = material.customProgramCacheKey();
    const normalDetail = { value: 1 };
    surfaceNormalUniform.set(material, normalDetail);
    material.onBeforeCompile = (shader, renderer) => {
      applyExisting.call(material, shader, renderer);
      shader.uniforms.openBridgeNormalDetail = normalDetail;
      shader.fragmentShader = "uniform float openBridgeNormalDetail;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
        #include <normal_fragment_maps>
        #ifdef USE_NORMALMAP
          if (openBridgeNormalDetail < 0.5) normal = nonPerturbedNormal;
        #endif
      `);
      // Three filters specular response using the geometry normal. Account
      // for normal-map variation too, so tiny highlights don't alias into
      // alternating bright/dark pixels as the sphere moves.
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_fragment>", `
        #ifdef USE_NORMALMAP
          vec3 detailNormal = normal - nonPerturbedNormal;
          vec3 detailDx = dFdx(detailNormal);
          vec3 detailDy = dFdy(detailNormal);
          float detailVariance = min(0.12, 0.30 * (dot(detailDx, detailDx) + dot(detailDy, detailDy)));
          roughnessFactor = sqrt(sqrt(clamp(pow(max(roughnessFactor, 0.08), 4.0) + detailVariance, 0.0, 1.0)));
        #endif
        #include <lights_physical_fragment>
      `);
    };
    material.customProgramCacheKey = () => `openbridge-surface-normal-detail:${shaderKey}`;
  }
  // The sphere already has normals derived from the deformed triangles.
  // Avoid applying the same relief twice at full strength.
  const normalStrength = bakedSurface && maps.displacement ? 0.55 : 1;
  material.normalScale.set(normalStrength, normalSpace === "dx" ? -normalStrength : normalStrength);
  return material;
}

const SURFACE_DISPLACEMENT = 0.1;

// 887,808 triangles, approximately twice the former 442,368.
const SURFACE_SEGMENTS = 272;
/** Cube-sphere: six 0–1 UV faces with no pole pinch. */
function createSurfaceSphere(): THREE.Mesh {
  const segments = SURFACE_SEGMENTS;
  const geometry = new THREE.BoxGeometry(2, 2, 2, segments, segments, segments);
  const position = geometry.getAttribute("position");
  const normal = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    // Spherified cube projection: unlike radial normalization, it spreads
    // samples out near cube corners while preserving the six square charts.
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    const xx = x * x, yy = y * y, zz = z * z;
    point.set(
      x * Math.sqrt(1 - (yy + zz) / 2 + yy * zz / 3),
      y * Math.sqrt(1 - (zz + xx) / 2 + zz * xx / 3),
      z * Math.sqrt(1 - (xx + yy) / 2 + xx * yy / 3)
    );
    position.setXYZ(index, point.x, point.y, point.z);
    normal.setXYZ(index, point.x, point.y, point.z);
  }
  position.needsUpdate = true;
  geometry.setAttribute("normal", normal);
  const uv = geometry.getAttribute("uv");
  if (uv) geometry.setAttribute("uv1", uv);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial());
  mesh.rotation.y = Math.PI / 4;
  mesh.userData.materialKey = "";
  return mesh;
}

function patchEmbeddedMaterial(
  source: THREE.MeshStandardMaterial,
  maps: LoadedMaps,
  alpha: boolean,
  normalSpace?: "gl" | "dx"
): void {
  const missing = (texture: THREE.Texture | null | undefined): boolean => !texture?.image;
  const physical = source instanceof THREE.MeshPhysicalMaterial ? source : null;
  if (maps.baseColor && missing(source.map)) {
    source.map = maps.baseColor;
    source.color.set(0xffffff);
  }
  if (maps.normal && missing(source.normalMap)) {
    source.normalMap = maps.normal;
    if (normalSpace === "dx") source.normalScale.set(1, -1);
  }
  if (maps.roughness && missing(source.roughnessMap)) {
    source.roughnessMap = maps.roughness;
    source.roughness = 1;
  } else if (!maps.roughness && !maps.orm && maps.gloss && missing(source.roughnessMap)) {
    source.roughnessMap = maps.gloss;
    source.roughness = 1;
    applyGlossInversion(source);
  }
  if (maps.metalness && missing(source.metalnessMap)) {
    source.metalnessMap = maps.metalness;
    source.metalness = 1;
  }
  if (maps.orm) {
    if (missing(source.roughnessMap)) { source.roughnessMap = maps.orm; source.roughness = 1; }
    if (missing(source.metalnessMap)) { source.metalnessMap = maps.orm; source.metalness = 1; }
    if (missing(source.aoMap)) source.aoMap = maps.orm;
  }
  if (maps.ao && missing(source.aoMap)) source.aoMap = maps.ao;
  if (!maps.normal && maps.displacement && missing(source.bumpMap)) {
    source.bumpMap = maps.displacement;
    source.bumpScale = 0.02;
  }
  if (physical && maps.specular && missing(physical.specularColorMap)) {
    physical.specularColorMap = maps.specular;
    physical.specularIntensity = 1;
  }
  if (physical && maps.translucency && missing(physical.thicknessMap)) {
    physical.thicknessMap = maps.translucency;
    physical.thickness = 0.35;
    physical.transmission = 0.08;
    physical.attenuationDistance = 1;
  }
  if (maps.opacity && missing(source.alphaMap)) {
    source.alphaMap = maps.opacity;
    source.alphaTest = Math.max(source.alphaTest, 0.5);
    source.alphaToCoverage = true;
    source.transparent = false;
    source.side = THREE.DoubleSide;
  }
  if (maps.emissive && missing(source.emissiveMap)) {
    source.emissiveMap = maps.emissive;
    source.emissive.set(0xffffff);
  }
  if (alpha) {
    source.side = THREE.DoubleSide;
    if (source.alphaTest === 0) source.alphaTest = 0.5;
    source.alphaToCoverage = true;
    source.transparent = false;
  }
  source.needsUpdate = true;
}

async function loadGeometryFile(
  format: ModelMeshVariant["format"],
  url: string,
  mtlUrl: string | undefined,
  manager: THREE.LoadingManager
): Promise<THREE.Object3D | null> {
  if (format === "gltf" || format === "glb") {
    const loader = new GLTFLoader(manager);
    const result = await loader.loadAsync(url);
    return result.scene;
  }
  if (format === "fbx") return new FBXLoader(manager).loadAsync(url);
  if (format === "obj") {
    const loader = new OBJLoader(manager);
    if (mtlUrl) {
      const materials = await new MTLLoader(manager).loadAsync(mtlUrl);
      materials.preload();
      loader.setMaterials(materials);
    }
    return loader.loadAsync(url);
  }
  if (format === "usd" || format === "usda" || format === "usdc" || format === "usdz") {
    return new USDLoader(manager).loadAsync(url);
  }
  if (format === "stl") return new THREE.Mesh(new STLLoader(manager).parse(await (await fetch(url)).arrayBuffer()));
  if (format === "ply") return new THREE.Mesh(new PLYLoader(manager).parse(await (await fetch(url)).arrayBuffer()));
  if (format === "dae") return (await new ColladaLoader(manager).loadAsync(url))?.scene ?? null;
  return null;
}

function layoutPartsInRow(group: THREE.Group): void {
  const parts = group.children.filter((child): child is THREE.Object3D => Boolean(child));
  if (parts.length < 2) return;
  const boxes = parts.map(part => new THREE.Box3().setFromObject(part));
  const sizes = boxes.map(box => box.getSize(new THREE.Vector3()));
  const gap = Math.max(...sizes.map(size => size.x), 0.001) * 0.18;
  const baseY = Math.min(...boxes.map(box => box.min.y));
  let cursor = 0;
  parts.forEach((part, index) => {
    const box = boxes[index];
    part.position.x += cursor - box.min.x;
    part.position.y += baseY - box.min.y;
    cursor += sizes[index].x + gap;
  });
}

async function loadGeometry(
  mesh: ModelMeshVariant,
  manager: THREE.LoadingManager,
  signal: { cancelled: boolean }
): Promise<THREE.Object3D | null> {
  if (signal.cancelled) return null;
  if (mesh.parts?.length) {
    const group = new THREE.Group();
    group.name = mesh.label;
    try {
      for (const part of mesh.parts) {
        const object = await loadGeometryFile(part.format, part.url, part.mtlUrl, manager);
        if (object) {
          if (part.materialKey) object.userData.materialKey = part.materialKey;
          group.add(object);
        }
        if (signal.cancelled) { disposeObject(group, true); return null; }
      }
      if (mesh.partsLayout === "row") layoutPartsInRow(group);
      return group.children.length > 0 ? group : null;
    } catch (error) {
      disposeObject(group, true);
      throw error;
    }
  }
  return loadGeometryFile(mesh.format, mesh.url, mesh.mtlUrl, manager);
}

interface WireframeEntry {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  flat: THREE.MeshBasicMaterial;
  lines: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

type DisplayMode = "pbr" | "map" | "matcap" | "uv" | "normals";

interface DisplayOptions {
  mode: DisplayMode;
  map: ModelMapType | null;
  singleSided: boolean;
  wireframe: boolean;
}

interface InspectionSlot {
  original: THREE.Material;
  maps: LoadedMaps;
  materialKey: string;
}

interface InspectionEntry {
  mesh: THREE.Mesh;
  slots: InspectionSlot[];
}

interface ViewerState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  pmrem: THREE.PMREMGenerator;
  model: THREE.Object3D | null;
  textures: THREE.Texture[];
  wireframe: WireframeEntry[];
  inspectionEntries: InspectionEntry[];
  inspectionMaterials: THREE.Material[];
  inspectionTextures: THREE.Texture[];
  environmentYaw: number;
  lightRig: THREE.Group;
  disposed: boolean;
  render: () => void;
  environment: Promise<void> | null;
  environmentTarget: THREE.WebGLRenderTarget | null;
}

function prepareEnvironment(state: ViewerState): Promise<void> {
  return state.environment ??= new HDRLoader().loadAsync(environmentUrl).then(source => {
    try {
      if (state.disposed) return;
      source.mapping = THREE.EquirectangularReflectionMapping;
      state.environmentTarget = state.pmrem.fromEquirectangular(source);
      state.scene.environment = state.environmentTarget.texture;
      state.scene.environmentIntensity = 1;
    } finally {
      source.dispose();
    }
  }).catch(error => {
    state.environment = null;
    throw error;
  });
}

function frameModel(state: ViewerState): void {
  if (!state.model) return;
  const box = new THREE.Box3().setFromObject(state.model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.001);
  const center = sphere.center;
  const verticalFov = THREE.MathUtils.degToRad(state.camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(state.camera.aspect, 0.01));
  const distance = Math.max(
    radius / Math.sin(verticalFov / 2),
    radius / Math.sin(horizontalFov / 2)
  ) * 1.12;
  const direction = new THREE.Vector3(0.7, 0.5, 0.9).normalize();
  state.controls.target.copy(center);
  state.camera.position.copy(center).add(direction.multiplyScalar(distance));
  state.camera.near = Math.max(0.001, radius / 100);
  state.camera.far = Math.max(10, radius * 100);
  state.camera.updateProjectionMatrix();
  state.controls.minDistance = state.model.userData.surfacePreview ? 1.14 : radius * 0.15;
  state.controls.maxDistance = radius * 12;
  state.controls.update();
  state.render();
}

function clearWireframe(state: ViewerState): void {
  for (const entry of state.wireframe) {
    entry.mesh.material = entry.original;
    entry.mesh.remove(entry.lines);
    entry.lines.material.dispose();
    entry.flat.dispose();
  }
  state.wireframe = [];
}

function applyWireframe(state: ViewerState, enabled: boolean): void {
  if (!enabled) {
    clearWireframe(state);
    state.render();
    return;
  }
  if (!state.model || state.wireframe.length > 0) return;
  for (const { mesh: child } of state.inspectionEntries) {
    const original = child.material;
    // Reuse the displaced positions and Three's cached wireframe index.
    const flat = new THREE.MeshBasicMaterial({ color: 0x101419, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const lines = new THREE.Mesh(
      child.geometry,
      new THREE.MeshBasicMaterial({ color: 0x8c9ca8, wireframe: true, depthWrite: false, toneMapped: false })
    );
    lines.frustumCulled = false;
    lines.renderOrder = 1000;
    child.material = flat;
    child.add(lines);
    state.wireframe.push({ mesh: child, original, flat, lines });
  }
  state.render();
}

const MAP_CHANNELS: Array<{ type: ModelMapType; label: string }> = [
  { type: "basecolor", label: "Base Color" },
  { type: "metalness", label: "Metalness" },
  { type: "roughness", label: "Roughness" },
  { type: "normal", label: "Normal" },
  { type: "opacity", label: "Opacity / Alpha" },
  { type: "emissive", label: "Emissive" },
  { type: "specular", label: "Specular F0" },
  { type: "ao", label: "Ambient Occlusion" },
  { type: "orm", label: "ORM / ARM" },
  { type: "gloss", label: "Gloss" },
  { type: "displacement", label: "Displacement" },
  { type: "translucency", label: "Translucency" }
];

interface ChannelTexture {
  texture: THREE.Texture;
  /** Packed ORM/ARM channel to display as a grayscale map. */
  channel?: "r" | "g" | "b";
}

function slotSourceMaterial(slot: InspectionSlot): THREE.MeshStandardMaterial | null {
  return slot.original instanceof THREE.MeshStandardMaterial ? slot.original : null;
}

function channelTextureFor(slot: InspectionSlot, mapType: ModelMapType): ChannelTexture | null {
  const source = slotSourceMaterial(slot);
  const maps = slot.maps;
  const hasImage = (texture: THREE.Texture | null | undefined): texture is THREE.Texture => Boolean(texture?.image);
  switch (mapType) {
    case "basecolor":
      return hasImage(source?.map) ? { texture: source.map } : maps.baseColor ? { texture: maps.baseColor } : null;
    case "normal":
      return hasImage(source?.normalMap) ? { texture: source.normalMap } : maps.normal ? { texture: maps.normal } : null;
    case "roughness":
      if (maps.roughness) return { texture: maps.roughness };
      if (maps.orm) return { texture: maps.orm, channel: "g" };
      if (hasImage(source?.roughnessMap)) {
        return {
          texture: source.roughnessMap,
          channel: source.roughnessMap === source.metalnessMap ? "g" : undefined
        };
      }
      return null;
    case "metalness":
      if (maps.metalness) return { texture: maps.metalness };
      if (maps.orm) return { texture: maps.orm, channel: "b" };
      if (hasImage(source?.metalnessMap)) {
        return {
          texture: source.metalnessMap,
          channel: source.metalnessMap === source.roughnessMap ? "b" : undefined
        };
      }
      return null;
    case "ao":
      if (maps.ao) return { texture: maps.ao };
      if (maps.orm) return { texture: maps.orm, channel: "r" };
      if (hasImage(source?.aoMap)) return { texture: source.aoMap };
      return null;
    case "orm":
      if (maps.orm) return { texture: maps.orm };
      if (hasImage(source?.roughnessMap) && source.roughnessMap === source.metalnessMap) {
        return { texture: source.roughnessMap };
      }
      return null;
    case "opacity":
      if (hasImage(source?.alphaMap)) return { texture: source.alphaMap };
      return maps.opacity ? { texture: maps.opacity } : null;
    case "emissive":
      return hasImage(source?.emissiveMap) ? { texture: source.emissiveMap } : maps.emissive ? { texture: maps.emissive } : null;
    case "specular": {
      const physical = source instanceof THREE.MeshPhysicalMaterial ? source : null;
      if (hasImage(physical?.specularColorMap)) return { texture: physical.specularColorMap };
      return maps.specular ? { texture: maps.specular } : null;
    }
    case "gloss":
      return maps.gloss ? { texture: maps.gloss } : null;
    case "displacement":
      if (maps.displacement) return { texture: maps.displacement };
      if (hasImage(source?.displacementMap)) return { texture: source.displacementMap };
      if (hasImage(source?.bumpMap)) return { texture: source.bumpMap };
      return null;
    case "translucency": {
      const physical = source instanceof THREE.MeshPhysicalMaterial ? source : null;
      if (hasImage(physical?.thicknessMap)) return { texture: physical.thicknessMap };
      return maps.translucency ? { texture: maps.translucency } : null;
    }
    default:
      return null;
  }
}

function setMaterialSide(material: THREE.Material | THREE.Material[], side: THREE.Side): void {
  for (const item of Array.isArray(material) ? material : [material]) {
    if (item.side !== side) {
      item.side = side;
      item.needsUpdate = true;
    }
  }
}

function applyChannelShader(material: THREE.MeshBasicMaterial, channel: "r" | "g" | "b"): void {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>\n\tdiffuseColor.rgb = vec3(texture2D(map, vMapUv).${channel});`
    );
  };
  material.customProgramCacheKey = () => `openbridge-map-channel-${channel}`;
}

let uvCheckerTexture: THREE.Texture | null = null;
let matcapTexture: THREE.Texture | null = null;

function getUvCheckerTexture(): THREE.Texture {
  if (uvCheckerTexture) return uvCheckerTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Texture();
  const cells = 4;
  const size = canvas.width / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      context.fillStyle = (x + y) % 2 === 0 ? "#e9e9e9" : "#43474d";
      context.fillRect(x * size, y * size, size, size);
    }
  }
  context.strokeStyle = "rgba(20, 24, 30, .45)";
  context.lineWidth = 2;
  for (let index = 1; index < cells; index++) {
    context.beginPath();
    context.moveTo(index * size, 0);
    context.lineTo(index * size, canvas.height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, index * size);
    context.lineTo(canvas.width, index * size);
    context.stroke();
  }
  context.fillStyle = "rgba(229, 57, 53, .9)";
  context.fillRect(0, 0, canvas.width, 6);
  context.fillStyle = "rgba(46, 204, 113, .9)";
  context.fillRect(0, 0, 6, canvas.height);
  context.fillStyle = "#101216";
  context.font = "bold 24px sans-serif";
  context.fillText("U →", canvas.width - 62, 30);
  context.save();
  context.translate(30, canvas.height - 16);
  context.rotate(-Math.PI / 2);
  context.fillText("V →", 0, 0);
  context.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  uvCheckerTexture = texture;
  return texture;
}

function getMatcapTexture(): THREE.Texture {
  if (matcapTexture) return matcapTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Texture();
  context.fillStyle = "#0d0f12";
  context.fillRect(0, 0, 256, 256);
  const gradient = context.createRadialGradient(88, 72, 8, 128, 128, 126);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.18, "#e6e9ee");
  gradient.addColorStop(0.5, "#9aa3ae");
  gradient.addColorStop(0.78, "#454d58");
  gradient.addColorStop(1, "#101216");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(128, 128, 124, 0, Math.PI * 2);
  context.fill();
  const rim = context.createRadialGradient(170, 185, 8, 170, 185, 90);
  rim.addColorStop(0, "rgba(120, 170, 255, .35)");
  rim.addColorStop(1, "rgba(120, 170, 255, 0)");
  context.fillStyle = rim;
  context.beginPath();
  context.arc(128, 128, 124, 0, Math.PI * 2);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  matcapTexture = texture;
  return texture;
}

function disposeInspection(state: ViewerState): void {
  for (const material of state.inspectionMaterials) material.dispose();
  state.inspectionMaterials = [];
  for (const texture of state.inspectionTextures) texture.dispose();
  state.inspectionTextures = [];
}

function disposeOriginalMaterials(state: ViewerState): void {
  for (const entry of state.inspectionEntries) {
    for (const slot of entry.slots) slot.original.dispose();
  }
}

function refreshDisplay(state: ViewerState, options: DisplayOptions): void {
  clearWireframe(state);
  disposeInspection(state);
  const side = options.singleSided ? THREE.FrontSide : THREE.DoubleSide;
  const entries = state.inspectionEntries;
  if (options.mode === "pbr" || (options.mode === "map" && !options.map)) {
    for (const entry of entries) {
      const materials = entry.slots.map(slot => slot.original);
      entry.mesh.material = materials.length > 1 ? materials : materials[0];
      for (const material of materials) setMaterialSide(material, side);
    }
  } else if (options.mode === "map" && options.map) {
    const displays = new Map<THREE.Texture, THREE.Texture>();
    const missing = new THREE.MeshBasicMaterial({ color: 0x858b93, toneMapped: false, side });
    state.inspectionMaterials.push(missing);
    for (const entry of entries) {
      const materials = entry.slots.map(slot => {
        const selected = channelTextureFor(slot, options.map!);
        if (!selected) return missing;
        let display = displays.get(selected.texture);
        if (!display) {
          display = selected.texture.clone();
          display.colorSpace = THREE.SRGBColorSpace;
          display.needsUpdate = true;
          displays.set(selected.texture, display);
          state.inspectionTextures.push(display);
        }
        const material = new THREE.MeshBasicMaterial({ map: display, toneMapped: false, side });
        if (selected.channel) applyChannelShader(material, selected.channel);
        state.inspectionMaterials.push(material);
        return material;
      });
      entry.mesh.material = materials.length > 1 ? materials : materials[0];
    }
  } else if (options.mode === "matcap" || options.mode === "normals" || options.mode === "uv") {
    if (options.mode === "matcap") {
      for (const entry of entries) {
        const materials = entry.slots.map(slot => {
          const original = slotSourceMaterial(slot);
          const bakedSurface = entry.mesh.userData.surfacePreview === true;
          const displacementMap = bakedSurface ? null : original?.displacementMap ?? slot.maps.displacement;
          const displacementScale = original?.displacementMap ? original.displacementScale : SURFACE_DISPLACEMENT * 0.6;
          const material = new THREE.MeshMatcapMaterial({
            matcap: getMatcapTexture(), toneMapped: false, side,
            displacementMap, displacementScale,
            displacementBias: original?.displacementMap ? original.displacementBias : -displacementScale / 2,
            alphaMap: original?.alphaMap ?? slot.maps.opacity,
            alphaTest: original?.alphaTest ?? 0
          });
          state.inspectionMaterials.push(material);
          return material;
        });
        entry.mesh.material = materials.length > 1 ? materials : materials[0];
      }
      state.render();
      return;
    }
    let material: THREE.Material;
    if (options.mode === "normals") {
      for (const entry of entries) {
        if (!entry.mesh.geometry.getAttribute("normal")) entry.mesh.geometry.computeVertexNormals();
      }
      material = new THREE.MeshNormalMaterial({ toneMapped: false, side });
    } else {
      material = new THREE.MeshBasicMaterial({ map: getUvCheckerTexture(), toneMapped: false, side });
    }
    state.inspectionMaterials.push(material);
    for (const entry of entries) entry.mesh.material = material;
  }
  if (options.wireframe) applyWireframe(state, true);
  state.render();
}

export interface ModelViewerProps {
  manifest: ModelManifest;
  quality: number;
  lod: ModelLodMode;
  fullscreen?: boolean;
  onClose?: () => void;
  onExpand?: () => void;
  /** Delayed status shown while a texture/LOD request is still downloading. */
  pendingLabel?: string;
  footerControls?: React.ReactNode;
}

export function ModelViewer({ manifest, quality, lod, fullscreen = false, onClose, onExpand, pendingLabel = "", footerControls }: ModelViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exposureStops, setExposureStops] = useState(0);
  const [environmentAngle, setEnvironmentAngle] = useState(0);
  const [wireframe, setWireframe] = useState(false);
  const [displacement, setDisplacement] = useState(60);
  const [surfaceNormalDetail, setSurfaceNormalDetail] = useState(true);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("pbr");
  const [activeMap, setActiveMap] = useState<ModelMapType | null>(null);
  const [singleSided, setSingleSided] = useState(Boolean(manifest.surface));
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [availableChannels, setAvailableChannels] = useState<ModelMapType[]>([]);
  const [decodedSizes, setDecodedSizes] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [graphicsRetry, setGraphicsRetry] = useState(0);
  const displayRef = useRef<DisplayOptions>({ mode: "pbr", map: null, singleSided: Boolean(manifest.surface), wireframe: false });
  const clickStart = useRef<{ x: number; y: number } | null>(null);
  const stateRef = useRef<ViewerState | null>(null);
  const resizeViewer = useRef<(() => void) | null>(null);
  const framedAsset = useRef("");
  const surfaceGeometry = useRef(new Map<THREE.BufferGeometry, { positions: Float32Array; normals: Float32Array; heights?: Float32Array }>());

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      setError("This desktop session could not start WebGL 2. You can still use the render and map previews.");
      setLoading(false);
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.className = "model-viewer-canvas";
    const controls = new OrbitControls(camera, renderer.domElement);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x30343a, 0.55);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 5, 4);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-4, 2, -3);
    const lightRig = new THREE.Group();
    lightRig.add(key, fill);
    scene.add(hemi, lightRig);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = Math.PI - 0.05;
    // Maya-style navigation: LMB orbit, MMB pan, RMB dolly. The right-button
    // dolly is handled below so it follows Maya's horizontal drag direction;
    // the OrbitControls mapping remains as a fallback for non-pointer input.
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.DOLLY;
    const pmrem = new THREE.PMREMGenerator(renderer);
    let frame: number | null = null;
    const render = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        renderer.render(scene, camera);
      });
    };
    controls.addEventListener("change", render);
    const resize = (): void => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const pixelBudget = fullscreen ? 3840 * 2160 : 1600 * 900;
      // Rasterize the full wireframe at a higher sampling rate when there is
      // framebuffer budget. A single GPU line can then be thinner than a CSS pixel.
      const desiredRatio = fullscreen && displayRef.current.wireframe
        ? Math.max(2, window.devicePixelRatio || 1) : window.devicePixelRatio || 1;
      const ratio = Math.min(desiredRatio, fullscreen ? 2 : 1.5,
        Math.sqrt(pixelBudget / (rect.width * rect.height)));
      if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    resizeViewer.current = resize;
    observer.observe(host);
    stateRef.current = { renderer, scene, camera, controls, pmrem, model: null, textures: [], wireframe: [], inspectionEntries: [], inspectionMaterials: [], inspectionTextures: [], environmentYaw: 0, lightRig, disposed: false, render, environment: null, environmentTarget: null };
    let endDrag: (() => void) | undefined;
    // Substance Painter-style environment spin: Shift + RMB drag rotates the
    // HDRI independently of the camera. Capture it before OrbitControls sees
    // the right-button drag.
    const onEnvironmentPointerDown = (event: PointerEvent): void => {
      if (event.button !== 2 || !event.shiftKey || event.altKey) return;
      const state = stateRef.current;
      if (!state) return;
      endDrag?.();
      event.preventDefault();
      event.stopImmediatePropagation();
      const startX = event.clientX;
      const startYaw = state.environmentYaw;
      const onMove = (move: PointerEvent): void => {
        state.environmentYaw = startYaw + (move.clientX - startX) * 0.008;
        state.scene.environmentRotation.y = state.environmentYaw;
        state.lightRig.rotation.y = state.environmentYaw;
        setEnvironmentAngle(state.environmentYaw);
        state.render();
      };
      const onUp = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
        endDrag = undefined;
      };
      endDrag = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    };
    renderer.domElement.addEventListener("pointerdown", onEnvironmentPointerDown, { capture: true });
    // Maya's dolly uses horizontal drag: right zooms in, left zooms out. OrbitControls'
    // built-in RMB dolly reads vertical movement, so take the right button before it sees
    // the pointer and move the camera along the current view direction instead.
    const onMayaDollyPointerDown = (event: PointerEvent): void => {
      if (event.button !== 2 || event.shiftKey) return;
      const state = stateRef.current;
      if (!state) return;
      endDrag?.();
      event.preventDefault();
      event.stopImmediatePropagation();
      let lastX = event.clientX;
      const onMove = (move: PointerEvent): void => {
        const delta = move.clientX - lastX;
        lastX = move.clientX;
        if (!delta) return;
        const offset = state.camera.position.clone().sub(state.controls.target);
        const length = offset.length();
        if (length < 1e-5) return;
        const next = THREE.MathUtils.clamp(
          length * Math.exp(-delta * 0.005),
          state.controls.minDistance,
          state.controls.maxDistance
        );
        offset.setLength(next);
        state.camera.position.copy(state.controls.target).add(offset);
        state.camera.updateMatrixWorld();
        state.render();
      };
      const onUp = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
        endDrag = undefined;
      };
      endDrag = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    };
    renderer.domElement.addEventListener("pointerdown", onMayaDollyPointerDown, { capture: true });
    resize();
    return () => {
      endDrag?.();
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onEnvironmentPointerDown, { capture: true });
      renderer.domElement.removeEventListener("pointerdown", onMayaDollyPointerDown, { capture: true });
      const state = stateRef.current;
      if (state) {
        state.disposed = true;
        clearWireframe(state);
        disposeInspection(state);
        disposeOriginalMaterials(state);
        state.controls.dispose();
        state.pmrem.dispose();
        state.environmentTarget?.dispose();
        for (const texture of state.textures) texture.dispose();
        disposeObject(state.model);
        state.renderer.dispose();
        state.renderer.forceContextLoss();
        state.renderer.domElement.remove();
      }
      stateRef.current = null;
      resizeViewer.current = null;
      framedAsset.current = "";
      surfaceGeometry.current.clear();
    };
  }, [fullscreen, graphicsRetry]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    // Exposure is in linear stops of light (EV), matching the HDR viewer.
    state.renderer.toneMappingExposure = Math.pow(2, exposureStops);
    state.render();
  }, [exposureStops]);

  useEffect(() => {
    displayRef.current = { mode: displayMode, map: activeMap, singleSided, wireframe };
    const state = stateRef.current;
    if (state) refreshDisplay(state, displayRef.current);
    resizeViewer.current?.();
  }, [displayMode, activeMap, singleSided, wireframe]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const token = { cancelled: false };
    setLoading(true);
    setError("");
    setDecodedSizes("");
    surfaceGeometry.current.clear();
    const manager = new THREE.LoadingManager();
    const textureByUrl = new Map<string, Promise<THREE.Texture>>();
    const sidecars = new Set<THREE.Texture>();
    const load = async () => {
      try {
        const mesh = chooseMesh(manifest, lod);
        if (!mesh) throw new Error(manifest.notes[0] ?? "No runtime 3D mesh is available.");
        const surface = Boolean(manifest.surface) || mesh.format === "sphere";
        await prepareEnvironment(state);
        if (token.cancelled) return;
        const object = surface ? createSurfaceSphere() : await loadGeometry(mesh, manager, token);
        if (token.cancelled) { disposeObject(object, true); return; }
        if (!object) return;
        state.model = object;
        if (surface) state.renderer.domElement.dataset.surfaceUv = "cube";
        state.textures.push(...objectTextures(object));
        // glTF/GLB and USD packages carry their own per-submesh materials and
        // texture sets. Replacing them with one global material breaks
        // multi-material assets (for example a plant, soil and pot together).
        const gltfMaterials = mesh.format === "gltf" || mesh.format === "glb";
        const usdMaterials = ["usd", "usda", "usdc", "usdz"].includes(mesh.format);
        const embeddedMaterials = gltfMaterials || usdMaterials;
        const loadSlot = (slot: MaterialSlot | undefined, color: boolean, flipY = true): Promise<THREE.Texture | null> => {
          if (!slot) return Promise.resolve(null);
          const { variant } = slot;
          // Color space and flip orientation are part of the identity: the same
          // bitmap can be used as a colour and a data map, or by a glTF
          // material and a separate sidecar with a different UV convention.
          const cacheKey = `${variant.url}|${color ? "srgb" : "linear"}|${flipY ? "flip" : "noflip"}`;
          let promise = textureByUrl.get(cacheKey);
          if (!promise) {
            promise = loadTexture(variant.url, variant.format, color, manager, flipY).then(texture => {
              if (token.cancelled) texture.dispose();
              else sidecars.add(texture);
              return texture;
            });
            textureByUrl.set(cacheKey, promise);
          }
          return promise
            .catch(error => {
              // A missing/unsupported sidecar should not blank the whole model.
              console.warn("3D preview map failed to load", variant.url, error);
              return null;
            });
        };
        const loadMaps = async (slots: Record<string, MaterialSlot>): Promise<LoadedMaps> => {
          const loaded = gltfMaterials
            ? await Promise.all([
                null, null, null, null, null, null,
                // GLTFLoader sets flipY=false on embedded glTF textures.
                loadSlot(slots.opacity, false, false),
                null, null, null, null, null
              ])
            : await Promise.all([
                loadSlot(slots.basecolor, true),
                loadSlot(slots.normal, false),
                loadSlot(slots.roughness, false),
                loadSlot(slots.metalness, false),
                loadSlot(slots.ao, false),
                loadSlot(slots.orm, false),
                loadSlot(slots.opacity, false),
                loadSlot(slots.emissive, true),
                loadSlot(slots.specular, false),
                loadSlot(slots.gloss, false),
                loadSlot(slots.displacement, false),
                loadSlot(slots.translucency, false)
              ]);
          return {
            baseColor: loaded[0],
            normal: loaded[1],
            roughness: loaded[2],
            metalness: loaded[3],
            ao: loaded[4],
            orm: loaded[5],
            opacity: loaded[6],
            emissive: loaded[7],
            specular: loaded[8],
            gloss: loaded[9],
            displacement: loaded[10],
            translucency: loaded[11]
          };
        };
        const partKeys = [...new Set((mesh.parts ?? [])
          .map(part => part.materialKey)
          .filter((key): key is string => Boolean(key)))];
        // One FBX can contain several material slots (for example a tree's
        // trunk, needles and branches). Resolve each source material against the
        // published texture prefixes instead of collapsing the mesh to one set.
        const manifestKeys = modelMaterialKeys(manifest);
        const keyForMaterial = (child: THREE.Mesh, source: THREE.Material): string => {
          const matched = materialKeyForSlot(child, source, manifestKeys);
          if (matched) return matched;
          return materialKeyForObject(child) || partKeys[0] || manifestKeys[0] || "";
        };
        const usedKeys = new Set<string>();
        object.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          for (const source of materialList(child.material)) {
            if (source) usedKeys.add(keyForMaterial(child, source));
          }
        });
        if (!usedKeys.size) usedKeys.add(partKeys[0] || manifestKeys[0] || "");
        const materialKeys = [...usedKeys];
        const mapsByKey = new Map<string, LoadedMaps>();
        const normalSpaceByKey = new Map<string, "gl" | "dx" | undefined>();
        const alphaKeyByKey = new Map<string, string>();
        const materialsByKey = new Map<string, THREE.Material | null>();
        for (const key of materialKeys) {
          const slots = selectedTextures(manifest, quality, mesh.lod, key || undefined);
          const maps = await loadMaps(slots);
          if (token.cancelled) return;
          const normalSpace = slots.normal?.variant.normalSpace;
          mapsByKey.set(key, maps);
          normalSpaceByKey.set(key, normalSpace);
          alphaKeyByKey.set(key, normalizeModelMaterialKey(slots.opacity?.variant.materialKey));
        }
        for (const [key, maps] of mapsByKey) {
          const hasCustomMaps = !embeddedMaterials && Object.values(maps).some(Boolean);
          materialsByKey.set(
            key,
            hasCustomMaps ? createPreviewMaterial(maps, manifest.alpha || Boolean(maps.opacity), normalSpaceByKey.get(key), surface) : null
          );
        }
        const defaultKey = materialKeys.find(key => Object.values(mapsByKey.get(key) ?? {}).some(Boolean))
          ?? materialKeys[0]
          ?? "";
        const defaultMaps = mapsByKey.get(defaultKey) ?? emptyLoadedMaps();
        const defaultNormalSpace = normalSpaceByKey.get(defaultKey);
        const replacedMaterials = new Set<THREE.Material>();
        const retainedMaterials = new Set<THREE.Material>();
        state.inspectionEntries = [];
        object.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          child.castShadow = false;
          child.receiveShadow = false;
          const position = child.geometry.getAttribute("position");
          const normal = child.geometry.getAttribute("normal");
          if (surface && position && normal) {
            child.userData.surfacePreview = true;
            surfaceGeometry.current.set(child.geometry, {
              positions: new Float32Array(position.array),
              normals: new Float32Array(normal.array)
            });
          }
          if (!child.geometry.getAttribute("uv1") && child.geometry.getAttribute("uv")) {
            child.geometry.setAttribute("uv1", child.geometry.getAttribute("uv")!);
          }
          const sources = materialList(child.material);
          const slots: InspectionSlot[] = [];
          const assigned = sources.map(source => {
            const key = keyForMaterial(child, source);
            const maps = mapsByKey.get(key) ?? defaultMaps;
            const normalSpace = normalSpaceByKey.get(key) ?? defaultNormalSpace;
            const alpha = manifest.alpha || Boolean(maps.opacity);
            const custom = materialsByKey.get(key) ?? null;
            let material: THREE.Material = custom ?? source;
            if (custom) replacedMaterials.add(source);
            else retainedMaterials.add(source);
            if (!custom && source instanceof THREE.MeshStandardMaterial) {
              source.envMapIntensity = 1;
              if (usdMaterials) {
                patchEmbeddedMaterial(source, maps, alpha, normalSpace);
              } else if (gltfMaterials) {
                const alphaKey = alphaKeyByKey.get(key) ?? alphaKeyByKey.get(defaultKey) ?? "";
                const sourceKey = normalizeModelMaterialKey(source.name);
                const alphaMatches = !alphaKey || !sourceKey || sourceKey.includes(alphaKey) || alphaKey.includes(sourceKey);
                if (maps.opacity && alphaMatches && !source.alphaMap) {
                  source.alphaMap = maps.opacity;
                  source.alphaTest = Math.max(source.alphaTest, 0.5);
                }
                if (alpha) {
                  source.side = THREE.DoubleSide;
                  if (source.alphaTest === 0) source.alphaTest = 0.5;
                  source.alphaToCoverage = true;
                  source.transparent = false;
                }
              } else if (alpha) {
                source.side = THREE.DoubleSide;
                if (source.alphaTest === 0) source.alphaTest = 0.5;
                source.alphaToCoverage = true;
                source.transparent = false;
              }
              source.needsUpdate = true;
            }
            slots.push({ original: material, maps, materialKey: key });
            return material;
          });
          if (!assigned.length) return;
          child.material = Array.isArray(child.material) ? assigned : assigned[0];
          state.inspectionEntries.push({ mesh: child, slots });
        });
        for (const material of replacedMaterials) if (!retainedMaterials.has(material)) material.dispose();
        const channelSet = new Set<ModelMapType>(manifest.textures.map(texture => texture.mapType));
        for (const entry of state.inspectionEntries) {
          for (const slot of entry.slots) {
            for (const channel of MAP_CHANNELS) {
              if (channelTextureFor(slot, channel.type)) channelSet.add(channel.type);
            }
          }
        }
        const orderedChannels = MAP_CHANNELS
          .filter(channel => channelSet.has(channel.type))
          .map(channel => channel.type);
        setAvailableChannels(orderedChannels);
        if (surface) {
          const sizes = [...sidecars].map(texture => {
            const image = texture.image as { width?: number; height?: number } | null;
            return Math.max(image?.width ?? 0, image?.height ?? 0);
          })
            .filter(size => size > 0).sort((a, b) => a - b);
          if (sizes.length) {
            const first = sizes[0], last = sizes.at(-1)!;
            setDecodedSizes(first === last ? `${modelQualityLabel(first)} loaded` : `${modelQualityLabel(first)}–${modelQualityLabel(last)} loaded`);
          }
        }
        let displayOptions = displayRef.current;
        if (displayOptions.map && !orderedChannels.includes(displayOptions.map)) {
          displayOptions = { ...displayOptions, mode: "pbr", map: null };
          displayRef.current = displayOptions;
          setActiveMap(null);
          setDisplayMode("pbr");
        }
        state.scene.add(object);
        refreshDisplay(state, displayOptions);
        const assetKey = `${manifest.provider}:${manifest.assetId}:${manifest.source}`;
        if (framedAsset.current !== assetKey) {
          framedAsset.current = assetKey;
          frameModel(state);
        }
        setLoading(false);
      } catch (cause) {
        if (token.cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      }
    };
    void load();
    return () => {
      token.cancelled = true;
      for (const texture of sidecars) texture.dispose();
      sidecars.clear();
      const current = stateRef.current;
      if (!current) return;
      clearWireframe(current);
      disposeInspection(current);
      disposeOriginalMaterials(current);
      current.inspectionEntries = [];
      if (current.model) {
        current.scene.remove(current.model);
        disposeObject(current.model);
        current.model = null;
      }
      for (const texture of current.textures) texture.dispose();
      current.textures = [];
    };
  }, [manifest, quality, lod, reloadKey]);

  const resetEnvironment = (): void => {
    const state = stateRef.current;
    if (!state) return;
    state.environmentYaw = 0;
    state.scene.environmentRotation.set(0, 0, 0);
    state.lightRig.rotation.y = 0;
    setEnvironmentAngle(0);
    state.render();
  };

  const selectDisplay = (mode: DisplayMode, map: ModelMapType | null = null): void => {
    setDisplayMode(mode);
    setActiveMap(map);
    setWireframe(false);
  };

  const restoreGeometry = useCallback(() => {
    for (const [geometry, base] of surfaceGeometry.current) {
      const position = geometry.getAttribute("position");
      if (!position) continue;
      (position.array as Float32Array).set(base.positions);
      position.needsUpdate = true;
      const normal = geometry.getAttribute("normal");
      (normal.array as Float32Array).set(base.normals);
      normal.needsUpdate = true;
    }
    const dom = stateRef.current?.renderer.domElement;
    if (dom) delete dom.dataset.surfaceDisplaced;
  }, []);

  /** All sphere display modes share the same deformed geometry. */
  const displaceGeometry = useCallback((strength: number) => {
    const state = stateRef.current;
    if (!state || !surfaceGeometry.current.size) return;
    const texture = state.inspectionEntries
      .flatMap(entry => entry.slots)
      .find(slot => slot.maps.displacement)?.maps.displacement;
    const image = texture?.image as (HTMLImageElement & { data?: ArrayLike<number> }) | undefined;
    if (!image || !image.width || !image.height) return;
    const scale = SURFACE_DISPLACEMENT * (strength / 100);
    for (const [geometry, base] of surfaceGeometry.current) {
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const uv = geometry.getAttribute("uv");
      if (!position || !normal || !uv) continue;
      const array = position.array as Float32Array;
      if (!base.heights) {
        // Band-limit height separately from material textures. Fine detail
        // below the mesh sampling rate belongs in the normal map.
        const width = image.data ? image.width : Math.min(SURFACE_SEGMENTS * 2, image.width);
        const height = image.data ? image.height : Math.min(SURFACE_SEGMENTS * 2, image.height);
        let pixels = image.data;
        if (!pixels) {
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          try {
            context.imageSmoothingQuality = "high";
            context.drawImage(image, 0, 0, width, height);
            pixels = context.getImageData(0, 0, width, height).data;
          } catch { return; }
        }
        const channels = pixels.length / (width * height);
        const sample = (x: number, y: number) => {
          const raw = pixels![(((y + height) % height) * width + (x + width) % width) * channels];
          const value = texture?.type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat(raw)
            : texture?.type === THREE.FloatType ? raw : raw / 255;
          return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0.5;
        };
        const heights = new Float32Array(position.count);
        for (let index = 0; index < position.count; index++) {
          const s = uv.getX(index), t = uv.getY(index);
          const u = s * width - 0.5, v = (texture?.flipY ? 1 - t : t) * height - 0.5;
          const x = Math.floor(u), y = Math.floor(v);
          const value = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(sample(x, y), sample(x + 1, y), u - x),
            THREE.MathUtils.lerp(sample(x, y + 1), sample(x + 1, y + 1), u - x), v - y
          );
          // Adjacent cube faces use different UVs. Meet at the same radius
          // with zero slope at each edge so height maps can't tear the mesh.
          const edge = Math.min(s, 1 - s, t, 1 - t);
          heights[index] = (value - 0.5) * THREE.MathUtils.smoothstep(edge, 0, 0.035);
        }
        base.heights = heights;
      }
      for (let index = 0; index < position.count; index += 1) {
        const heightValue = base.heights[index];
        const offset = index * 3;
        array[offset] = base.positions[offset] + base.normals[offset] * heightValue * scale;
        array[offset + 1] = base.positions[offset + 1] + base.normals[offset + 1] * heightValue * scale;
        array[offset + 2] = base.positions[offset + 2] + base.normals[offset + 2] * heightValue * scale;
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      // Both copies of a shared chart edge should have exactly the same
      // normal; one-sided triangle sums otherwise leave a lighting crease.
      for (let index = 0; index < normal.count; index++) {
        const u = uv.getX(index), v = uv.getY(index);
        if (u !== 0 && u !== 1 && v !== 0 && v !== 1) continue;
        const offset = index * 3;
        normal.setXYZ(index, base.normals[offset], base.normals[offset + 1], base.normals[offset + 2]);
      }
      normal.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
    state.renderer.domElement.dataset.surfaceDisplaced = "true";
  }, []);

  const changeWireframe = (value: boolean): void => {
    if (value) {
      setDisplayMode("pbr");
      setActiveMap(null);
    }
    setWireframe(value);
  };

  useEffect(() => {
    const state = stateRef.current;
    if (!state || !manifest.surface || loading) return;
    const frame = requestAnimationFrame(() => {
      if (displacement > 0) displaceGeometry(displacement);
      else restoreGeometry();
      state.render();
    });
    return () => cancelAnimationFrame(frame);
  }, [displacement, loading, displaceGeometry, restoreGeometry, manifest.surface]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state || !manifest.surface || loading) return;
    for (const entry of state.inspectionEntries) {
      for (const slot of entry.slots) {
        const uniform = surfaceNormalUniform.get(slot.original);
        if (uniform) uniform.value = surfaceNormalDetail ? 1 : 0;
      }
    }
    state.render();
  }, [loading, manifest.surface, surfaceNormalDetail]);

  const environmentDegrees = Math.round((((environmentAngle * 180) / Math.PI) % 360 + 360) % 360);
  const qualityLabel = useMemo(() => modelQualityLabel(quality), [quality]);
  const meshLabel = useMemo(() => {
    if (manifest.surface) return "Sphere";
    const mesh = chooseMesh(manifest, lod);
    if (!mesh) return "No mesh";
    if (mesh.parts?.length) {
      return `${mesh.lod === null ? "" : `LOD${mesh.lod} · `}${mesh.parts.length} parts`;
    }
    return modelLodLabel(mesh.lod);
  }, [manifest, lod]);

  return (
    <div className={`model-viewer ${fullscreen ? "fullscreen" : "inline"}`}>
      <div
        ref={hostRef}
        className="model-viewer-host"
        onPointerDown={event => { clickStart.current = { x: event.clientX, y: event.clientY }; }}
        onClick={event => {
          const start = clickStart.current;
          clickStart.current = null;
          if (!onExpand) return;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
          onExpand();
        }}
        role={onExpand ? "button" : undefined}
        tabIndex={onExpand ? 0 : undefined}
        onKeyDown={event => { if (onExpand && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onExpand(); } }}
        title={onExpand ? "Open full-screen 3D viewer" : undefined}
      />
      {loading && <div className="model-viewer-status"><span className="spinner" /><strong>Loading {qualityLabel} textures…</strong><span>{meshLabel}</span></div>}
      {!loading && pendingLabel && <div className="model-viewer-status switch" role="status" aria-live="polite"><span className="spinner" /><strong>{pendingLabel}</strong><span>Downloading and preparing the selected files…</span></div>}
      {error && <div className="model-viewer-status error" role="alert"><strong>3D preview unavailable</strong><span>{error}</span><button type="button" className="text-btn" onClick={() => { setError(""); setLoading(true); if (stateRef.current) setReloadKey(value => value + 1); else { setGraphicsRetry(value => value + 1); setReloadKey(value => value + 1); } }}>Retry</button></div>}
      {fullscreen && <div className="model-viewer-chrome">
        <div className="model-viewer-chrome-head"><div><strong>{manifest.name}</strong><span>{meshLabel} · {manifest.surface ? decodedSizes || "Texture preview" : qualityLabel}</span></div><button type="button" className="icon-btn model-viewer-close" aria-label="Close 3D viewer" data-modal-autofocus onClick={onClose}><CloseIcon /></button></div>
        <div className="model-viewer-chrome-footer">
        {footerControls}
        <div className="model-viewer-toolbar">
          <label>Exposure <input type="range" min="-10" max="10" step="0.1" value={exposureStops} aria-label="3D exposure stops" onChange={event => setExposureStops(Number(event.target.value))} /></label>
          <strong className="model-viewer-ev">{exposureStops > 0 ? "+" : ""}{exposureStops.toFixed(1)} EV</strong>
          <button type="button" className="text-btn" disabled={exposureStops === 0} title="Reset exposure to 0 EV" onClick={() => setExposureStops(0)}>Reset exposure</button>
          <button type="button" className={`text-btn${inspectorOpen ? " active" : ""}`} onClick={() => setInspectorOpen(value => !value)}>Inspector</button>
          <label className="toggle inline"><input type="checkbox" checked={wireframe} onChange={event => changeWireframe(event.target.checked)} /><span>Wireframe</span></label>
          {manifest.surface && manifest.textures.some(texture => texture.mapType === "displacement") && (
            <label>Displacement <input type="range" min="0" max="200" step="5" value={displacement} aria-label="Surface displacement strength" onInput={event => setDisplacement(Number(event.currentTarget.value))} /><strong>{displacement}%</strong></label>
          )}
          <button type="button" className="text-btn" onClick={() => { const state = stateRef.current; if (state) frameModel(state); }}>Reset view</button>
          <button type="button" className="text-btn" onClick={resetEnvironment}>Reset environment</button>
          <strong className="model-viewer-env-angle">Env {environmentDegrees}°</strong>
          <span className="model-viewer-controls-hint">LMB orbit · MMB pan · RMB/Alt+RMB dolly · Shift+RMB environment</span>
        </div>
        </div>
      </div>}
      {fullscreen && inspectorOpen && (
        <div className="model-inspector" role="dialog" aria-label="Model inspector">
          <div className="model-inspector-head">
            <strong>Model Inspector</strong>
            <button type="button" className="icon-btn" aria-label="Close model inspector" onClick={() => setInspectorOpen(false)}><CloseIcon /></button>
          </div>
          <section>
            <h4>Display</h4>
            <div className="model-inspector-grid">
              <button type="button" className={`model-inspector-option${displayMode === "pbr" ? " active" : ""}`} onClick={() => selectDisplay("pbr")}>PBR</button>
              <button type="button" className={`model-inspector-option${displayMode === "matcap" ? " active" : ""}`} onClick={() => selectDisplay("matcap")}>Matcap</button>
              <button type="button" className={`model-inspector-option${displayMode === "uv" ? " active" : ""}`} onClick={() => selectDisplay("uv")}>UV Checker</button>
              <button type="button" className={`model-inspector-option${displayMode === "normals" ? " active" : ""}`} onClick={() => selectDisplay("normals")}>Vertex Normals</button>
            </div>
          </section>
          <section>
            <h4>Material Channels</h4>
            {availableChannels.length > 0 ? (
              <div className="model-inspector-channels">
                {MAP_CHANNELS.filter(channel => availableChannels.includes(channel.type)).map(channel => (
                  <button
                    key={channel.type}
                    type="button"
                    className={`model-inspector-option${displayMode === "map" && activeMap === channel.type ? " active" : ""}`}
                    onClick={() => selectDisplay("map", channel.type)}
                  >
                    {channel.label}
                  </button>
                ))}
              </div>
            ) : <p className="hint">No separate texture maps were published for this asset.</p>}
          </section>
          <section>
            <h4>Geometry</h4>
            <label className="toggle inline"><input type="checkbox" checked={wireframe} onChange={event => changeWireframe(event.target.checked)} /><span>Wireframe</span></label>
            {wireframe && manifest.surface && <p className="hint">{(12 * SURFACE_SEGMENTS ** 2).toLocaleString()} triangles · zoom in to inspect edges</p>}
            <label className="toggle inline"><input type="checkbox" checked={singleSided} onChange={event => setSingleSided(event.target.checked)} /><span>Single Sided</span></label>
            {manifest.surface && availableChannels.includes("normal") && <label className="toggle inline" title="Compare PBR with and without the normal map; displacement stays active">
              <input type="checkbox" checked={surfaceNormalDetail} onChange={event => setSurfaceNormalDetail(event.target.checked)} /><span>Normal map detail</span>
            </label>}
          </section>
          <p className="hint">Inspect the model’s PBR channels, UV layout and geometry without leaving the viewer.</p>
        </div>
      )}
    </div>
  );
}

function objectTextures(object: THREE.Object3D | null): Set<THREE.Texture> {
  const textures = new Set<THREE.Texture>();
  object?.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of materialList(child.material)) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return textures;
}

function disposeObject(object: THREE.Object3D | null, disposeTextures = false): void {
  if (disposeTextures) for (const texture of objectTextures(object)) texture.dispose();
  object?.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material?.dispose();
  });
}

function textureSwitchLabel(value: number): string {
  return `Loading ${modelQualityLabel(value)} textures…`;
}

function meshSwitchLabel(value: ModelLodMode): string {
  if (value === "highest") return "Loading highest-detail mesh…";
  if (value === "lowest") return "Loading lowest-detail mesh…";
  return `Loading LOD${value} mesh…`;
}

export interface SurfacePreviewPanelProps {
  maps: SurfacePreviewMap[];
  assetId: string;
  provider: string;
  name: string;
  source?: "local" | "provider";
  className?: string;
  /** Highest provider-published map tier, used for on-demand quality options. */
  maxTier?: number | null;
  resolveTier?: (map: SurfacePreviewMap) => Promise<{ url: string; resolution?: string } | null>;
  onMode?: (mode: "render" | "maps") => void;
  startFullscreen?: boolean;
  preparing?: boolean;
  unavailableMessage?: string;
  onExitFullscreen?: () => void;
}

/** Wrap a 2D surface map set around a sphere using the 3D viewer pipeline. */
export function SurfacePreviewPanel({ maps, assetId, provider, name, source = "provider", className = "", maxTier, resolveTier, onMode, startFullscreen = false, preparing = false, unavailableMessage, onExitFullscreen }: SurfacePreviewPanelProps) {
  const [tierMaps, setTierMaps] = useState<SurfacePreviewMap[] | null>(null);
  const [tierLoading, setTierLoading] = useState(false);
  const [quality, setQuality] = useState(1024);
  const [tierNote, setTierNote] = useState("");
  // Drawers can rebuild equivalent arrays on unrelated store updates.
  const mapKey = JSON.stringify(maps);
  const stableMaps = useMemo(() => JSON.parse(mapKey) as SurfacePreviewMap[], [mapKey]);
  const displayMaps = useMemo(() => tierMaps && quality !== 0 ? [...stableMaps, ...tierMaps] : stableMaps, [stableMaps, tierMaps, quality === 0]);
  const baseQualities = useMemo(() => surfaceManifest(maps, { assetId, provider, name, source })?.availableQualities ?? [], [maps, assetId, provider, name, source]);
  const verifiedQualities = useMemo(() => tierMaps
    ? surfaceManifest(tierMaps, { assetId, provider, name, source })?.availableQualities ?? [] : [], [tierMaps, assetId, provider, name, source]);
  const manifest = useMemo(
    () => surfaceManifest(displayMaps, { assetId, provider, name, source }),
    [displayMaps, assetId, provider, name, source]
  );
  const [fullscreen, setFullscreen] = useState(startFullscreen);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => { setFullscreen(false); onExitFullscreen?.(); };
  useModalFocus(dialog, fullscreen, close);
  const qualities = [...new Set([...(baseQualities.length ? baseQualities : [0]), ...verifiedQualities])].sort((a, b) => a - b);
  const appliedQuality = qualities.includes(quality)
    ? quality
    : qualities.find(value => value >= 1024) ?? qualities[0] ?? 0;

  const canUpgrade = source === "provider" && resolveTier && maxTier && maxTier > (qualities.at(-1) ?? 1024);
  const selectQuality = async (choice: string): Promise<void> => {
    setTierNote("");
    if (choice !== "maximum") { setQuality(Number(choice)); return; }
    if (!resolveTier) return;
    setTierLoading(true);
    try {
      const upgraded: SurfacePreviewMap[] = [];
      // Decode sequentially so checking a large map set doesn't hold all of
      // its full-resolution bitmaps in memory at once.
      for (const map of maps) {
        try {
          const result = await resolveTier(map);
          if (!result?.url || result.url === map.url) continue;
          const image = new Image();
          image.crossOrigin = "anonymous";
          image.src = result.url;
          await image.decode();
          const resolution = Math.max(image.naturalWidth, image.naturalHeight);
          if (resolution > 0) upgraded.push({ ...map, url: result.url, resolution: `${resolution}x${resolution}` });
        } catch {
          // A missing channel keeps its original preview.
        }
      }
      const actual = surfaceManifest(upgraded, { assetId, provider, name })?.availableQualities ?? [];
      if (actual.length) {
        setTierMaps(upgraded);
        setQuality(actual.at(-1)!);
      }
      setTierNote(actual.length ? `Verified up to ${modelQualityLabel(actual.at(-1)!)}; individual maps may use lower tiers.` : "No higher-resolution preview could be verified.");
    } finally {
      setTierLoading(false);
    }
  };

  const empty = <div className="model-preview-empty" role="status">
    {preparing && <span className="spinner" />}
    <strong>{preparing ? "Preparing maps for the sphere preview…" : "Sphere preview unavailable"}</strong>
    {!preparing && <span>{unavailableMessage || "No browser-readable maps are available for this asset."}</span>}
    {fullscreen && <button type="button" className="btn btn-ghost" onClick={close}>Close preview</button>}
  </div>;

  const qualityPicker = <label>Textures <select className="native-select" value={tierLoading ? "maximum" : appliedQuality} disabled={tierLoading} onChange={event => void selectQuality(event.target.value)}>
    {(qualities.length ? qualities : [0]).map(value => <option key={value} value={value}>{value ? modelQualityLabel(value) : "Preview (size unknown)"}</option>)}
    {canUpgrade && <option value="maximum">Load highest available</option>}
  </select></label>;

  return (
    <div className={`model-preview-panel surface-preview ${className}`.trim()}>
      {!fullscreen && (manifest ? <>
      <ModelViewer manifest={manifest} quality={appliedQuality} lod="lowest" onExpand={() => setFullscreen(true)} />
      <div className="model-preview-controls">
        <span className="hint">Sphere surface preview · drag to orbit</span>
        {qualityPicker}
        {(tierLoading || tierNote) && <span className="hint" role="status">{tierLoading ? "Checking highest available maps…" : tierNote}</span>}
        <button type="button" className="text-btn" onClick={() => setFullscreen(true)}>Full screen</button>
      </div></> : empty)}
      {fullscreen && createPortal(
        <div ref={dialog} tabIndex={-1} className="model-viewer-overlay" role="dialog" aria-modal="true" aria-label={`${name} sphere preview`}>
          <div className="model-viewer-fullscreen-card">
             {manifest ? <ModelViewer fullscreen manifest={manifest} quality={appliedQuality} lod="lowest" onClose={close} footerControls={<div className="model-viewer-quality-bar">
              {onMode && <div className="preview-mode-switch" role="group" aria-label="Preview mode">
                <button type="button" onClick={() => { setFullscreen(false); onMode("render"); }}>Render</button>
                <button type="button" onClick={() => { setFullscreen(false); onMode("maps"); }}>Maps</button>
                <button type="button" className="active" aria-pressed="true">Sphere</button>
              </div>}
              {qualityPicker}
              <span className="model-viewer-quality-note" role="status">{tierLoading ? "Checking highest available maps…" : tierNote || "Sphere surface preview"}</span>
             </div>} /> : empty}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export interface ModelPreviewPanelProps {
  assetId: string;
  provider: string;
  name: string;
  path?: string;
  type?: string;
  isPlant?: boolean;
  className?: string;
  /** Open the full-screen viewer as soon as the inline manifest is ready. */
  startFullscreen?: boolean;
  onExitFullscreen?: () => void;
  onMode?: (mode: "render" | "maps" | "3d") => void;
}

export function ModelPreviewPanel({ assetId, provider, name, path, type, isPlant = false, className = "", startFullscreen = false, onMode, onExitFullscreen }: ModelPreviewPanelProps) {
  const [manifest, setManifest] = useState<ModelManifest | null>(null);
  // Applied values drive the live viewer. Choice values drive the selects and
  // update immediately, while the old preview remains visible until the new
  // manifest is ready.
  const [quality, setQuality] = useState(1024);
  const [qualityChoice, setQualityChoice] = useState(1024);
  const [lod, setLod] = useState<ModelLodMode>("highest");
  const [lodChoice, setLodChoice] = useState<ModelLodMode>("highest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(startFullscreen);
  const [fullscreenQuality, setFullscreenQuality] = useState(4096);
  const [fullscreenQualityChoice, setFullscreenQualityChoice] = useState(4096);
  const [fullscreenLod, setFullscreenLod] = useState<ModelLodMode>("highest");
  const [fullscreenLodChoice, setFullscreenLodChoice] = useState<ModelLodMode>(fullscreenLod);
  const [fullscreenManifest, setFullscreenManifest] = useState<ModelManifest | null>(null);
  const [autoQualityNote, setAutoQualityNote] = useState("");
  const [switchError, setSwitchError] = useState<{ target: "inline" | "fullscreen"; text: string; quality: number; lod: ModelLodMode; label?: string } | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{ label: string; target: "inline" | "fullscreen"; visible: boolean } | null>(null);
  const requestId = useRef(0);
  const switchTimer = useRef<number | null>(null);
  const autoOpened = useRef(false);
  const fullscreenDialog = useRef<HTMLDivElement>(null);

  const request = useCallback(async (
    nextQuality: number,
    nextLod: ModelLodMode,
    target: "inline" | "fullscreen",
    switchText?: string
  ) => {
    const id = ++requestId.current;
    if (switchTimer.current !== null) {
      window.clearTimeout(switchTimer.current);
      switchTimer.current = null;
    }
    if (switchText) {
      setPendingSwitch({ label: switchText, target, visible: false });
      switchTimer.current = window.setTimeout(() => {
        switchTimer.current = null;
        setPendingSwitch(current => current && current.target === target
          ? { ...current, visible: true }
          : current);
      }, 1000);
    } else {
      setPendingSwitch(null);
    }
    if (target === "inline") {
      setLoading(true);
      setError("");
      setQualityChoice(nextQuality);
      setLodChoice(nextLod);
    } else {
      setFullscreenQualityChoice(nextQuality);
      setFullscreenLodChoice(nextLod);
    }
    setSwitchError(null);
    try {
      const result = await window.openbridge.model.manifest({
        assetId,
        provider,
        name,
        path,
        // A plant flag must reach the scanner so foliage alpha cards are
        // treated as cutouts even when the provider calls the type "models".
        type: isPlant ? "3dplant" : type,
        quality: nextQuality,
        lod: nextLod
      });
      if (id !== requestId.current) return;
      if (!result.name || result.name === assetId) result.name = name;
      if (target === "fullscreen") {
        const resolved = result.availableQualities.includes(nextQuality)
          ? nextQuality
          : result.availableQualities[0] ?? nextQuality;
        setFullscreenManifest(result);
        setFullscreenQuality(resolved);
        setFullscreenQualityChoice(resolved);
        setFullscreenLod(nextLod);
        setFullscreenLodChoice(nextLod);
      } else {
        setManifest(result);
        const resolved = result.availableQualities.includes(nextQuality)
          ? nextQuality
          : result.availableQualities[0] ?? nextQuality;
        setQuality(resolved);
        setQualityChoice(resolved);
        setLod(nextLod);
        setLodChoice(nextLod);
      }
    } catch (cause) {
      if (id !== requestId.current) return;
      const text = cause instanceof Error ? cause.message : String(cause);
      if (target === "inline") setError(text);
      setSwitchError({ target, text, quality: nextQuality, lod: nextLod, label: switchText });
    } finally {
      if (id === requestId.current) {
        if (switchTimer.current !== null) {
          window.clearTimeout(switchTimer.current);
          switchTimer.current = null;
        }
        setPendingSwitch(null);
        if (target === "inline") setLoading(false);
      }
    }
  }, [assetId, provider, name, path, type, isPlant]);

  useEffect(() => () => {
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
  }, []);

  useEffect(() => {
    void request(1024, "highest", "inline");
  }, [request]);

  const qualities = manifest?.availableQualities.length ? manifest.availableQualities : [];
  const lods = manifest?.availableLods ?? [];
  const qualityOptions = qualities.length ? qualities : [1024];

  const openFullscreen = useCallback((): void => {
    if (!manifest || loading) return;
    const target = chooseAutoFullscreenQuality(manifest, lod, quality);
    setFullscreen(true);
    setFullscreenQuality(quality);
    setFullscreenQualityChoice(target.quality);
    setFullscreenLod(lod);
    setFullscreenLodChoice(lod);
    setFullscreenManifest(manifest);
    setAutoQualityNote(target.note);
    if (target.quality !== quality) void request(target.quality, lod, "fullscreen", textureSwitchLabel(target.quality));
  }, [manifest, loading, lod, quality, request]);

  useEffect(() => {
    if (!startFullscreen || autoOpened.current || loading || !manifest) return;
    autoOpened.current = true;
    openFullscreen();
  }, [startFullscreen, loading, manifest, openFullscreen]);

  const closeFullscreen = (exit = true): void => {
    autoOpened.current = true;
    if (fullscreenManifest) ++requestId.current;
    if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
    switchTimer.current = null;
    setPendingSwitch(null);
    setSwitchError(current => current?.target === "fullscreen" ? null : current);
    setFullscreen(false);
    setFullscreenManifest(null);
    setAutoQualityNote("");
    if (exit) onExitFullscreen?.();
  };

  useModalFocus(fullscreenDialog, fullscreen, closeFullscreen);

  const renderSwitchError = (target: "inline" | "fullscreen") => switchError?.target === target && (
    <div className="model-switch-error" role="status">
      <span><strong>Couldn’t switch preview.</strong> {switchError.text}</span>
      <button type="button" className="text-btn" onClick={() => void request(switchError.quality, switchError.lod, target, switchError.label)}>Retry switch</button>
    </div>
  );

  return (
    <div
      className={`model-preview-panel ${className}`.trim()}
      data-pending-switch={pendingSwitch?.label || undefined}
      aria-busy={pendingSwitch || loading ? "true" : undefined}
    >
      {manifest ? (
        <>
          <ModelViewer
            manifest={manifest}
            quality={quality}
            lod={lod}
            onExpand={loading ? undefined : openFullscreen}
            pendingLabel={pendingSwitch?.target === "inline" && pendingSwitch.visible ? pendingSwitch.label : ""}
          />
          <div className="model-preview-controls">
            <label>Textures <select className="native-select" value={switchError?.target === "inline" ? quality : qualityChoice} onChange={event => { const value = Number(event.target.value); setQualityChoice(value); void request(value, lod, "inline", textureSwitchLabel(value)); }}>{qualityOptions.map(value => <option key={value} value={value}>{modelQualityLabel(value)}</option>)}</select></label>
            {lods.length > 1 && <label>Mesh <select className="native-select" value={String(switchError?.target === "inline" ? lod : lodChoice)} onChange={event => { const raw = event.target.value; const value: ModelLodMode = raw === "lowest" || raw === "highest" ? raw : Number(raw); setLodChoice(value); void request(quality, value, "inline", meshSwitchLabel(value)); }}><option value="lowest">Lowest</option><option value="highest">Highest</option>{lods.map(value => <option key={value} value={String(value)}>{modelLodLabel(value)}</option>)}</select></label>}
            <button type="button" className="text-btn" disabled={loading} onClick={openFullscreen}>Full screen</button>
          </div>
          {renderSwitchError("inline")}
          {manifest.notes.length > 0 && <p className="hint model-preview-note">{manifest.notes[0]}</p>}
        </>
      ) : loading ? (
        <div className="model-preview-empty"><span className="spinner" /><strong>Preparing 3D preview…</strong><span className="hint">Loading the highest-detail mesh and initial textures.</span></div>
      ) : (
        <div className="model-preview-empty error"><strong>3D preview unavailable</strong><span>{error || "This asset has no runtime 3D mesh."}</span><button type="button" className="btn btn-ghost" onClick={() => void request(quality, lod, "inline", "Loading 3D preview…")}>Retry 3D</button></div>
      )}
      {fullscreen && createPortal(
        <div ref={fullscreenDialog} tabIndex={-1} className="model-viewer-overlay" role="dialog" aria-modal="true" aria-label={`${name} 3D viewer`}>
          <div className="model-viewer-fullscreen-card">
            {fullscreenManifest ? <ModelViewer fullscreen manifest={fullscreenManifest} quality={fullscreenQuality} lod={fullscreenLod} onClose={() => closeFullscreen()} pendingLabel={pendingSwitch?.target === "fullscreen" && pendingSwitch.visible ? pendingSwitch.label : ""} footerControls={<div className="model-viewer-quality-bar">
              {onMode && <div className="preview-mode-switch" role="group" aria-label="Preview mode">
                <button type="button" onClick={() => { closeFullscreen(false); onMode("render"); }}>Render</button>
                <button type="button" onClick={() => { closeFullscreen(false); onMode("maps"); }}>Maps</button>
                <button type="button" className="active" aria-pressed="true">3D</button>
              </div>}
              <label>Textures <select className="native-select" value={switchError?.target === "fullscreen" ? fullscreenQuality : fullscreenQualityChoice} onChange={event => { const value = Number(event.target.value); setAutoQualityNote(""); setFullscreenQualityChoice(value); void request(value, fullscreenLod, "fullscreen", textureSwitchLabel(value)); }}>{qualityOptions.map(value => <option key={value} value={value}>{modelQualityLabel(value)}</option>)}</select></label>
              {lods.length > 1 && <label>Mesh <select className="native-select" value={String(switchError?.target === "fullscreen" ? fullscreenLod : fullscreenLodChoice)} onChange={event => { const raw = event.target.value; const value: ModelLodMode = raw === "lowest" || raw === "highest" ? raw : Number(raw); setFullscreenLodChoice(value); void request(fullscreenQuality, value, "fullscreen", meshSwitchLabel(value)); }}><option value="lowest">Lowest</option><option value="highest">Highest</option>{lods.map(value => <option key={value} value={String(value)}>{modelLodLabel(value)}</option>)}</select></label>}
              {autoQualityNote && <span className="model-viewer-quality-note">{autoQualityNote}</span>}
              {renderSwitchError("fullscreen")}
            </div>} /> : <div className="model-preview-empty" role="status">{loading && <span className="spinner" />}<strong>{loading ? "Preparing full-screen 3D preview…" : error || "3D preview unavailable"}</strong><button type="button" className="btn btn-ghost" onClick={() => closeFullscreen()}>Close preview</button></div>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
