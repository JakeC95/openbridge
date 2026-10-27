const QUIXEL_URL_PATTERN =
  /(?:^|\/\/)(?:www\.)?(?:quixel\.com|megascans\.com)\/(?:assets?|asset)\/([a-z0-9_-]+)/i;
const PREFIXED_ASSET_PATTERN = /^(?:asset|id)\s*[:=]\s*([a-z0-9_-]+)$/i;

export interface ParsedSearchQuery {
  text: string;
  direct: boolean;
}

export function normalizeSearchText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const text = normalizeSearchText(input);
  if (!text) return { text: "", direct: false };

  const quixelMatch = text.match(QUIXEL_URL_PATTERN);
  if (quixelMatch?.[1]) return { text: quixelMatch[1], direct: true };

  const prefixed = text.match(PREFIXED_ASSET_PATTERN);
  if (prefixed?.[1]) return { text: prefixed[1], direct: true };

  return { text, direct: false };
}

export function localSearchTokens(input: string): string[] {
  const normalized = normalizeSearchText(input).toLowerCase();
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

export function matchesLocalSearch(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const text = haystack.toLowerCase();
  return tokens.every(token => text.includes(token));
}
