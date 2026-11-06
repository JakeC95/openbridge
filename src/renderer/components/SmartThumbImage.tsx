import { useState } from "react";
import type { ImgHTMLAttributes } from "react";
import { useSmartThumbnail } from "../use-smart-thumbnail";

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  source: string | null | undefined;
  /** Used when the primary/smart image cannot be loaded. */
  fallback?: string | null;
  /** Bypass the alpha-bounds cache, for full preview images. */
  direct?: boolean;
}

export function SmartThumbImage({ source, fallback, direct = false, alt = "", ...rest }: Props) {
  const smart = useSmartThumbnail(direct ? null : source);
  const sourceUrl = direct ? source : smart;
  const [fallbackActive, setFallbackActive] = useState(false);
  const src = fallbackActive && fallback ? fallback : sourceUrl;
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (!fallbackActive && fallback && src !== fallback) setFallbackActive(true);
      }}
      {...rest}
    />
  );
}
