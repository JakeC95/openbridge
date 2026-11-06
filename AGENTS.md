# Agent handoff

## Project

OpenBridge is a public, open-source Windows x64 app for browsing, downloading and managing a local
content library. Its first provider is Quixel Megascans; Poliigon catalogue browsing is implemented
as a second provider (auth/downloads still in progress). It is an Electron 45 + React 19 + TypeScript
application using `node:sqlite`, esbuild, FTS5 and a portable-only distribution model.

- Branch: `main`, tracking `origin/main`
- Last verified application commit: `781c962` (tagged `v1.4.2`)
- Current app version: `1.5.9` (unreleased)
- Latest published release: `v1.4.2`
- Repo visibility: public
- Distribution: portable ZIP only; no installer, Linux or macOS build
- The repository owner/name is discovered at build time and must not be hard-coded

Changes after `v1.4.2` are unreleased. Choose the next version when new work is ready to publish.

## 1.5.9 workspace pass (unreleased)

- Poly Haven provider added (unreleased): third public CC0 source with a local
  SQLite/FTS catalogue built from `/assets?t=hdris|textures|models`, background
  `/files/{id}` enrichment keyed by `files_hash`, type/category/resolution/map/
  collection facets, sort, search and explicit HDRI time-of-day. It is wired
  into the default All source scope, a focused Discover view, search, cards,
  drawers, map previews, live HDR/360 previews, downloads, bulk selection and
  the local Library. No account, API key, credits or entitlement checks are
  used. Downloads are public CDN files written into self-contained folders with
  `openbridge-polyhaven.json`; the local Library scans both those records and
  folders created by other tools. Clean-room protocol notes are in
  `docs/POLYHAVEN.md`. HDRIs use the clean primary panorama for card/drawer
  thumbnails, the drawer exposes the full attribute/file metadata, and live
  exposure uses the highest published HDR tier up to 8K to stay within memory.
  Catalogue and library thumbnails now share an alpha/flat-background bounds
  cache that crops transparent or plain-backdrop images to the real subject.
- Poliigon provider started (unreleased): provider switch, public catalogue index, category
  search/filters and read-only asset drawer. See `docs/POLIIGON.md` for the protocol research
  and phase plan. Phase 1 stores `poliigon-catalog.sqlite` in user data and needs no Poliigon
  account, third-party search key or telemetry. Phase 2 adds browser sign-in, DPAPI token
  storage, profile/credits and owned-asset badges. Phase 3 adds manifest requests and
  addon-compatible downloads into the Poliigon library. Free assets still require sign-in.
  Live-tested with a Business Unlimited account: token survives restart, free and paid
  (unlimited) assets download without a purchase call, and the on-disk layout matches the
  addon. The public catalogue is re-checked at startup, on window focus and every two hours,
  refreshing the index once it is six hours old (with a fifteen-minute retry cooldown after a
  failure) so newly published assets appear during a session; Megascans stays live per query.
  Phase 4 indexes both libraries with a `provider` column (index schema v8), derives
  local Poliigon previews/resolutions/maps/LODs from disk, exposes an All/Megascans/Poliigon
  Library source filter and opens local Poliigon records in the Poliigon drawer. Completed
  downloads trigger an automatic rescan. Library is strictly local disk contents and works
  offline regardless of subscriptions. The topbar **Check library** action only audits acquired
  assets against local disk; it never downloads missing assets or estimates/queues bulk data. The parity pass adds ID/URL/description search,
  relevance sorting, recent searches, local favorites, downloaded badges/filter, related
  assets, clickable categories/tags, list/compare view, bulk selection/download, Common/All/None
  map presets, DCC/renderer selection, remembered download defaults, Megascans-shaped drawer
  tabs/footer and catalogue status in Settings. Poliigon render previews use the Cloudflare
  `2000px` variant; the drawer supports expand/full-screen viewing and previous/next assets.
  The presentation pass adds the shared Relative size panel for models, a Megascans-style
  technical grid, tab-aware scrolling, a Catalogue/Library search scope, single-mesh handling
  and polycount-based triangle counts. Discover now defaults to an **All** source scope that
  merges Megascans and Poliigon results in one grid/list. A curated cross-provider taxonomy maps
  both category trees into one tree: 3D Assets, 3D Plants, Surfaces, HDRIs, Atlases, Decals,
  Brushes, Imperfections and Displacements, with shared subtopics such as Architecture,
  Furniture, Food & Drink, Rocks & Terrain, Wood & Flooring, Ground & Nature and Houseplants.
  Provider type/category filters are applied behind each unified node, including OR-based
  Megascans category paths and resolved Poliigon category IDs. Queries and pagination run
  against both catalogues, and the combined view reuses each provider's facets, counts, cards,
  drawers and download pipelines, plus size, free/favorites/downloaded filters, saved searches,
  recent searches and recently viewed assets, Megascans pack browsing, scroll restoration and
  bulk selection. Megascans and Poliigon remain selectable as focused views.
