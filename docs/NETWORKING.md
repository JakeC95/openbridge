# Networking

Megascans JSON calls share `src/main/network.ts`. Electron's Chromium network stack is retained
for Windows proxy settings, TLS, connection reuse and HTTP/2. No extra HTTP client or public
credentials are bundled.

## Request policy

- A JSON attempt has a 15-second deadline including body reads; the default total budget is
  45 seconds. Authentication has its own 30-second budget. Optional facet counts use shorter
  4-second attempts / 10-second totals so they cannot stall browsing indefinitely.
- GETs, Algolia's read-only search POSTs and download-signing POSTs can retry transient network
  failures and HTTP 408/425/429/500/502/503/504, up to three attempts with jittered exponential
  backoff. `Retry-After` seconds and dates are respected, including shared per-origin cooldowns.
- OAuth exchanges, refreshes, acquisition and other mutations are not automatically replayed after
  uncertain transport failures. An explicitly rejected 401 can refresh authentication once.
- Six JSON requests per origin can run concurrently. The queue is bounded and cancellable.
  Account requests have priority over ordinary reads; metadata-pack generation has lower priority.
- Invalid JSON and clearly invalid response shapes cannot silently populate caches.
- Scoped catalogue, related-asset, drawer and expanded-preview requests cancel obsolete work.
  One subscriber cancelling a shared request does not cancel other consumers.

## Caching and authentication

- Identical in-flight reads/signing calls share one request. Results are cloned for each consumer.
- Extended metadata is cached for 60 seconds (bounded to 192 account-side entries), acquired IDs
  for 15 seconds, favorites for 5 seconds and public search results for 15 seconds (64 entries).
  Category trees have a one-hour successful-result cache. Failed requests are not cached.
- Signing responses only share in-flight requests, except wildcard map signing which is reused
  until one minute before its advertised expiry. Signed image URLs are never committed or logged.
- Account changes clear account-side caches and cancel their in-flight reads. Acquisition and
  favorite mutations invalidate the affected reads. No stale entitlement fallback is used.
- Token refresh is single-flight, including concurrent 401s. A late 401 for an already-replaced
  token does not trigger another refresh. A refresh completing after logout cannot restore login.
- A permanently rejected refresh clears the unusable local session and prompts sign-in instead
  of repeatedly hammering authentication. A transient server outage does not log the user out.
- Category fetches no longer block initial catalogue startup. Independent metadata/signing and
  download-planning reads run in parallel. Optional facet failures retain valid asset results and
  show a warning rather than discarding the grid.

## File transfers

Files use a separate streaming path with four workers per asset. They are not subject to a small
total timeout: the 30-second idle watchdog resets as data arrives. All callers use the same
three-attempt transfer policy, avoiding retry multiplication in the queue or pack builder.

Partial files have a tiny sidecar containing a hashed resource identity and ETag/Last-Modified
validator, never the signed URL. Resume sends `Range` and `If-Range`, validates `Content-Range`,
and verifies the completed byte count before renaming into place. Ignored ranges restart from
zero; incorrect ranges/changed validators cannot be appended to existing data. Valid complete
partials can finish on HTTP 416. Without a trustworthy validator, restarting is safer than
potentially combining different files. HTTP-compressed responses validate decoded sizes and do
not resume decoded bytes against compressed byte ranges.

The stream pipeline applies backpressure and waits for file handles to close on cancellation or
failure before retrying. Permanent permission errors do not retry. A job can re-sign expired file
URLs once, shared across its workers, without re-running acquisition. The existing final size and
portable-update hash checks remain in place.

After bounded retries are exhausted, transient transfer failures pause the job and retain its
verified partial files for Resume rather than deleting completed work. Explicit cancellation
still removes temporary data; permission/format/disk errors are not retried indefinitely.

## Live transfer diagnostics

Active downloads show a compact statistics line: receive throughput, file-stream write throughput,
and the source server(s). Source details are collapsed by default and expand on click.

- Receive throughput sums bytes delivered to the app across the job's active files over a trailing
  three-second window. It is the rate the app observes, not a line-rate or ISP measurement.
- Write throughput counts bytes handed to the download file streams, including operating-system
  write caching. It is not a physical-drive benchmark and excludes extraction and final copying.
- Server identity is the host that actually served the bytes after redirects. CDN edge codes and S3
  regions come only from response headers (`x-amz-cf-pop`, `cf-ray`, `x-served-by`,
  `x-amz-bucket-region`). Cities are mapped from advertised airport/POP codes, not IP geolocation,
  and never claim where the asset is stored at origin. Unrecognised codes show the code alone.
- Signed URLs, query credentials and file paths are never included in diagnostics or rendered.

Statistics appear only while a job is transferring and drop to zero during a stall instead of
showing a stale average. Completed, paused and failed rows keep the normal compact layout.

## Verification and limits

```powershell
npm run test:network
npm run test:browsing
npm run build
npm run test:browsing:ui
```

Networking tests use deterministic mock responses and a loopback HTTP server, including an actual
Electron transfer. They exercise concurrency, a 25-caller metadata burst producing one request,
account isolation, refresh races, cancellation, backoff, malformed JSON, optional-facet failures,
range handling, compression, stalled bodies, telemetry accounting and source-header parsing. No real
account or external service is required. The UI test checks that statistics stay inside the download
card at wide and narrow widths, that details are collapsed by default, and that signed URLs never
reach the page.

These checks demonstrate fewer redundant calls and safer failure handling. They are not an
end-to-end speed/reliability benchmark against Bridge. Actual throughput still depends on the
legacy services, account access, server throttling, proxy/network conditions and disk speed.
