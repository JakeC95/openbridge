# Agent handoff

## Project

OpenBridge is a public, open-source Windows x64 app for browsing, downloading and managing a local
content library. Its first provider is Quixel Megascans; Poliigon catalogue browsing is implemented
as a second provider (auth/downloads still in progress). It is an Electron 45 + React 19 + TypeScript
application using `node:sqlite`, esbuild, FTS5 and a portable-only distribution model.

- Branch: `main`, tracking `origin/main`
- Last verified application commit: `6caa6b2` (tagged `v1.6.2`)
- Current app version: `1.6.2`
- Latest published release: `v1.6.2`
- Repo visibility: public
- Distribution: portable ZIP only; no installer, Linux or macOS build
- The repository owner/name is discovered at build time and must not be hard-coded

Changes after `v1.4.2` shipped in `v1.6.2`. Choose the next version when new work is ready to publish.

## 1.6.2 additional providers and browsing pass

- Version 1.6.2 packages ambientCG, BlenderKit and OpenHDRI alongside Megascans, Poliigon and
  Poly Haven. It was released from commit `6caa6b2`; see the release status section for the
  verified CI asset details.
- A Three.js 0.187 3D viewer is now integrated for local and catalog assets. glTF/GLB, FBX,
  OBJ/MTL, USD/USDA/USDC/USDZ, STL, PLY and DAE load directly; ABC resolves to the provider's
  published FBX/Alembic alternative, and native `.blend`/`.max`/`.c4d`/`.ma`/`.mb`/`.skp` remain
  download-only with an explicit message. The inline viewer defaults to the lowest texture tier
  (1K where published) and the lowest mesh LOD, except 3D plants which default to the highest
  mesh LOD. Full screen upgrades to at most 4K automatically when the estimated transfer stays
  within 250 MiB and the known mipmapped texture maps within 512 MiB; 8K stays an explicit user
  choice. Embedded textures and driver overhead cannot be estimated from the manifest. A single bundled Poly Haven CC0
  `monochrome_studio_02_1k.hdr` studio environment lights every preview. There is no auto-rotate;
  clicking the inline canvas opens full screen and Escape or the close button returns.
- Global search is typeahead-first. The topbar search debounces catalogue requests at 140 ms, keeps
  the previous result page visible while the new query resolves, and shows an `Updating` spinner
  instead of blanking or flashing skeletons. A fast local suggestion layer queries Poliigon, Poly
  Haven, ambientCG, OpenHDRI and the local library after 60 ms and returns ranked quick matches in
  roughly 85–130 ms and updates progressively as each local provider responds; Megascans and
  BlenderKit remain on the full all-source search. The quick panel
  supports recent searches, starter queries, provider/type/thumbnail rows, arrow-key navigation,
  Enter to search, and Enter on a highlighted row to open it directly. Typing any printable
  character outside an input focuses the search bar and starts a query. Quick suggestions are
  hidden while provider or local filters are active so they cannot contradict the filtered grid.
- Cross-provider relevance is no longer provider round-robin. All-source relevance scores text
  matches in names/tags/categories, provider-native rank, popularity, free licensing, query intent
  (HDRI/material/model), and whole-object specificity (stumps, branches, trunks, bark, GOBOs and
  LOD/season duplicates are demoted). Duplicate names and repeated providers are lightly diversified
  so the first page is not five copies of one catalogue entry. Poliigon numeric IDs and asset-page
  URLs resolve directly, and empty facet requests no longer ask Algolia for every facet bucket.
  `search-ranking.ts` has regression coverage in `test:browsing` (24 checks). Search acceptance:
  quick matches appeared at 86 ms in the source viewer and 126 ms in the packaged build; keyboard
  navigation opened Dining Chair 02; the full `tree` page mixed BlenderKit, Poly Haven, Megascans
  and ambientCG results; and Poliigon `7852` plus its asset-page URL both resolved directly.
- Windows responsiveness pass: quick matches skip facet buckets and local Library browse
  categories/packs. Local public-catalogue searches rank the joined FTS match set in one pass
  instead of running a separate FTS lookup for each result. On a Windows copy of the ambientCG
  index, the warm median for `s` dropped from ~665 ms to ~18 ms with facets, ~9 ms without
  (database time). Poliigon and public HDR decoding share one cancellable worker queue to bound
  peak decode memory. The 3D viewer reuses its studio environment across tier changes, coalesces
  draws to one per frame, caps framebuffer pixels on high-DPI screens, and disposes the GPU
  context on close. The Windows Electron UI fixture verifies lighting reuse and context release.
- Follow-up Windows responsiveness pass: Library scans share one writer and discard results from
  obsolete roots. Completed downloads batch their paths across providers and refresh the index
  incrementally, including re-downloads whose folder times stay unchanged. Manual full refresh
  remains available. Global search diversifies the first 120 results and keeps the remaining
  results in relevance order instead of re-running the full diversity loop on every page.
- Windows UI audit: asset titles stay visible in catalogue and Library grids; public-provider cards
  use the shared metadata overlay rather than clipping text below the image. Failed thumbnails
  try the original/fallback source and then show a placeholder. List/compare actions live in
  browse toolbars, and public saved-search editors are collapsed by default. Global quick matches
  keep keyboard selection by asset ID as providers respond, respect scoped filters and leave
  composition keys to the IME. Fullscreen previews contain focus, restore it on close and retain
  the working 3D model when a requested quality/LOD manifest fails.
- The Windows window can now resize to 1024 px wide. Compact workspaces use a 224 px sidebar
  (208 px at 1060 px and below), shorter navigation/topbar and tighter gutters; provider names
  remain visible. The inspector follows the topbar edge. Public-provider primary controls fit
  on one row at 1024 px. Verified in the Windows app and covered by the Electron layout fixture.
- Provider entries now toggle inclusion in the combined Discover view instead of immediately
  switching to a focused view. Disabled sources are dimmed/struck through, excluded from search,
  quick suggestions, counts, facets, paging and select-all, and are persisted. The All button or
  Restore all clears exclusions; the Sources menu still opens a focused single-provider view.
- Surface assets now have a **Sphere** preview in the drawer. It reuses the 3D viewer's
  manifest/material/UV/map pipeline with a six-face cube-sphere (equal texel density, no pole
  pinch), applies every published map (including real vertex displacement with a 0–200% strength
  control), always exposes a texture-tier selector and loads higher provider tiers on demand where
  the drawer already signs high-resolution previews. It supports the inspector channels and
  full-screen focus handling, and is available for local Megascans maps plus ambientCG, BlenderKit,
  Poly Haven and Poliigon texture previews. Wireframe displaces the actual sphere geometry on the
  CPU, then rebuilds the lines, so it shows the generated surface shape rather than the smooth base
  sphere. Matcap uses the displaced geometry for both surfaces and 3D assets rather than the raw
  undeformed mesh, and leaving matcap restores the base geometry. HDRIs stay on their panorama
  viewer. The Render/Maps/Sphere switch remains available inside
  full-screen image and sphere viewers, and the equivalent Render/Maps/3D switch stays inside the 3D
  full-screen viewer, so changing mode no longer requires closing full screen first.