- Preview and technical UI consistency: both Render and Maps preview modes have previous/next
  arrows with bounds state. Technical panels share one canonical field order across providers
  (dimensions, resolution, maps/formats, workflow, LODs, triangles, meshes, status, dates),
  show Max resolution and Map formats whenever the provider exposes them, and use LOD counts.
  Megascans now also shows Resolutions/Default resolution, Catalogue ID, Texture maps,
  per-LOD triangle counts, physical size and Asset ID; it gained the missing favourite action
  and the download-destination note. Asset-type labels use one provider-neutral vocabulary
  (3D Model / Surface / HDRI / Atlas / …); both drawers use the same Access field. Provider
  identity is shown with the supplied Megascans mark and the Poliigon favicon (see
  `src/renderer/providers/NOTICE.txt`) on cards and in drawer tags instead of coloured dots.
  HDRI browsing adds a dual-handle 0–24 h time-of-day slider where the handles set the start
  and end of the falloff window (default 09:00–15:00), crossing midnight automatically, with
  dawn/noon/dusk/night ticks and an All day reset; the window is backed by a `time_of_day`
  catalogue column estimated from name/tags/categories/`sun_position`. Time appears on cards,
  footers and technical rows. HDRI views hide size, texture-map and pack filters, and sort
  options are filtered per asset type.
  Technical data is grouped under Geometry / Maps / Delivery / Metadata with the same order
  everywhere; the DCC compatibility chips are intentionally not shown in the technical panel
  (the DCC chooser remains in download settings).
  Poliigon technical data also exposes release status, sun position for HDRIs, named texture
  maps and vendor compatibility; map previews are generated from the smallest (1K) manifest
  images for both textures and 3D models, cached under userData and shown unwatermarked.
  Opening a map in the full-screen viewer upgrades it to the highest available resolution
  through the same manifest, with the shared loading/retry overlay and a separate high-res
  cache. Temporary preview transfers (1K maps, full-resolution maps, HDR sources) publish into
  the normal download-progress channel so the Download activity pill/popover and viewer overlay
  show the same live size, speed, ETA and CDN source as library downloads; they are excluded
  from the Downloads queue/history and vanish when finished. HDRI maps expose both a Tone-mapped
  JPG entry and an HDR (EXR) entry and open on the Maps view; expanding from the Render tab
  switches to that genuine HDRI preview automatically. Selecting the HDR entry enables the live
  view immediately and preserves the current zoom/pan. The default full-screen image is the
  highest-resolution JPG/PNG, and enabling exposure on either entry downloads and decodes the
  highest published HDR/EXR tier, uploads it as a mip-mapped half-float texture and applies live
  GPU ACES/sRGB exposure in WebGL. The shader maps screen pixels through the same fit/zoom/pan
  transform as the JPG viewer, so the HDR view stays aligned and sharp at every zoom, with
  triangular dithering to keep gradients band-free. HDRI previews also open in an interactive
  equirectangular 360° view for both entries: drag to look, wheel/−+ for FOV (65° default),
  `P` or the 360° button toggles flat/panorama, and exposure stays live with a Reset button.
  The mode follows the content (equirect/HDR defaults to 360; flat maps stay flat), and choosing
  HDR or clearing exposure moves the picker between the HDR and tone-mapped entries so the label
  matches the view. UV gradients are derived continuously and sampled with `textureGrad` to
  remove the longitude seam. The 8-bit path uploads the JPEG/PNG to WebGL and shares the same
  camera maths. Opacity/alpha/mask maps request PNG so Poliigon accepts the manifest (this also
  fixes genuine previews for texture atlases). This is an independent implementation of the Poly
  Haven interaction model (`imgvwr` is a standalone Rust app; polyhaven.com is AGPL), so no
  third-party code or assets are bundled. No per-stop image caches are created.
  Transient Poliigon 429/5xx responses are retried briefly or surfaced with Retry instead of
  blocking. On quit, cached preview files larger than a thumbnail are flushed from
  `poliigon-map-previews`, `poliigon-map-highres` and `poliigon-hdr-source`, while
  thumbnail-sized files stay cached. Clicking the image
  itself closes the viewer. Textures fall back to the public watermarked catalogue previews
  only when genuine 1K maps are unavailable. This path only runs for free, owned or plan-included
  assets, so it never turns into an acquisition or credit spend. In-app purchases are
  intentionally out of scope; OpenBridge assumes the user already has the required subscription
  or owns the assets.
