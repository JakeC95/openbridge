# Testing

Use a disposable library folder for manual tests. Do not commit logs, screenshots, account details,
local absolute paths or downloaded asset files.

## Automated checks

```powershell
npm ci
npm run typecheck
npm run check:public
npm run build
npm run dist:portable
```

`check:public` fails if tracked files contain personal paths, email addresses, hard-coded account
names, machine-specific details or likely secrets.

GitHub Actions `Quality` runs type checking and `check:public` on pushes, pull requests and manual
workflow dispatch. The check only reads tracked files, so stage new files before relying on it.

## Manual smoke test

1. Start the app and confirm the portable window opens with the expected version.
2. Sign in with an Epic account and confirm the account view loads without exposing credentials.
3. Search the catalogue by name and open a result. Check category filters, facets, favorites and
   related assets.
4. Open a 3D plant, switch to **Maps**, and confirm reference maps and billboard maps load.
5. Open a surface and confirm 2D drawer restrictions: no mesh format, no per-LOD map controls.
6. Download one asset to a disposable library folder. Confirm files, JSON and previews finalize in
   the expected layout.
7. Rescan the library. Confirm indexed search, readiness filters, counts and health tools work.
8. Import a small catalogue metadata pack in Settings and confirm status and remote badges.
9. Check the update path against a local manifest or a published prerelease before publishing.

## Browsing regression checks

```powershell
npm run test:browsing
npm run test:network
npm run build
npm run test:browsing:ui
```

The first command tests real SQLite queries, filter/selection parity, pack membership, interrupted
drawer requests, saved preferences and local preview enumeration using disposable fixtures. The UI
check launches Electron with an isolated profile and fixture preload: it does not use real accounts,
services or libraries. It covers local categories/sorting, catalogue and local selection, drawer
Back/Next, local maps, expanded previews, zoom, density, pack browsing, scroll restoration and
compact live download statistics (speed, write rate, collapsed source details, no signed URLs).

`test:network` checks request/cache/auth concurrency, safe retries and cancellation using fixture
responses, then exercises range resume, ignored/bad ranges, compression, stalled transfers and
transfer telemetry against a loopback server, including Electron's real network stack. See
[NETWORKING.md](NETWORKING.md) for policy, cache lifetimes, limits and comparison caveats.

The UI check clamps its window to the desktop work area, so it also runs on small CI desktops. Set
`OPENBRIDGE_UI_WIDTH` and `OPENBRIDGE_UI_HEIGHT` to reproduce a narrower layout locally, and set
`OPENBRIDGE_UI_SCREENSHOTS` to a directory to write preview-layout screenshots.

For manual download verification, start a real download and confirm the statistics line shows a
moving download rate and a plausible write rate, and that expanding the source summary lists the
actual serving host. Treat the reported location as a CDN edge hint, not proof of where the asset
is stored. Pause and confirm the line disappears; resume and confirm it returns. A rate of 0 B/s
during a stall is expected; it should recover when data flows again.

For manual browsing verification:

- In Library, combine repository, type/category, favorites, readiness, colour and triangle filters.
  Verify **Select all** matches the visible scope; check exports/deletion only in a disposable library.
- Switch between Discover, Library and Downloads; returning should restore the grid position.
- Follow related assets and use **Back** or **Alt+Left**. Left/right in Render mode navigate loaded
  results; in Maps mode they cycle maps. Typing in inputs must not navigate assets.
- Open **Recent**, **Saved searches**, and searchable **Packs**. Pack membership comes from metadata,
  not Bridge's curated collections; remote packs require the optional metadata pack.
- Expand a render/map, zoom, drag, switch images and press Escape. Only the expanded preview should
  close and focus should return to its trigger. Local JPG/PNG/WebP maps work offline; EXR is not decoded.
- Expanding a catalogue map (or a recognized downloaded map) signs only its maximum available JPG,
  respecting account resolution limits. Verify the loading spinner stays visible through download
  and image decode, the small preview remains visible, and actual pixel dimensions appear afterward.
  Switch maps while loading and verify a late response cannot replace the current image. Test
  failure/retry and closing while loading. No download queue item or library file should be created.
- Search/expand facets beyond the first ten values, remove active-filter chips and clear an empty
  filtered result. Verify compact/comfortable/large thumbnail sizes at smaller window sizes.
- Local sort order applies before paging. Catalogue order remains service-defined; no unsupported
  catalogue sort is offered.

## Metadata pack checks

```powershell
npm run build
electron . --build-catalog-pack=dist/catalog-metadata-sample.json.gz --catalog-limit=50
electron . --import-catalog-pack=dist/catalog-metadata-sample.json.gz
```

Verify:

- The import reports the expected record count.
- Settings shows the pack count and generated date.
- A known asset exposes readiness, semantic and technical fields.
- Removing the pack returns the app to on-demand remote metadata.
- Full packs are generated only from an authenticated session and never committed.

## Release verification

- Confirm `npm run typecheck` and `npm run check:public` pass.
- Confirm the portable ZIP starts and reports the tagged version.
- Confirm the release contains the ZIP, `latest.json` and, when applicable,
  `catalog-metadata.json.gz`.
- Verify `latest.json` size and SHA-256 against the uploaded ZIP.
- Confirm the latest metadata-pack URL resolves when a pack is published.

## Destructive tests

Library deletion, queue cleanup, update replacement and forced shutdown should be tested only with
disposable data. Never run destructive tests against a real asset library.
