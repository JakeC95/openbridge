# Validation log

## v1.2.3 (current)

Environment: Windows 11 Pro, Electron 45, live legacy services.

### Build and package

- `npm run typecheck`, `npm run build` and `npm run dist:portable` completed successfully.
- Packaged portable reports `1.2.3` and starts with 48 catalogue cards and 5 local assets.
- The packaged Electron runtime successfully loads `node:sqlite` and the FTS5 index.
- Asset cards and the drawer no longer display point prices; free/owned states remain.

### Indexed library

- The index is created at `%APPDATA%\openbridge\library-index.sqlite` in WAL mode; schema version 2
  includes assets, issues, metadata and an FTS5 virtual table.
- The first scan indexed 5 assets. A subsequent scan skipped all 5 unchanged folders without
  re-reading their JSON, completing in 3-4 ms.
- Local search uses FTS5 prefix terms:
  - `rock` returned 3 assets in about 0.4 ms.
  - `rock small` returned 2 assets.
  - `desert-western` normalized to two terms and returned 3 assets.
- Repository filters and counts are evaluated by SQLite; selecting Custom returned 0 while the
  global library count stayed 5.
- Single-asset validation, drawer export and selected-asset export now resolve rows through the
  index instead of scanning the whole library; deletion also targets indexed paths directly.

### Surface map audit

- Cross-referenced 96 general surfaces, 48 metal-focused surfaces and 42 keyword-diverse surfaces.
- The dominant surface set is nine maps: albedo, AO, normal, displacement, roughness, specular,
  gloss, bump and cavity (80 of the 96 general samples).
- A small number used occlusion instead of AO, or added opacity/translucency/transmission.
- Metal surfaces added metalness; rare special cases added diffuse, mask or fuzz.
- Surfaces never showed normal-bump, normal-object, thickness, curvature or brush maps in this
  sample.
- The Surfaces preset now exposes 16 real map choices and defaults to the 10 core/metal maps.
  `occlusion` is displayed and selected as AO while the original download type is preserved.

### Scale and virtualization

- A synthetic 5,000-row index was used to test large-library behavior without creating files.
- FTS5 search over 5,000 rows returned in about 4.6 ms.
- The Library rendered only 36 cards for the 5,000-row result set, with a 20,147 px virtual scroll
  surface; scrolling to 5,000 px moved the window to row offset 4,035 px.
- Load more appended the next 300 rows, showing 600 loaded without increasing the rendered card
  count.
- Select-all-filtered selected all 5,000 matching rows.
- The catalogue grid rendered 36 of 48 loaded cards and updated its virtual window on scroll.
- Synthetic rows were deleted after the test; the library returned to its 5 real assets.

### Health

- Health progress events report `checked / total / percent`.
- The final report matched the previous run: 5 assets, 102 files, 1.4 GB, one missing-mesh issue.
- Health updates are written in batches of 25 assets inside a transaction.
- Library table sizes remain unchanged until a health pass refreshes them.

### Packaging hashes

```
portable/OpenBridge.exe  8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
electron.exe             8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
portable zip             FE7951CFCD0A7EF79A11B92D74FC6BEA6769957988915ADB52642F2EE574AB53
```

### Not tested in v1.2.3

- A real library with tens of thousands of files; scale behavior was measured with synthetic index
  rows plus the 5-asset validation library.
- Cancellable background health jobs and duplicate/orphan repair.
- A forced-quit scan while SQLite WAL writes are in flight.
- Microsoft Store-style packaging or any non-portable distribution.

## v1.1.2

Environment: Windows 11 Pro, Electron 45, live legacy services.

### Build and package

- `npm run typecheck`, `npm run build` and `npm run dist:portable` completed successfully.
- Packaged portable reports `1.1.2`, title `OpenBridge`, 48 catalogue cards, 18,835 catalogue
  assets and 5 local assets.
- Portable `OpenBridge.exe` is byte-identical to Electron 45 and passes Smart App Control.
- The packaged 1.1.2 build checked the published GitHub manifest and returned `current: 1.1.2`,
  `latest: 1.1.2`, `available: false`.

### Settings and per-type defaults