- Library settings now distinguish `libraryRoot`, the Megascans path (`libraryPath`) and
  `poliigonLibraryPath`. Existing Megascans paths are preserved and Poliigon defaults to a
  sibling `Poliigon` folder; new installs use `Documents\OpenBridge\{Megascans,Poliigon}`.
  `poliigonConfirmPurchases` defaults to true and must stay explicit.

- App-wide filter audit completed for 1.5.9. Filters and sorts are type-aware for Megascans,
  Poliigon, Poly Haven, All sources and the local Library; irrelevant groups/sorts are hidden and
  their stored values reset on type/provider changes. The shared `FilterWorkbench` now has an
  independently scrolling group rail and value pane inside a viewport-capped, header-fixed
  `.facet-panel`, so long All-source filter sets stay usable and results remain visible at
  1024x768. `Filters` is hidden when no group applies.
- Poliigon map codes are canonicalised at index time (`src/shared/poliigon-maps.ts`) so legacy
  tokens (`COL`, `NRM`, `METALNESS`, `DISP`, `GLOSS`, `REFL`) and PascalCase names (`BaseColor`,
  `Normal`, `Metalness`, `Gloss`, `Reflection`) produce one facet each. `poliigon-catalog.sqlite`
  schema is v9 and rebuilds automatically; the count remains 7,448. Map labels/order live in
  `src/renderer/poliigon-labels.ts`; legacy filter values still resolve through the canonicaliser.
- Physical-size presets/filters/sorts are shared (`src/renderer/size-filter.ts`) by Discover, All
  sources, Poliigon (non-HDRI) and Poly Haven (models). Resolution facets sort numerically and map
  facets use canonical order; Megascans facet values are humanised.
- Verified counts after the audit: 28,670 total (18,835 Megascans · 7,448 Poliigon · 2,387 Poly
  Haven); Poliigon Normal 7,072 and Base Color 7,035; Poly Haven models 2–5 m 71. `npm run check`,
  `npm run build`, `npm run test:browsing`, `npm run test:network` and `npm run test:browsing:ui`
  pass. The UI fixture now covers the three-provider All view, and All-view Shift selection closes
  open drawers and anchors the range like the focused Megascans view. These changes are pushed to
  `main`; no tag or release has been created.

- All five approved UI improvements implemented: docked wide-screen inspector, section navigation
  and pinned download footer, scoped search/shared filter workbench, shell download activity and
  responsive Downloads history/storage rail.
- `src/main/download-completions.ts` stores up to 5,000 completions in a separate user-data SQLite
  database. The rail displays the latest 30. Queue clearing and library-index rebuilds do not erase it.
- `downloads.overview()` exposes real session receive counters, completion history, volume free space
  and explicitly partial cached library measurements. No new live library scan is started by the rail.
- New renderer components: `DownloadActivity.tsx`, `DownloadsRail.tsx`; aggregate/ETA helpers in
  `src/renderer/download-summary.ts`. Catalogue and Library use `FilterWorkbench` from `BrowsingTools`.
- Do not tag or publish without user confirmation. The latest published release remains `v1.4.2`.
- Overview now includes `AssetScaleDiagram.tsx`: an SVG front orthographic human (1.78 m) and asset
  bounds sharing one metres-to-pixels scale and ground line. `src/shared/asset-scale.ts` reads the
  existing length/width/height metadata or recorded variations; scan area alone never creates bounds.
  Browsing regression checks now include unit parsing and proportional geometry.