- Catalog preview downloads are cache-only under `userData/model-previews`, use the provider's
  signed/entitled endpoints, and are pruned as a rolling 2 GB LRU. Megascans now requests the
  selected 1K–8K/LOD tier through the account's `v1/downloads` signing path, exposing LOD0–5 for
  props and LOD0–7 for plants, using the atlas maps from `asset.maps`; plants use Var1 so a
  preview shows one coherent plant rather than eight stacked variations. If the account cannot
  fetch the requested tier, the reference 1K/LOD0–1 preview is cached with a persisted
  `.preview-meta.json` marker so the UI stops advertising unavailable tiers after restart. Poly
  Haven downloads the glTF package plus include maps; ambientCG extracts the LQ OBJ/MTL package;
  BlenderKit resolves a runtime file; Poliigon requests a Generic runtime package through
  `/assets/download`, filters maps to the selected resolution/LOD, and uses
  `specifications.meshes` to distinguish true assemblies (plant + pot, no row layout) from
  variant collections (candle stages, row layout). USD layers whose materials reference absolute
  authoring paths fall back to the local/manifest maps.
- Texture selection is LOD-aware. The scanner records LOD tokens from filenames; exact-LOD maps
  win, then generic master maps, then the nearest labelled LOD. Resolution and format are chosen
  within that LOD pool (JPEG first for colour, lossless PNG/EXR first for data maps). This covers
  Megascans `_LODn` normals/albedo, Poliigon `_LODn` maps and local DCC exports.
- Multi-material meshes are resolved per source slot. The viewer derives the published material
  prefixes from filenames, then matches each mesh's original material name (and object/parent names
  as fallbacks) to those prefixes. A single FBX can therefore use a different texture set per
  material slot; material arrays are preserved when assigning PBR and map-inspection materials.
  Missing map types for a resolved material never borrow another material's maps, which prevents a
  trunk or pot from receiving a leaf mask. Poliigon's Large Fraser Fir tree is the fixture: one
  LOD4 FBX has `Trunk01` (trunk and branches) and `Needles01` materials, and now renders the trunk
  and branches with the bark set and only the needles with the foliage/alpha set. Bit-depth tokens
  such as `NRM16` and `DISP16` are treated as map tokens instead of material-key suffixes, avoiding
  phantom material groups. The inspector's channel list and per-map views operate over every
  material slot.
- The wireframe toggle replaces every mesh material with flat black and overlays white
  `WireframeGeometry` lines. It survives LOD/quality reloads and restores/disposes cleanly. The
  camera frames the bounding sphere with an aspect-aware margin instead of a fixed max-axis
  distance. The full-screen exposure control is now in linear EV from -10 to +10 (default 0),
  applies `2^EV` to `toneMappingExposure`, shows the exact EV value and includes Reset exposure,
  matching the HDR viewer. It no longer passes a raw slider value as exposure.
- Navigation follows Autodesk Maya's button mapping: LMB orbit, MMB pan, RMB/Alt+RMB dolly, and
  the Alt+LMB/MMB combinations behave identically. The right-button dolly is a custom horizontal
  drag handler: dragging right dollies in, dragging left dollies out, and vertical movement does
  not zoom. This replaces OrbitControls' vertical RMB interpretation and is clamped to the current
  min/max camera distance. Mouse wheel zoom is unchanged. Shift+RMB drag rotates the bundled studio
  environment and the light rig together, Substance Painter style, with a live environment angle
  readout and Reset environment. Inline click-to-expand ignores drags longer than four pixels, so
  orbiting the inline preview no longer opens full screen.
- Texture and LOD switches are non-destructive. The select shows the requested tier immediately, but
  the live viewer keeps its applied manifest/quality/LOD until the new manifest is ready. If the
  switch takes longer than one second, a centered status overlay appears with the exact operation
  (`Loading 8K textures…`, `Loading LOD4 mesh…`, etc.) and `Downloading and preparing the selected
  files…`; the old preview stays visible underneath. Cached switches that finish under one second
  show no overlay and do not flicker. This applies to both the inline preview and the full-screen
  quality bar. The old `loading 4K` head note was replaced by this pending-switch status.
- Foliage alpha handling was audited and fixed. Poly Haven glTF packages can omit the separate
  alpha sheet from their embedded material; the viewer now downloads the published alpha/opacity
  map for the selected tier and applies it to glTF materials that have no alpha map. Alpha sheets
  are matched to material names so a leaf mask is not applied to a pot. Custom foliage uses
  alphaTest 0.35 with alpha-to-coverage; patched glTF foliage uses 0.5. The separate alpha sheet
  is now uploaded with `flipY=false` for glTF/GLB, matching GLTFLoader's convention for the
  material's embedded textures. Previously it used TextureLoader's default `flipY=true`, which
  mirrored the mask vertically and produced black jagged leaf borders after the alpha sheet was
  added; disabling the flip removed them at the same extreme close range. Texture caching keys
  now include colour space and flip orientation so one bitmap cannot be reused with the wrong
  sampling convention. Didelta Spinosa was the regression fixture, and Potted Plant 01 was
  rechecked to confirm its leaf mask stayed on the leaves while the pot stayed solid.
- The custom PBR material consumes every applicable published map: base colour, normal (GL/DX),
  roughness, metalness, AO, packed ORM/ARM, opacity, emissive, specular colour, gloss, displacement
  and translucency. Gloss is inverted into roughness when roughness is absent; displacement is a
  bump fallback when no normal map exists; translucency drives thickness/transmission. Missing maps
  use neutral fallbacks: roughness 0.55, metalness 0, white specular at intensity 1, mid-grey base
  colour, no emission. Poliigon multi-part sets download the maps for every selected part and
  assign a material per part. Local Poliigon folders are grouped into same-LOD assemblies (up to
  four parts for the candle fixture) and use the same per-part material path. TGA maps decode
  through Three's `TGALoader`; TIFF/DDS/KTX2 are not advertised to the preview texture path so an
  unsupported sidecar cannot break an otherwise usable set.
