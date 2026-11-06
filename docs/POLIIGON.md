# Poliigon addon research and integration plan

Status: research complete. Phases 0-4 and the Megascans-parity polish pass are implemented
and unreleased: provider plumbing, catalogue browsing, account state, downloads, local
library indexing, favorites, bulk selection, related assets and richer download controls.
In-app credit purchases are intentionally out of scope for now; OpenBridge assumes the user
already has the required subscription or owns the assets.

This document records how the official Poliigon Blender addon talks to Poliigon, what it
does locally, and how OpenBridge can offer equivalent Poliigon support as a second asset
provider. It is protocol research only: no addon code, images, templates or other assets
are copied into OpenBridge.

## 1. Target and legal position

| Item | Value |
|---|---|
| Archive | `poliigon-addon-blender.zip` (research input, git-ignored) |
| Addon | Poliigon for Blender `1.17.0` |
| Modules | `poliigon-addon-blender/modules/poliigon_core` plus Blender UI layers |
| Licence | `LICENSE.txt` is GNU GPL v3; source headers say GPL v2-or-later |
| OpenBridge licence | MIT |

The addon is copyleft. OpenBridge must remain a clean-room implementation:

- Do not copy Python source, comments, UI strings, `.blend` templates, icons or images.
- Do not translate its code line-by-line into TypeScript.
- Treat HTTP endpoints, payload field names, status codes and on-disk layout as
  interoperability facts and reimplement them independently.
- Do not ship Poliigon artwork, catalogue dumps or account data.
- The archive contains a pre-populated `access_token.txt`. It was never read, used or
  copied. Token files from downloaded addons must always be treated as credentials.

Poliigon accounts, plans, credits and entitlements remain the user's. OpenBridge must not
bypass purchase, entitlement or rate limits. The public catalogue endpoint is the same one
the official addon calls without authentication; OpenBridge should cache it locally and
must not redistribute it.

Terminology note: "convention" below is Poliigon's own asset-layout version number
(0 or 1), not a UI convention.

## 2. Evidence and method

- Static review of the extracted addon under `analysis/poliigon-addon` (git-ignored).
- Live probes of public endpoints on 2026-11-05:
  - `/all?language_code=en`: HTTP 200, 43,680,283 bytes uncompressed (3.9 MB gzip),
    10,263 records.
  - `/category/list?language_code=en`: HTTP 200, 331 category nodes, maximum depth 4.
  - CDN thumbnail and watermarked map preview URLs: HTTP 200.
- Counts in this document are a snapshot and will drift as the catalogue changes.
- Published-only snapshot: 7,448 assets (Textures 6,246; Models 860; HDRIs 342).
  The remaining 2,815 records have `ReleaseStatus: "Unpublished"` and must be hidden by
  default, matching the addon's search filters.

## 3. Addon architecture

The Blender folders (`dialogs`, `operators`, `panels`, `asset_browser`, material import
modules) are UI and DCC glue. All network, account, caching, download and library logic
lives in `modules/poliigon_core`:

| Module | Responsibility |
|---|---|
| `env.py` | Environment selection. Falls back to the production API URL. |
| `api.py` | HTTP connector, auth, catalogue, account, purchase, download URL requests, streaming, telemetry. |
| `assets.py` | Asset domain model, types, map types, sizes, LODs, file naming. |
| `asset_index.py` | Builds asset records from API dictionaries, caches queries, scans local libraries. |
| `download_asset.py` | Download payload construction, parallel transfer, retries, temp files, dynamic files. |
| `asset_cache.py` | Atomic JSON cache for the public catalogue. |
| `user.py`, `plan_manager.py` | Profile, credits, subscription and download preferences. |
| `api_remote_control*.py` | Job queue that the Blender UI drives. |
| `updater.py`, `notifications.py`, `reporting.py` | Addon update, in-app notices and telemetry. |

OpenBridge does not need the remote-control job system or the Blender UI. It needs the
HTTP protocol, the catalogue model, the download payload builder and the library layout.

## 4. Environment and constants

```
API base      https://apiv2.poliigon.com/api/v2
Website base  https://www.poliigon.com
Software id   blender | 3dsmax | maya | cinema4d | sketchup | unreal | polydex
Download DCC  Blender | 3dsMax | Maya | Cinema4D | SketchUp | Generic
```

Asset types (`Type` in API responses):

| API value | Meaning | Local URL prefix |
|---|---|---|
| `Textures` | PBR texture sets | `/texture/` |
| `Models` | 3D models | `/model/` |
| `HDRS` | HDRIs | `/hdri/` |
| `Brushes` | Brush alphas (rare; none published in the snapshot) | `/brush/` |
| `Substances` | Not supported by the addon | n/a |

Convention values seen in the snapshot: `0` (older assets) and `1` (current assets).
Models and HDRIs are convention 0 in the snapshot.

Resolutions are strings from a fixed set:
`256`, `512`, `1K`, `2K`, `3K`, `4K`, `6K`, `8K`, `12K`, `16K`, `18K`, plus the
internal values `HIRES` and `WM`. `DefaultResolution` may be null.

Texture map type codes are split by convention:

