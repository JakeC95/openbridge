# Reverse-engineering report: Quixel Bridge 2025.0.0

All claims below are from static analysis of the installed app unless marked **(runtime)**.
Evidence paths are relative to this repository after extraction.

## 1. Target

| Item | Value | Evidence |
|---|---|---|
| Install dir | `C:\Program Files\Bridge` | filesystem |
| Product | `Bridge` / `megascans-bridge` | `analysis/asar/package.json` |
| Version | `2025.0.0` | `package.json`, `Bridge.exe` version info |
| Runtime | Electron `10.4.7`, Chrome `85.0.4183.121` | strings in `Bridge.exe` |
| Archive | `resources/app.asar`, 499,801,711 bytes, 97,857 files | `resources/` |
| Entry | `./app/main.prod.js` | `app/package.json.main` |
| Renderer | `app/dist/renderer.prod.js` (3.2 MB) + `renderer.prod.js.map` (7.6 MB) | `app/dist/` |
| Update feed | S3 `quixel-apps`, path `bridge/win` | `resources/app-update.yml` |
| Linux build | AppImage still served (HTTP 200) at `https://d2shgxa8i058x8.cloudfront.net/bridge/linux/Bridge.AppImage` | network probe |

The renderer source map contains **1,085 `sourcesContent` entries**, so most of the original
renderer modules (React components, API, auth, download/export logic) were recovered verbatim into
`analysis/renderer-src/`. The main process is minified but has a self-referential map; it was
prettified to `analysis/main.pretty.js` (400 KB).

## 2. Process model and security (do not copy)

`app/main.prod.js` creates the main window with:

```js
webPreferences: {
  nativeWindowOpen: true,
  nodeIntegrationInWorker: true,
  nodeIntegration: true,
  enableRemoteModule: true
}
```

So the renderer has full Node.js access and uses `electron.remote` extensively. There is no
`contextIsolation`, no sandbox, and no preload. The Epic login window is a separate
`BrowserWindow` with node integration disabled.

The app also runs shell commands (`pip install PySide pillow`, Assimp) and stores settings with a
hard-coded AES-256-CBC key. The reimplementation must **not** reproduce these weaknesses: use
`contextIsolation: true`, `nodeIntegration: false`, a typed preload, validated IPC, and OS keychain
for secrets.

## 3. Renderer architecture

- React 17 + Redux + `react-router` / `connected-react-router`, `redux-thunk`, `zustand` (new EOL UI),
  `styled-jsx`, `glamor`, `three.js` (3D preview), `postprocessing`.
- Entry: `app/main.prod.js` loads `file://<app>/app.html`; `app.html` loads `./dist/renderer.prod.js`.
- Feature areas recovered under `analysis/renderer-src/app/`:
  - `modules/api.js`, `auth.js`, `algolia.js`, `http.js`, `subscription.js`
  - `actions/myscans.js` (download orchestration), `actions/localLibrary.js` (library scan)
  - `modules/assets.js` (library JSON discovery), `utils/file.js` (zip/map handling)
  - `modules/exports.js` (67 KB export pipeline), `utils/exports.js` (DCC sockets, JSON writing)
  - `modules/plugins.js`, `utils/scripts.js` (plugin install/versioning)
  - `components/SimpleHttpServer.js` (local HTTP API on port 28241)
  - `utils/bridge-active-port.js` (TCP discovery on 28852)
  - `modules/MixerAPIManager.js` (Mixer live-link sockets)
  - `CuratedContent/appConfig.ts`, `utils/eol.ts` (Fab/EOL config and UI)

## 4. Credentials, settings, logs

### 4.1 Winston log

`analysis/renderer-src/app/modules/logger.js` plus main bundle:

- Path: `%APPDATA%\Bridge\bridge.log` (`path.join(app.getPath("appData"), "Bridge")`).
- Format: JSON lines, level `debug`, 10 MB rotation, 1 file.
- Contains: startup, channel, internet status, profile plan, EULA, socket/live-link events,
  download queue state, updater state.

On Windows, Chromium/Electron console output is not shown by default. Launch
`Bridge.exe --enable-logging=stderr --v=1` to get it on stderr (or use `--log-file`). The app also
opens DevTools when an asset is right-clicked (`ipcMain.on("asset-right-click")`) and the renderer
has `nodeIntegration: true`, so the DevTools console can `require()` Node modules at runtime.

**(runtime)** The local log confirmed the ports and startup sequence:

```
Opening socket connection for Bridge Active Port
MixerAPIManager::Server::LiveLinkStarted
MixerAPIManager::Server::OldLiveLinkStarted
Setting timeout to 30
Setting parallel files to 5
```