- Version bumped to 1.5.1 to build into a fresh portable folder while the old 1.5.0 runtime is locked.
- Version 1.5.2 moves the scale reference from Technical to Overview, leaving technical fields intact.
- Partial QoL batch in 1.5.3: catalogue/drawer retry, queue search/status and retry with original
  settings, interface scale, configurable metric/imperial human reference, opt-in automatic paging.
  Version 1.5.4 adds best-effort browsing state/scroll restore, loaded-item list and comparison,
  dismissible first-run guidance, shortcut help, an enlarged scale inset, cancellable health scan
  and non-destructive duplicate review. Paging restoration is bounded by loaded results; cleanup does
  not automatically delete or move suspected duplicates/orphans. No release has been published.
- Catalogue cards support Shift-click / Shift+Enter to begin inclusive loaded-range selection
  from the most recently opened card. Explicit Select mode still works. In a narrow overlay drawer,
  holding Shift allows clicks on visible cards behind the backdrop; covered cards remain obscured.
- List/compare remains available during bulk selection. Comparison is preview-led with technical
  metadata and proportional height references. Catalogue sorting reorders loaded results; Library
  sorting runs across the full indexed query and exposes available technical/health fields.
- Pagination no longer reapplies saved scroll positions while loading. Comparison previews use
  contained images and surface-specific details instead of inapplicable mesh/height fields.
- Catalogue pagination anchors the visible asset when client-side sorting inserts newly loaded
  assets above it; the UI regression tests sorted paging rather than scroll offset alone. The user
  reported that the previous 1.5.7 scroll fix did not work, and later said 1.5.8 was OK for now.
- The local 1.5.8 portable folder and ZIP are in `dist/`; older versioned portable folders and ZIPs
  were removed at the user's request. `dist/` is ignored and is not pushed to GitHub.
- GitHub Quality exposed a sorted auto-paging regression at 1024x768; 1.5.9 captures the visible
  anchor before a page request. The UI regression scrolls near the bottom with headroom below the
  anchor (the last row cannot keep its viewport position once new pages extend the list), and runs
  at both narrow and wide widths. A fresh 1.5.9 portable build is available locally in `dist/`.

## Mandatory checks

Run from the repository root in PowerShell:

```powershell
$env:Path = "$PWD\tools\node-v24.22.1-win-x64;$env:Path"
npm run check
npm run build
npm run check:public
```

`npm run check` runs TypeScript and the public-repository hygiene check. Run `npm run check:public`
after staging new files, because it only scans `git ls-files`.

For packaging:

```powershell
npm run dist:portable
```

GitHub Actions `Quality` runs typecheck + public check on pushes, pull requests and manual dispatch.
The release workflow runs only on `v*` tags and publishes the portable ZIP plus `latest.json`.

There is no unit-test suite. Verification is typecheck, build, public check, portable packaging and
the manual checklist in `docs/TESTING.md`.

## Repository hygiene rules

The repository is public. Every commit is public.

- Do not commit credentials, tokens, private keys, account names, email addresses, local absolute
  paths, machine identifiers, personal tool paths or downloaded assets.
- Use placeholders such as `%APPDATA%`, `<repo>`, `<user>` and `<owner>/<repo>`.
- Never commit `config.local.json`, `config.local.*.json`, `.env*`, `*_api_key.txt`, generated
  SQLite files, metadata packs, logs, `out/`, `dist/`, `analysis/`, `third_party/` or `tools/`.
- `config.local.example.json` is intentionally tracked.
- Run `npm run check:public` after adding files.
- The hygiene script builds blocked patterns from character codes. Do not replace them with literal
  personal values or secret fragments.
- Do not reintroduce the legacy Bridge settings importer or its decryption key. It was deliberately
  removed before the public history rewrite; the default library path is now
  `Documents\Megascans Library`.
- Do not hard-code the GitHub owner/repository. Use `releaseAssetUrl()` from `src/main/project.ts` or
  the `OPENBRIDGE_REPOSITORY` / `GITHUB_REPOSITORY` build inputs.

## Architecture map