- Convention 0 (workflow-oriented): `AO`, `COL`, `DIFF`, `DISP`, `DISP16`, `NRM`,
  `NRM16`, `ROUGHNESS`, `METALNESS`, `GLOSS`, `REFL`, `SSS`, `FUZZ`, `OPACITY`, `MASK`,
  `EMISSIVE`, `TRANSMISSION`, `TRANSLUCENCY`, `ALPHA`, `ALPHAMASKED`, `IDMAP`, `BUMP`,
  `BUMP16`, `ENV`, `JPG`, `LIGHT`, `HDR`, `OVERLAY`, `OVERLAY16`, `DIRECTION`, plus
  `NA_ORM` and `NA_VERTEXBLEND`. Map entries carry `{ workflow, maps: [code, ...] }`.
- Convention 1 (material-oriented): `AmbientOcclusion`, `BaseColor`,
  `BaseColorOpacity`, `Displacement`, `Emission`, `Metallic`, `Normal`, `Opacity`, `ORM`,
  `Roughness`, `ScatteringColor`, `SheenColor`, `Translucency`, `Transmission`, `ID`,
  `HDRI`, `Environment`. Map entries carry `{ type, file_formats: ["jpg", ...] }`.
- A `_VAR1`-style suffix on a convention 0 map code marks a variant.

`ORM` packs R=Ambient Occlusion, G=Roughness, B=Metalness.

Workflows: `REGULAR`, `METALNESS`, `SPECULAR`.

LODs: `SOURCE`, `LOD0` through `LOD4`, `PROXY`.

Model formats: `FBX`, `BLEND`, `MAX`, `C4D`, `OBJ`.

Texture formats: `jpg`, `png`, `tiff`, `exr`, `hdr`, `webp`, `psd`. The addon prefers
`jpg`, then `png`, `tiff`, `exr`, `hdr`.

## 5. Public catalogue API

These endpoints work without a token and are what a read-only browser should use.

### 5.1 All assets

```
GET /all?language_code=en
```

Returns `{ status, message, results: { data: [asset, ...] } }`. The `results` wrapper is
flattened by the addon's HTTP client, so the effective body is `{ data, ... }`.

This is the complete catalogue and the only public source of full per-asset metadata.
OpenBridge should download it once, build a compact local index, and refresh on a TTL or
on demand. It is approximately 3.9 MB gzipped and 43.7 MB raw.

### 5.2 Category tree

```
GET /category/list?language_code=en
```

Returns a nested tree. Each node has `id`, `name`, `path`, `title`, descriptions,
`popularity`, `is_seo`, `image` and `children`. Node `path` values look like
`/textures/architectural/ceilings/concrete`.

Asset `Categories` / `CategoryIDs` are arrays of numeric category IDs, not names. Build an
`id -> node` map from the category tree to display names and breadcrumbs.

### 5.3 Category results

```
GET /category/results/<category-path>?language_code=en&addon=1
```

The category path is the node path without the leading slash, lower-cased, with spaces
replaced by hyphens (for example `textures/wood/flooring`). Returns `data` as a list of
asset IDs, not full records. The addon resolves IDs through its local asset index.

### 5.4 Search

The addon searches an Algolia index with a public search key embedded in the client. That
key is third-party material and is intentionally not documented or copied here.

OpenBridge does not need it: the full catalogue is available from `/all`, so search,
filters, facets, sorting and counts can be computed locally with SQLite FTS5. This avoids
shipping any Poliigon key and gives offline browsing.

### 5.5 Asset record fields

Every `/all` record has the following top-level keys (some absent for some types):

| Field | Notes |
|---|---|
| `AssetID` | Integer. Stable primary key. |
| `Type` | See asset-type table. |
| `Name` | Display name. |
| `AssetName` | File-system-safe name, e.g. `Poliigon_WoodFloorChecker_14070`. Also the local folder name. |
| `Slug` | Website slug. |
| `WebsiteUrl` | Canonical product page. |
| `Parent` | Parent asset for multi-part sets, usually null. |
| `ReleaseStatus` | `Production` or `Unpublished`. Hide unpublished by default. |
| `PublishedAt`, `CreatedAt`, `UpdatedAt` | ISO-8601 UTC timestamps. |
| `Credit` | Integer credit cost; `0` means free. |
| `Tags` | String array. |
| `Categories`, `CategoryIDs` | Numeric category IDs. |
| `SeoCategories` | Array, usually empty. |
| `Resolutions` | String array of available sizes. |
| `DefaultResolution` | Included model resolution, or null. |
| `Maps` | Convention-dependent map descriptors; see below. |
| `LODs` | Model LOD list. |
| `Softwares` | `[{ software, render_engines: [] }]` for models. |
| `Specifications` | Technical data; see below. |
| `Convention` | 0 or 1. |
| `Previews` | Gallery images. |
| `VideoPreviews` | Poster image plus `.mp4` preview. |
| `ToolboxPreviews` | Watermarked per-map images. |
| `ManufacturerDetails` | Usually null. |
| `InternalDescription`, `WebsiteDescription` | Descriptions. Some unpublished records have internal text only. |

`Specifications` keys seen:

- Textures: `displacement_cm`, `creation_method`, `physical_size_cm { width, height }`,
  `map_file_formats`.
- Models: `meshes`, `lods { SOURCE, LOD0..4, PROXY: triangles }`,
  `physical_size_cm { width, height, depth }`, `minimum_compatibility`,
  `map_file_formats`, `maps`.
