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
- Asset intelligence: type-aware gallery facts, physical-size filters, download plans with
  estimated bytes/files, per-LOD mesh sizes, plant variation dimensions, per-map technical details,
  scale/texel panels and local library health facts.
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
- Completion history is implemented for 1.5 in a separate SQLite database, independent of the queue
  and rebuildable library index (see below).
- Cancellable background health jobs and richer issue filters.

## Phase 4b - Local-first metadata (done in 1.4)

- Optional compact catalogue metadata pack generated from authenticated extended JSON.
- SQLite-backed pack import, lookup, status and refresh independent of app updates.
- Remote card readiness badges and drawer semantic/pack/revision/technical sections.
- Library refinements for readiness, triangle budget, colour, condition and setting.
- Schema v4 local index with readiness and semantic fields, rebuilt from local JSON.
- Plant billboard previews via the authenticated download signing endpoint.

Still open:

- Sampled material/texture-set payloads are empty, so a material explorer needs a data audit first.

## Repository maintenance (done after 1.4.1)

- Replaced personal/machine-specific public documentation with generic setup and testing guides.
- Removed the legacy settings importer and recovered decryption material.
- Made release/update repository URLs build-time configuration instead of tracked constants.
- Added `npm run check:public`, a Quality workflow, contributing/security policy and issue\n  templates.
- Rewrote commits and tags to purge historical personal data, then force-pushed with release
  automation paused.

Still open:

- GitHub Support must purge old unreachable commit objects that remain accessible by SHA.
- Publish the unreleased maintenance changes as the next patch release.

## Browsing productivity (implemented, unreleased)

- Local asset-type/category navigation with indexed counts, favorites and name/type/modified sorting.
- Searchable recorded-pack browser and drawer links, backed by optional catalogue metadata or local
  JSON. Recorded packs are distinct from curated Bridge collections.
- Drawer history/Back, previous/next loaded results, recent searches/assets and visible saved searches.
- Preserved grid position across view changes and persistent thumbnail density/sort preferences.
- Expanded render/map inspection with zoom/pan, image selection and offline JPG/PNG/WebP map previews.
- Expanded maps lazily sign the maximum advertised JPG tier within account limits, with animated
  loading/decode feedback, original-preview fallback/retry and stale-image guards. High-res images
  stay in the temporary viewer and are never finalized into the library or download queue.
- Shared filter-query builders for visible results and all-filtered selection; bulk local operations
  retain their query scope, including duplicate IDs in different folders.
- Searchable/expandable facets and removable active-filter chips.
- Disposable SQLite and isolated Electron browsing regression checks.

Pack data audit of the published metadata: 7,031 of 18,835 records have pack names/IDs, covering
190 packs (largest: 205 assets). The browser does not infer membership for unlabelled assets.

## Networking hardening (implemented, unreleased)

- Shared bounded JSON transport with deadlines, safe retries, jitter, Retry-After and origin queues.
- Short-lived bounded read caches, in-flight coalescing, independent subscriber cancellation and
  account-scoped invalidation; single-flight refresh with logout/late-response guards.
- Obsolete search/drawer/preview cancellation, parallel independent reads and non-blocking categories.
- Optional facet failures preserve search results with a visible warning.
- Validator-aware, range-checked streaming transfers with size verification and safe restart,
  compressed-body handling, closed-handle cancellation and one shared expired-URL re-sign per job.
- Removed layered retry amplification; added deterministic networking and real Electron loopback tests.
- Compact live download diagnostics: receive and file-stream write rates, serving host, and
  server-reported CDN edge/region codes, with details collapsed by default.

See [Networking](NETWORKING.md). Improvements are verified at the request/transfer level; no live
end-to-end benchmark against original Bridge has been performed.

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

## Workspace quality (1.5.0, unreleased)

- Dock the inspector above 1180px; reserve workspace width so virtualized grids and filters reflow.
- Overview, Download settings/Files, Technical and Related sections, with a pinned plan/resolution/
  action footer and progress/pause/resume controls. Local assets retain folder/export/validation tools.
- Scoped Catalogue/Library topbar search, independent queries and one shared facet workbench with
  local readiness/triangle/colour/condition/setting groups. Remove the duplicate catalogue breadcrumb.
- Shell download activity: nav progress, live aggregate speed, mini queue and bulk pause/resume.
  ETA uses observed trailing samples and applies only to active transfers, not unsigned queued jobs.
- Responsive Downloads queue/rail with main-process session counters, actual volume free space,
  explicitly partial cached library measurements and up to 5,000 durable completion records.
