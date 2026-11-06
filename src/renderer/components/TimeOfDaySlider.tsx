import { formatClockValue, normalizeHour } from "../../shared/hdri-time";

const DEFAULT_RANGE = { start: 0, end: 24 };
const MIN_WIDTH = 0.5;

function circularWidth(start: number, end: number): number {
  const from = normalizeHour(start);
  const to = normalizeHour(end);
  return from <= to ? to - from : 24 - from + to;
}

function segments(start: number, end: number): Array<{ start: number; end: number }> {
  const from = normalizeHour(start);
  const to = normalizeHour(end);
  if (from <= to) return [{ start: from, end: to }];
  return [{ start: from, end: 24 }, { start: 0, end: to }];
}

export function TimeOfDaySlider({
  value,
  onChange
}: {
  /** Falloff window in hours 0..24; start may be greater than end to cross midnight. */
  value: { start: number; end: number } | null;
  onChange(value: { start: number; end: number } | null): void;
}) {
  const active = value !== null;
  const start = value?.start ?? DEFAULT_RANGE.start;
  const end = value?.end ?? DEFAULT_RANGE.end;
  const range = `${formatClockValue(start)} – ${formatClockValue(end)}`;
  const crossesMidnight = normalizeHour(start) > normalizeHour(end) && end !== 24;
  return (
    <div className={`time-of-day ${active ? "active" : ""}`}>
      <div className="time-of-day-head">
        <div className="time-of-day-title">
          <strong>Time of day</strong>
          <span>
            {active
              ? `Falloff ${range}${crossesMidnight ? " · crosses midnight" : ""}`
              : "All day — drag either handle to set the falloff window"}
          </span>
        </div>
        <div className="time-of-day-actions">
          {active && (
            <button type="button" className="text-btn" onClick={() => onChange(null)}>
              All day
            </button>
          )}
          <span className="time-of-day-clock">{active ? range : "All day"}</span>
        </div>
      </div>
      <div className="time-of-day-track" role="group" aria-label="HDRI time of day falloff">
        <div className="time-of-day-gradient" aria-hidden="true" />
        {active &&
          segments(start, end).map((segment, index) => (
            <span
              key={`${segment.start}-${index}`}
              className="time-of-day-window"
              aria-hidden="true"
              style={{
                left: `${(segment.start / 24) * 100}%`,
                width: `${((segment.end - segment.start) / 24) * 100}%`
              }}
            />
          ))}
        <input
          className="time-handle start"
          type="range"
          min={0}
          max={23.75}
          step={0.25}
          value={start}
          aria-label="Falloff start"
          aria-valuetext={formatClockValue(start)}
          onChange={event => {
            const next = Number(event.target.value);
            if (circularWidth(next, end) >= MIN_WIDTH) onChange({ start: next, end });
          }}
        />
        <input
          className="time-handle end"
          type="range"
          min={0}
          max={24}
          step={0.25}
          value={end}
          aria-label="Falloff end"
          aria-valuetext={formatClockValue(end)}
          onChange={event => {
            const next = Number(event.target.value);
            if (circularWidth(start, next) >= MIN_WIDTH) onChange({ start, end: next });
          }}
        />
      </div>
      <div className="time-of-day-ticks" aria-hidden="true">
        <span><b>00</b><em>Night</em></span>
        <span><b>06</b><em>Dawn</em></span>
        <span><b>12</b><em>Noon</em></span>
        <span><b>18</b><em>Dusk</em></span>
        <span><b>24</b><em>Night</em></span>
      </div>
    </div>
  );
}