- HDRIs: light/environment metadata where present.

`creation_method` values: `photoscanned`, `procedural`, `photometric`, `hybrid`.

### 5.6 Preview and thumbnail URLs

All previews are direct CDN URLs and need no authentication.

```
Gallery image:      <baseUrl>/<fileName>
Thumbnail:          <baseUrl>/300px   (also 600px, 900px, 2000px)
Watermarked map:    <toolboxBaseUrl>/<fileName>
Video preview:      <videoBaseUrl>/<fileName>
```

`Previews` entries have `fileName`, `baseUrl`, `type`, `position`, `role`, `mediaId`,
`mediaUpdatedAt` and a version query string. `role` can be `sphere`, `zoom` or null.
`300px` is the addon's grid size; `2000px` is suitable for the OpenBridge preview viewer.

The `ToolboxPreviews` file names carry the map code, for example
`<Asset>_AmbientOcclusion_WM.jpg`, which makes them useful as map previews in the drawer.

## 6. Authentication

### 6.1 Email and password

```
POST /login
Content-Type: application/json
Accept: application/json

{ "email": "...", "password": "...", "time_since_enable": <optional seconds> }
```

Success returns `access_token`. Failure returns messages such as `do not match`, plus an
optional `errors` structure. The addon never stores the password; it stores only the token
in a plain-text `settings.ini` (`[user] token`).

**Runtime note (2026-11-05):** the live API now rejects addon password login with HTTP 422
`{"message":"Please use login via web instead"}`. OpenBridge therefore exposes the browser
flow only. The password endpoint remains implemented for future compatibility but is not
shown in the UI. Do not build a product flow that depends on it.

OpenBridge should not copy the addon's plain-text token storage. Store only the token,
encrypted with Electron `safeStorage` (DPAPI on Windows), and never persist the password.

### 6.2 Browser login

```
POST /initiate/login
{ "platform": "addon-blender", "meta": { "addon_version", "software_version", "software_name" } }
  -> { login_token, login_url }

POST /validate/login
{ "platform": "addon-blender", "login_token": "...",
  "meta": { "optin": bool, "addon_version", "software_version", "software_name" },
  "time_since_enable": <optional> }
  -> { access_token } and a success marker
```

The addon opens `login_url` in the system browser and polls `validate/login` once per
second for up to five minutes. OpenBridge can use the same flow with `shell.openExternal`
and a cancellable poll. The browser flow is preferable to asking for a password.

### 6.3 Authenticated request shape

```
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
```

The addon appends `?format=plain` (or `format=html`) to every authenticated path. It then
flattens a top-level `results` object into the response root.

### 6.4 Logout

```
POST /logout
```

Clears the token on success.

## 7. Account, entitlements and recently viewed

```
POST /me?format=plain
  -> { user, credits, assets, subscription, download_preferences }
```

Observed structure:

- `user`: `id`, `name`, `how_will_you_use_poliigon`, `primary_3d_software`,
  `primary_rendering_engine`.
- `credits`: `available_balance`, `ondemand_balance`.
- `assets`: purchase and download counts.
- `subscription`: plan name, credits, renewal dates, paused/cancelled state,
  `unlimited`, `limited_legacy`.
- `download_preferences`: default resolution, LODs, software/renderer selections and
  per-map format preferences (see section 9.4).

Entitlements:

```
GET /assets/list/ids?format=plain     -> { asset_ids, asset_ids_count }   (owned)
GET /downloads/ids?format=plain       -> { asset_ids, asset_ids_count }   (recent downloads)
GET /users/recently/viewed/assets     -> recent-view records
POST /recently/viewed                 { language_code, asset_ids }
GET /assets/details/<id>?language_code=en
```

Unlimited-plan users may download the catalogue without per-asset purchase. The addon
skips the purchased check for them. Free assets have `Credit: 0`.

## 8. Purchases and credits

```
POST /assets/purchase/<asset_id>?format=plain
{ "last_search_term": "...", "last_category": "/models/bathroom" }
```

The search/category fields are only sent when telemetry is opted in. A 422 response with
`error_code: "insufficient-credits"` means the account cannot afford the asset.

The addon auto-purchases before download when its `auto_download` setting is true. That is
convenient for a DCC plugin but dangerous for a library manager. OpenBridge should:

- Never spend credits implicitly.
- Show credit cost and current balance in the download panel.
- Require an explicit confirmation for any paid asset.
- Never re-purchase an owned asset.
- Treat unlimited-plan downloads as entitled but still user-initiated.

## 9. Downloads

### 9.1 Request

```
POST /assets/download?format=plain
```

**Runtime note (2026-11-05):** free assets also return HTTP 401 `{"message":"Unauthenticated."}`
without a token. Free means zero credits, not anonymous download. OpenBridge therefore
requires a signed-in Poliigon account before requesting any manifest, including free assets.

Common body:

```json
{
  "response_type": "json",
  "assets": [
    { "id": 14070, "name": "<AssetName>", "sizes": ["2K"] }
  ]
}
```

Type-specific additions:

- Texture, convention 0:
  `{ "workflows": ["METALNESS"], "type_codes": ["AO", "COL", "NRM", ...] }`
