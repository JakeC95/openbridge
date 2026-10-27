import type { LegacyConfig } from "../shared/types";

declare const __OPENBRIDGE_CONFIG__: Partial<LegacyConfig> | undefined;

const injected =
  typeof __OPENBRIDGE_CONFIG__ === "object" && __OPENBRIDGE_CONFIG__ ? __OPENBRIDGE_CONFIG__ : {};

const defaults: LegacyConfig = {
  epicClientId: "",
  algoliaAppId: "",
  algoliaApiKey: "",
  algoliaIndex: "assets",
  apiBaseUrl: "https://quixel.com/",
  ssoBaseUrl: "https://accounts.quixel.se/api/v1/",
  signedUrlBase: "https://rps.quixel.com/",
  realm: "megascans-bridge"
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export const legacyConfig: LegacyConfig = {
  ...defaults,
  ...injected,
  epicClientId: env("OPENBRIDGE_EPIC_CLIENT_ID") ?? injected.epicClientId ?? defaults.epicClientId,
  algoliaAppId: env("OPENBRIDGE_ALGOLIA_APP_ID") ?? injected.algoliaAppId ?? defaults.algoliaAppId,
  algoliaApiKey:
    env("OPENBRIDGE_ALGOLIA_API_KEY") ?? injected.algoliaApiKey ?? defaults.algoliaApiKey,
  algoliaIndex:
    env("OPENBRIDGE_ALGOLIA_INDEX") ?? injected.algoliaIndex ?? defaults.algoliaIndex,
  apiBaseUrl: env("OPENBRIDGE_API_BASE") ?? injected.apiBaseUrl ?? defaults.apiBaseUrl,
  ssoBaseUrl: env("OPENBRIDGE_SSO_BASE") ?? injected.ssoBaseUrl ?? defaults.ssoBaseUrl,
  signedUrlBase: env("OPENBRIDGE_SIGNED_URL_BASE") ?? injected.signedUrlBase ?? defaults.signedUrlBase,
  realm: env("OPENBRIDGE_REALM") ?? injected.realm ?? defaults.realm
};

export const USER_AGENT = "megascans-bridge";

export function apiUrl(path: string): string {
  return new URL(path.replace(/^\//, ""), legacyConfig.apiBaseUrl).toString();
}

export function ssoUrl(path: string): string {
  return new URL(path.replace(/^\//, ""), legacyConfig.ssoBaseUrl).toString();
}