- The Settings view has four preset cards: 3D Assets, 3D Plants, Surfaces, Other 2D Assets.
- Each card exposes 21 default-map toggles with Common/All/None shortcuts. The recommended preset
  selects 11 maps (albedo, AO, displacement, fuzz, metalness, normal, opacity, roughness,
  translucency, transmission and brush), for 44 selected chips across the four cards.
- Removed controls are absent: offline library, stall timeout, parallel-file count and update-feed
  URL.
- An API round-trip set 3D to 4K/ABC, 3D Plants to 2K with highpoly, and Surfaces to EXR; the saved
  values were returned correctly. Restoring the original settings returned 8K/FBX.
- Toggling Normal Bump in the 3D card saved only the 3D preset to 12 maps; the other three presets
  stayed at 11. Restoring the preset returned 11.
- With the 3D preset reduced to albedo only, opening `xgmpcby` showed just the Albedo checkbox
  selected in the drawer. A pure resolver test confirmed preset maps apply to main-process bulk
  downloads and explicit drawer components still override the preset.
- `Ctrl+K` opened the command palette; ArrowDown + Enter navigated to Settings. Typing a query and
  pressing Enter also executed catalogue search.
- Custom dropdowns render with `rgb(32, 32, 32)`, receive keyboard focus, close with Escape and
  clamp inside the viewport.

### Discovery and library

- 3D Assets category returned 4,185 assets.
- `desert biome` facet reduced the result set to 204.
- Saving the search wrote `openbridge.savedSearches` to local storage.
- Library health reported 5 assets, 102 files, 1.4 GB and 1 issue (missing mesh), matching the
  earlier v1 scan.
- Bulk JSON export of two assets wrote `megascansAsset.json` with both records.
- Library folder deletion was intentionally not exercised against the validation assets.

### Download queue persistence

- A paused queue entry restored after restart with status `paused` and the original message.
- Cancelling that job changed it to `cancelled`, and the persisted queue became `[]`.
- `clearFinished` removed the cancelled job from the main-process queue and persisted the empty
  queue.
- File-level Range resume, disk preflight and retry exhaustion were not forced in this run; the
  v1.0 pause/resume test remains the live transfer evidence.

### Packaging hashes

```
portable/OpenBridge.exe  8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
electron.exe             8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
portable zip             382E3F15F588E2D2A03C52C1D4405191DB78256A3CB5B341BDB22048BAE55F88
```

### Updater test

- A local HTTP manifest served a 1.1.3 test payload to the 1.1.2 portable build.
- The app downloaded it, tar-extracted all 89 files, wrote `install-update.ps1`, and logged the
  source and target roots.
- Running the generated install script directly copied the payload and restarted the app as 1.1.3.
- The test harness terminates detached children when the calling process exits, so the final
  unattended helper handoff was not observed end-to-end in this environment.

### Not tested in v1.1.2

- Installing a newer release through the auto-updater (no newer published release existed at test
  time). The published 1.1.0 manifest check was verified; the app reported `current: 1.1.0`,
  `latest: 1.1.0`, `available: false` and the correct asset URL, size and SHA-256.
- A forced-quit transfer resume from a partial `.part` file.
- Mixed per-type bulk download against legacy services; defaults were verified through the settings
  API and the renderer option builder.
- Destructive library deletion and duplicate repair.
- Highpoly/ZTool/brushes transfer variants.

## Archived v1.0.0 log

The section below records the original v1.0 scope and tests. Fab catalogue code and the Fab UI were
removed in v1.1.0; offline-library settings and the configurable update feed were also removed.
NSIS and Linux packaging were removed in favour of the portable-only distribution. The packaging
entries below are historical.


### Environment (v1.0.0)

Windows 11 Pro. OpenBridge uses Electron 45. The original
Quixel Bridge 2025.0.0 was installed and running during the early tests; it was closed for the
final local-service and packaging tests.

## Static analysis