- Texture, convention 1:
  `{ "maps": [ { "type": "BaseColor", "format": "jpg" }, ... ] }`
- HDRI: no extra fields. The server decides which environment/light maps apply.
- Model:
  `{ "lods": ["LOD0", ...], "softwares": ["Blender"], "renders": ["Cycles"] }`
  Use `softwares: ["Generic"]` when the native DCC mesh is not wanted. `lods` is omitted
  when all LODs should be downloaded or when the asset has none.

`response_type: "json"` asks for a JSON manifest instead of a legacy archive.

### 9.2 Response

```json
{
  "uuid": "...",
  "payload": [
    {
      "files": [
        { "url": "https://cdn...", "name": "...", "bytes": 123, "resolution": "2K" }
      ],
      "dynamic_files": [
        { "name": "...", "contents": "<MaterialX XML>" }
      ]
    }
  ]
}
```

- `files` are individual CDN downloads, not ZIPs.
- `dynamic_files` are generated text files, currently MaterialX XML, written next to the
  textures.
- The `uuid` is used by the addon only for download-quality telemetry.

### 9.3 Transfer behaviour

The addon:

- Downloads up to 8 files per asset concurrently and at most 2 assets at once.
- Sorts files by size before scheduling.
- Writes to `<filename>.dl`, verifies `size_expected == size_downloaded == Content-Length`,
  then renames to the final name.
- Retries a failed file up to 3 times; retries a whole asset only when a URL expired (403).
- Treats 401 as an invalidated token, 403 as an expired URL, 429 as unlimited fair-use
  exhaustion, and 422 `insufficient-credits` as a purchase problem.
- Streams in 64 KB chunks and reports byte progress.

OpenBridge already has a hardened transfer layer with Range resume and size verification.
The Poliigon path should reuse that layer but must re-request the download manifest when a
signed URL expires rather than retrying the same URL forever.

### 9.4 Map preferences

`/me` returns server-side download preferences: resolution options/default, LOD options,
software/renderer selection, and per-map `required`, `default`, `selected` and available
`formats`. OpenBridge can offer a simpler model:

- Resolution selector from `Resolutions`.
- Per-map format selector from `Maps[].file_formats` (convention 1) or
  `Specifications.map_file_formats` (convention 0).
- "Required maps only" versus "all available maps".
- LOD selector and "native mesh" toggle with DCC/renderer selection for models.

### 9.5 Telemetry to omit

The addon posts analytics events to `/t/<event>` (search, preview, import, screen views,
notifications, plan prompts) and `/t/download_quality`. It also bundles Sentry.

OpenBridge has a no-telemetry policy. Do not implement any of these calls.

## 10. Local library layout

The addon stores everything under the user profile:

```
%USERPROFILE%\Poliigon\
  <software>\settings.ini          # e.g. blender\settings.ini
  Library\                         # default primary library
    <AssetName>\
      <size>\                      # e.g. 2K\ (convention 1/2/3)
        <texture files>
      <mesh files>                 # FBX/BLEND/MAX/C4D/OBJ at asset root
      <preview images>             # at asset root
      <dynamic MaterialX files>    # in the size folder when present
  OnlinePreviews\                  # downloaded thumbnails/previews by content hash
  AssetIndex\asset_index.json
  cache\assets_cache.json
  categories.json
```

`settings.ini` holds `[library] primary=<path>` and additional directories under
`[directories]`. Default download settings are `tex_res=2K`, `hdri_bg=8K`,
`hdri_light=1K`, `brush=2K`, `model_res=NONE`, `download_lods=true`, `lod=NONE`.

`settings.ini` sections used by the addon: `download`, `library`, `directories`, `update`,
`logging`, `purchase`, `import`, `onboarding`, `ui`, `user`, `upgrade`, plus a dynamic
`map_preferences` section. The token is stored under `[user] token`.

### 10.1 File naming

Downloaded files from the server follow names such as:

```
Poliigon_<Asset>_<id>_<MapType>_<Size>.<ext>      # textures
Poliigon_<Asset>_<id>_<MeshType>_LOD0.fbx          # models
Poliigon_<Asset>_<id>_Preview1.png                 # previews
Poliigon_<Asset>_<id>_<MapType>_WM.jpg             # watermarked toolbox previews
```

The addon parses unscored filename parts for map type, workflow, LOD, size and variant.
Previews are recognised by suffixes such as `_preview1`, `_preview01`, `_atlas`,
`_sphere`, `_fabric`, `_flat`, `_cube`, `_grid`, `_cylinder`. Image extensions are
`.jpg`, `.jpeg`, `.png`, `.webp`, `.tif`, `.tiff`, `.exr`, `.hdr`, `.psd`. `.dl` files are
incomplete transfers and should be ignored or resumed.

### 10.2 Interoperability opportunity

Writing to `%USERPROFILE%\Poliigon\Library` in exactly this layout means the official
Poliigon Blender addon will recognise assets downloaded by OpenBridge as local assets,
with no plugin changes. This is the lowest-risk way to deliver "OpenBridge downloads it,
Blender can import it" before OpenBridge has its own DCC import pipeline.

OpenBridge should therefore default the Poliigon library to that path, while allowing the
user to choose another folder. A future "OpenBridge-managed library" can add sidecar JSON
without breaking the official addon.

