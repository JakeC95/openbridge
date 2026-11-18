export interface SearchMatch {
  name: string;
  typeLabel?: string;
  tags?: string[];
  categories?: string[];
}

export interface SearchRankEntry<T> {
  item: T;
  /** Provider owning this result, used for diversity in the merged page. */
  provider: string;
  /** Provider-native rank position, starting at zero. */
  groupIndex: number;
  match: SearchMatch;
  popularity?: number | null;
  free?: boolean;
}

const HDRI_WORDS = new Set([
  "hdri", "hdr", "sky", "skies", "sunset", "sunrise", "dawn", "dusk", "cloud",
  "cloudy", "overcast", "storm", "night", "panorama", "environment", "studio",
  "backplate", "lighting"
]);

const TEXTURE_WORDS = new Set([
  "texture", "material", "surface", "brick", "wood", "concrete", "stone",
  "tile", "fabric", "cloth", "metal", "paint", "marble", "ground", "floor",
  "wall", "sand", "snow", "gravel", "asphalt", "plaster", "atlas", "decal",
  "brush", "imperfection", "displacement", "orm", "roughness"
]);

const MODEL_WORDS = new Set([
  "model", "plant", "tree", "chair", "table", "furniture", "rock", "prop",
  "decor", "vegetation", "flower", "bush", "fern", "pot", "vase", "lamp",
  "stool", "candle", "bowl", "sculpt", "asset"
]);

/** Parts of a whole object; demoted when the query asks for the whole object. */
const SUBASSET_WORDS = new Set([
  "branch", "branches", "log", "logs", "stump", "stumps", "root", "roots",
  "trunk", "trunks", "bark", "twig", "twigs", "leaf", "leaves", "needle", "needles", "fungus",
  "fungi", "mushroom", "mushrooms", "moss", "lichen", "seed", "seeds", "cone",
  "cones", "plank", "planks", "board", "boards", "slice", "slices",
  "gobo", "billboard", "impostor", "proxy", "decal"
]);

function words(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(Boolean);
}

function normalized(value: string): string {
  return words(value).join(" ");
}

const VARIANT_SEASONS = new Set(["autumn", "winter", "spring", "summer"]);

/** Collapse LOD/variant/season suffixes for duplicate detection in one page. */
function duplicateKey(value: string): string {
  const tokens = words(value);
  return tokens.filter((token, index) => {
    if (token === "lod" || token === "var" || token === "variant") return false;
    const previous = tokens[index - 1];
    if ((previous === "lod" || previous === "var" || previous === "variant") && /^\d+$/.test(token)) return false;
    if (VARIANT_SEASONS.has(token)) return false;
    return true;
  }).join(" ");
}

function containsToken(haystack: string, token: string): boolean {
  // Both arguments are normalized to single-space-delimited words.
  return ` ${haystack} `.includes(` ${token} `);
}

function typeFamily(typeLabel: string): "hdri" | "texture" | "model" | "other" {
  const text = typeLabel.toLowerCase();
  if (/\bhdri\b|\bhdr\b|panorama|sky/.test(text)) return "hdri";
  if (/plant|model|3d|vegetation|tree|furniture/.test(text)) return "model";
  if (/texture|material|surface|atlas|decal|brush|imperfection|displacement/.test(text)) return "texture";
  return "other";
}

/** Text relevance for a single result. Higher is better. */
export function searchTextScore(query: string, match: SearchMatch): number {
  const tokens = words(query);
  if (!tokens.length) return 0;
  const name = normalized(match.name);
  const tagText = normalized([...(match.tags ?? []), ...(match.categories ?? [])].join(" "));
  const full = tokens.join(" ");
  let score = 0;
  if (name === full) score += 140;
  else if (name.startsWith(`${full} `) || name.startsWith(full)) score += 95;
  else if (containsToken(name, full) || name.includes(full)) score += 72;
  else if (tokens.every(token => name.includes(token))) score += 52;
  else if (tokens.every(token => name.includes(token) || tagText.includes(token))) score += 32;
  else if (tokens.some(token => name.includes(token))) score += 12;

  for (const token of tokens) {
    if (containsToken(name, token)) score += 10;
    else if (name.includes(token)) score += 4;
    if (containsToken(tagText, token)) score += 5;
    else if (tagText.includes(token)) score += 2;
  }
  return score;
}

export function providerRankScore(groupIndex: number): number {
  return Math.max(0, 20 - Math.max(0, groupIndex) * 3);
}

export function popularityScore(value: number | null | undefined): number {
  if (!value || value <= 0) return 0;
  return Math.min(8, Math.log10(value + 1) * 2);
}

/** Small query-intent boost so "sunset" favours HDRIs and "brick" favours materials. */
export function searchIntentBoost(query: string, typeLabel: string): number {
  const tokens = words(query);
  if (!tokens.length) return 0;
  const family = typeFamily(typeLabel);
  const hdriIntent = tokens.some(token => HDRI_WORDS.has(token));
  const textureIntent = tokens.some(token => TEXTURE_WORDS.has(token));
  const modelIntent = tokens.some(token => MODEL_WORDS.has(token));
  let boost = 0;
  if (hdriIntent) boost += family === "hdri" ? 24 : -10;
  if (textureIntent) boost += family === "texture" ? 20 : -6;
  if (modelIntent) boost += family === "model" ? 26 : -12;
  return boost;
}

/** Whole-object queries should not be filled with branches, stumps or bark. */
export function searchSpecificityPenalty(query: string, match: SearchMatch): number {
  const queryTokens = words(query);
  if (queryTokens.length !== 1) return 0;
  const requested = new Set(queryTokens);
  const nameTokens = words(match.name);
  return nameTokens.some(token => SUBASSET_WORDS.has(token) && !requested.has(token)) ? -35 : 0;
}

export function rankSearchEntries<T>(query: string, entries: SearchRankEntry<T>[]): T[] {
  if (!words(query).length) return entries.map(entry => entry.item);
  const scored = entries.map((entry, order) => ({
    entry,
    order,
    name: duplicateKey(entry.match.name),
    score: searchTextScore(query, entry.match)
      + providerRankScore(entry.groupIndex)
      + popularityScore(entry.popularity)
      + searchIntentBoost(query, entry.match.typeLabel ?? "")
      + searchSpecificityPenalty(query, entry.match)
      + (entry.free ? 2 : 0)
  }));
  scored.sort((a, b) => b.score - a.score || a.order - b.order);

  // BlenderKit and some plant packs expose many near-identical "Tree" variants.
  // Keep the first exact match, then lightly reward provider variety so the
  // first page is useful rather than five copies of one catalogue entry.
  const providerCounts = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  const remaining = scored;
  const ranked: T[] = [];
  // Apply diversity near the top, where it makes repeated variants easier to
  // browse past. Keep deep pages in relevance order without a quadratic scan.
  const diversityLimit = 120;
  while (remaining.length > 0 && ranked.length < diversityLimit) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const adjusted = candidate.score
        - (providerCounts.get(candidate.entry.provider) ?? 0) * 4
        - (nameCounts.get(candidate.name) ?? 0) * 100;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    ranked.push(chosen.entry.item);
    providerCounts.set(chosen.entry.provider, (providerCounts.get(chosen.entry.provider) ?? 0) + 1);
    nameCounts.set(chosen.name, (nameCounts.get(chosen.name) ?? 0) + 1);
  }
  for (const candidate of remaining) ranked.push(candidate.entry.item);
  return ranked;
}