- `resources/app.asar`: 499,801,711 bytes, 97,857 files.
- Renderer source map: 1,085 `sourcesContent` entries recovered to `analysis/renderer-src`.
- Main bundle: 108,206 bytes prettified to `analysis/main.pretty.js`.
- Documented IPC channels, local API, discovery/Mixer sockets, DCC ports, library layout, plugin
  manifest, EOL/Fab config and the OAuth flow in `docs/REVERSE-ENGINEERING.md` / `PROTOCOL.md`.

## Runtime tests

### Catalogue and categories

- Initial Discover page: 48 cards, 18,835 assets reported by Algolia.
- Search `Desert Western Cluster Rock Small 02` -> 1 matching card.
- Search `Xeric Grass` -> 3D plant results.
- Top-level category tree counts from the live `assetCategories` facet:

```
3D Assets 4,185   3D Plants 288    Surfaces 7,604   Decals 2,235
Atlases 3,294     Imperfections 547  Displacements 52  Brushes 618
```

- Nested categories expand and filter correctly:
  - Surfaces > Stone -> 778 assets
  - Surfaces > Stone > Floor -> 76 assets
  - 3D Assets > Nature -> 1,866 assets
  - 3D Assets > Nature > Rock -> 1,276 assets
- Free filter (`points:0`) -> 51 assets, search field cleared automatically.
- Favorites round-trip: add favorite via card heart, count updates to 1, remove restores 0.
- The category tree contains all top-level categories and their nested children; counts are merged
  from a `maxValuesPerFacet=1000` Algolia facet query.

### Search

- A `quixel.com` asset URL (`https://quixel.com/assets/xgmpcby?foo=bar`) is reduced to the bare
  ID `xgmpcby`, switches to Megascans and returns exactly one card.
- A Fab listing URL without a scheme (`fab.com/listings/<uuid>`) and a bare UUID both switch to
  Fab and return exactly one listing. Full URLs with query strings also resolve.
- Prefixed IDs (`asset:xgmpcby`) work and clear category/filter state before searching.
- Whitespace is normalized (`  desert   rock  ` becomes `desert rock`), and bare legacy IDs return
  the matching asset.
- Local library search is token-based: `rock small` returns 2 of the 5 validation assets, and
  `xgmpcby` returns exactly 1.
- A search for `xeokah0` in Megascans shows an empty state with “Search Fab for `xeokah0`”. The
  action switches source and returns the target listing first; Fab's text search is fuzzy, so it
  returns 24 listings rather than 1 unless a listing URL/UUID is used.
- Catalogue requests have a 20 s timeout, retry transient/429/5xx failures, and a stale-request
  guard so an older response cannot replace a newer search.

### Texture map previews

- Opening `xgmpcby` and choosing **Maps** loaded 9 signed previews: Albedo, Normal, Bump, Gloss,
  Displacement, Roughness, Cavity, Specular and Normal Bump, each at 1024x1024.
- The image URL was a signed `rp.quixel.com/xgmpcby/...` URL derived from
  `/generateSignedUrl`; the images rendered in the drawer.
- The previous/next buttons and ArrowLeft/ArrowRight changed the map label and image; the counter
  showed `2 / 9` for Normal.
- `xjfgdhaqx` (Xeric Grass) exposed 11 maps including AO, Opacity and Translucency.
- Map previews only fetch signed images; no asset download or library write is triggered.

### Fab catalogue

- Discover source switch toggles between `MEGASCANS` and `FAB`; Fab uses a separate result count
  and "load more Fab listings" cursor.
- Search by the test listing URL auto-detected the UUID and returned exactly one result:
  `Historic Miscellaneous Stand Wood Old 05`, seller `Quixel Megascans`, price `FROM €4.44`.
- The card renders type `3D`, a `FAB` badge, the seller and a correctly encoded euro price (no
  mojibake). Search by bare UUID and by the full fab.com URL both resolve to the listing.
- The Fab drawer loaded the detail JSON: title, UUID, seller, `€4.44`, category
  `Furniture & Fixtures`, tags, formats (`FBX`, `Converted Files`, `Additional files`, `GLTF`),
  publish date, description and gallery. The drawer provides Open on Fab, Open Fab in Epic
  Launcher and Copy listing link; no in-app download button is shown.
