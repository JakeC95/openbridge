# Roadmap

## Phase 0 - Research (done)

- Unpacked `app.asar` (97,857 files) and recovered 1,085 renderer sources from the source map.
- Prettified the main bundle and mapped IPC channels, service ports and file formats.
- Confirmed live services (Algolia catalogue, plugin manifest, EOL config).
- Recorded the toolchain and evidence in `docs/`.

## Phase 1 - Local library manager (done)

- Settings, JSON logger, library scanner for `Downloaded/{3d,atlas,surface,3dplant,brush}`,
  `Custom` and `DHI`.
- Local HTTP API: folder, downloaded assets, reload, log, error.
- Discovery (`28852`) and Mixer live-link sockets.
- Asset grid UI with previews/search/import.
- Windows portable build configuration.

## Phase 2 - Catalogue, auth and downloads (done for Windows v1.0)

- Algolia catalogue (18,835 assets), search, type tabs, owned/free badges.
- Smart search for names, asset IDs and `quixel.com` URLs; whitespace normalization, request
  timeouts/retries and stale-result guards.
- Full nested category tree with live facet counts; Favorites and Free filters.
- Texture map previews with signed 1K URLs, keyboard cycling and texture-set labels.
- Multi-select and bulk download with large user-initiated queues.
- Epic OAuth with configurable client id; DPAPI-protected session/refresh token.
- Download request/fan-out/finalisation matching the original library layout.
- Full original Download Settings surface, persistent preferences and reset.
- Queue with progress, pause/resume, cancel and cancel all.
- Card-level download/favorite/progress controls and downloaded checks.
- Native asset/search context menus, downloaded-JSON validation and acquired-asset sync.

## Phase 3 - v1.1 productivity and reliability (done)

- Removed the Fab tab, source switch and all Fab-specific code. The app is Megascans-only.
- Removed offline-library, stall-timeout, parallel-file and update-feed settings.
- Per-type download presets for 3D Assets, 3D Plants, Surfaces and Other 2D assets, including
  selectable default maps with Common/All/None shortcuts.
- Download Engine 2.0: file concurrency, retries, HTTP Range resume, size verification, disk
  preflight, persistent queue, queue restore, pause/resume-all and clear finished.
- Library health report: storage totals, per-type stats, missing preview/mesh/texture detection,
  zero-byte files, empty folders, duplicate IDs, bulk JSON export and safe deletion.
- Discovery 2.0: biome/region/resolution/color/environment/theme facets, saved searches, active
  filter counts and related assets in the drawer.
- Command palette (`Ctrl+K`) for navigation, search, filters, sync, imports, updates, logs and
  download queue control.
- Dark, viewport-clamped custom dropdowns replacing native selects.
- Seamless Windows updates from GitHub release `latest.json` with size/SHA-256 verification and
  automatic restart.
- Bridge-aligned shell refresh: responsive sidebar, header search, 48 px filter bar, image-first
  cards and 120 px drawer.
- Tagged-release workflow builds the portable zip and publishes `latest.json`.

## Phase 4 - Library indexing and scale (done in 1.2)

- SQLite/WAL library index using Electron's `node:sqlite`.
- FTS5 search with prefix tokens, repository filters, sorted queries and server-side counts.
- Incremental scans: unchanged asset folders skip JSON re-reading; removed folders are pruned.
- Virtualized local-library and catalogue grids with 300-row paging.
- Select-all-filtered, queued page loading and health progress events.
- Batch health updates with cached file/byte statistics.

Still open from this area:

- Duplicate repair and orphan-folder cleanup (detection is implemented).
- Persist download history in the index instead of only the queue file.
- Cancellable background health jobs and richer issue filters.

## Phase 5 - Export pipeline (deferred)

- Port `app/modules/exports.js`: map selection, resolution, LOD/variation, naming conventions,
  channel packing, `.tbmat`/MaxScript special cases.
- Implement the export JSON exactly (`docs/PROTOCOL.md` section 1) and the socket writer.
- Bundle an open image processor (libvips/Sharp or Python/Pillow) with versioning.
- Replace Assimp with a glTF loader or bundle an open Assimp build.
- Custom disk/socket export first; then Maya/Max/Blender/Houdini/Unreal/Unity.
- Acceptance: recorded Bridge export round-trips through the existing plugins.

## Phase 6 - Plugin manager (deferred)

- Download/install plugin zips from the manifest.
- Parse script headers, tool/renderer/script picker, per-tool version detection and rollback.

## Phase 7 - Polish

- Keep the Windows portable ZIP as the only distribution target.
- Opt-in crash reporting, diagnostics export and update channels.
- Accessibility, high-DPI, localization and a broader Windows test matrix.

## Non-goals

- Reproducing the old insecure Electron 10 renderer (`nodeIntegration`, `remote`).
- Shipping Quixel/Epic artwork, fonts, plugins or user credentials.
- Bypassing asset ownership checks. Downloads must only use assets the user is entitled to.
- Automatic bulk downloading of all acquired assets. Sync only reports differences; users choose
  what to download.
- Fab catalogue or Fab package-download bypasses.
- Installer, MSI, RPM, AppImage and other non-portable package formats for now.
