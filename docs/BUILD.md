# Build and packaging

OpenBridge ships as a Windows x64 portable app only. There are no NSIS, MSI, RPM or AppImage
targets configured.

## Portable build

```powershell
npm run typecheck
npm run dist:portable
```

Output:

```
dist\OpenBridge-<version>-win-x64-portable\OpenBridge.exe
dist\OpenBridge-<version>-win-x64-portable.zip
```

`scripts/package-portable.ps1` keeps Electron's `electron.exe` byte-identical, copies it to
`OpenBridge.exe`, and places the app under `resources\app`. On machines with Windows Smart App
Control / WDAC, installer-built executables are often blocked by hash/policy while the untouched
Electron binary is accepted. The trade-off is the default Electron file icon; the window title and
in-app branding are OpenBridge.

The portable app requires no administrator rights. Settings, the Epic session, the library cache
and the download queue live in `%APPDATA%\openbridge`; the app folder itself can be moved or
deleted without removing user data.

## Library index

Local library metadata is stored in `%APPDATA%\openbridge\library-index.sqlite` in WAL mode.
The schema uses an `assets` table, an FTS5 index for local search, cached health statistics and an
`issues` table. Asset filenames and previews stay in the normal Megascans folder layout; the
database is an index, not a replacement for the library.

- Delete `library-index.sqlite*` and run Rescan to rebuild it.
- The schema version is tracked with `PRAGMA user_version`.
- Unchanged folders skip JSON re-reading unless Rescan forces a full refresh.
## Legacy service configuration

Copy `config.local.example.json` to `config.local.json` and fill in the Epic OAuth client ID and
Algolia read key. `config.local.json` is git-ignored and is embedded into the built bundle by
`scripts/build.mjs`. Environment overrides:

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

Never commit `config.local.json` or real service credentials.

## Update release

Configure the legacy service values as GitHub Actions repository secrets before tagging:
`OPENBRIDGE_EPIC_CLIENT_ID`, `OPENBRIDGE_ALGOLIA_APP_ID`, `OPENBRIDGE_ALGOLIA_API_KEY`,
`OPENBRIDGE_ALGOLIA_INDEX`, `OPENBRIDGE_API_BASE`, `OPENBRIDGE_SSO_BASE`,
`OPENBRIDGE_SIGNED_URL_BASE` and `OPENBRIDGE_REALM`. `scripts/build.mjs` injects them at build
time.

The portable zip is also the auto-update payload. Tagged pushes matching `v*` run
`.github/workflows/release.yml`, which builds the portable zip, generates `latest.json` with the
version, byte size and SHA-256, and attaches both to the GitHub release.

Manual release:

```powershell
npm run dist:portable
node scripts/make-update-manifest.mjs 1.3.1 "dist\OpenBridge-1.3.1-win-x64-portable.zip"
```

Upload that zip and `latest.json` to a GitHub release. OpenBridge checks
`https://github.com/example-owner/openbridge/releases/latest/download/latest.json`; the updater
downloads the zip, verifies size and SHA-256, extracts it with Windows `tar.exe`, then replaces the
portable files after the app exits and restarts it.

## Verified artifact

```
dist/OpenBridge-1.3.1-win-x64-portable/OpenBridge.exe
dist/OpenBridge-1.3.1-win-x64-portable.zip   159,033,000 bytes
```

SHA-256:

```
portable/OpenBridge.exe  8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
portable zip             64B21FCE53972081791A3B7D6B2D1507DC9B5D67C720BCD72A74B894D0D147FB
```

See [TESTING.md](TESTING.md) for the runtime validation log.
