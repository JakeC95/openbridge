import { extname, join, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { isInside } from "./shared-library";
import type { AssetManifest } from "../shared/asset-manifest";
import type { SharedLibraryRoot } from "../shared/types";

export function selectAssetHandoff(asset: AssetManifest, target: string, renderer?: string, variant = asset.defaultVariant) {
  const route = asset.handoffs.find(h => h.variant === variant && h.target === target && h.renderer === renderer);
  if (!route || route.status !== "ready")
    throw new Error(`No approved ${target}${renderer ? ` / ${renderer}` : ""} handoff for ${variant}. ${route?.reasons.join(" ") ?? ""}`.trim());
  const representation = asset.representations.find(r => r.id === route.representation)!;
  const bindings = asset.bindingSets.find(b => b.id === representation.bindingSet);
  const files = new Map(asset.files.map(file => [file.id, file]));
  const materials = new Map(asset.materials.map(material => [material.id, material]));
  const textures = new Map(asset.textures.map(texture => [texture.id, texture]));
  return { representation, bindings, files, materials, textures, route };
}

export function assetFileResolver(asset: AssetManifest, roots: SharedLibraryRoot[]) {
  const files = new Map(asset.files.map(file => [file.id, file]));
  const registered = new Map(roots.map(root => [root.id, root.path]));
  const canonicalRoots = new Map<string, Promise<string>>();
  const checked = new Map<string, Promise<string>>();
  function get(id: string): Promise<string> {
    const existing = checked.get(id);
    if (existing) return existing;
    const task = (async () => {
      const file = files.get(id);
      if (!file) throw new Error(`Unresolved asset file: ${id}.`);
      if (file.purpose !== "source" && file.purpose !== "production-derivative")
        throw new Error(`Not a production dependency: ${id}.`);
      const configured = registered.get(file.root);
      if (!configured) throw new Error(`Asset library root is not registered: ${file.root}.`);
      if (!canonicalRoots.has(file.root)) canonicalRoots.set(file.root, realpath(configured));
      const root = await canonicalRoots.get(file.root)!;
      const path = await realpath(join(root, file.path)).catch(() => {
        throw new Error(`Required asset file is missing: ${file.path}.`);
      });
      const info = await stat(path);
      if (!isInside(root, resolve(path)) || !info.isFile() || /\.gl(?:b|tf)$/i.test(path) || /[\x00-\x1f$`\\]/.test(path))
        throw new Error(`Invalid production source path: ${file.path}.`);
      if (file.fingerprint && (info.size !== file.fingerprint.bytes ||
          Math.trunc(info.mtimeMs) !== file.fingerprint.mtimeMs))
        throw new Error(`Source changed since ingest: ${file.path}. Re-audit before sending.`);
      return path;
    })();
    checked.set(id, task);
    return task;
  }
  return async (id: string) => {
    const pending = [id];
    const visited = new Set<string>();
    while (pending.length) {
      const next = pending.pop()!;
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(...(files.get(next)?.dependencies ?? []));
    }
    await Promise.all([...visited].map(get));
    return get(id);
  };
}

const roles = ["base_color", "normal", "specular_roughness", "metalness"] as const;
type Role = typeof roles[number];
const unit = (x: unknown): x is number => typeof x === "number" && x >= 0 && x <= 1;

export async function compileHoudiniArnold(asset: AssetManifest, roots: SharedLibraryRoot[]) {
  const { representation: r, bindings, files, textures, materials } = selectAssetHandoff(asset, "houdini", "arnold");
  const source = files.get(r.file)!;
  if (source.purpose !== "source" || source.role !== "geometry" || source.format.toLowerCase() !== "abc")
    throw new Error("Live Houdini Send currently requires source Alembic; FBX is recorded but this adapter does not support it.");
  if (!["static-mesh", "geometry-cache"].includes(r.kind) || r.selection.kind !== "all" || r.motion)
    throw new Error("This Houdini adapter cannot preserve object selections, rigs, or animated geometry yet.");
  if (!r.coordinates.metersPerUnit || r.coordinates.up !== "+Y" || r.coordinates.handedness !== "right" ||
      !r.coordinates.evidence.some(id => asset.evidence.some(e => e.id === id && e.status === "verified")))
    throw new Error("Houdini Send needs verified right-handed Y-up geometry, source units and axis evidence.");
  if (!bindings?.complete || bindings.table || !bindings.assignments.length || bindings.assignments.length > 256)
    throw new Error("Houdini Send needs complete inline material assignments within the connector limit.");
  const kinds = new Set(bindings.assignments.map(x => x.kind));
  if (kinds.size !== 1 || (!kinds.has("source-material") && !kinds.has("object-path")))
    throw new Error("Houdini Send does not support these assignment selectors.");
  const bindingAttribute = kinds.has("object-path") ? "path" : "shop_materialpath";
  const resolveFile = assetFileResolver(asset, roots);
  const geometry = await resolveFile(r.file);
  if (extname(geometry).toLowerCase() !== ".abc") throw new Error("Production geometry is not an Alembic file.");
  await Promise.all(r.dependencies.map(resolveFile));
  const looks = new Map<string, Promise<{ maps: Partial<Record<Role, { path: string; fileColorSpace: string }>>;
    baseColor?: [number, number, number]; roughness?: number }>>();
  function look(id: string) {
    if (!looks.has(id)) looks.set(id, (async () => {
      const m = materials.get(id)!;
      const p = m.portable;
      if (!p || p.model !== "standard-surface" || p.limitations.length ||
          Object.keys(p.parameters).some(key => !["baseColor", "roughness"].includes(key)))
        throw new Error(`Arnold cannot preserve the declared look for ${m.name}. Review the manifest limitations.`);
      const { baseColor, roughness } = p.parameters;
      if (baseColor !== undefined && (!Array.isArray(baseColor) || baseColor.length !== 3 || !baseColor.every(unit)) ||
          roughness !== undefined && !unit(roughness))
        throw new Error(`Invalid portable material parameters for ${m.name}.`);
      const maps: Partial<Record<Role, { path: string; fileColorSpace: string }>> = {};
      for (const input of p.inputs) {
        const role = input.role as Role;
        const texture = textures.get(input.texture)!;
        const encoding = texture.encoding;
        if (!roles.includes(role) || maps[role] || input.alphaMeaning || input.sampling || input.uvSet ||
            (input.component !== undefined && input.component !== "rgb") || texture.source.kind !== "file" ||
            !encoding.space || !/^[\w .()+-]{1,80}$/.test(encoding.space) || encoding.space.toLowerCase() === "auto" ||
            encoding.customConfig || encoding.gamma || encoding.downstreamSpace || encoding.expectedWorkingSpace ||
            !encoding.evidence.some(id => asset.evidence.some(e => e.id === id && e.status === "verified")))
          throw new Error(`Arnold cannot preserve ${InputLabel(input.role, m.name)} or its file encoding is unverified.`);
        maps[role] = { path: await resolveFile(texture.source.file), fileColorSpace: encoding.space };
      }
      if (!maps.base_color && baseColor === undefined) throw new Error(`Missing base color for ${m.name}.`);
      return { maps, ...(baseColor !== undefined ? { baseColor: baseColor as [number, number, number] } : {}),
        ...(roughness !== undefined ? { roughness: roughness as number } : {}) };
    })());
    return looks.get(id)!;
  }
  const result = await Promise.all(bindings.assignments.map(async a => {
    if (!/^(?:\/[a-zA-Z0-9_.-]+)+$/.test(a.key)) throw new Error(`Unsupported Alembic assignment selector: ${a.key}.`);
    return { group: a.key, materialId: a.material, ...(await look(a.material)) };
  }));
  return { geometry, bindingAttribute, metersPerUnit: r.coordinates.metersPerUnit, materials: result };
}

function InputLabel(role: string, material: string) {
  return `the ${role} input of ${material}`;
}
