import type { CategoryNode } from "../shared/types";
import type { PublicCatalogQuery, PublicProviderId } from "../shared/public-providers";
import { allSourceCategory } from "./all-sources";

const TYPES: Record<PublicProviderId, Record<string, string[]>> = {
  ambientcg: { hdri: ["hdri", "hdri-element"], surface: ["material", "substance", "plain-image"], "3d": ["3d-model", "terrain"], plant: ["3d-model"], atlas: ["atlas"], decal: ["decal"], brush: ["brush"], imperfection: ["material"] },
  blenderkit: { hdri: ["hdr"], surface: ["material"], "3d": ["model"], plant: ["model"], brush: ["brush"] },
  openhdri: { hdri: ["hdri"] }
};

export function publicTypesForRoot(provider: PublicProviderId, value: string): string[] {
  return value ? TYPES[provider][value.split(":")[0]] ?? ["__none__"] : [];
}

/** A provider category tree node implies a concrete source type; keep browsing coherent. */
export function publicTypeForCategory(provider: PublicProviderId, category: string): string | null {
  if (!category) return null;
  if (provider === "openhdri") return "hdri";
  if (provider === "blenderkit") {
    if (category.startsWith("hdr")) return "hdr";
    if (category.startsWith("material")) return "material";
    if (category.startsWith("model")) return "model";
    if (category.startsWith("brush")) return "brush";
    return null;
  }
  if (category.startsWith("HDRIs/Elements")) return "hdri-element";
  if (category.startsWith("HDRIs")) return "hdri";
  if (category.startsWith("Materials")) return "material";
  if (category.startsWith("Substances")) return "substance";
  if (category.startsWith("3D Models")) return "3d-model";
  if (category.startsWith("Terrains")) return "terrain";
  if (category.startsWith("Decals")) return "decal";
  if (category.startsWith("Atlases")) return "atlas";
  if (category.startsWith("Brushes")) return "brush";
  if (category.startsWith("Photo Textures")) return "plain-image";
  return null;
}

const CATEGORY_MATCH: Record<string, RegExp> = {
  "3d:architecture": /architectur|building|door|window|stair|fence|column/i,
  "3d:furniture": /furniture|chair|table|sofa|couch|bed|cabinet|shelving|shelf|stool/i,
  "3d:decor": /decoration|decorative|ornament|sculpture|vase|artwork|lighting|lamp/i,
  "3d:food": /\bfood\b|fruit|vegetable|bread|bakery|beverage/i,
  "3d:nature": /\bnature\b|rock|stone|terrain|wood|branch|stump|log\b/i,
  "3d:industrial": /industrial|machinery|machine|equipment|tool/i,
  "3d:historical": /historical|antique|archaeolog|artifact/i,
  plant: /plant|vegetation|tree|flower|succulent|cactus|grass|bush|shrub/i,
  "plant:houseplants": /houseplant|potted|indoor plant/i,
  "plant:garden": /garden|bush|shrub/i,
  "plant:flowers": /flower/i,
  "plant:ground": /grass|groundcover|fern|moss/i,
  "plant:succulents": /succulent|cactus|cacti/i,
  "plant:trees": /\btree/i,
  "surface:wood": /wood|plank|parquet/i,
  "surface:stone": /stone|marble|granite|slate|rock/i,
  "surface:concrete": /concrete|cement/i,
  "surface:brick": /brick/i,
  "surface:metal": /metal|rust|steel|alumin|copper|iron/i,
  "surface:fabric": /fabric|leather|carpet|textile|cloth|denim|wool/i,
  "surface:ground": /ground|grass|dirt|soil|sand|gravel|snow|ice|mud|moss|forest floor/i,
  "surface:urban": /asphalt|paving|pavement|road|cobble/i,
  "surface:walls": /plaster|wall|roof|tile|paint|stucco/i,
  "surface:other": /plastic|rubber|glass|paper|foam|ornament|organic|animal|liquid/i,
  "atlas:plants": /plant|leaf|leaves|vegetation|flower|grass/i,
  "atlas:debris": /debris|rubble|litter|rock|stone/i,
  "atlas:water": /water|liquid|foam/i,
  "decal:street": /street|road|marking|asphalt/i,
  "decal:vegetation": /vegetation|plant|leaf|leaves|moss/i,
  "decal:graffiti": /graffiti/i,
  "decal:damage": /damage|crack|scratch|hole/i,
  "decal:debris": /debris|rubble|litter/i,
  "brush:damage": /damage|crack|scratch/i,
  "brush:graffiti": /graffiti/i,
  "brush:stains": /stain|dirt|grunge/i,
  "brush:natural": /nature|natural|rock|stone|terrain/i,
  imperfection: /imperfection|scratch|smudge|fingerprint|grunge/i,
  "imperfection:damage": /scratch|damage/i,
  "imperfection:dirt": /dirt|smudge|fingerprint/i,
  "imperfection:grunge": /grunge/i
};

