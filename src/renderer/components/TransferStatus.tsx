import type { DownloadProgress } from "../../shared/types";
import { formatDuration, formatTransferBytes, transferStatistics } from "../download-summary";

export function TransferStatus({
  progress,
  fallbackText,
  className = ""
}: {
  progress?: DownloadProgress;
  fallbackText?: string;
  className?: string;
}) {
  const stats = progress ? transferStatistics(progress) : null;
  const percent = progress && progress.total > 0 ? Math.round((stats?.ratio ?? 0) * 100) : null;
  return (
    <div className={`transfer-status ${className}`.trim()}>
      {progress?.message && <span className="transfer-status-message">{progress.message}</span>}
      {progress && (
        <div
          className="progress transfer-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div className="progress-fill" style={{ width: `${percent ?? 0}%` }} />
        </div>
      )}
      <div className="transfer-status-meta">
        {progress ? (
          <span>
            {progress.total > 0
              ? `${formatTransferBytes(progress.received)} / ${formatTransferBytes(progress.total)}`
              : `${formatTransferBytes(progress.received)} received`}
          </span>
        ) : (
          fallbackText ? <span>{fallbackText}</span> : null
        )}
        {stats && stats.rate > 0 && <span>{formatTransferBytes(stats.rate)}/s</span>}
        {typeof stats?.eta === "number" && <span>{formatDuration(stats.eta)} left</span>}
        {stats?.source && (
          <span className="transfer-source" title={stats.source.host}>
            {stats.source.location ?? stats.source.host}
          </span>
        )}
        {percent !== null && <span>{percent}%</span>}
      </div>
    </div>
  );
}
