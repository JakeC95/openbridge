# Poly Haven provider

Poly Haven is OpenBridge's third content source. It is a public CC0 catalogue, so
there is no sign-in, entitlement call, credit balance or purchase flow. The
integration is a clean-room implementation of the public API; no GPL add-on code
or third-party artwork is bundled.

## Public API used

| Purpose | Endpoint |
| --- | --- |
| Asset summaries | `https://api.polyhaven.com/assets?t=hdris` / `textures` / `models` |
| Category counts | `https://api.polyhaven.com/categories/{type}` |
| Per-asset file metadata | `https://api.polyhaven.com/files/{id}` |
| Thumbnails | `https://cdn.polyhaven.com/asset_img/thumbs/{id}.png?...` and clean HDRI panoramas from `/asset_img/primary/{id}.png` |
| Downloads | the CDN URLs published by `/files/{id}` |

`/assets` returns an object keyed by the stable asset id. Type is numeric:
`0 = HDRI`, `1 = texture`, `2 = model`. Summaries expose name, categories,
category path, tags, description, authors, attributes, max resolution,
dimensions, polycount, texel density, publication date, download count and
thumbnail URL.

`/files` exposes maps and model packages:

- HDRIs: `hdri[resolution][hdr|exr]`, plus `tonemapped` and `colorchart`.
- Textures: named maps such as `Diffuse`, `nor_gl`, `nor_dx`, `Rough`, `AO`,
  `Displacement`, `arm`, and package entries such as `blend`, `gltf`, `mtlx`.
- Models: map entries plus package entries such as `blend`, `fbx`, `gltf`,
  `usd`; package values include the main file and an `include` object.

## Local catalogue

`polyhaven-catalog.sqlite` stores an FTS index of the three asset lists. After
the list refresh, a small worker pool fetches `/files/{id}` and caches
resolutions, map codes, image formats and model package formats. The cache is
tied to each asset's `files_hash`, so unchanged assets are not fetched again.

This makes resolution, map and type filters available locally without hitting
the API on every search. Background metadata progress is reported through the
catalogue status channel and is also shown in Settings.

## Time of day

Poly Haven publishes an explicit `attributes.time_of_day` value for most HDRIs
(`sunrise`, `morning`, `midday`, `afternoon`, `sunset`, `dusk`, `night`). It is
mapped into the same 0–24 hour window as Poliigon and shown through the shared
dual-handle falloff slider. HDRIs without the attribute fall back to the shared
name/tag/category estimator.

## Previews

- HDRIs use the clean `asset_img/primary/{id}` panorama for card and drawer
  thumbnails instead of the square composition with preview spheres and a
  checker floor.
- Texture and model map previews are downloaded at the smallest published
  resolution (usually 1K) and cached under the temporary preview cache. The
  full-screen viewer upgrades a map to its highest published resolution.
- HDRIs use a tone-mapped preview image for the flat/360 view. The HDR entry
  downloads the highest practical published Radiance `.hdr` (or EXR) source up
  to 8K, decodes it and drives the same half-float WebGL ACES exposure pipeline
  as Poliigon. The 8K ceiling keeps a 24K source from exhausting memory.
- Card thumbnails resolve through a shared alpha/flat-background bounds cache,
  so transparent renders and product renders on a plain backdrop are cropped to
  the real subject instead of leaving large empty margins.
- Temporary preview transfers use the normal download-progress channel but are
  excluded from download history and flushed when the app quits, except for
  thumbnail-sized files.

## Filters

The focused view exposes resolution, map, category-tag, collection and
type-specific attribute filters: weather/lighting/contrast/environment/sky
visibility/season/backplates for HDRIs; surface use/origin/setting/condition/
aerial for textures; and material/condition/rigged/LODs/geometry nodes for
models. Values and counts are indexed from the catalogue and presented through
the same searchable filter workbench used by the rest of the app. HDRI
time-of-day uses the falloff slider instead of a duplicate attribute group.

Models additionally expose a physical-size filter (`Up to 50 cm`,
`50 cm – 2 m`, `2 – 5 m`, `5 m and larger`) and a largest-first physical-size
sort; both are hidden for HDRIs and textures, which do not publish dimensions.
Resolution facets sort numerically and map facets use the canonical map order,
so the list reads the same way in the focused view and the All source scope.
Filters that do not apply to the selected type are removed, and size bounds are
cleared automatically when switching away from models.

## Metadata

The drawer exposes the full provider metadata: description, authors and roles,
categories, tags, collections, publication date, downloads, dimensions,
polycount, texel density, all HDRI attributes, EV range, white balance, capture
date and coordinates, vault, model requirements, category id, file hash and the
raw `/files` manifest.

## Downloads and library layout

Assets are written to `polyhavenLibraryPath` (default
`Documents\OpenBridge\PolyHaven`), one self-contained folder per asset id:

```text
PolyHaven/
  raw_wooden_floor_01/
    raw_wooden_floor_01_Diffuse_1k.jpg
    raw_wooden_floor_01_nor_gl_1k.jpg
    ...
    preview.png
    openbridge-polyhaven.json
  ArmChair_01/
    ArmChair_01_2k.gltf
    ArmChair_01.bin
    textures/...
    preview.png
    openbridge-polyhaven.json
  highway_bridge_sunset/
    highway_bridge_sunset_2k.hdr
    preview.png
    openbridge-polyhaven.json
```

The metadata record keeps the local Library useful offline even if the public
catalogue is unavailable. Folders created by other tools are matched to the
catalogue by folder id or asset name.

## UI integration

Poly Haven appears in the All source scope, in its own focused Discover view,
in the source switch, in search, taxonomy filters, cards, drawers, previews,
bulk selection/downloads and the local Library source filter. Its collections
and category tags are exposed as facets, and provider identity uses the official
Poly Haven mark from `polyhaven.com/Logo%20256.png` (see
`src/renderer/providers/NOTICE.txt`).
