# Build and packaging

## Windows portable (recommended)

```powershell
npm run build
npm run dist:portable
```

Output:

```
dist\OpenBridge-<version>-win-x64-portable\OpenBridge.exe
dist\OpenBridge-<version>-win-x64-portable.zip
```

This keeps Electron's `electron.exe` byte-identical and copies it to `OpenBridge.exe`, then places
the app under `resources\app`. On machines with Windows Smart App Control / WDAC, electron-builder's
rewritten executable is blocked by hash/policy while the untouched Electron binary is accepted.
The trade-off is the default Electron file icon; the window title and in-app branding are
OpenBridge.

## Windows NSIS installer

```powershell
npm run dist:win
```

Output: `dist/OpenBridge Setup <version>.exe`.

Notes:

- The installer is unsigned. On this machine Application Control blocks both the installer and
  `dist/win-unpacked/OpenBridge.exe`. Code-sign the installer (`CSC_LINK` / `CSC_KEY_PASSWORD`) or
  distribute the portable build.
- NSIS downloads `nsis`, `nsis-resources` and `winCodeSign` on first use.
- Windows 10 1809+ and Windows 11 are supported by Electron 45. Windows 7/8 are not.

## Legacy service configuration

Copy `config.local.example.json` to `config.local.json` and fill in your own Epic OAuth client id
and Algolia read key. `config.local.json` is git-ignored and is embedded into the built bundle by
`scripts/build.mjs`; it is not read at runtime from the repository. Environment overrides:

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

## Rocky Linux 9

Build on Rocky 9 (or a matching container):

```bash
sudo dnf install -y curl
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs rpm-build rpmdevtools fakeroot \
  libX11 libXcomposite libXdamage libXrandr libXcursor libXi libXtst \
  alsa-lib atk at-spi2-atk cups-libs gtk3 libdrm libgbm libxkbcommon \
  mesa-libGL mesa-libEGL nss nspr

npm ci
npm run typecheck
npm run dist:linux
```

Outputs: `dist/openbridge-<version>.x86_64.rpm` and `dist/OpenBridge-<version>.x86_64.AppImage`.

- Electron 45 needs glibc >= 2.31; Rocky 8 (2.28) is not supported. Use Rocky 9 (2.34).
- The AppImage needs FUSE 2 on the target or can run with `--appimage-extract-and-run`.
- Cross-building Linux targets on Windows is not supported; an AppImage attempt fails on NTFS
  symlink permissions.

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
node scripts/make-update-manifest.mjs 1.1.2 "dist\OpenBridge-1.1.2-win-x64-portable.zip"
gh release create v1.1.2 "dist\OpenBridge-1.1.2-win-x64-portable.zip" latest.json --title "OpenBridge 1.1.2"
```

OpenBridge checks
`https://github.com/example-owner/openbridge/releases/latest/download/latest.json`; the installer
downloads the zip, verifies size and SHA-256, then replaces the portable files after the app exits.

## Verified artifacts

```
dist/OpenBridge-1.1.2-win-x64-portable/OpenBridge.exe   working portable build
dist/OpenBridge-1.1.2-win-x64-portable.zip               158,992,855 bytes
dist/OpenBridge Setup 1.1.2.exe                          122,512,714 bytes (unsigned)
```

SHA-256:

```
portable/OpenBridge.exe  8E84549B05D27D444DA2957653200D1E0AC287EFF0FC5722B92835B9E0821A59
portable zip             0687C0061AD1B9164B67D6FA4D3721E5CF34A751985EAC7F4BA848935556E7ED
NSIS installer           2BE66FEE9B082348B42922984E34EEFF3EBEA02353ED1B188010C906C5201446
```

See [TESTING.md](TESTING.md) for the runtime validation log.

