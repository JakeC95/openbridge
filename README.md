# OpenBridge

A clean-room, open-source reimplementation of the discontinued **Quixel Bridge** desktop app
(`megascans-bridge` 2025.0.0, Electron 10 / Chrome 85), built for Windows 10/11 and
distributed as a portable app.

The visual language, layout, category tree and download workflow follow the original; the code,
branding and assets are independent. Quixel/Epic artwork, fonts, plugins and binaries are **not**
shipped.

The Windows shell follows the 2025 Bridge proportions: a responsive 320/280 px sidebar with the
nested category tree, header search, 48 px filter bar, image-first asset cards with hover labels,
and a 120 px right-side asset drawer.

## Windows v1.3.1 artifact

OpenBridge is distributed as a portable app. No installer is built or published:

```
dist\OpenBridge-1.3.1-win-x64-portable\OpenBridge.exe
dist\OpenBridge-1.3.1-win-x64-portable.zip
```

Run `OpenBridge.exe` directly. The portable build deliberately keeps Electron's original executable
bytes so Windows Smart App Control accepts it; only the file name changes.

Release: <https://github.com/example-owner/openbridge/releases/tag/v1.3.1>

SHA-256:

```
portable/OpenBridge.exe  8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
electron.exe             8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
portable zip             64B21FCE53972081791A3B7D6B2D1507DC9B5D67C720BCD72A74B894D0D147FB
```

## v1.2 features (Windows)

Verified against the live legacy services on this machine:

- **Epic sign-in** via OAuth in a dedicated window; JWT/refresh token stored with Windows DPAPI
  (`safeStorage`) in `%APPDATA%\openbridge\auth.bin`. No password is stored.
- **Catalogue + smart search**: 18,835 legacy Megascans assets, thumbnails, broad type tabs,
  infinite results and owned/free badges. Search accepts names, asset IDs, `quixel.com` asset URLs,
  bare UUIDs and prefixed IDs, normalizes whitespace, strips URL noise, and uses request timeouts,
  retries and stale-request guards. Local search uses a SQLite FTS5 index.
- **Discovery filters and saved searches**: biome, region, resolution, color, environment and theme
  facet filters; saved searches in local storage; active-facet counts; clear-all.
- **Related assets**: the asset drawer shows similar catalogue entries and opens them in place.
- **Full category tree**: all eight top-level categories plus nested categories, live Algolia
  counts, `assetCategories` path filtering, Favorites and Free filters.
- **Per-type download defaults**: separate presets for 3D Assets, 3D Plants, Surfaces and Other 2D
  assets. Each stores resolution, texture format, default maps, mesh format, LODs, highpoly, ZTool,
  brushes, unique maps per LOD, billboards and plant LOD behavior. Drawer changes apply to one
  download; presets apply to single and bulk downloads. Map presets support Common/All/None
  shortcuts.
- **Full download options**: 1K/2K/4K/8K with ACL capping, per-map JPG/EXR/JPG+EXR, LOD 0-8,
  FBX/ABC, Highpoly Source, Source ZTool, Brushes, unique maps per LOD, all plant LODs, billboards
  and variations.
- **Download Engine 2.0**: four concurrent files with retries, HTTP Range resume from `.part`,
  size verification, disk-space preflight, persistent queue at
  `%APPDATA%\openbridge\download-queue.json`, interrupted-job restore, pause/resume, pause all,
  resume all, cancel, cancel all and clear finished. Downloads finalize in the original library
  layout (`Downloaded/<type>/...`, `Atlas/`, `Billboard/`, `VarN/`, asset JSON + previews).
- **Library health and bulk tools**: asset/file/byte totals, per-type storage, missing
  preview/mesh/texture detection, zero-byte files, empty folders, duplicate IDs, multi-select,
  JSON export and safe folder deletion under the library root.
- **Asset intelligence**: type-aware gallery facts, accurate pre-download size plans, per-LOD
  triangle/format sizes, variation dimensions, per-map technical details and scale/texel panels.
- **Readable measurements and related assets**: sub-meter dimensions render in centimetres; related
  assets fall back to tag/category search and no longer leave the section empty.
- **Indexed library at scale**: SQLite/WAL index with FTS5 search, incremental scans,
  server-side counts and 300-row paging, virtualized local and catalogue grids, select-all-filtered
  and health progress. Unchanged assets skip JSON re-reading on subsequent scans.
- **Texture map previews**: Render and Maps views, signed 1K previews, map labels/resolutions,
  arrow/keyboard cycling and texture-set handling. No asset folder is created by previewing.
- **Multi-select and bulk download**: shift-click ranges, select loaded, select all in the current
  category/filter, add/clear, confirmation above 100 items, skip already-owned assets, and a
  capped 300-row Downloads view.
- **Asset card controls**: click to open the drawer, hover download/favorite controls, active
  progress/pause pill, downloaded check and native context menus.
- **Command palette**: `Ctrl+K` for navigation, search, filters, sync, import, updates, opening the
  library/log, and download queue controls.
- **Fixed menus**: all in-app select controls use a dark, viewport-clamped custom dropdown instead
  of the platform's white native menu.
- **Sync/update checks**: reports acquired assets missing from the library. Sync never downloads
  assets automatically; downloads are always user-initiated.
- **Seamless updates**: Settings checks the latest GitHub release manifest, downloads the portable
  zip, verifies size and SHA-256, extracts it, waits for the app to exit, replaces the portable
  files and restarts. No feed URL is required.