- Switching to Fab and searching the target immediately (while Fab's default listing search was
  still in flight) still finished with the target result. A request-generation guard prevents an
  older catalogue response from overwriting a newer search.
- Fab download probes found no public file endpoint. `/i/listings/<uuid>/download`, `/files`,
  `/library` and similar paths return 404; the authenticated legacy
  `/v1/assets/xeokah0/extended` also returns 404. Fab package retrieval is entitlement-gated and
  must go through Fab/Epic.

### Authentication

- Epic OAuth window opened from the UI; after interactive login the main process received the
  code, exchanged it at `accounts.quixel.se/api/v1/login/epic`, and stored the encrypted session.
- Profile: `user@example.com`, plan `unreal-unlimited`.
- Acquired endpoint returned 18,870 asset ids. Sync reports 18,865 not in the local library;
  **no automatic downloads occur**.

### Downloads

| Asset | Options | Result |
|---|---|---|
| `xgmpcby` Desert Western Cluster Rock Small 02 | 1K, JPG, FBX, LOD0, default maps, displacement JPG+EXR | 12 files, 7.6 MB, mesh `xgmpcby_LOD0.fbx`, folder `3d/nature_rock_xgmpcby` |
| `xgmncdu` Desert Western Rock Large 06 | 1K, JPG, FBX, LOD0 | paused at 16.5 KB / 12.9 MB, resumed, completed; folder `3d/3d_nature_xgmncdu` |
| `xgoraef` Desert Western Rock Large 08 | 1K, JPG, FBX, LOD0 | cancelled after request; Downloads shows CANCELLED; no asset folder left |
| `xjfgdhaqx` Xeric Grass | 1K, JPG, ABC, LOD0 + LOD6/7 prefs, billboards, 8 variations | 49 files, 32.7 MB; `Atlas/`, `Billboard/`, `Var1..Var8/`, JSON + previews |

The download response contains `components`, `meshes`, `billboards`, `previews` and a `json`
descriptor. The JSON descriptor is downloaded, the temp tree is copied into the library, and the
asset JSON preserves the original relative paths (`Atlas/...`, `Billboard/...`, `VarN/...`).

Manual map/LOD tests confirmed the payload changes:

```json
{
  "components": [
    {"type":"albedo","resolution":"1024x1024","mimeType":"image/jpeg"},
    {"type":"normal","resolution":"1024x1024","mimeType":"image/jpeg","tris":8022},
    {"type":"displacement","resolution":"1024x1024","mimeType":"image/jpeg"},
    {"type":"displacement","resolution":"1024x1024","mimeType":"image/x-exr"},
    {"type":"roughness","resolution":"1024x1024","mimeType":"image/jpeg"}
  ],
  "config": {
    "highpoly": false, "ztool": false, "lowerlod_normals": true, "albedo_lods": true,
    "meshMimeType": "application/x-fbx", "brushes": false, "lods": [8022]
  }
}
```

### Card controls

- Left click opens the asset drawer.
- Hover exposes the download button and favorite heart.
- Downloaded cards show an always-visible green check and check state.
- Starting a download from the card shows an always-visible progress pill; clicking it pauses,
  clicking again resumes. Cancel removes the partial temp tree and leaves no asset folder.
- A downloaded card (e.g. `xgmpcby`) shows `DOWNLOADED` semantics without a redundant text badge.

### Multi-select and bulk download

- **Select** adds a checkbox to all 48 loaded cards and shows the bulk bar.
- Card clicks, checkbox clicks and shift-click ranges update the selection; a range test selected
  5 cards, and selecting all IDs in Surfaces > Stone selected 778 assets (48 rendered cards plus
  the remaining result set).
- **Select all** enumerated the complete catalogue (18,835 entries) in about 4.7 seconds via the
  Algolia `catalog:ids` path. Free filter selection produced 51 entries.
- Download selected queued a 2-asset batch; both jobs appeared in Downloads and were cancelled
  cleanly, leaving the library at the original 5 assets.
- A larger 778-asset batch plus the 2 cancelled jobs produced 780 download rows. Downloads showed
  the first 300 and reported “Showing 300 of 780 downloads”; **Cancel all** marked every active job
  cancelled and left no new library folders.
