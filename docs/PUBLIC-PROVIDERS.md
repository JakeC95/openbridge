# Additional providers (work in progress)

This expansion adds ambientCG, BlenderKit and OpenHDRI. The browsing, delivery and preview paths
are implemented, with explicit provider limitations below. It remains unreleased: authenticated
BlenderKit delivery still requires a real-account acceptance test.

## Architecture

- `src/shared/public-providers.ts`: shared summary, query, facet and delivery contracts.
- `src/main/public/catalog.ts`: transactional SQLite/FTS catalogue, stale-cache recovery and
  twelve-hour refresh TTL. An incomplete/empty replacement does not erase a working catalogue.
- `src/main/public/download.ts`: two-asset queue, delivery selection, existing transfer/resume and
  ZIP extraction utilities, persistent queue, completion history and offline metadata sidecars.
- Main IPC and preload expose a provider-validated namespace. Download IDs are
  `ambientcg:<id>`, `blenderkit:<assetBaseId>` and `openhdri:<slug>`.
- `src/renderer/public-store.ts`, `views/PublicView.tsx`, `components/PublicAsset.tsx`: focused
  browsing, inclusive Shift selection, local favourites, list/comparison, saved/recent searches,
  validated persisted filters, density, scroll/paging restoration, inspector navigation and
  delivery-variant controls.
- `src/renderer/public-taxonomy.ts`: mappings resolved against live provider category keys. An
  unsupported leaf is excluded, never broadened to all assets. The All view explains exclusions.
- `src/main/public/previews.ts` and `preview-data.ts`: genuine map previews, selective map extraction
  from ambientCG packages, high-resolution upgrades, linear HDR decode and tone-mapped panoramas.
  Preview transfers share the download telemetry channel but are excluded from queue/history.

Downloads stay under the configured per-provider library paths. Completed folders contain
`openbridge-<provider>.json`; these are indexed offline without requiring a provider account.
Partials without a completed sidecar are not indexed. The sidecar does not include download URLs,
signed credentials or account-specific raw API responses.

## ambientCG

Official references:

- <https://docs.ambientcg.com/api/v3/assets/>
- <https://ambientcg.com/api/v3/assets>
- <https://ambientcg.com/api/v3/categories>
- <https://docs.ambientcg.com/license/>

The public v3 API supplies asset types, tags, dimensions, map names, previews and download variants.
Requests use 500-asset pages sequentially and retain an offline catalogue. Ordinary public assets
are CC0. Supporter-token features are not implemented. Category IDs are matched longest-first
against the provider's asset-ID families, with type-constrained tag matching as a fallback. The API
does not publish a per-asset category field. Environment subgroups use explicit names/tags, not
weather alone. The live audit checks every mapped All-view branch against its resulting category,
type and weather constraints (44 ambientCG branches in the current catalogue).

Material sizes are converted from centimetres to millimetres. HDRI weather/time classifications are
metadata heuristics, not image analysis; interior/studio assets and flat HDRI elements do not receive
invented outdoor weather/time. HDRI elements are labelled separately and never forced into 360°.
The public preview metadata publishes direct LQ/HQ EXRs. These are decoded independently, without
running the provider's embedded viewer. A real live test decoded a 6,144 × 3,072 HQ panorama.

## BlenderKit

Official service and implementation references:

- <https://www.blenderkit.com/>
- <https://github.com/BlenderKit/blenderkit>
- <https://github.com/BlenderKit/bk_client>

Public searches use `https://www.blenderkit.com/api/v1/search/`. Structured tokens belong **inside**
`query`: `asset_type:model`, `asset_type:material`, `asset_type:hdr`, `asset_type:brush`,
`is_free:true`, `license:cc_zero`, `category:<slug>` and `asset_base_id:<id>`. Supplying an
`asset_type=...` URL parameter alone was observed to be ignored. Category trees come from
`/api/v1/categories/`. Search result counts may be capped at 10,000 by the provider.
Category unions use `category_subtree:<slug>,<slug>`, preserving parent/descendant membership.
Native-resolution and polygon filters use the provider's documented add-on query fields
`textureResolutionMax_gte/lte` and `faceCount_gte/lte`. Facets inferred from the loaded page are
marked as samples; the UI does not present them as global facet counts. Unsupported global
weather/time/physical-size filtering is rejected or explicitly excluded in the All view.
The live audit verifies 30 mapped BlenderKit branches against actual descendant category IDs,
and exercises native-resolution and polygon limits. Provider polygon counts are not substituted
for missing triangle counts in the shared comparison/triangle-sort fields.

