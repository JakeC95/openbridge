import { rendererLogo, softwareLogo } from "../renderer-logos";

export function RendererMark({ renderer, className = "" }: { renderer?: string; className?: string }) {
  const logo = rendererLogo(renderer);
  return <Mark logo={logo} className={className} />;
}

export function SoftwareMark({ software, className = "" }: { software?: string; className?: string }) {
  const logo = softwareLogo(software);
  return <Mark logo={logo} className={className} />;
}

function Mark({ logo, className }: { logo: ReturnType<typeof rendererLogo>; className: string }) {
  if (!logo) return null;
  return <span className={`renderer-mark ${className}`.trim()} title={logo.name} aria-hidden="true">
    <img src={logo.src} alt="" draggable={false} className={logo.monochrome ? "monochrome" : undefined} />
  </span>;
}
