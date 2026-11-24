import arnoldLogo from "./renderers/arnold.svg";
import houdiniLogo from "./renderers/houdini.svg";
import mayaLogo from "./renderers/maya.svg";
import nukeLogo from "./renderers/nuke.svg";
import vrayLogo from "./renderers/vray.svg";
import mentalRayLogo from "./renderers/mental-ray.png";
import mantraIcon from "./renderers/mantra.svg";

export interface RendererLogo {
  name: string;
  src: string;
  monochrome?: boolean;
}

const RENDERER_LOGOS: Array<{ match: RegExp; logo: RendererLogo }> = [
  { match: /\barnold\b/i, logo: { name: "Arnold", src: arnoldLogo } },
  { match: /\bv[\s‐‑–-]*ray\b/i, logo: { name: "V-Ray", src: vrayLogo } },
  { match: /\bmental[\s_-]*ray\b/i, logo: { name: "mental ray", src: mentalRayLogo } },
  { match: /\bmantra\b/i, logo: { name: "Mantra", src: mantraIcon } },
];

const SOFTWARE_LOGOS: Array<{ match: RegExp; logo: RendererLogo }> = [
  ...RENDERER_LOGOS,
  { match: /\bmaya\b/i, logo: { name: "Autodesk Maya", src: mayaLogo, monochrome: true } },
  { match: /\bhoudini\b/i, logo: { name: "Houdini", src: houdiniLogo, monochrome: true } },
  { match: /\bnuke\b/i, logo: { name: "Nuke", src: nukeLogo, monochrome: true } }
];

export function rendererLogo(renderer: string | undefined): RendererLogo | null {
  if (!renderer) return null;
  return RENDERER_LOGOS.find(entry => entry.match.test(renderer))?.logo ?? null;
}

export function softwareLogo(software: string | undefined): RendererLogo | null {
  return softwareLogos(software)[0] ?? null;
}

export function softwareLogos(software: string | undefined): RendererLogo[] {
  return software ? SOFTWARE_LOGOS.filter(entry => entry.match.test(software)).map(entry => entry.logo) : [];
}