/** Return actual provider keys. A parent match subsumes its descendants. */
function matchingPaths(nodes: CategoryNode[], pattern: RegExp, provider: PublicProviderId, trail: string[] = []): string[] {
  return nodes.flatMap(node => {
    const path = [...trail, node.label];
    // Root type labels are not artist subcategories (e.g. "3D Models").
    if (trail.length && pattern.test(node.label)) return [node.key];
    return matchingPaths(node.children, pattern, provider, path);
  });
}

const HDRI_GROUPS: Record<string, string[]> = {
  "hdri:skies": ["Skies"], "hdri:skies:pure": ["Skies"],
  "hdri:interiors": ["Interiors"], "hdri:studio": ["Studio"],
  "hdri:nature": ["Fields & Countryside", "Forest & Woodland", "Mountains & Hills", "Coast & Water", "Desert & Arid", "Parks & Gardens"],
  "hdri:nature:fields": ["Fields & Countryside"], "hdri:nature:forest": ["Forest & Woodland"],
  "hdri:nature:mountains": ["Mountains & Hills"], "hdri:nature:coast": ["Coast & Water"],
  "hdri:nature:desert": ["Desert & Arid"], "hdri:nature:parks": ["Parks & Gardens"],
  "hdri:built": ["Streets & Town", "Industrial", "Abandoned & Ruins"],
  "hdri:built:streets": ["Streets & Town"], "hdri:built:industrial": ["Industrial"], "hdri:built:abandoned": ["Abandoned & Ruins"],
  "hdri:general": ["General"]
};

/** Unknown leaves stay empty; known mappings use exact published category keys/prefixes. */
export function publicCategoryQuery(provider: PublicProviderId, value: string, categories: CategoryNode[] = []): Partial<PublicCatalogQuery> {
  // Do not clear weather/time on unrelated category changes; only a weather node sets them.
  const base: Partial<PublicCatalogQuery> = { types: publicTypesForRoot(provider, value), categoryPaths: [] };
  const exclude = (): Partial<PublicCatalogQuery> => ({ ...base, types: ["__none__"] });
  if (!value || !value.includes(":") && !["plant", "imperfection"].includes(value)) return base;
  const node = allSourceCategory(value);
  if (value.startsWith("hdri:")) {
    if (node.poliigonWeather?.length) return provider === "blenderkit" ? exclude() : { ...base, weather: node.poliigonWeather, timeStart: node.poliigonTimeStart, timeEnd: node.poliigonTimeEnd };
    if (["hdri:night", "hdri:evening", "hdri:sunrise-sunset"].includes(value)) {
      if (provider === "blenderkit") return exclude();
      if (value === "hdri:sunrise-sunset") return { ...base, timeWindows: [{ start: 4, end: 8 }, { start: 17, end: 20 }] };
      return { ...base, timeStart: value === "hdri:night" ? 21 : value === "hdri:evening" ? 17 : 17, timeEnd: value === "hdri:night" ? 4 : value === "hdri:evening" ? 21 : 19 };
    }
    const labels = HDRI_GROUPS[value]; if (!labels) return exclude();
    if (provider === "blenderkit") {
      const expressions: Record<string, RegExp> = {
        "hdri:interiors": /^indoor$/i, "hdri:studio": /studio/i, "hdri:skies": /sky|skies/i, "hdri:skies:pure": /sky|skies/i,
        "hdri:nature": /nature|forest|mountain|coast|beach|desert|park|garden|field|countryside/i,
        "hdri:nature:fields": /field|countryside/i, "hdri:nature:forest": /forest|woodland/i, "hdri:nature:mountains": /mountain|hill/i,
        "hdri:nature:coast": /coast|beach|water/i, "hdri:nature:desert": /desert|arid/i, "hdri:nature:parks": /park|garden/i,
        "hdri:built": /urban|city|town|street|industrial|abandoned/i, "hdri:built:streets": /urban|city|town|street/i,
        "hdri:built:industrial": /industrial/i, "hdri:built:abandoned": /abandoned|ruin/i
      };
      const pattern = expressions[value];
      const roots = categories.filter(root => root.key === "hdr");
      const paths = pattern ? matchingPaths(roots, pattern, provider) : [];
      return paths.length ? { ...base, categoryPaths: paths } : exclude();
    }
    const paths = labels.map(label => ["Skies", "Interiors", "Studio"].includes(label) ? `HDRIs/${label}` : `HDRIs/Outdoor/${label}`);
    return { ...base, categoryPaths: paths };
  }
  const pattern = CATEGORY_MATCH[value]; if (!pattern) return exclude();
  const root = value.split(":")[0];
  const rootKeys = provider === "blenderkit" ? root === "surface" ? ["material"] : root === "brush" ? ["brush"] : ["model"] : root === "surface" || root === "imperfection" ? ["Materials", "Substances", "Photo Textures"] : root === "plant" || root === "3d" ? ["3D Models", "Terrains"] : root === "atlas" ? ["Atlases"] : root === "decal" ? ["Decals"] : ["Brushes"];
  const roots = categories.filter(node => rootKeys.includes(node.key) || rootKeys.includes(node.label));
  const paths = matchingPaths(roots, pattern, provider);
  return paths.length ? { ...base, categoryPaths: paths } : exclude();
}
