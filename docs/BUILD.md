# Build and packaging

OpenBridge builds portable x64 packages on Windows and Linux.

## Portable build

```sh
npm ci
npm run typecheck
npm run check:public
npm run dist:portable
```

Output:

```text
dist\OpenBridge-<version>-win-x64-portable\OpenBridge.exe
dist\OpenBridge-<version>-win-x64-portable.zip
dist/OpenBridge-<version>-linux-x64-portable/OpenBridge
dist/OpenBridge-<version>-linux-x64-portable.tar.gz
```

`scripts/package-portable.ps1` keeps Electron's `electron.exe` byte-identical, copies it to
`OpenBridge.exe`, and places the app under `resources\app`. On machines with Windows Smart App
Control / WDAC, installer-built executables are often blocked by hash/policy while the untouched
Electron binary is accepted. The trade-off is the default Electron file icon; the window title and
in-app branding are OpenBridge.

The portable app requires no administrator rights. Settings, the Epic session, the library cache
and the download queue live in `%APPDATA%\openbridge`; the app folder itself can be moved or
deleted without removing user data.

On Linux, the packager uses GNU tar. Extract the archive on a filesystem that can run
executables and launch `./OpenBridge` as a normal desktop user. The app requires Electron's
desktop libraries (including GTK, NSS, and GBM) and support for Chromium's sandbox. OpenBridge
stores settings in `${XDG_CONFIG_HOME:-$HOME/.config}/OpenBridge`. On Linux, Epic and Poliigon
sessions stay in memory if a secure desktop keyring is unavailable. Saving a BlenderKit key
requires an unlocked keyring. See [Electron credential storage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Library index

Local library metadata is stored in `library-index.sqlite` in the settings directory in WAL mode.
The schema uses an `assets` table, an FTS5 index for local search, cached health statistics and an
`issues` table. Asset filenames and previews stay in the normal Megascans folder layout; the
database is an index, not a replacement for the library.

- Delete `library-index.sqlite*` and run Rescan to rebuild it.
- The schema version is tracked with `PRAGMA user_version`.
- Unchanged folders skip JSON re-reading unless Rescan forces a full refresh.

## Catalogue metadata pack

The optional compact catalogue pack provides readiness, semantic, pack and technical metadata for
the remote catalogue without committing or shipping the raw extended JSON responses. It is
generated from an authenticated OpenBridge session:

```powershell
npm run build
electron . --build-catalog-pack=dist/catalog-metadata.json.gz
```

Use `--catalog-limit=50` for a small test pack. The output is gzipped NDJSON with a header:

```json
{"format":"openbridge-catalog-metadata","version":1,"generatedAt":0,"count":18835}
```

The pack is optional and separate from the app ZIP. Upload it to the GitHub release as
`catalog-metadata.json.gz`; the app resolves the download through the release repository configured
at build time. Import a local pack through Settings or
`electron . --import-catalog-pack=path\to\pack.json.gz`. The pack never marks assets as downloaded
and is not required to browse or download.

## Legacy service configuration

Copy `config.local.example.json` to `config.local.json` and fill in the Epic OAuth client ID and
Algolia read key. `config.local.json` is git-ignored and is embedded into the built bundle by
`scripts/build.mjs`. Environment overrides:

```text
OPENBRIDGE_EPIC_CLIENT_ID
OPENBRIDGE_ALGOLIA_APP_ID
OPENBRIDGE_ALGOLIA_API_KEY
OPENBRIDGE_ALGOLIA_INDEX
OPENBRIDGE_API_BASE
OPENBRIDGE_SSO_BASE
OPENBRIDGE_SIGNED_URL_BASE
OPENBRIDGE_REALM
OPENBRIDGE_REPOSITORY
```

`OPENBRIDGE_REPOSITORY` uses the form `owner/repo` and controls release and update URLs. When it is
not set, `scripts/build.mjs` detects the GitHub remote from `origin`; set it explicitly for builds
outside a Git checkout. Never commit `config.local.json` or real service credentials.

## Release

Configure the legacy service values as GitHub Actions repository secrets before tagging:
`OPENBRIDGE_EPIC_CLIENT_ID`, `OPENBRIDGE_ALGOLIA_APP_ID`, `OPENBRIDGE_ALGOLIA_API_KEY`,
`OPENBRIDGE_ALGOLIA_INDEX`, `OPENBRIDGE_API_BASE`, `OPENBRIDGE_SSO_BASE`,
`OPENBRIDGE_SIGNED_URL_BASE` and `OPENBRIDGE_REALM`. `scripts/build.mjs` injects them at build
time, along with `GITHUB_REPOSITORY` for release URLs.

Tagged pushes matching `v*` build both archives and publish them with their respective update
manifests. Each manifest contains the version, byte size and SHA-256 of its archive.

For a manual release, run `npm run dist:portable` on each platform, then run
`node scripts/make-update-manifest.mjs <version> <archive>` with the corresponding archive.
Upload the archives and manifests to the same release. The optional `catalog-metadata.json.gz`
is generated separately from an authenticated session.

The updater verifies the archive before extraction. On Linux it requires write access to the
parent of the app directory. It replaces the directory after the app exits, restarts OpenBridge,
and retains the old directory under `.openbridge-update-*/previous` alongside it for rollback.
You can remove the backup after verifying the new version. Windows updates use `tar.exe` and
PowerShell.

Release assets:

```text
OpenBridge-<version>-win-x64-portable.zip
OpenBridge-<version>-linux-x64-portable.tar.gz
latest.json
latest-linux-x64.json
catalog-metadata.json.gz   (optional)
```

CI-built archive hashes differ from local builds because packaging timestamps are not reproducible.
Verify the hash from the uploaded asset when documenting a release.

See [TESTING.md](TESTING.md) for the manual test checklist.
