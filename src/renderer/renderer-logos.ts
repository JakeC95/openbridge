import arnoldLogo from "./renderers/arnold.svg";
import houdiniLogo from "./renderers/houdini.svg";
import mayaLogo from "./renderers/maya.svg";
import nukeLogo from "./renderers/nuke.svg";

export interface RendererLogo {
  name: string;
  src: string;
  monochrome?: boolean;
}

const SOFTWARE_LOGOS: Array<{ match: RegExp; logo: RendererLogo }> = [
  { match: /\barnold\b/i, logo: { name: "Arnold", src: arnoldLogo } },
  { match: /\bmaya\b/i, logo: { name: "Autodesk Maya", src: mayaLogo, monochrome: true } },
  { match: /\bhoudini\b/i, logo: { name: "Houdini", src: houdiniLogo, monochrome: true } },
  { match: /\bnuke\b/i, logo: { name: "Nuke", src: nukeLogo, monochrome: true } }
];

export function rendererLogo(renderer: string | undefined): RendererLogo | null {
  if (!renderer) return null;
  return softwareLogo(renderer);
}

export function softwareLogo(software: string | undefined): RendererLogo | null {
  if (!software) return null;
  return SOFTWARE_LOGOS.find(entry => entry.match.test(software))?.logo ?? null;
}