- `src/main/index.ts` - Electron startup, settings defaults, IPC registration, lifecycle.
- `src/main/auth.ts` - Epic OAuth, DPAPI-backed session storage, profile.
- `src/main/legacy-api.ts` - legacy catalogue/download REST client.
- `src/main/downloader.ts` - transfers, resume, size verification, persistence.
- `src/main/library.ts` and `src/main/library-index.ts` - library scan, schema v4, FTS5, filters.
- `src/main/catalog-metadata.ts` - optional metadata pack provider, import/download/status.
- `src/main/catalog-pack-builder.ts` - authenticated pack generation and retry logic.
- `src/main/map-previews.ts` - map previews; billboard maps use the authenticated download path.
- `src/main/updater.ts` - release manifest, SHA-256-verified portable update.
- `src/main/project.ts` - injected repository slug and release asset URL.
- `src/main/settings.ts` - settings store, migrations and per-type download defaults.
- `src/main/sync.ts` - acquired/favorite/library synchronization.
- `src/main/poliigon/catalog.ts` - public Poliigon catalogue fetch, SQLite/FTS index, categories and queries.
- `src/main/poliigon/auth.ts` - Poliigon browser sign-in, DPAPI token store, account/credits and owned-asset sync.
- `src/main/poliigon/download.ts` - Poliigon manifest downloads, progress, pause/resume/cancel and addon-compatible layout.
- `src/main/poliigon/payload.ts` - pure Poliigon download payload builder for textures, models and HDRIs.
- `src/main/library.ts` - scans Megascans and Poliigon libraries; Poliigon records are matched to the catalogue by AssetName.
- `src/main/library-index.ts` - provider-aware SQLite/FTS index (schema v8) with per-provider counts and filters.
- `src/main/http-api.ts`, `discovery.ts`, `mixer-socket.ts` - legacy local integration.
- `src/renderer/views/LibraryView.tsx` - catalogue/library browsing and filters.
- `src/renderer/views/PoliigonView.tsx` - Poliigon catalogue browser; `poliigon-store.ts` holds its state.
- `src/renderer/components/PoliigonDrawer.tsx` - Poliigon preview, map and technical inspector.
- `src/renderer/components/AssetDrawer.tsx` - map, technical and metadata display.
- `src/renderer/components/BrowsingTools.tsx` - shared searchable filter workbench and browsing menus.
- `src/renderer/catalog-utils.ts` - local readiness/semantic/freshness filtering and facet ordering helpers.
- `src/renderer/size-filter.ts` - shared physical-size presets, bounds and label mapping.
- `src/renderer/poliigon-labels.ts` - Poliigon map labels and canonical display order.
- `src/shared/poliigon-maps.ts` - canonical Poliigon map-code normalisation used by the catalogue index.
- `src/shared/types.ts` - shared IPC/domain types.
- `src/shared/asset-metadata.ts` - pack record projection and technical extraction.
- `scripts/build.mjs` - esbuild pipeline and repository slug injection.
- `scripts/package-portable.ps1` - portable ZIP layout.
- `scripts/make-update-manifest.mjs` - release manifest generator.
- `scripts/check-public-repo.mjs` - tracked-file privacy/secret scanner.
- `.github/workflows/quality.yml` - typecheck + public check.
- `.github/workflows/release.yml` - tag build, manifest, GitHub release assets.

## Configuration and release URLs

`scripts/build.mjs` resolves the repository in this order:

1. `OPENBRIDGE_REPOSITORY`
2. `GITHUB_REPOSITORY`
3. `repository` in ignored `config.local.json`
4. GitHub remote from `origin`

The slug is injected as `__OPENBRIDGE_REPOSITORY__`. At runtime, `releaseAssetUrl()` builds
`https://github.com/<slug>/releases/latest/download/<asset>`. If no slug is present, update checks
return a configuration error and the metadata-pack download reports that no URL is configured.

Release assets:

- `OpenBridge-<version>-win-x64-portable.zip`
- `latest.json`
- `catalog-metadata.json.gz` (optional, uploaded manually)

Do not delete or rename released tags. The updater and pack downloader resolve assets through
`releases/latest/download` and tag-specific release URLs.

## Release status and known facts

`v1.4.2` assets (published 2026-10-27):

- Portable ZIP: `159,195,365` bytes
- ZIP SHA-256: `30A682988B74EA2E84A1542EDDB863F8838B8E2DE98EFC9E8CAE74E750F6A581`
- Contains the browsing workflow, high-resolution previews, networking hardening, live download
  diagnostics, download history sparkline, CDN country flags, the catalogue filter workbench
  (group rail, per-group search, checkbox rows) and the larger app-wide type scale with a wider
  sidebar and asset drawer.