- Assets already in the local library are skipped, and unowned paid assets are skipped with a
  message. Bulk actions are user-initiated; no automatic bulk downloads run.

### Context menus

- Asset right-click (native Electron menu):
  - Go to Files (local assets only)
  - Copy Asset ID
  - Copy Asset Link (`https://quixel.com/assets/<id>`)
  - Validate Asset JSON (local assets only)
- Search right-click (native Electron menu):
  - Paste
  - Paste and Search
- Both menus were triggered successfully; the validation action uses the same IPC path verified
  below.

### Downloaded JSON validation

`window.openbridge.validateAssetJson` parses the downloaded JSON and runs it through the export/
library consumer:

```json
{
  "ok": true,
  "assetId": "xgmpcby",
  "name": "Desert Western Cluster Rock Small 02",
  "categories": ["3d", "nature", "rock"],
  "components": 4,
  "meshes": 1,
  "lods": 1,
  "warnings": []
}
```

```json
{
  "ok": true,
  "assetId": "xjfgdhaqx",
  "name": "Xeric Grass",
  "categories": ["3dplant", "grass"],
  "components": 7,
  "meshes": 24,
  "lods": 24,
  "warnings": []
}
```

### Local library

- Scanner found five assets and their previews/JSON.
- Library UI shows thumbnails, repo tabs and search.
- Import folder/zip code paths are implemented (native dialogs are manual).

### Local services

- `/GetMegascansFolder/` returns `{"folder":"C:\\Users\\<user>\\Documents\\Megascans Library"}`.
- With the original Bridge closed, discovery (`28852`) and Mixer (`28456/28458`) bind cleanly.
- During early tests the original Bridge held those ports and OpenBridge logged `EADDRINUSE`
  warnings as expected.
- Export JSON scaffold produces `megascansAsset.json`; not part of the v1 scope.

### Packaging

- `npm run dist:portable` produced the working build:
  - `dist/OpenBridge-1.0.0-win-x64-portable/OpenBridge.exe`
  - `dist/OpenBridge-1.0.0-win-x64-portable.zip` (158,973,887 bytes)
- The portable exe is byte-identical to Electron 45, so Smart App Control accepts it. Verified from
  `dist`: title `OpenBridge`, version 1.0.0, 48 catalogue cards, 5 local assets, Source Sans 3
  loaded, Epic session persisted, all category counts/filters present, no mojibake in the UI.
- The Bridge-aligned shell was verified in the packaged build: 280 px responsive sidebar (320 px at the original window width), header search, 48 px filter bar, dismissible Fab banner, sidebar category tree, image-first cards with hover metadata and the 120 px right drawer.
- The rebuilt portable also passed the new flows: Quixel/Fab URL search, the Maps drawer
  (9 signed maps, Albedo → Normal via arrow), multi-select with the bulk bar, and the Fab target
  card. No new local assets were created during the image/selection tests.

### Artifact hashes (SHA-256)

```
portable/OpenBridge.exe  8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
electron.exe             8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
portable zip             98C11836EE340036AF0562D5E9F0A2B90487D171547F4D677B424F960AEBFCFC
```

## Not tested

- Acquiring an unowned paid asset (the test account is `unreal-unlimited`; all catalogue assets
  report as acquired).
- Highpoly/ztool/brushes download variants (UI and payload wired; not exercised to save bandwidth).
- Completing a very large bulk queue (the 778-asset queue was cancelled after validating the queue
  and 300-row Downloads window).
- Texture maps for every asset and multi-texture-set labelling; representative 3D rock and 3D plant
  assets passed.
- DCC export/plugins, 3D preview/channel packing, MetaHumans (out of v1 scope).
- Fab checkout/package acquisition. The drawer only opens Fab/Epic Launcher; no entitlement or
  download bypass is implemented.
- App auto-update feed (setting is implemented; no public feed exists).

## Resource use

Five assets (~1.4 GB) are present in the validation library, below the few-GB development budget.
Bulk and select-all downloads are manual, user-initiated actions; auto-sync only reports
differences. The validation batch tests were cancelled before completion so they did not expand
the library beyond the five test assets.