Multi-type paging indexes concatenated type streams with a global offset. Cached/coalesced pages
are bounded and expire after five minutes. Metadata caches are bounded. Select-all operations
over 2,000 BlenderKit assets fail explicitly instead of silently returning a partial selection.

Free access is separate from licence: assets can use CC0 or royalty-free terms independently of
whether an account can download them. Download resolution uses the provider's published resolver;
no entitlement bypass or purchase operation is implemented. API keys are saved only when Electron
secure storage is available, and are sent only to validated HTTPS BlenderKit download endpoints.
The UI does not claim a saved key has been validated. Resolver requests include a random,
session-local `scene_uuid`, not a machine identifier. Published `filePaths[].url` and `filePath`
responses are supported; alternate sources are probed without credentials, with a bounded range
GET only when HEAD is rejected. Embedded-credential and non-HTTPS URLs are rejected. These protocol
paths and 403 entitlement errors are covered by fixtures. Authenticated free/paid delivery still
needs a real-account test; no user key has been used during this implementation.

HDR assets publish actual `.hdr`/`.exr` tiers which support exposure after legitimate authorization.
Public panorama thumbnails remain usable without a key. Native `.blend` material packages do not
publish individual browser-readable maps; the UI states that limitation instead of inventing them.
Delivery type and actual file extension remain separate so a selected native `.blend` is not
silently replaced by a resolution package.

## OpenHDRI

- <https://openhdri.org/>

