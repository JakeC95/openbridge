# Testing

Use a disposable library folder for manual tests. Do not commit logs, screenshots, account details,
local absolute paths or downloaded asset files.

## Automated checks

```powershell
npm ci
npm run typecheck
npm run check:public
npm run build
npm run dist:portable
```

`check:public` fails if tracked files contain personal paths, email addresses, hard-coded account
names, machine-specific details or likely secrets.

GitHub Actions `Quality` runs type checking and `check:public` on pushes, pull requests and manual
workflow dispatch. The check only reads tracked files, so stage new files before relying on it.

## Manual smoke test

1. Start the app and confirm the portable window opens with the expected version.
2. Sign in with an Epic account and confirm the account view loads without exposing credentials.
3. Search the catalogue by name and open a result. Check category filters, facets, favorites and
   related assets.
4. Open a 3D plant, switch to **Maps**, and confirm reference maps and billboard maps load.
5. Open a surface and confirm 2D drawer restrictions: no mesh format, no per-LOD map controls.
6. Download one asset to a disposable library folder. Confirm files, JSON and previews finalize in
   the expected layout.
7. Rescan the library. Confirm indexed search, readiness filters, counts and health tools work.
8. Import a small catalogue metadata pack in Settings and confirm status and remote badges.
9. Check the update path against a local manifest or a published prerelease before publishing.

## Browsing regression checks

The local 1.5.6 UI additionally offers retry, filtered download queue, adjustable interface size,
opt-in automatic paging, saved browsing state, image-led loaded-item comparison, guidance and
health-scan cancellation. Verify session restoration with a real library and a multi-page catalogue;
restored scroll is limited to currently loaded results. Duplicate review is informational and never
deletes. Catalogue sorting applies to currently loaded results; Library sorting is applied in the
SQLite query before paging. Metadata-based sort keys place assets without that metadata after those
with it.

```powershell
npm run test:browsing
npm run test:network
npm run build
npm run test:browsing:ui
```

The first command tests real SQLite queries, filter/selection parity, pack membership, interrupted
drawer requests, saved preferences and local preview enumeration using disposable fixtures. The UI
check launches Electron with an isolated profile and fixture preload: it does not use real accounts,
services or libraries. It covers local categories/sorting, catalogue and local selection, drawer
Back/Next, local maps, expanded previews, zoom, density, pack browsing, scroll restoration and
compact live download statistics (speed, write rate, collapsed source details, no signed URLs).
It also checks scoped search retention, both filter workbenches, docked/overlay drawer behavior,
mid-scroll grid reflow, pinned footer visibility, inspector sections, mini-queue dismissal and
fixture-backed disk/history rendering. SQLite tests reopen completion history and check it is
independent of queue clearing; transfer tests verify actual session receive counters and completion
recording. ETA checks cover startup, stalls, unknown sizes and paused jobs.

`test:network` checks request/cache/auth concurrency, safe retries and cancellation using fixture
responses, then exercises range resume, ignored/bad ranges, compression, stalled transfers and
transfer telemetry against a loopback server, including Electron's real network stack. See
[NETWORKING.md](NETWORKING.md) for policy, cache lifetimes, limits and comparison caveats.

The UI check clamps its window to the desktop work area, so it also runs on small CI desktops. Set
`OPENBRIDGE_UI_WIDTH` and `OPENBRIDGE_UI_HEIGHT` to reproduce a narrower layout locally, and set
`OPENBRIDGE_UI_SCREENSHOTS` to a directory to write preview-layout screenshots.

For manual download verification, start a real download and confirm the statistics line shows a
moving download rate and a plausible write rate, and that expanding the source summary lists the
actual serving host. Treat the reported location as a CDN edge hint, not proof of where the asset
is stored. Pause and confirm the line disappears; resume and confirm it returns. A rate of 0 B/s
during a stall is expected; it should recover when data flows again.

For manual browsing verification:

- In Discover, click a card normally and Shift-click another visible card. Confirm the inclusive
  loaded range is selected, the drawer closes, bulk controls appear, and further Shift-clicks extend
  the selection. Verify this also works with the narrow overlay drawer, with keyboard Shift+Enter,
  and that ordinary clicks and the explicit Select button retain their existing behavior.

- At 2560/1920px, open an asset mid-scroll: the grid/filter panel must end at the docked drawer edge.
  At 1100px, confirm overlay/backdrop behavior. Switch inspector sections, scroll settings to the
  bottom, and verify the footer remains visible and no toast covers its actions.
- In Overview, compare a small measured asset and a tall one against the 1.78 m human. Confirm the
  scale reference is not visible in Technical. Width and
  height must share the human's scale and ground line; depth is listed but not projected. Variation
  measurements must follow the selected recorded variation. Missing/invalid/2D-only measurements
  must show an unavailable state, not an invented box. Automated checks cover metres, cm/mm, axis
  order, missing data and proportional geometry, including a very wide/thin object.
