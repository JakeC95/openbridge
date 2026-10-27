declare const __OPENBRIDGE_REPOSITORY__: string | undefined;

const injected =
  typeof __OPENBRIDGE_REPOSITORY__ === "string" ? __OPENBRIDGE_REPOSITORY__.trim() : "";

export const repository = injected;

export function releaseAssetUrl(fileName: string): string {
  if (!repository) return "";
  return `https://github.com/${repository}/releases/latest/download/${encodeURIComponent(fileName)}`;
}