No documented unrestricted catalogue API was established. This adapter reads the public home-page asset
links and asset pages, retaining only explicitly published download URLs. It does not invent a
download URL when markup changes. At most two detail pages are fetched concurrently. A parsing
failure preserves the previous catalogue. This HTML-based adapter needs monitoring for site changes.
The official [About page](https://openhdri.org/about) confirms CC0 asset use. The official
[Blender add-on](https://openhdri.org/blender-addon) and [Downloader](https://openhdri.org/downloader)
pages describe lower-resolution delivery through supporter tools. This implementation does not
guess private tier URLs, copy paid tool code or claim access to a supporter API.

The current public asset pages publish 16K EXRs, sometimes over a gigabyte each. The tier/name is
read from the actual published link, not hard-coded. Rounded website GB labels
are displayed as metadata, **not** used as exact download verification sizes. Capture clock times
are used where present. A live test reads/cancels the first EXR chunk rather than downloading a
multi-GB asset merely to validate its format. ambientCG's thumbnail set is a sphere render; its PBR
preview folder also publishes `_LQ.jpg` and `_HQ.jpg` panoramas beside the EXR viewer sources. Cards
use the LQ JPG (typically 1536×768, tens of KB), while the drawer and 360° view use the HQ JPG (up to
6144×3072). The EXR is decoded only for live exposure. These JPGs are cached locally, and the EXR
version query is dropped from the JPG URL so card thumbnails survive catalogue refreshes. OpenHDRI's
4:3 preview has material balls composited below a 2:1 environment, so
cards and drawer previews crop the content strip. The flat panorama preview is fetched as a 4096px
PNG built from the slug, which bypasses stale catalogue entries that still point at the old 512 AVIF
thumbnail. OpenHDRI's 16K EXR is download-only: live HDR exposure is capped at 8K for every
provider because a 16K decode/texture is too heavy for most systems and transfers over 1 GB. The UI
explains this and keeps the 4K tone-mapped panorama available. The renderer's connection policy is
not weakened to fetch arbitrary CDNs: posters are cached locally.

## Metadata coverage

The public drawers and comparison view use the provider payload rather than a lowest-common
denominator. ambientCG exposes relations (variations/previous/next), download statistics, colours,
collections, technique, maps, formats and per-resolution package sizes. BlenderKit exposes creator,
rating, verification, version, source app, bookmarks, video, file formats/sizes and provider
polygon counts. OpenHDRI exposes upload date, author, capture date, location, dynamic range, white
balance, file format, download size and a color-checker EXR. The technical panel hides geometry
rows that do not apply to an HDRI and uses a dedicated Source group for creator/licence/rating/
verification/version/source-app/download statistics. Related results use published ambientCG
relations when present, otherwise a provider category search. Existing SQLite catalogues reindex
with normalizer revision 4 so these fields appear without a manual refresh.

## Preview safety

Downloads are limited to 160 MiB per preview, both by descriptor/HTTP size and by decoded streamed
bytes (including compressed responses). EXR/Radiance dimensions are checked before decoder
allocation: no axis above 8K and at most 8K × 4K pixels for every provider. OpenHDRI's 16K original
is available as a normal asset download but is deliberately excluded from live HDR exposure; the
UI explains the 8K limit. Tiled/deep/multipart EXRs are rejected.
One HDR decodes at a time; one half-float source is retained in the main-process cache. Closing
an inspector cancels its pending transfers; late renderer responses cannot replace a newer asset.
Map ZIPs are not extracted wholesale: only the requested browser-readable member is streamed to
a controlled cache filename, with entry-size and traversal checks. Source fingerprints and a
twelve-hour file TTL prevent indefinite preview reuse. Large cached files are flushed on quit.

## UI parity audit (1.6.1)

The focused public-provider experience was compared feature-by-feature with Megascans and
Poliigon, and with the combined All view. The audit corrected real regressions and filled the
following gaps:

| Capability | Megascans | Poliigon | ambientCG | BlenderKit | OpenHDRI |
|---|---|---|---|---|---|
| Search, clear, recent searches | Yes | Yes | Yes | Yes | Yes |
| Saved searches | Yes | — | Yes | Yes | Yes |
| Catalogue/Library search scope | Yes | Yes | Yes | Yes | Yes |
| Type + live category tree | Yes | Yes | Yes | Yes | Yes |
| Multi-select filter workbench | Yes | Yes | Yes | Yes (sampled facets) | Yes |
| Per-group filter search / show all | Yes | Yes | Yes | Yes | Yes |
| Active-filter chips | Yes | Yes | Yes | Yes | Yes |
| Licence filter | — | Free | Yes | Yes | Yes |
| Resolution/map/model-format filters | Maps/LODs | Yes | Yes | Native resolution/polygons | Resolution |
| Physical-size filter | Yes | Yes | Yes | — (not published) | — (not published) |
| Sky condition/time | — | Yes | HDRI subsets | HDRI subsets | Yes |
| Free/favourites/downloaded scopes | Free/favourites | Yes | Yes | Yes | Yes |
| Sort | 7 loaded sorts | 11 server sorts | 9 server sorts | 3 server sorts | 9 server sorts |
| Grid/list/compare + density | Yes | Yes | Yes | Yes | Yes |
| Shift selection / select all filtered | Yes | Yes | Yes | Yes | Yes |
| Quick download/progress/pause on cards | Yes | Download | Yes | Yes (key-gated) | Yes (confirmed) |
| Drawer Overview/Technical/Download/Related | Yes | Yes | Yes | Yes | Yes |
| Genuine maps/high-res previews | Yes | Yes | Yes | Native package limitation | Public panorama |
| HDR exposure / 360° | 360° | Yes | Yes | Yes (authorised source) | 4K panorama; 16K download-only |
| Catalogue status/refresh | Metadata pack | Yes | Yes | Categories/live search | Yes |
| Account/key state in view | Epic | Poliigon | — | Yes | — |
| Library source/path/health | Yes | Yes | Yes | Yes | Yes |
| Provider labels in downloads | Yes | Yes | Yes | Yes | Yes |
| Start fresh/reset current source | Yes | Yes | Yes | Yes | Yes |

“Yes (sampled facets)” means BlenderKit facet options and counts are derived from the loaded search
page. They are labelled **sample** and are not presented as global catalogue counts. BlenderKit
physical size/maps are not filterable because its public search API does not publish a reliable
global facet for them.

### Corrections made during this audit

- Replaced single-value focused facet selects with the shared multi-select `FilterWorkbench`.
  Previously two selected values were collapsed to the first one and the others were silently lost.
- Added active chips for every public filter, including values inherited from All/viewed assets, so
  hidden constraints can always be seen and removed.
- Added Start fresh/reset handling for each public provider; previously it cleared Megascans state
  while leaving the visible public view unchanged.
- Added indexing/unindexed/error/loading states and skeleton cards. First-run ambientCG/OpenHDRI no
  longer looks like “no results”.
- Added BlenderKit key status to the shared store, card buttons, bulk actions and drawer. Downloads
  are disabled with an explicit Settings/entitlement explanation instead of failing after queueing.
  Authenticated catalogue requests now carry the key, with an anonymous fallback for invalid keys.
- Added BlenderKit/ambientCG/OpenHDRI card quick download, progress, pause/resume, HDRI card width,
  provider facts and access badges.
- Added drawer Related-by-category, clickable category/tag filters, grouped technical facts,
  file/variant labels, inline download errors, Previous/Next and Alt+Left navigation.
- Added provider indexing and focus/refresh actions to the All Sources menu; public downloads now
  preflight local/key/entitlement state, and Select all uses per-source `Promise.allSettled`.
- Included public assets in downloaded counts, saved-search round-tripping and the global Recent
  menu. Library empty states and type filters are now provider-specific.
- Changed shared download/storage labels from “Megascans” to the active provider.

### Genuine limitations (not imitated)

- BlenderKit free/paid **downloads** require a provider account/plan and API key; OpenBridge does not
  purchase assets or bypass entitlement checks. Real-account acceptance remains outstanding.
- BlenderKit native material packages contain the material inside the `.blend`; separate JPG map
  downloads are not published. The drawer states this rather than fabricating maps.
- OpenHDRI publishes 16K originals only. Live HDR exposure is disabled for its 16K EXR because every
  provider is capped at the safe 8K preview budget; the UI explains this and retains the 4K panorama
  preview. The original EXR remains available as a download. Its 4:3 preview contains material balls
  below the 2:1 environment, so cards, drawer previews and the expanded render use the cropped strip.
  The flat panorama preview is requested at 4096px PNG and constructed from the slug rather than a
  previously indexed preview URL. Bulk downloads warn about size.
- AmbientCG/OpenHDRI package downloads are provider-selected ZIPs/EXRs, not per-map or per-LOD
  manifests. The drawer presents real published variants rather than Megascans-style fictional
  map/LOD controls. AmbientCG HDRI cards use the real LQ panorama JPG, not the provider's sphere
  thumbnail; the HQ JPG powers the drawer/360 preview and the EXR remains the live-exposure source.
- Public provider Library folders are OpenBridge-managed downloads with sidecars. Arbitrary folders
  from other tools are not guessed/imported for these providers.
- Megascans packs, Epic acquisition/credits and Poliigon credit purchasing have no equivalent on
  these public sources and are not shown.

## Verification

```powershell
npm run check
npm run test:browsing
npm run test:network
npm run test:providers
npm run build
npm run test:browsing:ui
node scripts/check-public-repo.mjs --include-untracked
```

`npm run test:providers:live` is opt-in, contacts the providers, tests actual ambientCG EXR decode,
and transfers one small material to an isolated temporary library, which is removed afterward.
It must not run in normal CI.
Live catalogues observed during implementation: ambientCG 2,934 assets; OpenHDRI 60 assets.

## Remaining acceptance work

- Validate BlenderKit authenticated free and paid-plan downloads with the user's own account.
  Enter any key in Settings, not a chat or committed file. Saving a key alone is not validation.
- Perform a fresh portable-package smoke test before advertising a replacement build. The previous
  portable build has not been overwritten; no tag, commit, push or release was created here.
- Provider metadata limitations above remain explicit capabilities, not silently broadened filters,
  fabricated previews or promises to access supporter-only delivery endpoints.
