import type { DownloadProgress } from "../shared/types";
import { readDownloadSpeed } from "./download-history";

export function formatTransferBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function summarizeDownloads(items: DownloadProgress[], now = Date.now()) {
  const active = items.filter(item => ["downloading", "requesting", "extracting"].includes(item.status));
  const queued = items.filter(item => item.status === "queued");
  const paused = items.filter(item => item.status === "paused");
  const rate = active.reduce((sum, item) => sum + (item.diagnostics?.receiveBytesPerSecond ?? 0), 0);
  const transferring = active.filter(item => item.status === "downloading");
  const smoothed = transferring.reduce((sum, item) => {
    if (!(item.diagnostics?.receiveBytesPerSecond ?? 0)) return sum;
    const history = readDownloadSpeed(item.assetId, now);
    const count = Math.min(15, history.observedSeconds);
    return sum + (count >= 3 ? history.values.slice(-count).reduce((a, b) => a + b, 0) / count : 0);
  }, 0);
  const known = transferring.length > 0 && transferring.every(item => item.total > 0);
  const remaining = transferring.reduce((sum, item) => sum + Math.max(0, item.total - item.received), 0);
  const seconds = known && smoothed > 0 ? Math.ceil(remaining / smoothed) : null;
  const eta = seconds === null ? null : seconds < 60 ? "<1 min" : seconds < 3600 ? `~${Math.ceil(seconds / 60)} min` : `~${Math.ceil(seconds / 3600)} hr`;
  const total = active.reduce((sum, item) => sum + item.total, 0);
  const received = active.reduce((sum, item) => sum + item.received, 0);
  const ratio = total > 0 ? Math.max(0, Math.min(1, received / total)) : null;
  return { active, queued, paused, rate, eta, ratio };
}
