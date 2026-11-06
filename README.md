# OpenBridge

OpenBridge is an open-source, portable Windows desktop app for browsing, downloading and managing a
local content library. It started as a clean-room reimplementation of the discontinued Megascans
Bridge workflow and now also indexes the public Poliigon and Poly Haven catalogues as additional
providers. It ships with an independent interface and no bundled Quixel, Epic, Poliigon or Poly
Haven artwork, fonts, plugins or binaries.

> OpenBridge is an independent community project. It is not affiliated with or endorsed by Epic
> Games, Quixel, Poliigon or Poly Haven. Use it only with assets you are entitled to access.

## Download

Download the latest portable ZIP from the repository's **Releases** page, extract it, and run
`OpenBridge.exe`. No installer or administrator access is required.

The portable package is the only supported distribution. Settings, the encrypted Epic session and
the local index live in `%APPDATA%\openbridge`, so the app folder can be moved or replaced without
losing user data.

## Highlights

- **Three providers** with a source switch: Quixel Megascans, Poliigon and Poly Haven. Settings keep
  a shared library root with a folder per provider.
- **Poly Haven provider (1.5.9, unreleased)** with the full public CC0 catalogue, local full-text
  search, category/resolution/map/collection facets, explicit HDRI time-of-day, previews, live
  HDR/360 HDRI viewing, downloadable map sets and model packages, and a local Library source
  filter. No account, API key or credits are required.
- **Poliigon catalogue browsing (1.5.9, unreleased)** with the full public catalogue (7,448 published
  textures, models and HDRIs), 331-category tree, local full-text search, free/credit badges, facets,
  previews, watermarked map previews and technical metadata. No Poliigon account or third-party
  search key is required for browsing.
- **Poliigon account (1.5.9, unreleased)** with browser sign-in, DPAPI-encrypted token storage, plan and
  credit balance, owned-asset sync and owned badges. Password sign-in is hidden because Poliigon
  currently rejects addon password login.
- **Poliigon downloads (1.5.9, unreleased)** with resolution/map/LOD/renderer options, resumable file
  transfers, pause/resume/cancel, generated MaterialX files and the exact folder layout the official
  Poliigon Blender addon reads. Free and owned assets require a Poliigon sign-in.
- **Unified local library (1.5.9, unreleased)** with All/Megascans/Poliigon/Poly Haven source filters,
  local provider previews, downloaded-resolution/map/LOD facts, search, categories, health checks
  and automatic rescan after each download. Library means only files already on disk — available
  offline and independent of catalogue subscriptions. The topbar **Check library** action only
  audits acquired assets against that local disk state and never downloads anything.
- **Combined Discover (1.5.9, unreleased)** with an All source scope as the default view. It merges
  Megascans, Poliigon and Poly Haven results into one grid/list, searches all catalogues together,
  and maps all provider trees into one content taxonomy (3D Assets, 3D Plants, Surfaces, HDRIs,
  Atlases, Decals, Brushes, Imperfections, Displacements) with cross-source subtopics such as
  Architecture, Furniture, Food & Drink, Rocks & Terrain, Wood & Flooring and Houseplants.
  Provider category and type filters are applied behind each unified node, and the view combines
  all facet sets, counts, size/state/downloaded filters, saved searches, recent searches and
  recently viewed assets, Megascans packs, scroll restoration, bulk selection and download
  queues. Each provider remains available as a focused single-source view.
- **Poliigon parity tools (1.5.9, unreleased)** with ID/URL/description search, relevance sorting,
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
- **Workspace improvements (1.5.9, unreleased)** with scoped Catalogue/Library search, a shared
  filter workbench, a docked wide-screen inspector and always-visible download controls. Narrow
  windows retain an overlay drawer.
- **Filter audit (1.5.9, unreleased)** with type-aware filter and sort sets for every provider and
  asset type, canonical Poliigon map facets, physical-size filters/sorts for Poliigon and Poly Haven,
  numeric resolution and map ordering, humanised facet labels, and a docked filter panel whose group
  rail and values scroll independently so results stay visible.
- **Visual inspection** with expanded render/map previews, zoom/pan and offline JPG/PNG/WebP maps.
- **Epic sign-in** via OAuth. Tokens are encrypted with Windows DPAPI (`safeStorage`); passwords are
  never stored.
- **Download engine** with per-type presets, map/LOD/variation selection, resumable transfers, size
  verification, pause/resume, persistent queues and the original library folder layout.
- **Transfer awareness (1.5, unreleased)** with sidebar progress, a mini queue, session totals, volume
  free space and completion history saved independently of the queue. Library-size figures are cached
  health measurements, not a live folder scan.
- **Local library index** backed by SQLite/WAL and FTS5, with incremental scans, server-side counts,
  virtualized grids, health reports and bulk tools.
- **Asset intelligence** with download plans, per-map technical details, LOD triangle counts,
  physical dimensions, readiness badges and plant billboard previews.
- **Relative size (1.5, unreleased)** shows a front-view bounding box next to a 1.78 m human on the
  Overview page, using one shared scale. Assets without complete dimensions are explicitly marked.
- **Local-first metadata pack** that optionally adds remote catalogue readiness, semantic, pack and
  freshness metadata without bundling the raw catalogue.
- **Portable updates** from GitHub releases with size and SHA-256 verification.
- **Legacy interoperability** through the local HTTP API, discovery service and Mixer sockets.

## Requirements

- Windows 10 or Windows 11, x64
- An Epic account with access to the assets you download
- Node.js 24+ and npm for development only

## Getting started

```powershell
npm ci
npm run typecheck
npm run start
```

For a portable build:

```powershell
npm run dist:portable
```

Outputs are written under `dist/`. See [docs/BUILD.md](docs/BUILD.md) for packaging, release and
metadata-pack details.

## Configuration

Copy `config.local.example.json` to `config.local.json` and fill in the legacy service values needed
for catalogue and authentication. The local file is git-ignored and must never be committed.
Equivalent environment overrides are documented in [docs/BUILD.md](docs/BUILD.md).

The release and update URLs are derived from the build repository, so the source tree does not
hard-code an account or repository owner. Set `OPENBRIDGE_REPOSITORY=owner/repo` only when building
outside a Git checkout.

## Project automation

- `.github/workflows/quality.yml` runs type checking and the public-repository hygiene check on
  pushes and pull requests.
- `.github/workflows/release.yml` builds and publishes the portable ZIP and `latest.json` when a
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

- Windows x64 portable builds only.
- No installer, Linux or macOS build.
- Poliigon browsing, account sign-in, downloads and local-library indexing are available in the
  current unreleased build. Free assets still require sign-in. In-app purchases are intentionally
  not implemented; OpenBridge assumes you already have access through your subscription or owned
  assets. See [docs/POLIIGON.md](docs/POLIIGON.md).
- DCC export/plugin installation, Fab browsing and the Three.js preview are not implemented.
- Automatic updates require a published release manifest.
- Some catalogue fields are sparse in the legacy API; the UI hides unavailable data rather than
  showing placeholders.

## Documentation

- [Build and packaging](docs/BUILD.md)
- [Testing](docs/TESTING.md)
- [Networking policy and verification](docs/NETWORKING.md)
- [Roadmap](docs/ROADMAP.md)
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
