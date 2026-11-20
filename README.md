# OpenBridge

OpenBridge is an open-source, portable desktop app for Windows and Linux for browsing, downloading and managing a
local content library. It started as a clean-room reimplementation of the discontinued Megascans
Bridge workflow and now also indexes the public Poliigon, Poly Haven, ambientCG, BlenderKit and
OpenHDRI catalogues as additional providers. It ships with an independent interface and no bundled
Quixel, Epic, Poliigon, Poly Haven, ambientCG, BlenderKit or OpenHDRI artwork, fonts, plugins or
binaries.

> OpenBridge is an independent community project. It is not affiliated with or endorsed by Epic
> Games, Quixel, Poliigon, Poly Haven, ambientCG, BlenderKit or OpenHDRI. Use it only with assets
> you are entitled to access.

## Download

Version 1.8.0 is available in **Releases** as a Windows x64 ZIP and a Linux x64 tar.gz.
Extract the archive and run `OpenBridge.exe` on Windows or `./OpenBridge` on Linux. From an
existing portable installation, choose **Settings → Check and install** to update.

Version 1.6.3 introduced the Linux package. Version 1.6.4 fixes an indexing banner that could
linger after ambientCG or OpenHDRI was ready and makes session-only Epic sign-in visible when
the desktop keyring cannot save the session. Version 1.7.0 adds read-only shared folders
to Library with resumable indexing, previews, local organization and batch copy. Version 1.7.1
adds bounded source metadata inspection and keeps Linux SQLite state on local storage when
the profile is on a network mount. Version 1.8.0 adds shared material-resource browsing,
binary FBX source facts, generated geometry/HDR thumbnails and inspection of the full matching file scope.
Version 1.9.0 adds optional curated presentation details for prepared assets: concise specs,
turntable video, anatomy, primary texture cards and collapsed provenance.

Settings, saved sessions and local state live outside the portable folder. Windows uses
`%APPDATA%\openbridge`. Linux uses `${XDG_CONFIG_HOME:-$HOME/.config}/OpenBridge`; SQLite databases move to persistent
local storage when that profile is on a network mount. See [storage configuration](docs/BUILD.md).

## Highlights

- **Existing providers** with a source switch: Quixel Megascans, Poliigon and Poly Haven. Settings keep
  a shared library root with a folder per provider.
- **Additional providers (1.6.2; account acceptance pending)**: ambientCG, BlenderKit and
  OpenHDRI are wired into focused/All browsing, downloads and the offline Library. They include
  saved browsing, comparison and safe genuine previews where the provider publishes suitable
  source files. Unsupported filters and preview tiers are disclosed instead of fabricated.
  Real-account BlenderKit delivery still needs acceptance testing; see
  [provider capabilities and verification](docs/PUBLIC-PROVIDERS.md).
- **Poly Haven provider (1.6.2)** with the full public CC0 catalogue, local full-text
  search, category/resolution/map/collection facets, explicit HDRI time-of-day, previews, live
  HDR/360 HDRI viewing, downloadable map sets and model packages, and a local Library source
  filter. No account, API key or credits are required.
- **Poliigon catalogue browsing (1.6.2)** with the full public catalogue (7,554 published
  textures, models and HDRIs), 332-category tree, local full-text search, free/credit badges, facets,
  previews, watermarked map previews and technical metadata. No Poliigon account or third-party
  search key is required for browsing.
- **Poliigon account (1.6.2)** with browser sign-in, system credential storage, plan and
  credit balance, owned-asset sync and owned badges. Password sign-in is hidden because Poliigon
  currently rejects addon password login.
- **Poliigon downloads (1.6.2)** with resolution/map/LOD/renderer options, resumable file
  transfers, pause/resume/cancel, generated MaterialX files and the exact folder layout the official
  Poliigon Blender addon reads. Free and owned assets require a Poliigon sign-in.
- **Unified local library** with source filters for provider-managed assets,
  local provider previews, downloaded-resolution/map/LOD facts, search, categories, health checks
  and automatic rescan after each download. Library means only files already on disk — available
  offline and independent of catalogue subscriptions. The topbar **Check library** action only
  audits acquired assets against that local disk state and never downloads anything.