## 11. Proposed OpenBridge integration

### 11.1 Provider abstraction

Add a first-class provider dimension instead of branching deep inside Megascans code.

```ts
type AssetProvider = "megascans" | "poliigon";
```

Thread `provider` through:

- `AppSettings` (per-provider library paths and defaults)
- catalogue queries and hits
- download queue entries and progress events
- local library records, index queries and health reports
- recent items, favorites and saved state
- IPC payloads and the preload API

Keep the existing Megascans code paths intact and migrate settings so current users see no
change.

### 11.2 Suggested modules

```
src/main/poliigon/config.ts       endpoints, limits, defaults
src/main/poliigon/auth.ts         login/logout/state, safeStorage token, profile
src/main/poliigon/catalog.ts      /all + /category/list fetch, compact cache, refresh
src/main/poliigon/catalog-index.ts SQLite + FTS5 catalogue queries
src/main/poliigon/download.ts     manifest request, file transfer, dynamic files
src/main/poliigon/library.ts      scan/parse local Poliigon libraries
src/shared/poliigon-types.ts      API record and query/result types
```

The Poliigon catalogue index should be a separate SQLite database (for example
`poliigon-catalog.sqlite`) so a catalogue refresh never rebuilds or blocks the asset
library index. Use FTS5 for name, `AssetName`, tags, description and category names.

### 11.3 Catalogue UX

- A provider switch in the shell: **Megascans** and **Poliigon**.
- Poliigon category rail from the 331-node tree, with counts computed from the index.
- Type filters: Textures, Models, HDRIs, Free, plus resolution, creation method, map type
  and "downloadable with current plan" facets.
- Sort by newest, name, resolution, triangle count.
- Cards use the 600px CDN thumbnail, with a name, type, free/credit badge and owned/local
  indicator.
- Drawer tabs: Overview (gallery, description, physical size), Maps (watermarked map
  previews), Technical (resolutions, map formats, LOD triangles, supported software),
  Download (size/maps/LOD/format and cost).
- Local library view shows Poliigon assets alongside Megascans, filterable by provider.

### 11.4 Auth and account UX

- Settings section for Poliigon: sign in (browser flow preferred, email/password
  optional), sign out, plan and credit balance, owned-asset sync, catalogue refresh.
- Never store the password. Store the token with `safeStorage`.
- Show a clear "not signed in" state in the Poliigon catalogue rather than failing at
  download time.

### 11.5 Download and library UX

- Reuse the existing queue, pause/resume, progress events, completion history and
  download rail.
- Write into the exact addon-compatible layout described in section 10.
- After completion, scan the asset folder and index it locally.
- Add a "Reveal in Explorer" action and an "Open on Poliigon" link.
- Do not auto-purchase. For paid assets show cost, balance and an explicit confirm step.

### 11.6 Compatibility with the official addon

- Read `%USERPROFILE%\Poliigon\<dcc>\settings.ini` only to discover the user's primary
  library path; do not import its plain-text token by default.
- Offer the official library path as the default so Blender users get immediate
  interoperability.
- Never delete or rewrite addon cache/index files. OpenBridge owns only its own index.

## 12. Phased implementation

| Phase | Deliverable | Depends on | Status |
|---|---|---|---|
| 0 | Provider plumbing in types, settings, IPC and shell; Megascans unchanged | none | Done |
| 1 | Public Poliigon catalogue fetch, local SQLite/FTS index, category/search/filter browsing and drawer | 0 | Done |
| 2 | Poliigon auth, profile, credits and owned-asset sync | 1 | Done |
| 3 | Download manifests, transfer, temp/rename, dynamic files, queue integration | 2 | Done |
| 4 | Local Poliigon library scan/index/health and addon-compatible layout | 3 | Done |
| 5 | In-app credit purchase confirmation | 2, 3 | Deferred by design |
| 6 | Tests, docs, packaging and manual verification | all | Done |

Each phase should keep `npm run check`, `npm run build` and `npm run check:public` green.
Catalogue tests should use a small fixture, never the full 43 MB response.

### 12.1 Implemented in phases 0 and 1

- `AssetProvider` (`megascans` | `poliigon`) in shared types and renderer state.
- `libraryRoot`, `libraryPath`, `poliigonLibraryPath` and `poliigonConfirmPurchases`
  settings. Existing Megascans paths are preserved; Poliigon defaults to a sibling
  `Poliigon` folder. New installs default to `Documents\OpenBridge\{Megascans,Poliigon}`.
- `src/main/poliigon/catalog.ts`: public `/all` and `/category/list` fetch, compact gzip
  record payloads, published-only SQLite index, contentless FTS5 search, category tree
  with distinct descendant counts, facet counts and 120-item paging.
- IPC and preload surface: `poliigon.status/refresh/categories/search/extended/onStatus`.
- Provider switch in the sidebar, Poliigon category rail, type/free/facet/sort controls,
  virtualized card grid, preview/map/technical drawer and "Open on Poliigon" links.
