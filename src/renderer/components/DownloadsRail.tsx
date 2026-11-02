import { useEffect, useState } from "react";
import type { DownloadOverview } from "../../shared/types";
import { useStore } from "../store";
import { formatTransferBytes as bytes } from "../download-summary";

export function DownloadsRail() {
  const settings = useStore(state => state.settings);
  const toast = useStore(state => state.toast);
  const [overview, setOverview] = useState<DownloadOverview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let running = false;
    const refresh = async () => {
      if (running) return;
      running = true;
      try { const value = await window.openbridge.downloads.overview(); if (!cancelled) { setOverview(value); setError(""); } }
      catch { if (!cancelled) setError("Download overview unavailable. Try again shortly."); }
      finally { running = false; }
    };
    setOverview(null);
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const unsubscribe = window.openbridge.downloads.onProgress(item => { if (item.status === "complete") void refresh(); });
    return () => { cancelled = true; clearInterval(timer); unsubscribe(); };
  }, [settings?.libraryPath]);
  const disk = overview?.disk;
  const used = disk?.totalBytes != null && disk.freeBytes != null && disk.totalBytes > 0
    ? Math.max(0, Math.min(100, (disk.totalBytes - disk.freeBytes) / disk.totalBytes * 100)) : null;
  return <aside className="downloads-rail" aria-label="Download history and storage">
    {error && <p className="error-box small" role="status">{error}</p>}
    <section className="download-rail-card"><h3>This app session</h3>
      {overview ? <dl>
        <dt>Received over network</dt><dd>{bytes(overview.session.receivedBytes)}</dd>
        <dt>Average job speed</dt><dd>{bytes(overview.session.averageBytesPerSecond)}/s</dd>
        <dt>Peak receive speed</dt><dd>{bytes(overview.session.peakBytesPerSecond)}/s</dd>
        <dt>Completed</dt><dd>{overview.session.completed} assets</dd>
      </dl> : <p className="hint">Loading session totals…</p>}
      <p className="hint">Network bytes exclude resumed files already on disk. Average includes request and finalization time.</p>
    </section>
    <section className="download-rail-card"><h3>Library storage</h3>
      {disk ? <>
        <p className="storage-path" title={disk.libraryPath}>{disk.libraryPath}</p>
        {used !== null && <><strong className="storage-free">{bytes(disk.freeBytes!)} free</strong>
          <div className="progress" role="progressbar" aria-label="Volume space used" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${used}%` }} /></div>
          <p className="hint">{bytes(disk.totalBytes! - disk.freeBytes!)} used of {bytes(disk.totalBytes!)} on this volume</p></>}
        {disk.error && <p className="hint">{disk.error}</p>}
        <dl><dt>Measured library files</dt><dd>{bytes(disk.measuredLibraryBytes)}</dd></dl>
        <p className="hint">Cached health measurements: {disk.measuredAssets} of {disk.totalAssets} assets. Run Library → Health for a full measurement.</p>
      </> : <p className="hint">Loading storage…</p>}
    </section>
    <section className="download-rail-card"><h3>Recent completions</h3>
      <p className="hint">Saved across restarts and Clear finished. Latest 30 of up to 5,000 retained completions.</p>
      {overview?.historyError && <p className="error-box small">{overview.historyError}</p>}
      {overview?.history.map(item => <div className="completion-row" key={item.id}>
        <div><strong title={item.name}>{item.name}</strong><small>{bytes(item.bytes)} · {new Date(item.completedAt).toLocaleString()}</small></div>
        <button type="button" className="text-btn" title={item.path} onClick={() => void window.openbridge.openPath(item.path).catch(error => toast(String(error), true))}>Open folder</button>
      </div>)}
      {overview?.history.length === 0 && <p className="hint">No recorded completions yet.</p>}
    </section>
  </aside>;
}