- Verified after upload: release assets return HTTP 200/206, the downloaded ZIP hash matches
  `latest.json`, and the packaged `resources/app/package.json` reports `1.4.2`.
- `Quality` passed on `781c962` before tagging; `latest.json` points to `v1.4.2`.

`v1.4.1` assets:

- Portable ZIP: `159,058,760` bytes
- ZIP SHA-256: `E4089BA1C3FFD81158C4800B8BEE876E171FEFE6D23B526BF7EC467ADC00ECBB`
- Metadata pack: `1,585,054` bytes
- Pack SHA-256: `EDF1237AD02A3B4DF82FE58C2A0A677859DA6E0CCD6A42509533710037A02411`
- Pack records: `18,835`

CI-built ZIP hashes differ from local builds. Always verify the uploaded CI asset before documenting
a release hash.

The local `dist/OpenBridge-1.4.2-win-x64-portable` build (`159,194,669` bytes, SHA-256
`C3EF2AFA8258149947BA01710600CF6C1B8D5BA52F4914F8FC5130BE4C4E6188`) predates the CI release and
differs from the published asset. Do not quote it as a release hash.

Hosted Windows runners expose a 1024x768 desktop. `test:browsing:ui` clamps its window to the work
area and compares compact density against comfortable density instead of a fixed column count, so it
must keep passing at narrow widths.

## Recent completed work

- Public-facing README/docs rewrite; removed personal paths, email, hardware details and recovered
  key material.
- Build-time repository slug injection; hard-coded owner URLs removed from tracked source.
- Public-repository hygiene check, Quality workflow, contributing/security policy, issue templates.
- Removed the legacy settings importer because it required a recovered secret.
- Rewrote all commits and 12 tags to remove historical personal data, then force-pushed with GitHub
  Actions temporarily disabled to prevent release workflows from rebuilding old tags.
- GitHub repository description and topics updated.
- Quality CI manually dispatched on rewritten `main` and passed.
- Released `v1.4.2` from `781c962`: browsing workflow, high-resolution previews, networking and
  transfer hardening, live download diagnostics, CDN country flags, catalogue filter workbench and
  the larger type scale. Added `test:browsing`, `test:network` and `test:browsing:ui` to `Quality`.

A pre-rewrite backup bundle was created outside the repository under the session temp directory.
It contains the removed sensitive data. Keep it only until the GitHub purge is confirmed, then
delete it.

## Outstanding work

1. **GitHub cached commit purge is pending.** Old pre-rewrite commits from `v1.1.0` through
   `v1.3.1` still resolve by raw SHA even though no branch/tag points to them. This is expected after
   a force-push. Open `https://support.github.com/contact` and request removal of unreachable
   commits containing sensitive data for this repository. Do not consider the history cleanup
   complete until old SHA URLs return 404.
2. **Do not run release workflows for old tags.** If another history rewrite is ever required,
   disable Actions first, back up all refs, force-push, re-enable Actions, then manually verify
   release assets and `latest.json`.
3. **Metadata data gap.** Sampled material/texture-set extended payloads are empty; a material
   explorer needs a data audit before implementation.
4. **Publishing the next version.** Bump `package.json`/`package-lock.json`, run the mandatory
   checks, commit the working tree, push `main`, wait for `Quality` to pass, then tag and push the
   tag. Never tag before the code is committed, or the release workflow builds the previous commit.

## Useful commands

```powershell
npm run start
npm run typecheck
npm run check:public
npm run check
npm run build
npm run dist:portable
npm run catalog:pack:sample
```

GitHub CLI is not installed. Use the GitHub REST API with a token from:

```powershell
"protocol=https`nhost=github.com`n`n" | git credential fill
```

Do not print the token. Do not store it in the repository.

## Documentation index

- `README.md` - public overview, install, configuration and project map
- `CONTRIBUTING.md` - contribution and public-hygiene requirements
- `SECURITY.md` - private vulnerability reporting
- `docs/BUILD.md` - build, packaging, configuration and release process
- `docs/TESTING.md` - automated and manual verification
- `docs/PROTOCOL.md` - local API and export protocol
- `docs/REVERSE-ENGINEERING.md` - original-app research notes
- `docs/POLIIGON.md` - Poliigon addon research, protocol and provider integration plan
- `docs/TOOLCHAIN.md` - optional research tools
- `docs/ROADMAP.md` - completed and planned product phases
