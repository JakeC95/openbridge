# OpenBridge

OpenBridge is an open-source, portable Windows desktop app for browsing, downloading and managing a
local Quixel Megascans library. It is a clean-room reimplementation of the discontinued Bridge
workflow, with an independent interface and no bundled Quixel/Epic artwork, fonts, plugins or
binaries.

> OpenBridge is an independent community project. It is not affiliated with or endorsed by Epic
> Games or Quixel. Use it only with assets you are entitled to access.

## Download

Download the latest portable ZIP from the repository's **Releases** page, extract it, and run
`OpenBridge.exe`. No installer or administrator access is required.

The portable package is the only supported distribution. Settings, the encrypted Epic session and
the local index live in `%APPDATA%\openbridge`, so the app folder can be moved or replaced without
losing user data.

## Highlights

- **Catalogue browsing** for the legacy Megascans catalogue, including nested categories, filters,
  saved searches, related assets and a command palette.
- **Browsing productivity** with local categories/favorites, recorded-pack exploration, recent
  searches/assets, drawer Back/Next, preserved scroll position and adjustable thumbnail sizes.
- **Visual inspection** with expanded render/map previews, zoom/pan and offline JPG/PNG/WebP maps.
- **Epic sign-in** via OAuth. Tokens are encrypted with Windows DPAPI (`safeStorage`); passwords are
  never stored.
- **Download engine** with per-type presets, map/LOD/variation selection, resumable transfers, size
  verification, pause/resume, persistent queues and the original library folder layout.
- **Local library index** backed by SQLite/WAL and FTS5, with incremental scans, server-side counts,
  virtualized grids, health reports and bulk tools.
- **Asset intelligence** with download plans, per-map technical details, LOD triangle counts,
  physical dimensions, readiness badges and plant billboard previews.
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
- [Research toolchain](docs/TOOLCHAIN.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).

Country flag artwork in `src/renderer/flags` comes from
[flag-icons](https://github.com/lipis/flag-icons) and is MIT licensed. See
[src/renderer/flags/LICENSE](src/renderer/flags/LICENSE).
