import { useStore } from "../store";
import { FolderIcon, CloseIcon, DownloadIcon, CheckIcon } from "../icons";
import type { DownloadProgress } from "../../shared/types";

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
      return item.message || "Failed";
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
      downloading: 0,
      extracting: 1,
      requesting: 2,
      queued: 3,
      paused: 4,
      error: 5,
      cancelled: 6,
      complete: 7
    };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  const active = items.some(item =>
    ["queued", "requesting", "downloading", "extracting"].includes(item.status)
  );
  const visibleItems = items.slice(0, 300);
  const paused = items.some(item => item.status === "paused");

  return (
    <div className="view downloads">
      <div className="view-header">
        <div className="header-line">
          <div>

            <p className="view-subtitle">
              {items.length ? `${items.length} item(s)` : "Nothing queued"}  - {" "}
              {settings?.libraryPath}
            </p>
          </div>
          <div className="header-actions">
            {active && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void window.openbridge.downloads.pauseAll()}
              >
                Pause all
              </button>
            )}
            {paused && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void window.openbridge.downloads.resumeAll()}
              >
                Resume all
              </button>
            )}
            {active && (
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
            {visibleItems.map(item => {
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
                      <span className="download-status">{statusText(item)}</span>
                    </div>
                    <div className="progress">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${
                            item.status === "complete"
                              ? 100
                              : item.status === "error"
                                ? 100
                                : Math.round(item.ratio * 100)
                          }%`
                        }}
                      />
                    </div>
                    <div className="download-meta">
                      <span>{item.assetId}</span>
                      {item.message && <span>{item.message}</span>}
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
            })}
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

