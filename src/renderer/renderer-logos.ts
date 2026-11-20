import arnoldLogo from "./renderers/arnold.svg";

export interface RendererLogo {
  name: string;
  src: string;
}

const RENDERER_LOGOS: Array<{ match: RegExp; logo: RendererLogo }> = [
  { match: /\barnold\b/i, logo: { name: "Arnold", src: arnoldLogo } }
];

export function rendererLogo(renderer: string | undefined): RendererLogo | null {
  if (!renderer) return null;
  return RENDERER_LOGOS.find(entry => entry.match.test(renderer))?.logo ?? null;
}