- The full-screen viewer includes a Sketchfab-style Model Inspector. It offers PBR, Matcap, UV
  Checker and Vertex Normals display modes plus one button per published map channel discovered
  from the loaded materials and manifest: base colour, metalness, roughness, normal, opacity,
  emissive, specular F0, AO, packed ORM/ARM, gloss, displacement and translucency. Packed ORM/ARM
  views isolate the selected channel as R=AO, G=roughness and B=metalness. Map views use cloned
  textures and a channel shader so the raw published map is visible; Map and Matcap/UV/Normal
  modes are mutually exclusive with Wireframe, while Single Sided is independent. PBR restore
  returns the original per-slot materials, including material arrays. Every downloaded published
  map is inspectable even when the PBR shader would skip it, such as displacement alongside a
  normal map or gloss
  alongside roughness, so the inspector channel list matches the provider payload.
- 3D acceptance now includes a cross-provider audit of 14 assets: Megascans rocks/cobblestone
  (4K/LOD0 plus 1K/LOD5), Xeric Grass and Silvery Glade Fern (1K–8K, LOD0–7, Var1, opacity,
  translucency and specular), Poliigon Monstera/Plantain Lily (1K–8K, 2K maps verified, plant +
  pot assembly, per-part materials), Poliigon microwave (metalness/roughness), Poliigon candle
  set (four variants, LOD0–4, per-part maps), Poliigon Large Fraser Fir tree (LOD4/8K, one FBX
  with Trunk01 bark for the trunk/branches and Needles01 foliage), Poly Haven Potted Plant 01 /
  Ceramic Pot / Ceramic Vase 03 (glTF, auto-4K, leaf/pot materials), ambientCG 3D Apple 002 /
  3D Bread 013 (USDC, 1K–4K), and BlenderKit's no-key error. Controls were checked against provider metadata:
  Megascans plants expose 1K–8K + LOD0–7, props 1K–8K + LOD0–5, Poliigon exposes the provider
  resolution tiers and any LODs, Poly Haven exposes 1K–8K where published, ambientCG exposes
  its LQ package tiers, and no-key BlenderKit shows the explicit API-key error. Exposure was
  checked at -10 EV (near black, not blown out), 0 EV and the EV readout. Maya dolly was measured
  in the source viewer: Alt+RMB dragging right reduced camera distance from 689 to 326, dragging
  left returned it to 689, and vertical drag left it unchanged. The packaged tree smoke test
  confirmed the same direction visually (right drag enlarged the tree, left drag returned to the
  exact default screenshot) with no page errors. Shift+RMB environment spin moved the environment
  angle from 0° to 73°, and Reset environment returned it to 0°. The packaged LOD4/8K Fraser Fir
  displayed bark on the trunk and branches with needle foliage, and source instrumentation
  confirmed `Trunk01` bark for trunk/branches and `Needles01` foliage. Texture/LOD switch loading
  was measured: Didelta 4K→8K showed `Loading 8K textures…` at 1,061 ms and completed after 9.8 s;
  the packaged Potted Plant 4K→8K check showed the same label at 1,055 ms and completed after
  16.8 s; a cached candle LOD3→LOD2 switch completed in 508 ms with no overlay; the inline
  LOD0→LOD4 switch showed `Loading LOD4 mesh…` at 1,027 ms. Didelta Spinosa was checked
  at 4K close
  range with no black leaf borders, and Potted Plant 01 was checked to confirm the leaf alpha
  sheet did not cut the pot. Inspector acceptance covered the four-part Poliigon candle set
  (Base Color, Metalness, Roughness, Normal, AO and Translucency; per-part maps across all four
  parts), the two-part Monstera planter at auto-4K, and Xeric Grass as the custom-material
  Megascans plant (Base Color, Roughness, Normal, Opacity/Alpha, Specular F0, AO, Gloss,
  Displacement and Translucency). PBR, Matcap, UV Checker, Vertex Normals, Single Sided,
  Wireframe and PBR restore were checked, including the packaged Didelta modes. Local Poly Haven
  previews still show only the tiers physically present in the local folder; local Megascans
  ABC-only previews use the full provider tier set. Remaining gaps: real-account BlenderKit 3D
  delivery, per-variation plant selection (Var1 is used), and local-only tier expansion for
  providers other than Megascans.
- Focused browsing now uses a themed filter panel rather than unstyled native selects. The blank
  white controls were a real CSS bug: `.select-dropdown` styles the custom `Dropdown` wrapper, not
  plain `<select>` elements. Native selects now use `.native-select`, and the app declares a dark
  `color-scheme`. The Electron regression asserts non-white backgrounds and visible text.
- Combined Discover now adds ambientCG/BlenderKit/OpenHDRI licence, resolution, map, model-format
  and sky-condition groups. Their selections participate in active-filter counts, clearing, saved
  searches and filtered source totals. Provider-specific All filters stay absent for unsupported
  metadata instead of being broadened.
- Additional provider browsing gained list/comparison (with technical data), density, independent
  scroll restoration, saved/recent searches, inclusive Shift selection, inspector previous/next and
  favourites. The provider switch handles seven sources without horizontal overflow and gives each
  new source its own active accent. Provider wordmarks are neutral text tiles, not third-party art.
- Settings includes all provider library paths, per-provider catalogue status/refresh, and a
  BlenderKit API-key test against the provider `/me` endpoint. The key is encrypted and never
  printed; a successful test shows only the account display name and plan. A saved key is not
  claimed valid until this test succeeds.
- Previews: ambientCG cards use the published LQ JPG panorama that sits beside its EXR preview
  sources instead of the sphere-render thumbnail; the drawer/360 uses the HQ JPG, and live exposure
  decodes the EXR only on demand. BlenderKit's square render thumbnail is never treated as
  equirectangular. OpenHDRI's 4:3 preview is requested
  as a 4096px PNG and cropped to its real 2:1 environment strip for cards/drawers; the URL is built
  from the slug so older catalogues cannot fall back to the 512 AVIF thumbnail. Live 360° exposure
  is capped at the 8K preview budget for every provider; OpenHDRI's 16K EXR is download-only and
  the UI explains why it cannot be decoded live. Closing the viewer no longer cancels the drawer's
  preview request, and cancellation/AbortError responses are not shown as retryable errors. Flat
  HDRI elements stay flat. Map facets and technical
  labels are humanised; provider polygon counts are not relabelled as triangles.
- Provider metadata now uses the full published payload in All-mode drawers, list/comparison and
  downloads: ambientCG relations, download statistics, collections, colors and technique; BlenderKit
  ratings, verification, version, source app, video/filesize/formats and bookmarks; OpenHDRI upload
  date, author, capture/location/dynamic range/white balance, file format and the optional
  color-checker EXR. Technical panels hide non-applicable geometry rows for HDRIs and surface
  assets, and the related tab uses provider-published ambientCG relations when available.