- Catalogue index is stored in `userData/poliigon-catalog.sqlite` (about 30 MB for 7,448
  published assets, down from 111 MB in the first prototype). It is re-checked against the
  public `/all` endpoint at startup, when the window regains focus, and every two hours while
  the app runs; the index itself refreshes when older than six hours, with a fifteen-minute
  retry cooldown after a failure. A successful background refresh re-runs the current search
  so new assets appear without restarting. The toolbar and Settings also expose on-demand
  refresh. Megascans searches the live catalogue API on every query, so its new assets appear
  as soon as the provider publishes them.
- No Poliigon account is required for phase 1 and no telemetry or third-party search key
  is used.
- `src/main/poliigon/auth.ts`: browser sign-in (`/initiate/login`, `/validate/login` polling,
  300 s timeout, cancel), optional password fallback, `/me` account snapshot, owned and recent
  download ID sync, `/logout`, and DPAPI-encrypted token persistence in
  `userData/poliigon-auth.bin`.
- Renderer account state, sign-in dialog, topbar account pill, owned badges on cards and the
  drawer, and a Settings account section with plan, credits, on-demand credits, owned count,
  refresh and sync actions.
- Password sign-in is hidden because the live API rejects it; browser sign-in is the only
  supported flow.
- `src/main/poliigon/payload.ts`: pure `/assets/download` payload builder for convention 0
  and 1 textures, models (LODs, native/generic mesh, renderer) and HDRIs. Unit-tested with
  fixtures.
- `src/main/poliigon/download.ts`: manifest request with expired-URL refresh, owned/free
  entitlement checks, six parallel files per asset, two assets at a time, pause/resume/cancel,
  `.part` resume through the existing transfer layer, size verification, dynamic MaterialX
  files and addon-compatible folder layout. Existing complete files are skipped on resume.
- Downloads are routed through the existing queue/IPC surface with `poliigon:<id>` job IDs,
  merged queue listings, shared completion history and a provider-tagged progress payload.
- The drawer has a Download section: resolution, map/format selection, LOD selection,
  native-mesh/renderer controls, progress and pause/resume/cancel. Paid unowned assets are
  blocked with a link to Poliigon until Phase 5.
- `src/main/library.ts` and `library-index.ts` now index both providers. The index stores a
  `provider` column, counts per provider and provider-aware queries; existing Megascans
  behaviour is preserved.
- Poliigon folders are matched to catalogue records by `AssetName`. The scan derives local
  previews, downloaded resolutions, map types, LODs, mesh format, file counts and bytes from
  disk, then writes health statistics immediately.
- The Library view has an **All sources / Megascans / Poliigon** filter, provider-specific
  type lists, the correct library path, and local search/categories/sorting. Poliigon cards
  open the Poliigon drawer with a LOCAL badge, local preview, size and **Open folder**.
- Completed Poliigon downloads trigger an automatic library rescan, so new assets appear
  without pressing Rescan.

### 12.2 Known phase 1-4 limits

- Downloads require a Poliigon sign-in. Free assets still return 401 without a token.
- Local Poliigon records are matched to the catalogue by folder/`AssetName`. If the catalogue
  has no matching record, the scan falls back to folder-name metadata and local inference.
- The Poliigon download queue is not persisted across app restarts yet. Completed history is
  recorded in the shared `download-history.sqlite`.
- Paid unowned assets require the Phase 5 purchase confirmation flow.
- Poliigon publish status is filtered to `Production`; unreleased/staging records are not
  indexed.

### 12.4 Megascans-parity polish

- Search now covers names, asset names, descriptions, tags, slugs, website URLs, map codes
  and resolutions. Numeric IDs and full Poliigon URLs resolve directly. Relevance is the
  default sort when a query is present, and recent searches are remembered.
- Local favorites, a Favorites filter, a Downloaded filter, DOWNLOADED card badges and local
  status in the catalogue drawer.
- Related assets in the drawer use the deepest matching category, producing genuinely
  related results instead of the whole type.
- Clickable category and tag chips navigate or search directly from the drawer.
- Bulk selection with shift-click ranges, select-loaded, select-all-filtered and bulk
  download using safe 2K/all-maps/native-mesh defaults.
- Download controls now include Common/All/None map presets, DCC selection, renderer
  selection filtered by DCC, remembered per-type defaults and a plain-language plan summary.
- The drawer mirrors the Megascans pattern: Render/Maps switch, expandable image viewer,
  render picker, previous/next asset buttons, standard Overview / Download settings /
  Technical / Related tabs, quick resolution chips and a direct Download action in the footer.
  Download settings use the same download-box, map-row, toggle and dropdown structure as
  Megascans, including a per-map format selector.
- Presentation parity pass: the preview thumbnail strip and render-mode overlay arrows were
  removed so the preview, picker and tabs occupy the same space as Megascans. Switching tabs
  scrolls the content to the tab bar, and opening another asset resets the drawer scroll.
- Overview adds the shared **Relative size** panel for models with complete width, height and
  depth metadata, including metric/imperial units and the human reference selector.
- Technical uses the Megascans `technical-panel` two-column layout with dimensions,
  resolutions (including default resolution), map types and formats, LODs, max triangles,
  meshes, material workflow, alpha/opacity, displacement height, creation method, release
  status, layout convention, catalogue ID and dates. HDRIs additionally expose their
  `sun_position`, and named texture-map chips are shown below the panel. Model `polycount`
  values fill the maximum-triangle field when no LOD table exists.
