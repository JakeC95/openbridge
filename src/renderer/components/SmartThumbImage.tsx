import { useState } from "react";
import type { ImgHTMLAttributes, ReactNode } from "react";
import { useSmartThumbnail } from "../use-smart-thumbnail";

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  source: string | null | undefined;
  /** Used when the primary/smart image cannot be loaded. */
  fallback?: string | null;
  /** Bypass the alpha-bounds cache, for full preview images. */
  direct?: boolean;
  /** Optional deterministic crop applied after decoding, e.g. OpenHDRI's top 2:1 panorama area. */
  crop?: "top-2-1";
  fallbackContent?: ReactNode;
}

export function SmartThumbImage({ source, fallback, direct = false, crop, alt = "", ...rest }: Props) {
  const smart = useSmartThumbnail(direct ? null : source, crop);
  if (!source && !fallback) return null;
  return <Thumbnail key={JSON.stringify([source, fallback, crop, direct])}
    candidates={[direct ? source : smart, source, fallback]} alt={alt} {...rest} />;
}

function Thumbnail({ candidates, alt, onError, fallbackContent, ...rest }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  candidates: Array<string | null | undefined>;
  fallbackContent?: ReactNode;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = candidates.find(url => url && !failed.includes(url));
  if (!src) return fallbackContent ?? <span className="preview-unavailable">{alt ? `${alt}: preview unavailable` : "Preview unavailable"}</span>;
  return (
    <img
      key={src}
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={event => {
        setFailed(previous => previous.includes(src) ? previous : [...previous, src]);
        onError?.(event);
      }}
      {...rest}
    />
  );
}