- Downloads: full completion history now merges all providers rather than dropping the shorter
  provider list. Library sidecars use the real preview image extension, native BlenderKit material
  packages do not raise false missing-texture warnings, and health output lists every provider path.
- Deep UI parity audit completed against Megascans/Poliigon. Focused provider facets now use the
  shared multi-select `FilterWorkbench` with active chips; Start fresh, catalogue indexing/error/
  empty/loading states, card quick download/progress/pause, HDRI card width, saved-search scope,
  global recent assets, provider-filter round-tripping, Related tab, grouped technical data,
  clickable category/tag filters, inline download errors and Alt+Left navigation were added.
  BlenderKit key state is shared in the renderer and gates card/bulk/drawer downloads; authenticated
  searches include the key with an anonymous fallback if it is rejected. All Sources now exposes
  public provider focus/refresh and indexing states. Select-all isolates per-source failures, and
  downloads preflight local/key/entitlement state. Library empty states/types, download/storage
  labels and Settings catalogue wording were corrected per provider.
- Known acceptance gaps: real-account BlenderKit free/paid delivery has still not been executed;
  its protocol/alternate CDN/entitlement fixtures pass. BlenderKit facets remain sampled and are
  labelled as such. Public libraries index only sidecar-backed OpenBridge downloads. OpenHDRI is
  16K original is download-only because live exposure is capped at 8K for every provider; the UI
  explains this and keeps the 4K panorama available. Public provider bulk defaults remain provider-tier
  based rather than full per-map/LOD plans, because those sources don't publish such manifests.
  See `docs/PUBLIC-PROVIDERS.md` for the parity matrix and exact remaining checks.

## 1.5.10 HDRI category and filter pass (unreleased)

### Three-provider expansion — implemented, acceptance still pending

- ambientCG, BlenderKit and OpenHDRI adapters plus shared catalogue/download types are under
  `src/main/public/` and `src/shared/public-providers.ts`. They are wired through main IPC,
  preload, source switching, focused browsing, the All grid, download routing and offline Library
  sidecars. Provider paths and encrypted BlenderKit API-key entry are in Settings.
- Run `npm run test:providers` for isolated catalogue, pagination, download and Library fixtures;
  `npm run test:providers:live` additionally audits real catalogues, downloads/extracts one small
  ambientCG material and checks an OpenHDRI EXR header without a multi-GB transfer. The Electron
  UI test now includes focused browsing, licence display and download routing for all three.
- The second pass implements genuine HDR/map previews, safe high-resolution upgrades, shared
  transfer telemetry and cancellation, explicit flat HDRI-element handling, saved/recent browsing,
  list/comparison, density, range selection, paging/scroll state and inspector navigation. The UI
  regression caught and fixed a real queued-state Shift-anchor bug and a scroll-container CSS
  specificity bug; it also verifies source-file caching rather than weakening renderer CSP.
- Artist categories now resolve from live provider keys; the live audit checks 44 ambientCG and
  26 OpenHDRI and 30 BlenderKit mapped branches. Unsupported category leaves remain empty with an All-view note.
  BlenderKit native-resolution/polygon query fields and category unions are implemented. Sample
  facets are not labelled as global counts; search API caps are disclosed.
- Preview limits: 160 MiB transfer, 8K maximum axis and at most 8K × 4K pixels for every provider.
  OpenHDRI's 16K original is available as a download but is not decoded for live exposure; the UI
  says so and retains the 4K panorama preview. Lower OpenHDRI tiers are advertised for supporter
  tools; no private tier URLs or paid tool code were used. BlenderKit native material packages do
  not expose separate maps; that is stated in UI.
- **Remaining acceptance:** real-account BlenderKit free/paid download tests and a fresh portable
  smoke test. The resolver protocol/alternate-CDN fallback/credential isolation is fixture-tested,
  but no real key has been used. Do not claim those authenticated tests passed.
- No credentials, tag, commit, push or release were created by this expansion. The existing portable
  1.5.10 build remains unchanged. Protocol details and remaining work: `docs/PUBLIC-PROVIDERS.md`.

- HDRI category setup rebuilt from the live provider taxonomies. Poly Haven publishes a
  three-level `category` field (12 environment roots, 41 second-level groups, 153 leaves); the
  combined Discover sidebar attaches those live children at runtime and groups them under
  **Skies & Skyboxes**, **Nature & Landscapes**, **Urban & Built**, **Interiors**, **Studio** and
  **General Environments**. Poliigon Arid/Coastal/Environment/fields/Industrial/Sky/Urban map into
  the matching branches. Dynamic Poly Haven leaves are generated from `polyhaven-categories`, so
  new provider leaves appear without hard-coding every path.
- HDRI weather is now a canonical dimension. Poly Haven uses the published
  `attributes.weather`; a weather filter always implies `environment=outdoor`, so indoor/studio
  captures tagged `clear` or `overcast` cannot leak into sky results. Poliigon derives a
  `weather` value at index time from name/tags/categories (`src/shared/sky-conditions.ts`) and
  exposes it as a facet and query filter. `poliigon-catalog.sqlite` schema is v10; existing v9
  databases migrate in place and backfill weather without a network rebuild. An all-null weather
  column is also repaired on startup (guards against an older binary refreshing the shared file).
- HDRI category trees and filters now use weather instead of contradictory provider tags:
  Poly Haven flat `clear`/`partly cloudy`/`overcast` category tags are hidden for HDRI browsing,
  and Poliigon's raw `Sky > Clear/Partly Cloudy/Overcast` branches are hidden in the focused
  view. Both focused views expose a normalised **Sky condition** facet. **Clear / Sunny Day** is
  clear + 07:00–17:00; **Clear Skies** is all clear. A curated time preset is cleared when moving
  to a sibling sky condition without a window.
- HDRI filter presentation: Megascans groups are hidden, provider filters are ordered Sky
  condition first, the type dropdown stays at the top-level type (HDRIs) while the category
  tree/chip carries the subcategory, and cards show resolved weather + time. Poly Haven FTS
  refresh now recreates the contentless FTS5 table instead of issuing an unsupported DELETE.
- Verified against live catalogues: Poly Haven 997 HDRIs (outdoor weather Clear 270, Partly 315,
  Overcast 119, Fog 11, Rain 3, Snow 1); Poliigon 342 HDRIs (Clear 130, Partly 111, Overcast 42,
  Fog 23, Rain 1). Every weather, environment, sky-view, backplate, season, contrast, light,
  resolution, category, time and combined AND filter was queried against real catalog data.
  `npm run check`, `npm run build`, `npm run test:browsing`, `npm run test:browsing:ui` and the
  live Electron UI smoke test pass. No tag or release has been created.