- Completion history lives in `download-history.sqlite` in app user data, separate from the asset
  index so index rebuilds/library changes cannot erase it. The rail shows the latest 30; clearing
  finished queue entries does not delete history. Earlier completions cannot be recovered retroactively.
- Version selected locally; no tag or GitHub release published yet.

## Phase 8 - Poliigon provider (implemented, unreleased)

- Provider dimension (`megascans` | `poliigon`) in types, settings, IPC and renderer state.
- Shared library root with per-provider folders; existing Megascans paths preserved.
- Public Poliigon catalogue fetch (`/all`, `/category/list`) into a compact SQLite/FTS index.
  The index is re-checked at launch, on window focus and every two hours while the app runs,
  and refreshes once it is six hours old (with a fifteen-minute retry cooldown), so newly
  published assets appear without restarting. Megascans remains live per query.
- Poliigon category tree, type/free/facet filters, search, sort, paged virtual grid and drawer with
  renders, watermarked map previews and technical metadata.
- No third-party search key, no telemetry, no account required for browsing.
- Poliigon account sign-in (browser flow), DPAPI token storage, plan/credits and owned-asset badges
  are implemented. Password login is hidden because Poliigon rejects it.
- Poliigon downloads are implemented: payload builder, manifest requests, parallel resumable
  transfers, pause/resume/cancel, dynamic MaterialX files and addon-compatible folder layout.
  Premium purchases remain blocked until Phase 5.
- The unified library index is provider-aware (schema v8). The Library view can filter All sources,
  Megascans or Poliigon; Poliigon locals get previews, local resolution/map/LOD facts, health
  statistics, search and an automatic rescan after download. Library is local disk only and
  works offline. The topbar **Check library** action audits acquired assets against disk and
  never downloads anything.
- Parity polish: ID/URL/description search, relevance sorting, recent searches, local favorites,
  downloaded badges/filter, related assets, clickable categories/tags, list/compare view, bulk
  selection/download, Common/All/None map presets, DCC/renderer selection, remembered download
  defaults, expandable 2000px render previews, Megascans-shaped drawer tabs/footer, tab-aware
  scrolling, a Relative size panel and technical grid, a Catalogue/Library search scope,
  single-mesh model handling and catalogue status in Settings.
- Combined Discover is now the default **All** source scope. It merges Megascans, Poliigon and
  Poly Haven assets in one grid/list through a curated cross-provider taxonomy: 3D Assets, 3D Plants,
  Surfaces, HDRIs, Atlases, Decals, Brushes, Imperfections and Displacements, plus shared
  subtopics such as Architecture, Furniture, Food & Drink, Rocks & Terrain, Wood & Flooring,
  Ground & Nature and Houseplants. Provider type/category filters are applied behind each node,
  search and pagination run against all catalogues, and all facet sets, counts, size/state/
  downloaded filters, saved searches, recent searches and viewed assets, Megascans packs,
  scroll restoration, selection and download queues are combined. Focused provider views remain
  available.
  Both Render and Maps preview modes now have previous/next arrows. Technical panels across
  Megascans and Poliigon share group headers and field order (Geometry / Maps / Delivery /
  Metadata), show Max resolution and Map formats whenever available, use LOD counts and
  per-LOD triangle tables, and use provider-neutral type/Access labels. Megascans also gained
  Resolutions/Default resolution, Catalogue ID, Texture maps, physical size/Asset ID, a favourite
  action and the download-destination note. DCC compatibility chips are not shown in the
  technical panel; the DCC chooser stays in download settings. Provider identity now uses the
  supplied Megascans mark and the Poliigon favicon instead of coloured dots. HDRI browsing adds
  a dual-handle 0–24 h time-of-day slider where the handles set the start and end of the
  falloff window (default 09:00–15:00), crossing midnight automatically, with dawn/noon/dusk/
  night ticks and an All day reset, fed by a `time_of_day` catalogue column estimated from
  provider metadata; HDRI views hide size, texture-map and pack filters and show the estimated
  time on cards, footers and technical rows.
  Poliigon technical metadata now includes release status, HDRI sun position, named texture maps
  and vendor compatibility. Map previews for both textures and 3D models now request the
  smallest (1K) manifest map images, cache them under userData and show them unwatermarked;
  opening a map in the full-screen viewer upgrades it to the highest available resolution,
  cached separately under `poliigon-map-highres`, with the shared loading and retry UI.
  HDRI maps expose both a Tone-mapped JPG entry and an HDR (EXR) entry, open on the Maps view,
  and expand from the Render tab straight into the genuine HDRI preview. Selecting HDR enables
  the live view immediately and preserves zoom/pan for comparison. The default full-screen
  image is the highest-resolution JPG/PNG, and the exposure slider downloads and decodes the
  highest published HDR/EXR tier, applies live GPU ACES/sRGB exposure in WebGL without per-stop
  image caches, and maps screen pixels through the same zoom/pan transform as the JPG viewer so
  the HDR view stays equally sharp, with dithering to keep gradients band-free. HDRI previews
  additionally open as an interactive equirectangular 360° panorama (both tone-mapped and HDR)
  with drag-to-look, wheel/button FOV and `P` flat/panorama toggle; it is an independent
  implementation of Poly Haven's interaction model because `imgvwr` is a native app and the
  site source is AGPL. Temporary
  preview transfers use the normal Download activity UI for size, speed, ETA and CDN source,
  and transient provider 429/5xx responses retry briefly or surface a Retry action. Preview
  caches larger than a thumbnail are flushed on quit, keeping thumbnail-sized files. Clicking
  the image closes the viewer. Textures fall back to public watermarked
  previews only if genuine maps are unavailable. This is limited to free, owned or plan-included
  assets so previews never spend credits or acquire an asset implicitly.