- **Combined Discover (1.6.2)** with an All source scope as the default view. It merges
  Megascans, Poliigon and Poly Haven results into one grid/list, searches all catalogues together,
  and maps all provider trees into one content taxonomy (3D Assets, 3D Plants, Surfaces, HDRIs,
  Atlases, Decals, Brushes, Imperfections, Displacements) with cross-source subtopics such as
  Architecture, Furniture, Food & Drink, Rocks & Terrain, Wood & Flooring and Houseplants.
  Provider category and type filters are applied behind each unified node, and the view combines
  all facet sets, counts, size/state/downloaded filters, saved searches, recent searches and
  recently viewed assets, Megascans packs, scroll restoration, bulk selection and download
  queues. Each provider remains available as a focused single-source view.
- **Poliigon parity tools (1.6.2)** with ID/URL/description search, relevance sorting,
  recent searches, local favorites, downloaded badges and filters, related assets, clickable
  categories/tags, list/compare view, expandable render previews, genuine 1K map previews for
  textures and 3D models with full-screen zoom upgrading to the highest available map
  resolution, HDRI map previews with both Tone-mapped JPG and HDR (EXR) entries, an interactive
  drag-to-look 360° panorama for both entries (mouse look, wheel FOV, `P` toggles flat/360), and a
  full-screen linear HDR exposure slider that loads the highest published HDR tier (−10 to +10 EV,
  live GPU tone mapping from the decoded EXR), a Megascans-style Relative size panel and technical
  grid, bulk selection/download and per-type remembered download options.
- **Catalogue browsing** for the legacy Megascans catalogue, including nested categories, filters,
  saved searches, related assets and a command palette.
- **Browsing productivity** with local categories/favorites, recorded-pack exploration, recent
  searches/assets, drawer Back/Next, preserved scroll position and adjustable thumbnail sizes.
- **Workspace improvements (1.6.2)** with scoped Catalogue/Library search, a shared
  filter workbench, a docked wide-screen inspector and always-visible download controls. Narrow
  windows retain an overlay drawer.
- **Filter audit (1.6.2)** with type-aware filter and sort sets for every provider and
  asset type, canonical Poliigon map facets, physical-size filters/sorts for Poliigon and Poly Haven,
  numeric resolution and map ordering, humanised facet labels, and a docked filter panel whose group
  rail and values scroll independently so results stay visible.
- **HDRI category and sky-condition pass (1.6.2)** with Poly Haven's live three-level
  environment taxonomy, Poliigon environment mapping, and a normalised sky-condition filter
  (Clear, Partly cloudy, Overcast, Fog & haze, Rain & storm, Snow). Clear / Sunny Day adds a
  07:00–17:00 preset. Weather is always outdoor-only; contradictory provider `clear`/`overcast`
  category tags no longer leak into weather results. HDRI filters are ordered by sky condition, and
  cards show the resolved weather and time for quick verification.
- **Visual inspection** with expanded render/map previews, zoom/pan and offline JPG/PNG/WebP maps.
- **Epic sign-in** via OAuth. OpenBridge uses the system credential store to save tokens.
- **Download engine** with per-type presets, map/LOD/variation selection, resumable transfers, size
  verification, pause/resume, persistent queues and the original library folder layout.
- **Transfer awareness (1.6.2)** with sidebar progress, a mini queue, session totals, volume
  free space and completion history saved independently of the queue. Library-size figures are cached
  health measurements, not a live folder scan.
- **Local library index** backed by SQLite/WAL and FTS5, with incremental scans, server-side counts,
  virtualized grids, health reports and bulk tools.
- **Asset intelligence** with download plans, per-map technical details, LOD triangle counts,
  physical dimensions, readiness badges and plant billboard previews.
- **Relative size (1.6.2)** shows a front-view bounding box next to a 1.78 m human on the
  Overview page, using one shared scale. Assets without complete dimensions are explicitly marked.