## 1.5.9 workspace pass (unreleased)

- Poly Haven provider added (unreleased): third public CC0 source with a local
  SQLite/FTS catalogue built from `/assets?t=hdris|textures|models`, background
  `/files/{id}` enrichment keyed by `files_hash`, type/category/resolution/map/
  collection facets, sort, search and explicit HDRI time-of-day. It is wired
  into the default All source scope, a focused Discover view, search, cards,
  drawers, map previews, live HDR/360 previews, downloads, bulk selection and
  the local Library. No account, API key, credits or entitlement checks are
  used. Downloads are public CDN files written into self-contained folders with
  `openbridge-polyhaven.json`; the local Library scans both those records and
  folders created by other tools. Clean-room protocol notes are in
  `docs/POLYHAVEN.md`. HDRIs use the clean primary panorama for card/drawer
  thumbnails, the drawer exposes the full attribute/file metadata, and live
  exposure uses the highest published HDR tier up to 8K to stay within memory.
  Catalogue and library thumbnails now share an alpha/flat-background bounds
  cache that crops transparent or plain-backdrop images to the real subject.
- Poliigon provider started (unreleased): provider switch, public catalogue index, category
  search/filters and read-only asset drawer. See `docs/POLIIGON.md` for the protocol research
  and phase plan. Phase 1 stores `poliigon-catalog.sqlite` in user data and needs no Poliigon
  account, third-party search key or telemetry. Phase 2 adds browser sign-in, DPAPI token
  storage, profile/credits and owned-asset badges. Phase 3 adds manifest requests and
  addon-compatible downloads into the Poliigon library. Free assets still require sign-in.
  Live-tested with a Business Unlimited account: token survives restart, free and paid
  (unlimited) assets download without a purchase call, and the on-disk layout matches the
  addon. The public catalogue is re-checked at startup, on window focus and every two hours,
  refreshing the index once it is six hours old (with a fifteen-minute retry cooldown after a
  failure) so newly published assets appear during a session; Megascans stays live per query.
  Phase 4 indexes both libraries with a `provider` column (index schema v8), derives
  local Poliigon previews/resolutions/maps/LODs from disk, exposes an All/Megascans/Poliigon
  Library source filter and opens local Poliigon records in the Poliigon drawer. Completed
  downloads trigger an automatic rescan. Library is strictly local disk contents and works
  offline regardless of subscriptions. The topbar **Check library** action only audits acquired
  assets against local disk; it never downloads missing assets or estimates/queues bulk data. The parity pass adds ID/URL/description search,
  relevance sorting, recent searches, local favorites, downloaded badges/filter, related
  assets, clickable categories/tags, list/compare view, bulk selection/download, Common/All/None
  map presets, DCC/renderer selection, remembered download defaults, Megascans-shaped drawer
  tabs/footer and catalogue status in Settings. Poliigon render previews use the Cloudflare
  `2000px` variant; the drawer supports expand/full-screen viewing and previous/next assets.
  The presentation pass adds the shared Relative size panel for models, a Megascans-style
  technical grid, tab-aware scrolling, a Catalogue/Library search scope, single-mesh handling
  and polycount-based triangle counts. Discover now defaults to an **All** source scope that
  merges Megascans and Poliigon results in one grid/list. A curated cross-provider taxonomy maps
  both category trees into one tree: 3D Assets, 3D Plants, Surfaces, HDRIs, Atlases, Decals,
  Brushes, Imperfections and Displacements, with shared subtopics such as Architecture,
  Furniture, Food & Drink, Rocks & Terrain, Wood & Flooring, Ground & Nature and Houseplants.
  Provider type/category filters are applied behind each unified node, including OR-based
  Megascans category paths and resolved Poliigon category IDs. Queries and pagination run
  against both catalogues, and the combined view reuses each provider's facets, counts, cards,
  drawers and download pipelines, plus size, free/favorites/downloaded filters, saved searches,
  recent searches and recently viewed assets, Megascans pack browsing, scroll restoration and
  bulk selection. Megascans and Poliigon remain selectable as focused views.
- Preview and technical UI consistency: both Render and Maps preview modes have previous/next
  arrows with bounds state. Technical panels share one canonical field order across providers
  (dimensions, resolution, maps/formats, workflow, LODs, triangles, meshes, status, dates),
  show Max resolution and Map formats whenever the provider exposes them, and use LOD counts.
  Megascans now also shows Resolutions/Default resolution, Catalogue ID, Texture maps,
  per-LOD triangle counts, physical size and Asset ID; it gained the missing favourite action
  and the download-destination note. Asset-type labels use one provider-neutral vocabulary
  (3D Model / Surface / HDRI / Atlas / …); both drawers use the same Access field. Provider
  identity is shown with the supplied Megascans mark and the Poliigon favicon (see
  `src/renderer/providers/NOTICE.txt`) on cards and in drawer tags instead of coloured dots.
  HDRI browsing adds a dual-handle 0–24 h time-of-day slider where the handles set the start
  and end of the falloff window (default 09:00–15:00), crossing midnight automatically, with
  dawn/noon/dusk/night ticks and an All day reset; the window is backed by a `time_of_day`
  catalogue column estimated from name/tags/categories/`sun_position`. Time appears on cards,
  footers and technical rows. HDRI views hide size, texture-map and pack filters, and sort
  options are filtered per asset type.
  Technical data is grouped under Geometry / Maps / Delivery / Metadata with the same order
  everywhere; the DCC compatibility chips are intentionally not shown in the technical panel
  (the DCC chooser remains in download settings).
  Poliigon technical data also exposes release status, sun position for HDRIs, named texture
  maps and vendor compatibility; map previews are generated from the smallest (1K) manifest
  images for both textures and 3D models, cached under userData and shown unwatermarked.
  Opening a map in the full-screen viewer upgrades it to the highest available resolution
  through the same manifest, with the shared loading/retry overlay and a separate high-res
  cache. Temporary preview transfers (1K maps, full-resolution maps, HDR sources) publish into
  the normal download-progress channel so the Download activity pill/popover and viewer overlay
  show the same live size, speed, ETA and CDN source as library downloads; they are excluded
  from the Downloads queue/history and vanish when finished. HDRI maps expose both a Tone-mapped
  JPG entry and an HDR (EXR) entry and open on the Maps view; expanding from the Render tab
  switches to that genuine HDRI preview automatically. Selecting the HDR entry enables the live
  view immediately and preserves the current zoom/pan. The default full-screen image is the
  highest-resolution JPG/PNG, and enabling exposure on either entry downloads and decodes the
  highest published HDR/EXR tier, uploads it as a mip-mapped half-float texture and applies live
  GPU ACES/sRGB exposure in WebGL. The shader maps screen pixels through the same fit/zoom/pan
  transform as the JPG viewer, so the HDR view stays aligned and sharp at every zoom, with
  triangular dithering to keep gradients band-free. HDRI previews also open in an interactive
  equirectangular 360° view for both entries: drag to look, wheel/−+ for FOV (65° default),
  `P` or the 360° button toggles flat/panorama, and exposure stays live with a Reset button.
  The mode follows the content (equirect/HDR defaults to 360; flat maps stay flat), and choosing
  HDR or clearing exposure moves the picker between the HDR and tone-mapped entries so the label
  matches the view. UV gradients are derived continuously and sampled with `textureGrad` to
  remove the longitude seam. The 8-bit path uploads the JPEG/PNG to WebGL and shares the same
  camera maths. Opacity/alpha/mask maps request PNG so Poliigon accepts the manifest (this also
  fixes genuine previews for texture atlases). This is an independent implementation of the Poly
  Haven interaction model (`imgvwr` is a standalone Rust app; polyhaven.com is AGPL), so no
  third-party code or assets are bundled. No per-stop image caches are created.
  Transient Poliigon 429/5xx responses are retried briefly or surfaced with Retry instead of
  blocking. On quit, cached preview files larger than a thumbnail are flushed from
  `poliigon-map-previews`, `poliigon-map-highres` and `poliigon-hdr-source`, while
  thumbnail-sized files stay cached. Clicking the image
  itself closes the viewer. Textures fall back to the public watermarked catalogue previews
  only when genuine 1K maps are unavailable. This path only runs for free, owned or plan-included
  assets, so it never turns into an acquisition or credit spend. In-app purchases are
  intentionally out of scope; OpenBridge assumes the user already has the required subscription
  or owns the assets.
