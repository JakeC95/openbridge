/**
 * Canonical HDRI sky conditions shared by Poly Haven (published weather
 * attributes) and Poliigon (derived from public names, tags and categories).
 *
 * Provider "category tags" are not reliable weather filters: an asset can be
 * tagged clear and partly cloudy at the same time, polygenic captures can have
 * fog on the ground under a clear sky, and Poliigon's Clear bucket contains a
 * few cloudy days. Artists expect "Clear" to mean clear, so the browsing
 * filters use this smaller, mutually meaningful vocabulary instead.
 */
export const SKY_CONDITIONS = [
  "clear",
  "partly_cloudy",
  "overcast",
  "fog",
  "rain",
  "snow"
] as const;

export type SkyCondition = (typeof SKY_CONDITIONS)[number];

const SKY_CONDITION_LABELS: Record<SkyCondition, string> = {
  clear: "Clear",
  partly_cloudy: "Partly cloudy",
  overcast: "Overcast",
  fog: "Fog & haze",
  rain: "Rain & storm",
  snow: "Snow"
};

const SKY_CONDITION_RANK = new Map<string, number>(
  SKY_CONDITIONS.map((value, index) => [value, index])
);

export function isSkyCondition(value: unknown): value is SkyCondition {
  return typeof value === "string" && SKY_CONDITION_RANK.has(value);
}

export function skyConditionLabel(value: string): string {
  return SKY_CONDITION_LABELS[value as SkyCondition] ?? value;
}

export function skyConditionRank(value: string): number {
  return SKY_CONDITION_RANK.get(value) ?? 999;
}

function text(value: string): string {
  return value.toLowerCase();
}

function classifyText(input: string): SkyCondition | null {
  const value = text(input);
  if (!value) return null;
  // Only explicit snow/rain language belongs in weather. A "snowy field under
  // a clear sky" is a clear-sky HDRI, not a snow-weather HDRI.
  if (/\bsnow(?:fall|ing|storm|y sky)\b|blizzard/.test(value)) return "snow";
  if (/\brain\b|rainy|rainfall|\bshower|thunder|lightning|storm/.test(value)) return "rain";
  if (/\bfog\b|foggy|\bmist\b|misty|\bhaze\b|hazy/.test(value)) return "fog";
  if (/overcast|heavy cloud|dark cloud|dense cloud|thick cloud|very cloudy|stormy/.test(value)) {
    return "overcast";
  }
  if (/partly|scattered|drifting|wispy|whispy|patchy|light cloud|lightly cloud|low cloud|some cloud|broken cloud|cloudy|cloud/.test(value)) {
    return "partly_cloudy";
  }
  if (/\bclear\b|sunny|blue sky/.test(value)) return "clear";
  return null;
}

/**
 * Derive a single sky condition for a Poliigon HDRI.
 *
 * Names are the strongest signal, followed by the public tags and finally the
 * provider's category path. This intentionally lets "Mostly Clear" remain
 * clear even when Poliigon's generic tag list also includes "cloudy sky".
 */
export function poliigonSkyCondition(input: {
  name: string;
  tags: string[];
  categories: string[];
}): SkyCondition | null {
  const fromName = classifyText(input.name);
  if (fromName) return fromName;

  const fromTags = classifyText(input.tags.join(" | "));
  if (fromTags) return fromTags;

  const categories = input.categories.map(text).join(" | ");
  if (/overcast/.test(categories)) return "overcast";
  if (/partly cloudy/.test(categories)) return "partly_cloudy";
  if (/sky \/ clear/.test(categories)) return "clear";
  return null;
}