- In the topbar, search Library and Catalogue separately; switch scope and verify each retains its
  own query. Local Filters must offer the same search/checkbox/clear interaction as catalogue facets.
- During a real download, inspect the nav progress and activity popover; test pause/resume all and
  Escape/outside dismissal. ETA describes active transfers only and is omitted without enough data.
- Complete a disposable download, clear finished, restart, and check Recent completions still lists
  it and opens its folder. Missing/deleted folders should surface an error, not disappear silently.
- Verify volume free/total space against Windows. Cached library bytes may be partial until Library
  Health runs; verify the measured-asset count is honest. Test an inaccessible library folder.

- In Library, combine repository, type/category, favorites, readiness, colour and triangle filters.
  Verify **Select all** matches the visible scope; check exports/deletion only in a disposable library.
- Switch between Discover, Library and Downloads; returning should restore the grid position.
- Follow related assets and use **Back** or **Alt+Left**. Left/right in Render mode navigate loaded
  results; in Maps mode they cycle maps. Typing in inputs must not navigate assets.
- Open **Recent**, **Saved searches**, and searchable **Packs**. Pack membership comes from metadata,
  not Bridge's curated collections; remote packs require the optional metadata pack.
- Expand a render/map, zoom, drag, switch images and press Escape. Only the expanded preview should
  close and focus should return to its trigger. Local JPG/PNG/WebP maps work offline; EXR is not decoded.
- Expanding a catalogue map (or a recognized downloaded map) signs only its maximum available JPG,
  respecting account resolution limits. Verify the loading spinner stays visible through download
  and image decode, the small preview remains visible, and actual pixel dimensions appear afterward.
  Switch maps while loading and verify a late response cannot replace the current image. Test
  failure/retry and closing while loading. No download queue item or library file should be created.
- Search/expand facets beyond the first ten values, remove active-filter chips and clear an empty
  filtered result. Verify compact/comfortable/large thumbnail sizes at smaller window sizes.
- Local sort order applies before paging. Catalogue order remains service-defined; no unsupported
  catalogue sort is offered.

## Filter audit checks

Verify the filter workbench across providers and asset types:

- Discover: switch between All Types, 3D, Surfaces, Atlases, Decals, Brushes, Imperfections and
  Displacements. Facets and sorts must change with the type; size and triangle sorts disappear for
  2D types, and size/map filters disappear where they do not apply. Resolution lists must ascend
  numerically and selected chips must show the same humanised label as the facet option.
- Poliigon: the Texture maps facet must not contain duplicate labels. Base Color, Normal, Roughness,
  Metalness, Gloss, Reflection, ORM, Ambient Occlusion and Displacement must each appear once and
  return the same count as the facet. Base Color + Normal should cover most textures. Legacy values
  entered through older saved searches must still resolve.
- Poly Haven: HDRIs show resolution/category/collection plus weather, lighting, contrast,
  environment, sky visibility, season and backplates; textures show surface use, origin, condition,
  setting and aerial scan; models show condition, material, rigged, LODs and geometry nodes.
  Models also show the physical-size filter and sort; HDRIs and textures do not.
- All sources: facets are provider-labelled, empty provider groups are omitted, and only one
  resolution group per provider is present. HDRI views hide size/map filters and keep the time
  slider. Selecting a size preset and switching to an incompatible type must clear it.
- Library: readiness appears only for Megascans surfaces/atlases/3D and never for HDRIs, textures
  or models; triangles only for 3D/plants/models; brushes show colour but not condition/setting;
  displacements show neither colour nor condition/setting. The Filters button must be hidden when
  no group applies.
- Layout: at 1024x768 and at a wide desktop, open a long All-source filter panel. The group rail and
  value pane must scroll independently, the header must stay fixed, and catalogue results must stay
  visible below the panel. Verify the panel does not clip values and the filters remain usable in a
  short window.
- Apply several filters, switch provider and back, and confirm only applicable filters survive and
  result counts match the facet counts.

## Metadata pack checks

```powershell
npm run build
electron . --build-catalog-pack=dist/catalog-metadata-sample.json.gz --catalog-limit=50
electron . --import-catalog-pack=dist/catalog-metadata-sample.json.gz
```

Verify:

- The import reports the expected record count.
- Settings shows the pack count and generated date.
- A known asset exposes readiness, semantic and technical fields.
- Removing the pack returns the app to on-demand remote metadata.
- Full packs are generated only from an authenticated session and never committed.

## Release verification

- Confirm `npm run typecheck` and `npm run check:public` pass.
- Confirm the portable ZIP starts and reports the tagged version.
- Confirm the release contains the ZIP, `latest.json` and, when applicable,
  `catalog-metadata.json.gz`.
- Verify `latest.json` size and SHA-256 against the uploaded ZIP.
- Confirm the latest metadata-pack URL resolves when a pack is published.

## Destructive tests

Library deletion, queue cleanup, update replacement and forced shutdown should be tested only with
disposable data. Never run destructive tests against a real asset library.