- Library settings now distinguish `libraryRoot`, the Megascans path (`libraryPath`) and
  `poliigonLibraryPath`. Existing Megascans paths are preserved and Poliigon defaults to a
  sibling `Poliigon` folder; new installs use `Documents\OpenBridge\{Megascans,Poliigon}`.
  `poliigonConfirmPurchases` defaults to true and must stay explicit.

- App-wide filter audit completed for 1.5.9. Filters and sorts are type-aware for Megascans,
  Poliigon, Poly Haven, All sources and the local Library; irrelevant groups/sorts are hidden and
  their stored values reset on type/provider changes. The shared `FilterWorkbench` now has an
  independently scrolling group rail and value pane inside a viewport-capped, header-fixed
  `.facet-panel`, so long All-source filter sets stay usable and results remain visible at
  1024x768. `Filters` is hidden when no group applies.
- Poliigon map codes are canonicalised at index time (`src/shared/poliigon-maps.ts`) so legacy
  tokens (`COL`, `NRM`, `METALNESS`, `DISP`, `GLOSS`, `REFL`) and PascalCase names (`BaseColor`,
  `Normal`, `Metalness`, `Gloss`, `Reflection`) produce one facet each. `poliigon-catalog.sqlite`
  schema is v10 (v9 migrates in place); the live count is 7,554. Map labels/order live in
  `src/renderer/poliigon-labels.ts`; legacy filter values still resolve through the canonicaliser.
- Physical-size presets/filters/sorts are shared (`src/renderer/size-filter.ts`) by Discover, All
  sources, Poliigon (non-HDRI) and Poly Haven (models). Resolution facets sort numerically and map
  facets use canonical order; Megascans facet values are humanised.
- Verified counts after the audit: 28,776 total (18,835 Megascans · 7,554 Poliigon · 2,387 Poly
  Haven); Poliigon Normal 7,072 and Base Color 7,035; Poly Haven models 2–5 m 71. `npm run check`,
  `npm run build`, `npm run test:browsing`, `npm run test:network` and `npm run test:browsing:ui`
  pass. The UI fixture now covers the three-provider All view, and All-view Shift selection closes
  open drawers and anchors the range like the focused Megascans view. These changes are pushed to
  `main`; no tag or release has been created.
- UI polish pass after the audit: the provider switch is a 2×2 grid so “Poly Haven” no longer wraps
  or clips at narrow widths; thumbnail density labels are short (`Compact`/`Comfortable`/`Large`);
  result counts pluralise correctly (`1 asset`); Megascans ownership checks are hover-only; list and
  drawer type labels use the shared provider-neutral vocabulary (`3D Model`, `Surface`, `HDRI`);
  drawer tabs use `Download` and no longer wrap; Downloads wording is Megascans-specific where the
  measured path is Megascans-only; zero-count source pills are hidden; empty search results offer
  `Clear search and filters`; filter tabs ellipsise with tooltips and show thin scrollbars; and the
  list view fits or scrolls cleanly at 1024/900 widths.

- All five approved UI improvements implemented: docked wide-screen inspector, section navigation
  and pinned download footer, scoped search/shared filter workbench, shell download activity and
  responsive Downloads history/storage rail.
- `src/main/download-completions.ts` stores up to 5,000 completions in a separate user-data SQLite
  database. The rail displays the latest 30. Queue clearing and library-index rebuilds do not erase it.
- `downloads.overview()` exposes real session receive counters, completion history, volume free space
  and explicitly partial cached library measurements. No new live library scan is started by the rail.
- New renderer components: `DownloadActivity.tsx`, `DownloadsRail.tsx`; aggregate/ETA helpers in
  `src/renderer/download-summary.ts`. Catalogue and Library use `FilterWorkbench` from `BrowsingTools`.
- Do not tag or publish without user confirmation. The latest published release is `v1.6.2`.
- Overview now includes `AssetScaleDiagram.tsx`: an SVG front orthographic human (1.78 m) and asset
  bounds sharing one metres-to-pixels scale and ground line. `src/shared/asset-scale.ts` reads the
  existing length/width/height metadata or recorded variations; scan area alone never creates bounds.
  Browsing regression checks now include unit parsing and proportional geometry.
- Version bumped to 1.5.1 to build into a fresh portable folder while the old 1.5.0 runtime is locked.
- Version 1.5.2 moves the scale reference from Technical to Overview, leaving technical fields intact.
- Partial QoL batch in 1.5.3: catalogue/drawer retry, queue search/status and retry with original
  settings, interface scale, configurable metric/imperial human reference, opt-in automatic paging.
  Version 1.5.4 adds best-effort browsing state/scroll restore, loaded-item list and comparison,
  dismissible first-run guidance, shortcut help, an enlarged scale inset, cancellable health scan
  and non-destructive duplicate review. Paging restoration is bounded by loaded results; cleanup does
  not automatically delete or move suspected duplicates/orphans. No release has been published.