- In-app credit purchases are intentionally deferred. OpenBridge assumes the user already has the
  required subscription or owns the assets.
- Next: Poliigon queue persistence across restarts and any remaining DCC import/export work.

See [POLIIGON.md](POLIIGON.md).

## Phase 9 - Poly Haven provider (implemented, unreleased)

- Public CC0 catalogue (`/assets?t=hdris|textures|models`) indexed into
  `polyhaven-catalog.sqlite` with FTS search, type/category/resolution/map/collection facets,
  sorting and explicit HDRI `time_of_day`.
- Background `/files/{id}` enrichment (keyed by `files_hash`) supplies resolutions, map codes,
  image formats and model package formats without repeating requests for unchanged assets.
- Focused Discover view with category tree, collections, bulk selection/downloads, local
  favourites and downloaded filters, list/compare view, and a drawer with previews, genuine map
  previews, live HDR/360 HDRI exposure, technical groups and download settings.
- Public downloads write self-contained folders with `openbridge-polyhaven.json` and `preview.png`.
  The local Library scans those records plus folders created by other tools, and exposes Poly Haven
  in the source filter, health scan and category tree.
- All source scope and unified taxonomy include Poly Haven alongside Megascans and Poliigon.
- Next: persist bulk queue state across restarts if it becomes necessary, and consider optional
  background refresh notifications for newly published assets.

See [POLYHAVEN.md](POLYHAVEN.md).

## Filter workbench audit (1.5.9, unreleased)

- One searchable filter workbench is shared by Discover, All sources, Poliigon, Poly Haven and the
  local Library, with a group rail and value pane that scroll independently in a viewport-capped
  panel. Results remain visible while filters are open, and empty filter controls are hidden.
- Filter and sort sets now vary per provider and asset type: HDRI views hide physical size, maps
  and triangles; atlases, decals, brushes, imperfections and displacements only expose facets that
  apply to them; the Library exposes readiness/triangles/colour/condition/setting per type.
- Physical-size presets (`Up to 50 cm`, `50 cm – 2 m`, `2 – 5 m`, `5 m and larger`) are shared by
  Discover, All sources, Poliigon and Poly Haven, with matching largest-first sorting. Size filters
  and sorts are hidden where the provider publishes no dimensions.
- Poliigon map codes are canonicalised during indexing, merging legacy tokens (`COL`, `NRM`,
  `METALNESS`) with current PascalCase names (`BaseColor`, `Normal`, `Metalness`). The catalogue
  schema is v9; existing indexes rebuild automatically. Facet labels and order are friendly and
  stable, and legacy filter values still resolve.
- Resolution and texture-map facets sort canonically instead of by count, and Megascans facet values
  are humanised (`temperate-forest` → `Temperate Forest`).
- Hidden filters reset when switching type or provider, and focused provider views clear size
  bounds that do not apply to the newly selected type.

## Non-goals

- Reproducing the old insecure Electron 10 renderer (`nodeIntegration`, `remote`).
- Shipping Quixel/Epic artwork, fonts, plugins or user credentials.
- Bypassing asset ownership checks. Downloads must only use assets the user is entitled to.
- Automatic bulk downloading of all acquired assets. Sync only reports differences; users choose
  what to download.
- Fab catalogue or Fab package-download bypasses.
- Installer, MSI, RPM, AppImage and other non-portable package formats for now.