- **Legacy interoperability**: local HTTP API (`127.0.0.1:28241`), discovery (`28852`), Mixer
  live-link sockets (`28456/28457/28458/28459`), DCC export inventory and plugin JSON shape.

## Not in v1.2

- Fab catalogue/browsing and Fab package downloads. The Fab tab and Fab-specific code were
  removed; owned assets remain available through the legacy Megascans catalogue.
- DCC export/plugin installation (Unreal/Maya/Max/Blender/Houdini/Unity/C4D/Clarisse).
- The Three.js preview and channel-packing image processor.
- MetaHumans/DHI browsing.
- Automatic bulk downloading of all acquired assets.
- NSIS/MSI installers and other non-portable package formats. The portable ZIP is the only
  supported distribution.
- Linux or macOS builds.

## Quick start (development)

This machine has no global Node.js; use the portable copy from the research toolchain:

```powershell
$node = Get-ChildItem tools -Directory -Filter "node-v*-win-x64" | Select-Object -First 1
$env:Path = "$($node.FullName);$env:Path"

npm install
npm run typecheck
npm run start
```

If Electron's install script is blocked by npm's allow-list: `node node_modules/electron/install.js`.

## Build

```powershell
npm run dist:portable   # portable folder + zip
```

Portable is the only build target. There is no installer or cross-platform package step.

### Update release

The release workflow (`.github/workflows/release.yml`) builds the portable zip on a `v*` tag,
generates `latest.json` with the version/size/SHA-256, and uploads both to the GitHub release.
For a local release:

```powershell
npm run dist:portable
node scripts/make-update-manifest.mjs 1.3.1 "dist\OpenBridge-1.3.1-win-x64-portable.zip"
```

OpenBridge checks
`https://github.com/example-owner/openbridge/releases/latest/download/latest.json`.

## Legacy service configuration

Copy `config.local.example.json` to `config.local.json` and fill in the Epic OAuth client ID and
Algolia read key. `config.local.json` is git-ignored. `scripts/build.mjs` injects the values into
the main bundle at build time; runtime environment overrides are also supported:

```
OPENBRIDGE_EPIC_CLIENT_ID
OPENBRIDGE_ALGOLIA_APP_ID
OPENBRIDGE_ALGOLIA_API_KEY
OPENBRIDGE_ALGOLIA_INDEX
OPENBRIDGE_API_BASE
OPENBRIDGE_SSO_BASE
OPENBRIDGE_SIGNED_URL_BASE
OPENBRIDGE_REALM
```

The public source repository does not contain credentials. Official portable builds are assembled
with the legacy service configuration required to reach the retired Quixel endpoints. Never commit
`config.local.json`.

## Running next to the original Bridge

The original renderer binds `28241`, `28852`, `28456` and `28458`. OpenBridge binds its HTTP API to
`127.0.0.1` and uses the same discovery/Mixer ports. Close the original Bridge for a clean
discovery/Mixer test; otherwise OpenBridge logs `EADDRINUSE` warnings for `28852/28456/28458` and
the plugin live-link surface is unavailable.

## Test assets (local only)

The validation library contains five assets (about 1.4 GB total, under
`C:\Users\<user>\Documents\Megascans Library\Downloaded`):

- `3d\nature_rock_yg2hfhyva` - 4K EXR test
- `3d\nature_rock_xgmpcby` - 1K JPG, FBX, LOD0
- `3d\3d_nature_xgmncdu` - 1K JPG, FBX, LOD0 (pause/resume test)
- `3dplant\3dplant_grass_xjfgdhaqx` - 1K JPG, ABC, billboards, 8 variations
- `3d\3d_street_xbzpbdj` - additional library asset present during final validation

Delete any of those folders if you do not want them; the app will rescan.

## Repository layout

```
analysis/                 extracted app.asar, recovered sources, screenshots (git-ignored)
docs/
  REVERSE-ENGINEERING.md  architecture, formats, evidence
  PROTOCOL.md             local HTTP API, sockets, DCC ports, plugin format
  TOOLCHAIN.md            installed RE tools, runtime access
  BUILD.md                Windows portable build instructions
  TESTING.md              validation log and measured results
  ROADMAP.md              phased implementation plan
scripts/                  build, dev, extraction, portable packaging, update manifest
src/
  main/                   Electron main process (auth, API, downloads, sync, library, updater)
  preload/                context-isolated bridge
  renderer/               React UI
  shared/                 shared types and download defaults
config.local.example.json template for legacy service credentials
third_party/leanrea/      RE skill used for the analysis (git-ignored)
tools/                    portable RE toolchain (git-ignored)
```

## Documentation

- [docs/TESTING.md](docs/TESTING.md) - v1.0-v1.2 validation results.
- [docs/BUILD.md](docs/BUILD.md) - build, packaging and release instructions.
- [docs/ROADMAP.md](docs/ROADMAP.md) - current scope and next phases.
- [docs/PROTOCOL.md](docs/PROTOCOL.md) - legacy local API/socket protocol.
- [docs/REVERSE-ENGINEERING.md](docs/REVERSE-ENGINEERING.md) - research evidence; some Fab/EOL
  material is historical and no longer part of the app.

## Legal / clean-room note

This is an independent reimplementation. The extracted `app.asar` and recovered renderer sources
are kept only for interoperability research and must not be committed or shipped. Quixel,
Megascans, Epic Games and Fab are trademarks of their respective owners. Users are responsible for
complying with the Epic/Fab terms that apply to assets they download or export.
