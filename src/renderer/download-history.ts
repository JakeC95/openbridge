import type { DownloadProgress } from "../shared/types";

/**
 * One sample per second of the smoothed receive rate. Samples are recorded from real download
 * progress events only; we never synthesise a history the app did not observe.
 */
export const SPEED_WINDOW_SECONDS = 60;

interface SpeedSample {
  second: number;
  value: number;
}

const histories = new Map<string, SpeedSample[]>();

function secondOf(time: number): number {
  return Math.floor(time / 1000);
}

function trim(list: SpeedSample[], second: number): void {
  const oldest = second - SPEED_WINDOW_SECONDS;
  while (list.length > 0 && list[0].second < oldest) list.shift();
}

function fillGap(list: SpeedSample[], from: number, to: number): void {
  for (let second = from + 1; second < to; second += 1) list.push({ second, value: 0 });
}

export function recordDownloadSpeed(assetId: string, bytesPerSecond: number, now = Date.now()): void {
  const second = secondOf(now);
  const list = histories.get(assetId) ?? [];
  const value = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? bytesPerSecond : 0;
  const last = list.at(-1);
  if (last && last.second === second) {
    last.value = value;
  } else {
    if (last) fillGap(list, last.second, second);
    list.push({ second, value });
  }
  trim(list, second);
  histories.set(assetId, list);
}

export function clearDownloadSpeed(assetId: string): void {
  histories.delete(assetId);
}

/** Track a progress event. Resume gaps become explicit zero seconds rather than a fake line. */
export function recordDownloadProgress(progress: DownloadProgress): void {
  if (progress.status === "complete" || progress.status === "error" || progress.status === "cancelled") {
    clearDownloadSpeed(progress.assetId);
    return;
  }
  if (progress.status !== "downloading") return;
  if ((progress.diagnostics?.activeTransfers ?? 0) <= 0) return;
  recordDownloadSpeed(progress.assetId, progress.diagnostics?.receiveBytesPerSecond ?? 0);
}

export interface SpeedHistory {
  /** Oldest to newest, exactly SPEED_WINDOW_SECONDS buckets. */
  values: number[];
  peak: number;
  observedSeconds: number;
}

export function readDownloadSpeed(assetId: string, now = Date.now()): SpeedHistory {
  const end = secondOf(now);
  const start = end - SPEED_WINDOW_SECONDS + 1;
  const values = new Array<number>(SPEED_WINDOW_SECONDS).fill(0);
  let peak = 0;
  let observedSeconds = 0;
  const list = histories.get(assetId);
  if (list) {
    trim(list, end);
    if (list.length === 0) histories.delete(assetId);
    const bySecond = new Map(list.map(sample => [sample.second, sample.value]));
    let previous = 0;
    let seen = false;
    for (let index = 0; index < SPEED_WINDOW_SECONDS; index += 1) {
      const value = bySecond.get(start + index);
      if (value !== undefined) {
        previous = value;
        seen = true;
        observedSeconds += 1;
      }
      values[index] = seen ? previous : 0;
      if (values[index] > peak) peak = values[index];
    }
  }
  return { values, peak, observedSeconds };
}
