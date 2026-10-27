import type { KeyboardEvent, MouseEvent } from "react";
import type { CatalogHit, DownloadProgress } from "../../shared/types";
import {
  hitId,
  galleryFacts,
  hitThumb,
  typeLabel
} from "../catalog-utils";
import {
  CheckIcon,
  DownloadIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon
} from "../icons";

interface Props {
  hit: CatalogHit;
  owned: boolean;
  downloaded: boolean;
  favorited: boolean;
  canFavorite?: boolean;
  localPath?: string | null;
  progress?: DownloadProgress;
  selectionMode?: boolean;
  selected?: boolean;
  onPauseResume?: () => void;
  onSelect?: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
  onOpen: (hit: CatalogHit) => void;
  onToggleFavorite: () => void;
  onDownload: () => void;
}

export function AssetCard({
  hit,
  owned,
  downloaded,
  favorited,
  canFavorite = true,
  localPath,
  progress,
  selectionMode = false,
  selected = false,
  onPauseResume,
  onSelect,
  onOpen,
  onToggleFavorite,
  onDownload
}: Props) {
  const id = hitId(hit);
  const thumb = hitThumb(hit);
  const free = (hit.points ?? 0) === 0;
  const facts = galleryFacts(hit);
  const primaryBadge = downloaded ? "" : owned ? "OWNED" : free ? "FREE" : "";
  const active =
    progress &&
    ["queued", "requesting", "downloading", "extracting", "paused"].includes(progress.status);
  const ratio = progress ? Math.round(progress.ratio * 100) : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      className={selected ? "asset-card selected" : "asset-card"}
      data-asset-id={id}
      aria-pressed={selectionMode ? selected : undefined}
      onClick={event => {
        if (selectionMode) {
          event.preventDefault();
          onSelect?.(event);
          return;
        }
        onOpen(hit);
      }}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (selectionMode) onSelect?.(event);
          else onOpen(hit);
        }
      }}
      onContextMenu={event => {
        event.preventDefault();
        void window.openbridge.contextMenu.asset({
          assetId: id,
          localPath
        });
      }}
      title={hit.name}
    >
      <div className="asset-thumb">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="asset-placeholder">{typeLabel(hit.type)}</span>
        )}

        <span className="asset-type">{typeLabel(hit.type)}</span>

        {selectionMode && (
          <button
            type="button"
            className={selected ? "asset-select selected" : "asset-select"}
            aria-label={selected ? `Deselect ${hit.name}` : `Select ${hit.name}`}
            aria-pressed={selected}
            title={selected ? "Deselect asset" : "Select asset"}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onSelect?.(event);
            }}
          >
            {selected && <CheckIcon width={14} height={14} />}
          </button>
        )}

        {primaryBadge && (
          <span className={`asset-flag ${primaryBadge.toLowerCase()}`}>
            {primaryBadge === "OWNED" ? (
              <CheckIcon width={15} height={15} />
            ) : (
              primaryBadge
            )}
          </span>
        )}

        {active && progress && (
          <div className="asset-progress" title={progress.message ?? progress.status}>
            <span style={{ width: `${ratio}%` }} />
          </div>
        )}

        {!selectionMode && (
          <span
            className={
              active || downloaded || progress?.status === "complete"
                ? "asset-card-actions always"
                : "asset-card-actions"
            }
          >
          {active && progress ? (
            <button
              type="button"
              className="asset-action progress"
              title={progress.status === "paused" ? "Resume download" : "Pause download"}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onPauseResume?.();
              }}
            >
              {progress.status === "paused" ? (
                <PlayIcon width={12} height={12} />
              ) : (
                <PauseIcon width={12} height={12} />
              )}
              <span>{ratio}%</span>
            </button>
          ) : downloaded || progress?.status === "complete" ? (
            <span className="asset-action done" title="Downloaded">
              <CheckIcon width={15} height={15} />
            </span>
          ) : (
            <button
              type="button"
              className="asset-action"
              title={
                owned || free
                  ? "Download with current settings"
                  : "Open to acquire"
              }
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onDownload();
              }}
            >
              <DownloadIcon width={15} height={15} />
            </button>
          )}
          </span>
        )}

        {!selectionMode && canFavorite && (
          <button
            type="button"
            className={favorited ? "asset-favorite active" : "asset-favorite"}
            title={favorited ? "Remove from favorites" : "Add to favorites"}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite();
            }}
          >
            <HeartIcon width={15} height={15} filled={favorited} />
          </button>
        )}
      </div>
      <div className="asset-meta">
        <strong>{hit.name}</strong>
        <span>
          {hit.categories?.slice(0, 2).join(" - ") ||
            hit.category ||
            hit.asset_type ||
            id}
        </span>
        {facts.length > 0 && <span className="asset-facts">{facts.join(" · ")}</span>}
      </div>
    </div>
  );
}