### 4.2 Legacy settings file

`%APPDATA%\Megascans Bridge\settings.dat` is base64 of AES-256-CBC. The recovered key and IV are
intentionally omitted from this repository. Decrypted shape:

```json
{
  "megascansPath": "C:\\Users\\<user>\\Documents\\Megascans Library",
  "offlineMegascansPath": "",
  "zipPaths": [],
  "expiryDate": "",
  "userEmail": ""
}
```

OpenBridge does not ship a legacy-settings importer or the decryption material.

### 4.3 electron-settings

`%APPDATA%\Bridge\Settings` (JSON, no extension) holds plugin/API metadata and user overrides. The
keys used by the app include `bridgePortValue`, `lastExportedAssets`, `useDevPluginsRepo`,
`pluginsRepoPath`, `bridgeUpdate.updated`. The observed file only had the defaults copied from
`plugin_versions_13.json` plus `OFFLINE_DOC: false`.

### 4.4 Auth

- Browser-window OAuth: `https://www.epicgames.com/id/{login|register}?client_id=<EPIC_CLIENT_ID>&response_type=code`.
- Exchange: `POST https://accounts.quixel.se/api/v1/login/epic` `{ code, realm: "megascans-bridge" }`.
- Password login: `POST .../login` `{ email, password, realm }`.
- Refresh: `POST .../login` `{ email, token, refreshToken, realm }`.
- Logout: `POST .../logout`.
- JWT stored in renderer `localStorage.auth` as `{ token, refreshToken }`; email and roles are read
  from the JWT payload (base64url, no signature check in the client).

Production constants recovered from `app/config.js`:

```
API_URL          https://quixel.com/v1/
SSO_URL          https://accounts.quixel.se/api/v1/
SIGNED_URL_API   https://rps.quixel.com/
EPIC_CLIENT_ID   <EPIC_CLIENT_ID>
ALGOLIA_INDEX    assets
```

Do **not** hard-code the Epic client ID in a public fork; use a bring-your-own client ID.

## 5. Catalogue and downloads

### 5.1 Algolia (still live at analysis time)

`analysis/renderer-src/app/modules/algolia.js`:

- app id `<ALGOLIA_APP_ID>`
- public search key `<ALGOLIA_SEARCH_KEY>`
- index `assets` (staging `assets-staging`)
- proxy `https://proxy-algolia-prod.quixel.com/algolia/cache`

**(runtime)** Direct query to `<ALGOLIA_APP_ID>-dsn.algolia.net` returned `nbHits: 18833` and full asset
metadata (previews, categories, tags, resolution, biome, region, `comp_version`). This is useful for
a read-only catalogue browser, but the key is Quixel's and can be revoked; make it configurable.

### 5.2 REST endpoints (`app/modules/api.js`)

```
GET  /v1/assets/categorytree/2
GET  /v1/assets/categorytree/archviz
GET  /v1/users/self
POST /v1/users/drops/seen
GET  /v1/assets/:id/extended
GET  /v1/assets/acquired
GET  /v1/assets/favorites
POST /v1/assets/favorites/:id
DEL  /v1/assets/favorites/:id
POST /v1/assets/multiple              { ids: [] }        (max 100)
GET  /v1/packs /v1/packs/:id /v1/packs/:id/assets
POST /v1/downloads                    { asset, components, meshes, config, billboards }
POST /v1/acl                          { assetID }
POST /v1/acl/claim/all
GET  /v1/acl/claim/status
GET  /v1/notifications?count=20
PUT  /v1/notifications/seen
POST /v1/users/trial                  { app: "global" }
GET  /v1/wallet/refund/eligible
POST /v1/wallet/credit
GET  /v1/assets/created|updated|deleted?...&limit&page
POST /v1/assets/export
GET  https://rps.quixel.com/generateSignedUrl
POST https://stats.megascans.se/v1/message
```

### 5.3 Download flow

`analysis/renderer-src/app/actions/myscans.js` builds a request:

```js
const payload = {
  asset: assetId,
  components: processedMaps,   // [{ type, resolution, mimeType, ... }]
  meshes: [...],
  ...(is3dplant && { billboards: [...] }),
  config: { ... }              // 3D LOD/format options
};
const res = await api.requestDownload(payload); // POST /v1/downloads
ipcRenderer.send("download-file-ex", { assetId, isFree, res, assetPath, uniqueDownloads });
```

The response contains file descriptors (`components`, `meshes`, `billboards`) with a URL `uri`,
`saveAs` relative path, and `contentLength`. The **main process does not use a normal HTTP client**:
it registers `session.on("will-download")` and calls `webContents.downloadURL`. That gives Electron's
resume/pause/cancel and progress for free.

