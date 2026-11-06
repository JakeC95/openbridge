/**
 * Heuristic time-of-day for an HDRI, derived from the provider's name, tags,
 * categories and sun position. Values are hours in 0..24.
 *
 * `sun_position` is Poliigon's normalised [azimuth, elevation] pair. Elevation
 * maps smoothly to a daytime hour, then the azimuth (plus explicit morning /
 * afternoon / sunset tokens) decides whether it is AM or PM. When the sun is
 * not present, explicit time words in the name/category/tags are used, with a
 * midday fallback for ordinary daylight captures.
 */
export interface HdriTimeInput {
  name: string;
  tags: string[];
  categories: string[];
  sunPosition?: number[] | null;
}

export function hdriTimeOfDay(input: HdriTimeInput): number {
  const category = input.categories.join(" ").toLowerCase();
  const text = `${input.name} ${input.tags.join(" ")} ${category}`.toLowerCase();
  const has = (pattern: RegExp): boolean => pattern.test(text);

  // Strongest, unambiguous time-of-day tokens first.
  if (has(/\bmidnight\b|\bnight\b|\bnighttime\b|starry|moonlit/)) return 0;
  if (has(/blue hour|twilight/)) return 19.5;
  if (has(/\bdusk\b/)) return 19;
  if (has(/\bsunset\b|sundown|sun down/)) return 18;
  if (has(/\bsunrise\b|\bdawn\b|sunup|sun up/)) return 6;
  if (has(/golden hour/)) {
    return /sunset|evening|dusk/.test(category) ? 18 : 6;
  }
  if (has(/\bmorning\b/)) return 8.5;
  if (has(/\bafternoon\b/)) return 15;
  if (has(/\bmidday\b|\bnoon\b|mid-day/)) return 12;

  const elevation = input.sunPosition?.[1];
  if (typeof elevation === "number" && Number.isFinite(elevation)) {
    const clamped = Math.max(0, Math.min(1, elevation));
    const daylight = 6 + (12 * Math.asin(clamped)) / (Math.PI / 2); // 6..18
    const azimuth = input.sunPosition?.[0] ?? 0.5;
    return daylight < 12 && azimuth > 0.5 ? 24 - daylight : daylight;
  }

  if (has(/\bdaylight\b|\bdaytime\b|\bday\b/)) return 12;
  return 12;
}

export function normalizeHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

export function formatClock(hour: number): string {
  const normalized = normalizeHour(hour);
  const totalMinutes = Math.round(normalized * 60) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Like formatClock, but preserves the right-hand 24:00 end-of-day endpoint. */
export function formatClockValue(hour: number): string {
  return hour === 24 ? "24:00" : formatClock(hour);
}

/** Short, friendly label used on HDRI cards and metadata. */
export function formatHdriTime(hour: number | null | undefined): string {
  if (hour == null || !Number.isFinite(hour)) return "Unknown time";
  const normalized = normalizeHour(hour);
  if (normalized < 4) return "Night";
  if (normalized < 6.5) return "Dawn";
  if (normalized < 10) return "Morning";
  if (normalized < 13.5) return "Noon";
  if (normalized < 16.5) return "Afternoon";
  if (normalized < 18.5) return "Sunset";
  if (normalized < 21) return "Dusk";
  return "Night";
}
