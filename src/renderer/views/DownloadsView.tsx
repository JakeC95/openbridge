import { useStore } from "../store";
import { FolderIcon, CloseIcon, DownloadIcon, CheckIcon } from "../icons";
import type { DownloadProgress } from "../../shared/types";
import { DownloadStats } from "../components/DownloadStats";

function bytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusText(item: DownloadProgress): string {
  switch (item.status) {
    case "queued":
      return "Queued";
    case "requesting":
      return "Requesting URLs...";
    case "downloading":
      return `${bytes(item.received)} / ${bytes(item.total)}`;
    case "extracting":
      return "Extracting...";
    case "paused":
      return "Paused";
    case "complete":
      return "Complete";
    case "cancelled":
      return "Cancelled";
    case "error":
      return "Failed";
    default:
      return item.status;
  }
}

export function DownloadsView() {
  const downloads = useStore(state => state.downloads);
  const cancel = useStore(state => state.cancelDownload);
  const clear = useStore(state => state.clearFinishedDownloads);
  const settings = useStore(state => state.settings);

  const items = Object.values(downloads).sort((a, b) => {
    const order: Record<string, number> = {
      error: 0,
      downloading: 1,
      extracting: 2,
      requesting: 3,
      queued: 4,
      paused: 5,
      complete: 6,
      cancelled: 7
    };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  const active = items.filter(item =>
    ["downloading", "extracting", "requesting"].includes(item.status)
  );
  const queued = items.filter(item => item.status === "queued");
  const paused = items.filter(item => item.status === "paused");
  const attention = items.filter(item => item.status === "error");
  const hasActive = active.length + queued.length > 0;
  const visibleItems = items.slice(0, 300);

  const groups = [
    {
      key: "attention",
      label: "Needs attention",
      items: visibleItems.filter(item => item.status === "error")
    },
    {
      key: "active",
      label: "Active & queued",
      items: visibleItems.filter(item =>
        ["downloading", "extracting", "requesting", "queued"].includes(item.status)
      )
    },
    {
      key: "paused",
      label: "Paused",
      items: visibleItems.filter(item => item.status === "paused")
    },
    {
      key: "complete",
      label: "Completed",
      items: visibleItems.filter(item => item.status === "complete")
    },
    {
      key: "cancelled",
      label: "Cancelled",
      items: visibleItems.filter(item => item.status === "cancelled")
    }
  ].filter(group => group.items.length > 0);

  function renderRow(item: DownloadProgress) {
    const done =
      item.status === "complete" ||
      item.status === "error" ||
      item.status === "cancelled";
    const running = !done && item.status !== "paused";
    return (
      <div className={`download-row ${item.status}`} key={item.assetId}>
        <div className="download-icon">
          {item.status === "complete" ? <CheckIcon /> : <DownloadIcon />}
        </div>
        <div className="download-body">
          <div className="download-top">
            <strong>{item.name || item.assetId}</strong>
            <span className={`download-status ${item.status}`}>{statusText(item)}</span>
          </div>
          {item.status !== "error" && item.status !== "cancelled" && (
            <div className="progress">
              <div
                className="progress-fill"
                style={{
                  width: `${
                    item.status === "complete" ? 100 : Math.round(item.ratio * 100)
                  }%`
                }}
              />
            </div>
          )}
          {item.diagnostics && (item.status === "downloading" ||
            (item.status === "extracting" && item.diagnostics.activeTransfers > 0)) &&
            <DownloadStats stats={item.diagnostics} assetId={item.assetId} />}
          <div className="download-meta">
            <span>{item.assetId}</span>
            {item.message && <span className="download-message">{item.message}</span>}
            {item.path && (
              <button
                type="button"
                className="text-btn"
                onClick={() => void window.openbridge.openPath(item.path!)}
              >
                Open folder
              </button>
            )}
          </div>
        </div>
        <div className="download-actions">
          {running && (
            <button
              type="button"
              className="text-btn"
              onClick={() => void window.openbridge.downloads.pause(item.assetId)}
            >
              Pause
            </button>
          )}
          {item.status === "paused" && (
            <button
              type="button"
              className="text-btn"
              onClick={() => void window.openbridge.downloads.resume(item.assetId)}
            >
              Resume
            </button>
          )}
          {!done && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => void cancel(item.assetId)}
              title="Cancel"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
    );
  }

  const summary = items.length
    ? [
        `${items.length.toLocaleString()} item${items.length === 1 ? "" : "s"}`,
        active.length > 0 ? `${active.length.toLocaleString()} active` : "",
        queued.length > 0 ? `${queued.length.toLocaleString()} queued` : "",
        paused.length > 0 ? `${paused.length.toLocaleString()} paused` : "",
        attention.length > 0
          ? `${attention.length.toLocaleString()} need${attention.length === 1 ? "s" : ""} attention`
          : ""
      ].filter(Boolean).join(" · ")
    : "Nothing queued";

  return (
    <div className="view downloads">
      <div className="view-header">
        <div className="header-line">
          <div>
            <p className="view-subtitle">{summary}</p>
            {settings?.libraryPath && (
              <p className="view-subtitle download-library-path">{settings.libraryPath}</p>
            )}
          </div>
          <div className="header-actions">
            {hasActive && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void window.openbridge.downloads.pauseAll()}
              >
                Pause all
              </button>
            )}
            {paused.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void window.openbridge.downloads.resumeAll()}
              >
                Resume all
              </button>
            )}
            {hasActive && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void window.openbridge.downloads.cancelAll()}
              >
                Cancel all
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={clear}>
              Clear finished
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => settings && void window.openbridge.openPath(settings.libraryPath)}
            >
              <FolderIcon /> Open library
            </button>
          </div>
        </div>
      </div>

      <div className="view-body">
        {items.length === 0 ? (
          <div className="empty">
            <DownloadIcon className="empty-icon" />
            <h2>No downloads yet</h2>
            <p>Find an asset in Discover and hit Download. Assets you own download at full access.</p>
          </div>
        ) : (
          <div className="download-list">
            {attention.length > 0 && (
              <div className="download-alert" role="status">
                <div>
                  <strong>
                    ! {attention.length.toLocaleString()} download
                    {attention.length === 1 ? " needs" : "s need"} attention
                  </strong>
                  <span>
                    {attention[0].name || attention[0].assetId}
                    {attention.length > 1 ? ` and ${attention.length - 1} more` : ""}
                    {attention[0].message ? ` · ${attention[0].message}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void window.openbridge.openLogs()}
                >
                  Open logs
                </button>
              </div>
            )}

            {groups.map(group => (
              <section className={`download-group ${group.key}`} key={group.key}>
                <div className="download-group-head">
                  <span>{group.label}</span>
                  <span>{group.items.length.toLocaleString()}</span>
                </div>
                {group.items.map(renderRow)}
              </section>
            ))}

            {items.length > visibleItems.length && (
              <div className="download-limit">
                Showing {visibleItems.length.toLocaleString()} of{" "}
                {items.length.toLocaleString()} downloads. Clear finished downloads to
                reduce this list.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
