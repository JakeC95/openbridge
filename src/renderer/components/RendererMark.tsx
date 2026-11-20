import { rendererLogo } from "../renderer-logos";

export function RendererMark({ renderer, className = "" }: { renderer?: string; className?: string }) {
  const logo = rendererLogo(renderer);
  if (!logo) return null;
  return <span className={`renderer-mark ${className}`.trim()} title={logo.name} aria-hidden="true">
    <img src={logo.src} alt="" draggable={false} />
  </span>;
}