Main-process behaviour (`analysis/main.pretty.js`):

- `add-to-download-queue`, `add-to-sync`, `cancel-*`, `pause-download`, `resume-download`,
  `download-plugin`, `download-file`, `download-file-ex`, `download-file-error`
- writes to `app.getPath("temp")/asset-<id>/...` and to the library path
- defaults: 5 parallel files (`--files`, clamped 1..5), 30 s stall timeout (`--timeout`, clamped 0..600)
- user agent forced to `megascans-bridge` on every request
- on completion, unzips asset archives and updates `assetsData.json`

## 6. Library format

`analysis/renderer-src/app/modules/assets.js` and `actions/localLibrary.js`:

```
<library>/
  Downloaded/
    3d/<assetFolder>/...            (also atlas, surface, 3dplant, brush)
    DHI/<metahuman folders>/...
    assetsData.json                 (cache, array of asset records)
  Custom/
    <mixer / custom asset folders>/
  support/
    plugins/<tool>/<version>/...
    utils/...
```

- An asset folder is recognized by a `.json` file whose name does **not** contain `_export` or
  `megascansassets`; the JSON's `id` is the asset id.
- Preview detection: a file whose name contains `grid` or `preview` and ends in `.png/.jpg`.
- Thumb detection: a file whose name contains `thumb`.
- Each record exposes `id`, `name`, `type`, `categories`, `tags`, `environment`, `origin`,
  `semanticTags`, `points`, `meshes`, `models`, `textureSets`, `materials`, `previews.relativeSize`,
  `path`, `jsonPath`, `mtime`, `preview`, `thumb`, `searchStr`.
- `assetsData.json` is a cache; the scanner re-reads folders and rewrites it.

The scanner starts from `path.join(megascansPath, "Downloaded")` and iterates types
`["3d", "atlas", "surface", "3dplant", "brush"]` (or the DHI root). Custom/Mixer assets live under
`<library>/Custom`.

## 7. Local protocol surface

See [PROTOCOL.md](PROTOCOL.md) for exact messages.

| Service | Bind | Purpose |
|---|---|---|
| HTTP API | `127.0.0.1:28241` (override `bridgePortValue`) | plugin/asset queries, logs, analytics |
| Discovery | `127.0.0.1:28852` | returns active HTTP port as a decimal string |
| Mixer old RX/TX | `28456` / `28457` | `refresh_<libraryPath>` text protocol |
| Mixer new RX/TX | `28458` / `28459` | JSON array `[{message,id,path,isExternal,libraryPath,type,version}]` |
| Unreal | `13429` (legacy `13428`) | export JSON |
| 3ds Max | `13292` | export JSON |
| Maya | `13291` | export JSON |
| Unity | `13081` | export JSON |
| Blender | `28888` | export JSON |
| Houdini | `13290` | export JSON |
| Cinema 4D | `24420` | export JSON |
| Clarisse / custom socket | `24981` | export JSON |

## 8. Plugin system

`plugin_versions_13.json` (downloaded to `<library>/support/plugins/`) describes each plugin:

```json
"unreal": { "displayName": "Unreal Engine", "win-version": "8.2", "linux-version": "8.2",
  "defaultPort": "13429", "legacyPort": "13428", "requiresDownload": true,
  "requiresInstall": true, "supportedversions": ["5.5", "5.4", ...] }
```

- Manifest URL: `https://d3uwib8iif8w1p.cloudfront.net/bridge/plugin_versions_13.json`
- Zip base: `https://d3uwib8iif8w1p.cloudfront.net/bridge/plugins_13/`
- Resources: `https://d3uwib8iif8w1p.cloudfront.net/bridge/Resources.zip`
- Install dir: `<library>/support/plugins/<tool>/<version>/`
- Export scripts are plain text with a header scanned by `utils/scripts.js`:
  `--tool:`, `--name:`, `--type:`, `--renderer:`, `--author:`.
- Maya/Max scripts are `.py` / `.ms`; Unreal has per-engine folders under `versions/UE_5.x`.
- `<library>/support/utils/` holds the image processor and Assimp.

## 9. Image processor and Assimp

- `support/python/<platform>/ImageProcessor.zip` (58 MB on Windows) is extracted under the library
  and invoked as `"<path>/ImageProcessor" "<json-file>"`. Used for channel packing, thumbnail
  generation, resolution conversion, colours-space conversion and EXR/JPG handling.