- Models without LODs are shown as a single mesh and no longer block download with an empty
  "select a LOD" state.
- The Poliigon search bar now uses the same Catalogue / Library scope switch as Megascans, and
  unlimited-plan cards no longer repeat an `UNLIMITED` badge on every tile.
- Catalogue results have a grid and a list/compare view, matching the Megascans browsing modes.
- Discover now defaults to an **All** source scope. Poliigon and Megascans are searched in
  parallel and merged into one grid/list through a curated cross-provider taxonomy: 3D Assets,
  3D Plants, Surfaces, HDRIs, Atlases, Decals, Brushes, Imperfections and Displacements, plus
  shared subtopics such as Architecture, Furniture, Food & Drink, Rocks & Terrain, Wood &
  Flooring, Ground & Nature and Houseplants. Each node resolves to provider-specific type or
  category filters, so Poliigon vegetation appears under 3D Plants and Poliigon wood/flooring
  appears under Wood & Flooring. Both catalogues contribute facets, counts, cards, drawers,
  pagination and download queues, and the All view also carries size and state/downloaded
  filters, saved searches, recent searches and recently viewed assets, Megascans pack browsing
  and scroll restoration. Focused Megascans and Poliigon views remain available.
- Poliigon publishes public watermarked map previews for textures and no map images for 3D
  models. For entitled assets, the drawer requests a download manifest at 1K, downloads only
  the image maps, caches them under `userData/poliigon-map-previews/<assetId>/`, and presents
  them as genuine unwatermarked map previews with previous/next, picker and full-screen
  navigation. Alpha-bearing maps (opacity/alpha/mask) request PNG rather than the default JPEG,
  which the provider rejects; this affects both previews and real downloads. Opening a map in the full-screen viewer requests the highest available
  resolution through the same manifest, caches it under
  `userData/poliigon-map-highres/<assetId>/`, and uses the shared loading/retry overlay while
  the full-size image downloads. Every temporary preview transfer (1K maps, full-resolution
  maps and HDR sources) publishes into the normal download-progress channel, so the Download
  activity pill, popover and viewer overlay show the same live size, smoothed speed, ETA and
  CDN source as library downloads; preview entries are excluded from the Downloads queue and
  history and disappear once finished. Manifests are briefly cached per asset/resolution so
  opening the viewer right after the map previews does not re-request them, and transient
  provider errors (429/5xx) are retried briefly or surfaced with a Retry action instead of
  blocking. Cached preview files larger than a catalogue thumbnail are flushed from
  `poliigon-map-previews`, `poliigon-map-highres` and `poliigon-hdr-source` when the app quits,
  so multi-hundred-megabyte HDR and full-resolution caches never accumulate; thumbnail-sized
  files are kept. HDRIs expose both a Tone-mapped JPG entry and an HDR (EXR) entry plus a full-screen
  −10 to +10 EV exposure slider: selecting the HDR entry enables the live view immediately and
  preserves the current zoom and pan for direct comparison; the default is the
  highest-resolution JPG/PNG, and enabling exposure downloads and decodes the highest published
  HDR/EXR tier (12K where available) with `@bb-studio/exr`, uploads it once as a mip-mapped
  half-float texture and applies live ACES/sRGB exposure in a WebGL shader. The shader maps the
  on-screen pixels back through the same fit/zoom/pan transform as the JPG viewer, so the HDR
  view stays pixel-aligned and equally sharp at every zoom instead of magnifying a fit-sized
  buffer, and triangular-PDF dithering keeps smooth sky gradients band-free at every stop. No
  per-stop image files or tone-mapped PNG caches are used. HDRI previews also open in an
  interactive equirectangular 360° view for both the tone-mapped and HDR entries: drag to look
  around, wheel or −/+ to change the field of view (65° default), `P` (or the 360° toolbar
  button) toggles between panorama and flat, and the exposure slider works live on the
  panorama with a Reset button back to 0 EV. The mode follows the content: HDRI and 2:1
  equirectangular previews default to 360, while flat maps stay flat, and choosing HDR or
  clearing exposure switches the picker between the HDR (EXR) and Tone-mapped JPG entries so
  the label always matches what is displayed. Equirectangular sampling derives continuous UV
  gradients and uses `textureGrad`, avoiding the mip-level jump that otherwise shows as a
  vertical seam at the longitude wrap. The 8-bit path uploads the JPEG/PNG directly to WebGL,
  while the HDR path reuses the decoded half-float texture; both share the same camera maths.
  This is an independent implementation
  of the interaction model popularised by Poly Haven's website and `imgvwr`
  (<https://github.com/Poly-Haven/imgvwr>, MIT): `imgvwr` is a standalone Rust desktop app and
  the polyhaven.com source is AGPL, so no third-party code or assets are bundled. HDRI time of
  day is estimated during catalogue refresh from the name, tags, category paths and the
  normalised `sun_position` azimuth/elevation pair, then stored in the catalogue
  (`time_of_day`). The HDRI browser exposes a dual-handle 0–24 h time slider where the two
  handles set the start and end of the falloff window (default 09:00–15:00), crossing midnight
  automatically, with dawn/noon/dusk/night ticks and an All day reset; it is available in both
  the unified and focused Poliigon views. HDRI views hide irrelevant size, texture-map and pack
  filters, and show the estimated time on cards, in the footer and in the technical panel. HDRI
  drawers open on the Maps view, and expanding from the Render tab switches to the genuine
  HDRI preview automatically. HDRI categories are split into Skies
  (clear/cloudy/overcast/sunrise-sunset/evening/night), Environments (arid/coastal/fields/
  general), Urban and Industrial. Clicking the image closes the viewer. Textures fall back to
  the public watermarked catalogue previews only if genuine maps cannot be loaded, with a
  clear note and Retry action. This only runs for free, owned or plan-included assets, so it
  never spends credits or acquires an asset implicitly.
- Downloads view labels the provider; Settings shows catalogue status, published count,
  last refresh and a manual refresh button.

### 12.5 Filter and map-code audit (1.5.9)

- Poliigon publishes two generations of map codes: convention 0 tokens (`COL`, `NRM`, `DISP`,
  `METALNESS`, `GLOSS`, `REFL`) and convention 1 PascalCase names (`BaseColor`, `Normal`,
  `Displacement`, `Metalness`, `Gloss`, `Reflection`). The catalogue now canonicalises both into
  one code per map during indexing (`src/shared/poliigon-maps.ts`), so facets no longer show
  duplicate labels and a map filter matches every asset that exposes that map.
- Catalogue schema is v9. Existing `poliigon-catalog.sqlite` files rebuild automatically; the
  published record count is unchanged (7,448 at the time of the audit).
- Filter facets show friendly labels and canonical order: Base Color, Normal, Roughness,
  Metalness, Gloss, Reflection, ORM, Ambient Occlusion, Displacement, Bump, Opacity, Mask, …
  Legacy values still resolve through the same canonicaliser.
- Physical-size filters and largest-first sorts are available for textures and models and hidden
  for HDRIs; the shared presets are `Up to 50 cm`, `50 cm – 2 m`, `2 – 5 m`, `5 m and larger`.
- Resolution facets sort numerically, map facets sort canonically, and the focused view uses the
  shared searchable filter workbench with independent scrolling for the group rail and values.

### 12.3 Live verification (2026-11-05)

- Browser sign-in persisted across an app restart: the encrypted token in
  `userData/poliigon-auth.bin` was reloaded and `/me` reported the same Business Unlimited
  account. `expiresAt` is null because the token is not a decodable JWT; a 401 from the API
  ends the session.
- Downloaded a free 2K texture: nine manifest files plus a generated MaterialX file. Preview
  at the asset root, maps and MaterialX in `2K/`.
- Downloaded a paid 256 texture under the Unlimited plan without a purchase call. Credits
  stayed at 0 and the drawer correctly showed "Included in plan".
- Live testing exposed a preview-detection bug: checking for preview suffixes as substrings
  misclassified maps for assets whose names contained `_Fabric`. Detection now uses filename
  suffixes, matching the addon.
- Shared completion history listed the Poliigon and Megascans downloads together; no renderer
  or transfer errors were logged.
- Library indexing: three Poliigon downloads appeared as `poliigon:<id>` records alongside the
  Megascans asset. Source filtering showed 3 Poliigon, 1 Megascans and 4 total. Local search,
  type/category filters, previews, sizes and `0` health issues were verified. A fourth download
  appeared automatically without a manual rescan.
- Local technical data reflects what is on disk: downloaded resolution (256/2K), local map
  count and local file/byte totals.
- Parity pass verified: ID/URL search, relevance ordering, recent searches, favorites and
  downloaded filters, related fabrics, model DCC/renderer controls, bulk selection and the
  Settings catalogue status. All checks still pass with no renderer errors.
- Render previews were blank because gallery images were built as `baseUrl/fileName`; Poliigon
  delivers them as Cloudflare variants (`baseUrl/2000px`). The drawer now loads a 2000×2000
  render, opens the full-screen viewer, and navigates with the render picker and previous/next
  asset controls.
- Category counts are distinct per subtree, so a parent count can be smaller than the sum
  of its visible children when assets sit in multiple child categories.
- Existing installs keep their Megascans folder in place and get a sibling `Poliigon`
  folder. Changing the root in Settings updates the paths but does not move existing files;
  a guided library move belongs with the local-library phase.

## 13. Risks and open questions

- **API stability.** `/all` and `/category/list` are undocumented and may change. Isolate
  them behind one module and fail gracefully with a cached catalogue.
- **Licence.** The addon is GPL. Keep the clean-room boundary explicit in reviews.
- **Terms of service.** Catalogue caching and repeated bulk downloads may be restricted.
  Prefer on-demand fetch, a bounded TTL (six hours for the public catalogue), respectful
  conditional/periodic checks and user-initiated downloads. Do not redistribute the
  catalogue or downloaded files.
- **Purchase policy.** Confirm that OpenBridge should support spending credits, and that
  it must always require explicit confirmation.
- **DCC import.** This plan delivers assets in a layout the official Blender addon reads.
  Native OpenBridge DCC import is a separate, larger phase.
- **Search.** Local FTS over 7.4k records is fast and avoids third-party keys; if Poliigon
  later removes `/all`, a hosted metadata pack would be required.
- **Attribution.** README and in-app credits should state that Poliigon support is an
  independent interoperability implementation and is not affiliated with or endorsed by
  Poliigon.