- Catalogue cards support Shift-click / Shift+Enter to begin inclusive loaded-range selection
  from the most recently opened card. Explicit Select mode still works. In a narrow overlay drawer,
  holding Shift allows clicks on visible cards behind the backdrop; covered cards remain obscured.
- List/compare remains available during bulk selection. Comparison is preview-led with technical
  metadata and proportional height references. Catalogue sorting reorders loaded results; Library
  sorting runs across the full indexed query and exposes available technical/health fields.
- Pagination no longer reapplies saved scroll positions while loading. Comparison previews use
  contained images and surface-specific details instead of inapplicable mesh/height fields.
- Catalogue pagination anchors the visible asset when client-side sorting inserts newly loaded
  assets above it; the UI regression tests sorted paging rather than scroll offset alone. The user
  reported that the previous 1.5.7 scroll fix did not work, and later said 1.5.8 was OK for now.
- The local 1.5.8 portable folder and ZIP are in `dist/`; older versioned portable folders and ZIPs
  were removed at the user's request. `dist/` is ignored and is not pushed to GitHub.
- GitHub Quality exposed a sorted auto-paging regression at 1024x768; 1.5.9 captures the visible
  anchor before a page request. The UI regression scrolls near the bottom with headroom below the
  anchor (the last row cannot keep its viewport position once new pages extend the list), and runs
  at both narrow and wide widths. A fresh 1.5.10 portable build is available locally in `dist/`.

## Mandatory checks

Run from the repository root in PowerShell:

```powershell
$env:Path = "$PWD\tools\node-v24.22.1-win-x64;$env:Path"
npm run check
npm run build
npm run check:public
```

`npm run check` runs TypeScript and the public-repository hygiene check. Run `npm run check:public`
after staging new files, because it only scans `git ls-files`.

For packaging:

```powershell
npm run dist:portable
```

GitHub Actions `Quality` runs typecheck + public check on pushes, pull requests and manual dispatch.
The release workflow runs only on `v*` tags and publishes the portable ZIP plus `latest.json`.

There is no unit-test suite. Verification is typecheck, build, public check, portable packaging and
the manual checklist in `docs/TESTING.md`.

## Repository hygiene rules

The repository is public. Every commit is public.

- Do not commit credentials, tokens, private keys, account names, email addresses, local absolute
  paths, machine identifiers, personal tool paths or downloaded assets.
- Use placeholders such as `%APPDATA%`, `<repo>`, `<user>` and `<owner>/<repo>`.
- Never commit `config.local.json`, `config.local.*.json`, `.env*`, `*_api_key.txt`, generated
  SQLite files, metadata packs, logs, `out/`, `dist/`, `analysis/`, `third_party/` or `tools/`.
- `config.local.example.json` is intentionally tracked.
- Run `npm run check:public` after adding files.
- The hygiene script builds blocked patterns from character codes. Do not replace them with literal
  personal values or secret fragments.
- Do not reintroduce the legacy Bridge settings importer or its decryption key. It was deliberately
  removed before the public history rewrite; the default library path is now
  `Documents\Megascans Library`.
- Do not hard-code the GitHub owner/repository. Use `releaseAssetUrl()` from `src/main/project.ts` or
  the `OPENBRIDGE_REPOSITORY` / `GITHUB_REPOSITORY` build inputs.

## Architecture map

- `src/main/index.ts` - Electron startup, settings defaults, IPC registration, lifecycle.
- `src/main/auth.ts` - Epic OAuth, DPAPI-backed session storage, profile.
- `src/main/legacy-api.ts` - legacy catalogue/download REST client.
- `src/main/downloader.ts` - transfers, resume, size verification, persistence.
- `src/main/library.ts` and `src/main/library-index.ts` - library scan, schema v4, FTS5, filters.
- `src/main/catalog-metadata.ts` - optional metadata pack provider, import/download/status.
- `src/main/catalog-pack-builder.ts` - authenticated pack generation and retry logic.
- `src/main/map-previews.ts` - map previews; billboard maps use the authenticated download path.
- `src/main/updater.ts` - release manifest, SHA-256-verified portable update.
- `src/main/project.ts` - injected repository slug and release asset URL.
- `src/main/settings.ts` - settings store, migrations and per-type download defaults.
- `src/main/sync.ts` - acquired/favorite/library synchronization.
- `src/main/poliigon/catalog.ts` - public Poliigon catalogue fetch, SQLite/FTS index, categories and queries.
- `src/main/poliigon/auth.ts` - Poliigon browser sign-in, DPAPI token store, account/credits and owned-asset sync.
- `src/main/poliigon/download.ts` - Poliigon manifest downloads, progress, pause/resume/cancel and addon-compatible layout.
- `src/main/poliigon/payload.ts` - pure Poliigon download payload builder for textures, models and HDRIs.
- `src/main/library.ts` - scans Megascans and Poliigon libraries; Poliigon records are matched to the catalogue by AssetName.
- `src/main/library-index.ts` - provider-aware SQLite/FTS index (schema v8) with per-provider counts and filters.
- `src/main/http-api.ts`, `discovery.ts`, `mixer-socket.ts` - legacy local integration.
- `src/renderer/views/LibraryView.tsx` - catalogue/library browsing and filters.
- `src/renderer/views/PoliigonView.tsx` - Poliigon catalogue browser; `poliigon-store.ts` holds its state.
- `src/renderer/components/PoliigonDrawer.tsx` - Poliigon preview, map and technical inspector.
- `src/renderer/components/AssetDrawer.tsx` - map, technical and metadata display.
- `src/renderer/components/BrowsingTools.tsx` - shared searchable filter workbench and browsing menus.
- `src/renderer/catalog-utils.ts` - local readiness/semantic/freshness filtering and facet ordering helpers.
- `src/renderer/size-filter.ts` - shared physical-size presets, bounds and label mapping.
- `src/renderer/poliigon-labels.ts` - Poliigon map labels and canonical display order.
- `src/shared/poliigon-maps.ts` - canonical Poliigon map-code normalisation used by the catalogue index.
- `src/shared/types.ts` - shared IPC/domain types.
- `src/shared/asset-metadata.ts` - pack record projection and technical extraction.
- `scripts/build.mjs` - esbuild pipeline and repository slug injection.
- `scripts/package-portable.ps1` - portable ZIP layout.
- `scripts/make-update-manifest.mjs` - release manifest generator.
- `scripts/check-public-repo.mjs` - tracked-file privacy/secret scanner.
- `.github/workflows/quality.yml` - typecheck + public check.
- `.github/workflows/release.yml` - tag build, manifest, GitHub release assets.

