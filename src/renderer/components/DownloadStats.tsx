import { useEffect, useReducer } from "react";
import type { DownloadDiagnostics, DownloadSource } from "../../shared/types";
import { readDownloadSpeed, SPEED_WINDOW_SECONDS } from "../download-history";
import { flagUrl } from "../flags";

function rate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const index = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(value) / Math.log(1024))));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

const PROVIDER_NAMES: Record<string, string> = {
  CloudFront: "Amazon CloudFront",
  "Amazon S3": "Amazon S3",
  Cloudflare: "Cloudflare",
  Fastly: "Fastly"
};

function providerName(source: DownloadSource): string {
  if (source.provider) return PROVIDER_NAMES[source.provider] ?? source.provider;
  return source.location || source.edgeCode ? "CDN edge" : "Source server";
}

function placeName(source: DownloadSource): string {
  if (source.location) return source.location.split(",")[0].trim();
  return source.edgeCode ?? "";
}

function sourceTitle(source: DownloadSource): string {
  return [providerName(source), source.location ?? source.edgeCode, source.host]
    .filter(Boolean)
    .join(" · ");
}

function GlobeBadge() {
  return (
    <svg className="download-flag download-flag-fallback" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3.2 3.4 3.2 14.6 0 18M12 3c-3.2 3.4-3.2 14.6 0 18" />
    </svg>
  );
}

function SpeedSparkline({ assetId }: { assetId: string }) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { values, peak, observedSeconds } = readDownloadSpeed(assetId);
  const width = 150;
  const height = 34;
  const scale = Math.max(peak, 1);
  const step = width / (values.length - 1);
  const points = values.map(
    (value, index) => `${(index * step).toFixed(2)},${(height - (value / scale) * height).toFixed(2)}`
  );
  const line = `M${points.join(" L")}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  const current = values[values.length - 1] ?? 0;

  return (
    <figure
      className="download-spark"
      title="Download speed over the last 60 seconds, sampled once per second from live transfer statistics."
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Download speed over the last ${SPEED_WINDOW_SECONDS} seconds. Current ${rate(current)}, peak ${rate(peak)}.`}
      >
        <path className="download-spark-area" d={area} />
        <path className="download-spark-line" d={line} />
      </svg>
      <figcaption>
        <span>{SPEED_WINDOW_SECONDS} s</span>
        <span>{observedSeconds < 2 ? "Sampling…" : `peak ${rate(peak)}`}</span>
      </figcaption>
    </figure>
  );
}

export function DownloadStats({ stats, assetId }: { stats: DownloadDiagnostics; assetId: string }) {
  const source = stats.sources[0];
  const flag = flagUrl(source?.countryCode);
  const place = source ? placeName(source) : "";
  const label = source ? [providerName(source), place].filter(Boolean).join(" · ") : "";
  return (
    <div className="download-stats" aria-label="Live transfer statistics">
      {source ? (
        <span className="download-source-badge" title={sourceTitle(source)}>
          {flag ? (
            <img
              className="download-flag"
              src={flag}
              alt={source.country ?? source.countryCode?.toUpperCase() ?? ""}
            />
          ) : (
            <GlobeBadge />
          )}
          <span className="download-source-name">{label}</span>
          {stats.sources.length > 1 && (
            <span className="download-source-more">+{stats.sources.length - 1}</span>
          )}
        </span>
      ) : (
        <span className="download-stats-label">Connecting…</span>
      )}
      <SpeedSparkline assetId={assetId} />
      <span title="Received by the app across active files, smoothed over 3 seconds. Compressed responses count decoded bytes.">
        <span className="download-stats-label">Download</span>{" "}
        <strong>{rate(stats.receiveBytesPerSecond)}</strong>
      </span>
      <span title="Bytes written to the download file streams per second, including OS caching. Not a physical-drive benchmark or extraction/copy speed.">
        <span className="download-stats-label">Disk writes</span>{" "}
        <strong>{rate(stats.writeBytesPerSecond)}</strong>
      </span>
      {source ? (
        <details className="download-source-details">
          <summary title="Show source servers and reported CDN edge locations">
            <span className="download-source-summary">
              {stats.sources.length > 1 ? `${stats.sources.length} sources` : "Source details"}
            </span>
          </summary>
          <div className="download-source-list">
            {stats.sources.map(item => (
              <div className="download-source-item" key={`${item.host}:${item.edgeCode ?? ""}`}>
                <strong>{item.host}</strong>
                <span>
                  {[providerName(item), item.edgeCode].filter(Boolean).join(" · ") || "Source server"}
                </span>
                <span>
                  {item.location
                    ? `${item.locationKind === "region" ? "Service region" : "CDN edge"}: ${
                        item.location
                      }${item.country ? ` (${item.country})` : ""}`
                    : "Location not reported"}
                </span>
              </div>
            ))}
            <p>
              Locations come from server-reported CDN edge or region codes—not IP geolocation or
              the asset’s storage origin.
            </p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
