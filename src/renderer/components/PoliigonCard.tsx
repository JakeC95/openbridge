import type { KeyboardEvent, MouseEvent } from "react";
import type { PoliigonAssetSummary } from "../../shared/types";
import { formatHdriTime } from "../../shared/hdri-time";
import { assetTypeClass } from "../asset-visuals";
import { ProviderLogo } from "./ProviderLogo";
import { SmartThumbImage } from "./SmartThumbImage";
import { DownloadIcon } from "../icons";

interface Props {
  hit: PoliigonAssetSummary;
  owned?: boolean;
  included?: boolean;
  downloaded?: boolean;
  favorited?: boolean;
  canDownload?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  wide?: boolean;
  onSelect?: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
  onToggleFavorite?: () => void;
  onDownload?: () => void;
  onOpen: (hit: PoliigonAssetSummary) => void;
}

function facts(hit: PoliigonAssetSummary): string[] {
  const output: string[] = [];
  if (hit.maxResolution) output.push(`${Math.round(hit.maxResolution / 1024)}K`);
  else if (hit.resolutions.length > 0) output.push(hit.resolutions.at(-1) ?? "");
  if (hit.physicalSize) output.push(hit.physicalSize);
  if (hit.type === "HDRS") {
    output.push(formatHdriTime(hit.timeOfDay));
  } else if (hit.hasModel) {
    if (hit.maxTris) output.push(`${hit.maxTris.toLocaleString()} tris`);
    if (hit.lodCount > 0) output.push(`${hit.lodCount} LOD${hit.lodCount === 1 ? "" : "s"}`);
  } else {
    if (hit.mapCodes.length > 0) output.push(`${hit.mapCodes.length} maps`);
    if (hit.creationMethod) output.push(hit.creationMethod.replace(/_/g, " "));
  }
  return output.filter(Boolean).slice(0, 3);
}

export function PoliigonCard({
  hit,
  owned = false,
  included = false,
  downloaded = false,
  favorited = false,
  canDownload = false,
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

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        "asset-card",
        hit.type === "HDRS" && wide ? "hdri-card" : "",
        selected ? "selected" : ""
      ].filter(Boolean).join(" ")}
      data-asset-id={String(hit.id)}
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
        {hit.thumbnail ? (
          <SmartThumbImage source={hit.thumbnail} alt="" className="asset-thumb-img" direct={hit.type === "HDRS"} />
        ) : (
          <span className="asset-placeholder">{hit.typeLabel}</span>
        )}
        {!selectionMode && <ProviderLogo provider="poliigon" className="asset-provider-mark" />}
        <span className={`asset-type ${assetTypeClass(hit.typeLabel)}`}>{hit.typeLabel}</span>
        {downloaded ? (
          <span className="asset-flag downloaded">DOWNLOADED</span>
        ) : owned ? (
          <span className="asset-flag owned">OWNED</span>
        ) : hit.free ? (
          <span className="asset-flag free">FREE</span>
        ) : included ? null : (
          <span className="asset-flag credit" title={`${hit.credit} credit${hit.credit === 1 ? "" : "s"}`}>
            {hit.credit} CR
          </span>
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
        {!selectionMode && canDownload && onDownload && (
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
        <span>
          {hit.categories.slice(0, 2).join(" - ") || hit.slug || hit.assetName}
        </span>
        {badges.length > 0 && <span className="asset-facts">{badges.join(" · ")}</span>}
      </div>
    </div>
  );
}
