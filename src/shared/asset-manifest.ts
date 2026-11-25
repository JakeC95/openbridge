import { z } from "zod";

const text = z.string().min(1);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const vector = z.tuple([z.number(), z.number(), z.number()]);
const jsonFields = z.record(text, z.json());
const refs = z.array(id).default([]);
const path = text.refine(value => !/[\x00-\x1f\\$`]/.test(value) &&
  !value.startsWith("/") && !value.includes(":") &&
  value.split("/").every(part => part && part !== "." && part !== ".."), "Expected a library-root-relative path.");
const evidence = z.strictObject({
  id, status: z.enum(["verified", "inferred", "translated", "missing", "unsupported"]),
  method: text, note: text, files: refs
});
const file = z.strictObject({
  id, root: id, path, format: text,
  purpose: z.enum(["source", "production-derivative", "preview", "evidence"]),
  role: z.enum(["geometry", "texture", "native-scene", "rig", "animation", "material-graph", "assignment-table", "ocio-config", "other"]),
  fingerprint: z.strictObject({
    bytes: z.number().int().nonnegative(), mtimeMs: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
  }).optional(),
  dependencies: refs, evidence: refs
});
const coordinates = z.strictObject({
  metersPerUnit: z.number().positive().nullable(),
  up: z.enum(["+X", "-X", "+Y", "-Y", "+Z", "-Z"]).nullable(),
  forward: z.enum(["+X", "-X", "+Y", "-Y", "+Z", "-Z"]).nullable(),
  handedness: z.enum(["right", "left"]).nullable(),
  evidence: refs
});
const representation = z.strictObject({
  id, file: id, variant: id, lod: z.number().int().nonnegative().optional(),
  kind: z.enum(["static-mesh", "geometry-cache", "rig", "animation", "native-scene", "preview"]),
  selection: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("all") }),
    z.strictObject({ kind: z.literal("objects"), paths: z.array(text).min(1) })
  ]),
  coordinates, bindingSet: id.optional(), evidence: refs, dependencies: refs,
  geometry: z.strictObject({
    faces: z.number().int().nonnegative().optional(),
    parts: z.array(z.strictObject({
      id, path: text, originalName: text.optional(), parent: id.optional(), instances: id.optional(),
      faces: z.number().int().nonnegative().optional(), transform: z.array(z.number()).length(16).optional(),
      pivot: vector.optional(), visible: z.boolean().optional()
    })).optional(),
    bounds: z.strictObject({ min: vector, max: vector }).optional(),
    uvSets: z.array(text).optional(), normals: text.optional(), subdivision: jsonFields.optional()
  }).optional(),
  motion: z.strictObject({ start: z.number(), end: z.number(), fps: z.number().positive(), rig: id.optional() }).optional(),
  retained: z.array(text).default([]), losses: z.array(text).default([]), extensions: jsonFields.optional()
});
const encoding = z.strictObject({
  space: text.nullable(), customConfig: id.optional(), expectedWorkingSpace: text.optional(),
  bakedTransform: text.optional(), gamma: z.number().positive().optional(),
  downstreamSpace: text.optional(), evidence: refs
});
const texture = z.strictObject({
  id, encoding,
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("file"), file: id }),
    z.strictObject({ kind: z.literal("udim"), pattern: text,
      tiles: z.array(z.strictObject({ tile: z.number().int().min(1001), file: id })).min(1) }),
    z.strictObject({ kind: z.literal("sequence"), pattern: text, files: z.array(id).min(1), start: z.number().int(), end: z.number().int() })
  ]),
  resolution: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  bitDepth: z.number().int().positive().optional(), evidence: refs, extensions: jsonFields.optional()
});
const material = z.strictObject({
  id, name: text, evidence: refs,
  native: z.strictObject({
    renderer: text, shader: text.optional(), graph: id.optional(), plugins: z.array(text).default([]),
    parameters: jsonFields.optional(), connections: z.array(z.strictObject({ from: text, to: text })).optional()
  }).optional(),
  portable: z.strictObject({
    model: text,
    parameters: jsonFields.default({}),
    inputs: z.array(z.strictObject({
      role: text, texture: id, component: z.enum(["rgb", "r", "g", "b", "a"]).optional(),
      uvSet: text.optional(), alphaMeaning: z.enum(["opacity", "transparency"]).optional(),
      sampling: jsonFields.optional(), evidence: refs
    })).default([]),
    limitations: z.array(text).default([])
  }).optional()
});
const bindingSet = z.strictObject({
  id, representation: id, evidence: refs, complete: z.boolean(),
  assignments: z.array(z.strictObject({
    kind: z.enum(["source-material", "object-path", "primitive-group", "all"]),
    key: z.string(), material: id, evidence: refs
  })).default([]),
  table: id.optional()
});
const handoff = z.strictObject({
  variant: id, representation: id.optional(), target: id, renderer: id.optional(),
  status: z.enum(["ready", "review", "blocked", "unverified"]), reasons: z.array(text).default([]), evidence: refs
});

export const assetManifestSchema = z.strictObject({
  schemaVersion: z.literal(1), id, name: text, kind: text, defaultVariant: id,
  variants: z.array(z.strictObject({ id, name: text, evidence: refs })).min(1),
  files: z.array(file), representations: z.array(representation), textures: z.array(texture),
  materials: z.array(material), bindingSets: z.array(bindingSet), evidence: z.array(evidence),
  handoffs: z.array(handoff).default([]),
  provenance: z.strictObject({
    productionRenderer: text.optional(), provider: text.optional(), license: text.optional(),
    credits: z.array(z.strictObject({ role: text, name: text })).optional(), evidence: refs
  }).optional(),
  extensions: jsonFields.optional()
}).superRefine((data, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  function index<T extends { id: string }>(items: T[], name: string) {
    const byId = new Map(items.map(x => [x.id, x]));
    if (byId.size !== items.length) issue(`Duplicate ${name} IDs.`);
    return byId;
  }
  const files = index(data.files, "file");
  const variants = index(data.variants, "variant");
  const representations = index(data.representations, "representation");
  const textures = index(data.textures, "texture");
  const materials = index(data.materials, "material");
  const sets = index(data.bindingSets, "binding set");
  const evidence = index(data.evidence, "evidence");
  const require = <T>(map: Map<string, T>, key: string, type: string) => {
    const item = map.get(key);
    if (!item) issue(`Unresolved ${type}: ${key}.`);
    return item;
  };
  const ev = (ids: string[]) => ids.forEach(x => require(evidence, x, "evidence"));
  const dependencies = (ids: string[]) => ids.forEach(x => require(files, x, "file dependency"));
  require(variants, data.defaultVariant, "default variant");
  data.variants.forEach(v => ev(v.evidence));
  data.evidence.forEach(e => dependencies(e.files));
  data.files.forEach(f => { ev(f.evidence); dependencies(f.dependencies); });
  if (data.provenance) ev(data.provenance.evidence);
  for (const r of data.representations) {
    const f = require(files, r.file, "representation file");
    require(variants, r.variant, "representation variant");
    ev(r.evidence);
    ev(r.coordinates.evidence);
    dependencies(r.dependencies);
    if (r.bindingSet && require(sets, r.bindingSet, "binding set")?.representation !== r.id)
      issue(`Binding set belongs to another representation: ${r.bindingSet}.`);
    if (r.motion?.rig) require(representations, r.motion.rig, "rig representation");
    if (r.motion && r.motion.start > r.motion.end) issue(`Invalid frame range: ${r.id}.`);
    if (r.coordinates.up && r.coordinates.forward && r.coordinates.up[1] === r.coordinates.forward[1])
      issue(`Up and forward axes overlap: ${r.id}.`);
    if (f && (r.kind === "preview") !== (f.purpose === "preview")) issue(`Inconsistent preview purpose: ${r.id}.`);
    if (f && r.kind !== "preview" && (f.format.toLowerCase() === "glb" || /\.gl(?:b|tf)$/i.test(f.path)))
      issue(`Preview geometry cannot be a DCC representation: ${r.id}.`);
    const parts = index(r.geometry?.parts ?? [], "part");
    for (const p of parts.values()) {
      if (p.parent) require(parts, p.parent, "part parent");
      if (p.instances) require(parts, p.instances, "instanced part");
    }
  }
  for (const set of data.bindingSets) {
    require(representations, set.representation, "bound representation");
    ev(set.evidence);
    if (set.table && require(files, set.table, "assignment table")?.role !== "assignment-table")
      issue(`Invalid assignment table: ${set.table}.`);
    if (set.complete && !set.table && !set.assignments.length) issue(`Complete binding set is empty: ${set.id}.`);
    const keys = new Set<string>();
    for (const a of set.assignments) {
      ev(a.evidence);
      require(materials, a.material, "assigned material");
      const key = `${a.kind}:${a.key}`;
      if (keys.has(key) || (a.kind === "all" ? a.key !== "" || set.assignments.length > 1 : !a.key))
        issue(`Invalid or repeated binding: ${key}.`);
      keys.add(key);
    }
  }
  for (const t of data.textures) {
    ev(t.evidence);
    ev(t.encoding.evidence);
    if (t.encoding.customConfig && require(files, t.encoding.customConfig, "OCIO config")?.role !== "ocio-config")
      issue(`Invalid OCIO config file: ${t.encoding.customConfig}.`);
    const s = t.source;
    const ids = s.kind === "file" ? [s.file] : s.kind === "udim" ? s.tiles.map(x => x.file) : s.files;
    for (const key of ids) {
      const f = require(files, key, "texture file");
      if (f && (f.role !== "texture" || !["source", "production-derivative"].includes(f.purpose)))
        issue(`Not a production texture file: ${key}.`);
    }
    if (s.kind === "udim" && (!s.pattern.includes("<UDIM>") || new Set(s.tiles.map(x => x.tile)).size !== s.tiles.length))
      issue(`Invalid UDIM set: ${t.id}.`);
    if (s.kind === "sequence" && s.end - s.start + 1 !== s.files.length) issue(`Invalid texture sequence: ${t.id}.`);
  }
  const dataRoles = new Set([
    "normal", "specular_roughness", "roughness", "gloss", "metalness",
    "opacity", "displacement", "height"
  ]);
  for (const m of data.materials) {
    ev(m.evidence);
    if (m.native?.graph) require(files, m.native.graph, "native graph");
    for (const input of m.portable?.inputs ?? []) {
      const texture = require(textures, input.texture, "material input texture");
      ev(input.evidence);
      if (!texture) continue;
      if (dataRoles.has(input.role.toLowerCase())) {
        if (texture.encoding.bakedTransform &&
            !/^none$/i.test(texture.encoding.bakedTransform.trim()))
          issue(`Texture ${texture.id} has a baked color transform and cannot feed ${input.role} as data.`);
        if (!texture.encoding.space ||
            !/^(raw|data|linear|utility - raw|utility - linear - srgb)$/i.test(texture.encoding.space.trim()))
          issue(`Data input ${input.role} requires a Raw/data file encoding, not ${texture.encoding.space ?? "undocumented"}.`);
      }
      if (texture.encoding.bakedTransform && !texture.encoding.space)
        issue(`Texture ${texture.id} records a baked transform but not the resulting file encoding.`);
    }
  }
  const routes = new Set<string>();
  for (const h of data.handoffs) {
    require(variants, h.variant, "handoff variant");
    ev(h.evidence);
    const r = h.representation ? require(representations, h.representation, "handoff representation") : undefined;
    if (r && (r.variant !== h.variant || r.kind === "preview")) issue(`Invalid handoff representation: ${h.representation}.`);
    if (h.status === "ready" && (!r || !h.evidence.some(id => evidence.get(id)?.status === "verified")))
      issue(`A ready handoff needs a selected representation and verification evidence: ${h.target}.`);
    const key = `${h.variant}:${h.target}:${h.renderer ?? ""}`;
    if (routes.has(key)) issue(`Duplicate handoff route: ${key}.`);
    routes.add(key);
  }
});

export type AssetManifest = z.infer<typeof assetManifestSchema>;
export function parseAssetManifest(input: unknown): AssetManifest {
  const result = assetManifestSchema.safeParse(input);
  if (!result.success) throw new Error(`Invalid asset.json: ${result.error.issues.slice(0, 5)
    .map(e => `${e.path.length ? `${e.path.join(".")}: ` : ""}${e.message}`).join("; ")}`);
  return result.data;
}
