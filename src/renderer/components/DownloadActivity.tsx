import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { DownloadIcon } from "../icons";
import { formatDuration, formatTransferBytes, summarizeDownloads, transferStatistics } from "../download-summary";

export function DownloadActivity() {
  const downloads = useStore(state => state.downloads);
  const toast = useStore(state => state.toast);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const summary = summarizeDownloads(Object.values(downloads));
  const count = summary.active.length + summary.queued.length;
  const visible = count > 0 || summary.paused.length > 0;
  const act = async (action: () => Promise<void>) => {
    try { await action(); } catch (error) { toast(String(error), true); }
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", key); };
  }, [open]);
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);
  if (!visible) return null;
  return <div className="download-activity" ref={ref}>
    <button type="button" className="activity-pill" ref={trigger} aria-expanded={open} aria-controls="mini-download-queue"
      onClick={() => setOpen(value => !value)} title="Download activity">
      <DownloadIcon /><span>{count ? `${summary.active.length} active · ${summary.queued.length} queued` : `${summary.paused.length} paused`}</span>
      {summary.rate > 0 && <strong>{formatTransferBytes(summary.rate)}/s</strong>}
      {summary.eta && <span className="activity-eta" title="Estimated time for active transfers only">{summary.eta} active</span>}
    </button>
    {open && <div className="activity-popover" id="mini-download-queue" role="region" aria-label="Download activity">
      <div className="activity-heading"><strong>Download queue</strong><span>{summary.eta ? `${summary.eta} for active transfers` : "Time remaining unavailable"}</span></div>
      {[...summary.active, ...summary.queued, ...summary.paused].slice(0, 4).map(item => {
        const stats = transferStatistics(item);
        return <div className="mini-download" key={item.assetId}>
          <div><strong>{item.name || item.assetId}</strong><span>{item.provider === "poliigon" ? "Poliigon · " : item.provider === "polyhaven" ? "Poly Haven · " : ""}{item.message ?? item.status}{item.total > 0 ? ` · ${Math.round(item.ratio * 100)}%` : ""}{stats && stats.rate > 0 ? ` · ${formatTransferBytes(stats.rate)}/s` : ""}{typeof stats?.eta === "number" ? ` · ${formatDuration(stats.eta)} left` : ""}</span></div>
          <div className="progress"><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, item.ratio * 100))}%` }} /></div>
        </div>;
      })}
      {count + summary.paused.length > 4 && <p className="hint">{count + summary.paused.length - 4} more in the full queue</p>}
      <div className="button-row horizontal">
        {count > 0 && <button type="button" className="btn btn-ghost" onClick={() => void act(() => window.openbridge.downloads.pauseAll())}>Pause all</button>}
        {summary.paused.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => void act(() => window.openbridge.downloads.resumeAll())}>Resume all</button>}
        <button type="button" className="btn btn-primary" onClick={() => { useStore.getState().setView("downloads"); setOpen(false); }}>Open queue</button>
      </div>
    </div>}
  </div>;
}
