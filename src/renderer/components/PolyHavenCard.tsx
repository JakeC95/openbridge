import type { KeyboardEvent, MouseEvent } from "react";
import type { PolyHavenAssetSummary } from "../../shared/types";
import { formatHdriTime } from "../../shared/hdri-time";
import { polyHavenPrimaryPreview } from "../../shared/polyhaven";
import { assetTypeClass } from "../asset-visuals";
import { ProviderLogo } from "./ProviderLogo";
import { SmartThumbImage } from "./SmartThumbImage";
import { DownloadIcon } from "../icons";

interface Props {
  hit: PolyHavenAssetSummary;
  downloaded?: boolean;
  favorited?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  /** Use the wider 2:1 tile used by dedicated HDRI grids. */
  wide?: boolean;
  onSelect?: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
  onToggleFavorite?: () => void;
  onDownload?: () => void;
  onOpen: (hit: PolyHavenAssetSummary) => void;
}

function facts(hit: PolyHavenAssetSummary): string[] {
  const output: string[] = [];
  if (hit.maxResolution) output.push(`${Math.round(hit.maxResolution / 1024)}K`);
  if (hit.type === "hdris") {
    output.push(formatHdriTime(hit.timeOfDay));
  } else if (hit.type === "models") {
    if (hit.polycount) output.push(`${hit.polycount.toLocaleString()} tris`);
    if (hit.dimensions) output.push(hit.dimensions);
  } else {
    if (hit.mapCodes.length > 0) output.push(`${hit.mapCodes.length} maps`);
    if (hit.dimensions) output.push(hit.dimensions);
  }
  return output.filter(Boolean).slice(0, 3);
}

export function PolyHavenCard({
  hit,
  downloaded = false,
  favorited = false,
  selectionMode = false,
  selected = false,
  wide = false,
  onSelect,
  onToggleFavorite,
  onDownload,
  onOpen
}: Props) {
  const open = (): void => onOpen(hit);
  const key = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (selectionMode || event.shiftKey) onSelect?.(event);
      else open();
    }
  };
  const badges = facts(hit);
  const thumbnail = hit.type === "hdris" ? polyHavenPrimaryPreview(hit.thumbnail) : hit.thumbnail;

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        "asset-card",
        hit.type === "hdris" && wide ? "hdri-card" : "",
        selected ? "selected" : ""
      ].filter(Boolean).join(" ")}
      data-asset-id={hit.id}
      onClick={event => {
        if (selectionMode || event.shiftKey) {
          event.preventDefault();
          onSelect?.(event);
          return;
        }
        open();
      }}
      onKeyDown={key}
      title={hit.name}
    >
      <div className="asset-thumb">
        {thumbnail ? (
          <SmartThumbImage
            source={thumbnail}
            fallback={hit.thumbnail}
            direct={hit.type === "hdris"}
            alt=""
            className={hit.type === "hdris" ? "asset-thumb-img hdri-panorama" : "asset-thumb-img"}
          />
        ) : (
          <span className="asset-placeholder">{hit.typeLabel}</span>
        )}
        {!selectionMode && <ProviderLogo provider="polyhaven" className="asset-provider-mark" />}
        <span className={`asset-type ${assetTypeClass(hit.typeLabel)}`}>{hit.typeLabel}</span>
        {downloaded && (
          <span className="asset-flag downloaded">DOWNLOADED</span>
        )}
        {selectionMode && (
          <button
            type="button"
            className={selected ? "asset-select selected" : "asset-select"}
            aria-label={selected ? `Deselect ${hit.name}` : `Select ${hit.name}`}
            aria-pressed={selected}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onSelect?.(event);
            }}
          >
            {selected && "✓"}
          </button>
        )}
        {!selectionMode && !downloaded && onDownload && (
          <span className="asset-card-actions">
            <button
              type="button"
              className="asset-action"
              title="Download with default settings"
              aria-label={`Download ${hit.name}`}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onDownload();
              }}
            >
              <DownloadIcon width={15} height={15} />
            </button>
          </span>
        )}
        {!selectionMode && onToggleFavorite && (
          <button
            type="button"
            className={favorited ? "asset-favorite active" : "asset-favorite"}
            title={favorited ? "Remove from favorites" : "Add to favorites"}
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite();
            }}
          >
            {favorited ? "♥" : "♡"}
          </button>
        )}
      </div>
      <div className="asset-meta">
        <strong>{hit.name}</strong>
        <span>{hit.category || hit.categories.slice(0, 2).join(" - ") || hit.id}</span>
        {badges.length > 0 && <span className="asset-facts">{badges.join(" · ")}</span>}
      </div>
    </div>
  );
}