## Configuration and release URLs

`scripts/build.mjs` resolves the repository in this order:

1. `OPENBRIDGE_REPOSITORY`
2. `GITHUB_REPOSITORY`
3. `repository` in ignored `config.local.json`
4. GitHub remote from `origin`

The slug is injected as `__OPENBRIDGE_REPOSITORY__`. At runtime, `releaseAssetUrl()` builds
`https://github.com/<slug>/releases/latest/download/<asset>`. If no slug is present, update checks
return a configuration error and the metadata-pack download reports that no URL is configured.

Release assets:

- `OpenBridge-<version>-win-x64-portable.zip`
- `latest.json`
- `catalog-metadata.json.gz` (optional, uploaded manually)

Do not delete or rename released tags. The updater and pack downloader resolve assets through
`releases/latest/download` and tag-specific release URLs.

## Release status and known facts

`v1.6.2` assets (published 2026-11-18, tag `v1.6.2`, commit `6caa6b2`):

- Portable ZIP: `162,443,482` bytes
- ZIP SHA-256: `B3B88D253BA541191D466A0DFE68B6BD81BE34304172E8D4414AB9826CF91F98`
- `latest.json` reports version `1.6.2`, the same size and SHA-256 as the uploaded ZIP.
- Verified after upload: the downloaded ZIP hash matches `latest.json` and the packaged
  `resources/app/package.json` reports `1.6.2`.
- `Quality` passed on `6caa6b2` before tagging; the tag-triggered `Quality` and `Release`
  workflows both passed (Release run `44360255012`).

`v1.4.2` assets (published 2026-10-27):

- Portable ZIP: `159,195,365` bytes
- ZIP SHA-256: `30A682988B74EA2E84A1542EDDB863F8838B8E2DE98EFC9E8CAE74E750F6A581`
- Contains the browsing workflow, high-resolution previews, networking hardening, live download
  diagnostics, download history sparkline, CDN country flags, the catalogue filter workbench
  (group rail, per-group search, checkbox rows) and the larger app-wide type scale with a wider
  sidebar and asset drawer.
- Verified after upload: release assets return HTTP 200/206, the downloaded ZIP hash matches
  `latest.json`, and the packaged `resources/app/package.json` reports `1.4.2`.
- `Quality` passed on `781c962` before tagging; `latest.json` points to `v1.4.2`.

`v1.4.1` assets:

- Portable ZIP: `159,058,760` bytes
- ZIP SHA-256: `E4089BA1C3FFD81158C4800B8BEE876E171FEFE6D23B526BF7EC467ADC00ECBB`
- Metadata pack: `1,585,054` bytes
- Pack SHA-256: `EDF1237AD02A3B4DF82FE58C2A0A677859DA6E0CCD6A42509533710037A02411`
- Pack records: `18,835`

CI-built ZIP hashes differ from local builds. Always verify the uploaded CI asset before documenting
a release hash.

The local `dist/OpenBridge-1.4.2-win-x64-portable` build (`159,194,669` bytes, SHA-256
`C3EF2AFA8258149947BA01710600CF6C1B8D5BA52F4914F8FC5130BE4C4E6188`) predates the CI release and
differs from the published asset. Do not quote it as a release hash.

Hosted Windows runners expose a 1024x768 desktop. `test:browsing:ui` clamps its window to the work
area and compares compact density against comfortable density instead of a fixed column count, so it
must keep passing at narrow widths.

## Recent completed work

- Public-facing README/docs rewrite; removed personal paths, email, hardware details and recovered
  key material.
- Build-time repository slug injection; hard-coded owner URLs removed from tracked source.
- Public-repository hygiene check, Quality workflow, contributing/security policy, issue templates.
- Removed the legacy settings importer because it required a recovered secret.
- Rewrote all commits and 12 tags to remove historical personal data, then force-pushed with GitHub
  Actions temporarily disabled to prevent release workflows from rebuilding old tags.
- GitHub repository description and topics updated.
- Quality CI manually dispatched on rewritten `main` and passed.
- Released `v1.4.2` from `781c962`: browsing workflow, high-resolution previews, networking and
  transfer hardening, live download diagnostics, CDN country flags, catalogue filter workbench and
  the larger type scale. Added `test:browsing`, `test:network` and `test:browsing:ui` to `Quality`.

A pre-rewrite backup bundle was created outside the repository under the session temp directory.
It contains the removed sensitive data. Keep it only until the GitHub purge is confirmed, then
delete it.

## Outstanding work

1. **GitHub cached commit purge is pending.** Old pre-rewrite commits from `v1.1.0` through
   `v1.3.1` still resolve by raw SHA even though no branch/tag points to them. This is expected after
   a force-push. Open `https://support.github.com/contact` and request removal of unreachable
   commits containing sensitive data for this repository. Do not consider the history cleanup
   complete until old SHA URLs return 404.
2. **Do not run release workflows for old tags.** If another history rewrite is ever required,
   disable Actions first, back up all refs, force-push, re-enable Actions, then manually verify
   release assets and `latest.json`.
3. **Metadata data gap.** Sampled material/texture-set extended payloads are empty; a material
   explorer needs a data audit before implementation.
4. **Publishing the next version.** Bump `package.json`/`package-lock.json`, run the mandatory
   checks, commit the working tree, push `main`, wait for `Quality` to pass, then tag and push the
   tag. Never tag before the code is committed, or the release workflow builds the previous commit.

## Useful commands

```powershell
npm run start
npm run typecheck
npm run check:public
npm run check
npm run build
npm run dist:portable
npm run catalog:pack:sample
```

GitHub CLI is not installed. Use the GitHub REST API with a token from:

```powershell
"protocol=https`nhost=github.com`n`n" | git credential fill
```

Do not print the token. Do not store it in the repository.

## Documentation index

- `README.md` - public overview, install, configuration and project map
- `CONTRIBUTING.md` - contribution and public-hygiene requirements
- `SECURITY.md` - private vulnerability reporting
- `docs/BUILD.md` - build, packaging, configuration and release process
- `docs/TESTING.md` - automated and manual verification
- `docs/PROTOCOL.md` - local API and export protocol
- `docs/REVERSE-ENGINEERING.md` - original-app research notes
- `docs/POLIIGON.md` - Poliigon addon research, protocol and provider integration plan
- `docs/TOOLCHAIN.md` - optional research tools
- `docs/ROADMAP.md` - completed and planned product phases