- `support/assimp/<platform>/Assimp-<platform>.zip` (4.2 MB) is extracted and invoked as
  `"<assimp>" export "<input>" "<output.obj>" -config=full` to convert FBX/OBJ for the 3D preview.
- `IP_VERSION = 7`; a `bundle-version.json` gates updates.

## 10. EOL / Fab (historical research)

> OpenBridge v1.1 removed Fab browsing, the Fab source switch and all Fab-specific code. This
> section is retained as reverse-engineering evidence only. The shipped app is Megascans-only.

`https://cdn.quixel.com/quixel/appsConfig/eol-config-prod-v2.json` (live at analysis time):

- `website.isBridgeEnabled: true`
- `redirectToFab.enabled: true`
- `common.cutOffDate: 2025-02-19`
- banner pushes users to Fab / Epic Games Launcher

So the services are still partially alive, but the app is in end-of-life redirect mode. A clone
should treat Quixel as **one optional provider**, not a dependency.

### 10.1 Fab catalogue surface (runtime)

Fab's public web pages are protected by Cloudflare and returned 403 to non-browser requests, but
the JSON endpoints used by the site worked anonymously at analysis time:

```
GET https://www.fab.com/i/listings/search?q=<query>&count=24[&cursor=...][&category=...][&sortBy=newest]
GET https://www.fab.com/i/listings/<uuid>
```

Search returns listing summaries and a `nextCursor`; detail returns title, description, seller,
category, tags, asset formats, licenses/prices, publish date and gallery images. The test listing
`854ffc09-e07f-45c2-9569-37cb7c4ab9c2` (`Historic Miscellaneous Stand Wood Old 05`, asset slug
`xeokah0`, seller Quixel Megascans) reported EUR 4.44 / USD 4.99 and formats FBX, Converted Files,
Additional files and GLTF.

The v1.0 prototype mapped this metadata into catalogue cards and a read-only Fab drawer; those
surfaces were removed in v1.1. A direct fab.com URL or bare UUID was resolved to the listing
before searching.

**Fab downloads are entitlement-gated and were intentionally not reverse-engineered.** Probes of
`/i/listings/<uuid>/download`, `/files`, `/library` and similar paths returned 404. The legacy
authenticated `/v1/assets/xeokah0/extended` returned 404 and Algolia had no record of the Fab
listing. There is no public file URL in the listing JSON. The clone opens Fab/Epic Launcher and
requires the user to obtain the package through Epic's normal entitlement flow.

### 10.2 Texture map previews and signing (runtime)

The legacy extended asset (`/v1/assets/:id/extended`) includes `referencePreviews.maps`. Each
entry carries `type`, `mimeType`, `resolution`, `contentLength` and a relative `uri` such as
`xgmpcby/xgmpcby_1K_Normal_LOD0.jpg`. Downloaded asset JSON may have these URIs stripped, but the
live extended response has them.

The original preview UI calls:

```
GET https://rps.quixel.com/generateSignedUrl
Authorization: Bearer <quixel JWT>
```

The response is a wildcard CloudFront base:

```json
{"expiresIn":180000000,"expiresAt":"...","url":"https://rp.quixel.com/*?Policy=...&Signature=..."}
```

The original `getSignedUrl` helper replaces `*` with the map URI (or, more precisely, inserts the
URI between `.com/` and `?`). The resulting URL returns the 1K JPEG. The legacy maps view groups
maps by texture set, excludes LOD-specific duplicates other than LOD0, filters Bump/Cavity/Gloss
from the 3D texture sets path, and cycles the remaining names with arrows or swipe.

OpenBridge exposes this as `catalog:mapPreviews`, which fetches the extended asset, caches the
signed wildcard URL until shortly before expiry, and returns labelled preview URLs. It does not
write to the library.

## 11. Linux notes (research only)

- The original shipped as an AppImage (`Bridge.AppImage`, still downloadable) and contains
  `process.platform === "linux"` branches for path handling, zip extraction (`unzip`), Assimp and
  the image processor.
- The legacy app bundled an old Electron (10), which will not run reliably on current Linux.
- OpenBridge currently ships as a Windows portable build only. Linux packaging is not configured
  and no RPM/AppImage target is planned for the current scope.

## 12. What to reuse vs. reimplement

Reuse **protocols and formats** (HTTP endpoints, socket messages, plugin manifest, library layout).
Reimplement **code and UI** clean-room. Do not ship:

- `app.asar`, recovered renderer sources, or any Quixel JavaScript
- Quixel/Epic logos, fonts, environment HDRIs, preview images
- Quixel plugins or the image processor binaries
- the Epic OAuth client id or Algolia key (make them user-supplied/configurable)