- **Local-first metadata pack** that optionally adds remote catalogue readiness, semantic, pack and
  freshness metadata without bundling the raw catalogue.
- **Portable updates** from GitHub releases with size and SHA-256 verification.
- **Legacy interoperability** through the local HTTP API, discovery service and Mixer sockets.

## Requirements

- Windows 10 or 11 x64, or a Linux x64 desktop. The Linux build was exercised on Rocky Linux 9.5.
- A desktop keyring on Linux for saving credentials, and WebGL 2 for 3D and HDR previews.
- Provider accounts where required. Public catalogue browsing works without an Epic account.
- Node.js 24+ and npm when running from source or building a package.

## Getting started

```sh
npm ci
npm run typecheck
npm run start
```

Build a portable archive for the current platform.

```sh
npm run dist:portable
```

Outputs are written under `dist/`. See [docs/BUILD.md](docs/BUILD.md) for packaging, release and
metadata-pack details.

## Configuration

For Megascans catalogue and sign-in, copy `config.local.example.json` to `config.local.json`
and fill in the legacy service values. The local file is git-ignored and must never be committed.
Equivalent environment overrides are documented in [docs/BUILD.md](docs/BUILD.md).

The release and update URLs are derived from the build repository, so the source tree does not
hard-code an account or repository owner. Set `OPENBRIDGE_REPOSITORY=owner/repo` only when building
outside a Git checkout.

## Project automation

- `.github/workflows/quality.yml` runs checks on Windows and Linux on pushes and pull requests.
- `.github/workflows/release.yml` publishes packages and update manifests for both platforms when a
  `v*` tag is pushed.
- `npm run check:public` scans tracked text files for credentials, personal paths, account details
  and machine-specific data.

The optional catalogue metadata pack is generated separately and uploaded as
`catalog-metadata.json.gz` on the release. It is never bundled into the app ZIP.

## Privacy

OpenBridge has no telemetry or analytics. Credentials, catalogue metadata and the local index stay
on the user's machine. The public repository is kept free of real account names, email addresses,
local file paths, machine identifiers and secrets.

Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## Limitations

- Distribution is available as portable x64 builds for Windows and Linux.
- Poliigon browsing, account sign-in, downloads and local-library indexing are available since
  1.6.2. Free assets still require sign-in. In-app purchases are intentionally
  not implemented; OpenBridge assumes you already have access through your subscription or owned
  assets. See [docs/POLIIGON.md](docs/POLIIGON.md).
- DCC export/plugin installation and Fab browsing are not implemented. Native `.blend`, `.max`,
  `.c4d`, `.ma`, `.mb` and `.skp` previews are download-only; the 3D viewer opens glTF/GLB, FBX,
  OBJ, USD, STL, PLY and DAE.
- The Library indexes supported provider layouts and OpenBridge downloads. The source tree
  also supports read-only access to existing shared model and HDRI folders. See the
  [shared library guide](docs/SHARED-LIBRARY.md).
- Automatic updates require a published release manifest.
- Some catalogue fields are sparse in the legacy API; the UI hides unavailable data rather than
  showing placeholders.

## Documentation

- [Build and packaging](docs/BUILD.md)
- [Testing](docs/TESTING.md)
- [Networking policy and verification](docs/NETWORKING.md)
- [Roadmap](docs/ROADMAP.md)
- [Shared asset library design](docs/SHARED-LIBRARY.md)
- [Prepared presentation details](docs/PRESENTATION-DETAILS.md)
- [Local API and export protocol](docs/PROTOCOL.md)
- [Reverse-engineering notes](docs/REVERSE-ENGINEERING.md)
- [Poliigon research and integration plan](docs/POLIIGON.md)
- [Poly Haven provider notes](docs/POLYHAVEN.md)
- [Research toolchain](docs/TOOLCHAIN.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).

Country flag artwork in `src/renderer/flags` comes from
[flag-icons](https://github.com/lipis/flag-icons) and is MIT licensed. See
[src/renderer/flags/LICENSE](src/renderer/flags/LICENSE).
