# Prepared presentation details

A prepared asset already answers “what file is this?” with a portable GLB and a
cover. A studio asset usually has a much longer story: named mesh parts, a
published texture set, lookdev reels, version history, source tasks and review
notes. The optional `presentation.json` sidecar carries that story next to the
model and lets OpenBridge present it without reading the production tree.

The manifest is curated context, not measured evidence. The existing **Measured
source facts** and **Resources** views remain authoritative for file sizes,
declared geometry, material references and dependency completeness.

## Where the file goes

```
Prepared assets/
  Tennis racket/
    Tennis racket.glb
    Tennis racket.jpg
    presentation.json
    media/
      turntable.mp4
      turntable-poster.jpg
      stills/
      maps/
```

OpenBridge looks for `presentation.json`, then `<model stem>.presentation.json`,
in the same folder as the prepared GLB. A folder without a manifest behaves
exactly as before. The scanner still indexes one presentation per folder and
ignores the manifest, media and other supporting files.

The scanner reads `job`, `artist`, `renderer` and `original.format` into the
indexed search text. **Rescan** after editing a manifest while the app is
running; a restart scans the collection again. The card metadata itself is read
on demand, so a manifest edit updates the card and drawer immediately.

When a renderer has a bundled product mark, the card and its primary spec show
that mark beside the renderer name. Unknown renderers remain text-only rather
than receiving a guessed logo. Renderer artwork and source attribution live in
`src/renderer/renderers/`. The Arnold SVG keeps its transparent canvas and the
card uses the Autodesk Arnold symbol inline beside the renderer name, avoiding a
detached badge or an opaque logo tile.

## What it enables

This is built for an artist hunting a known asset in a large local library.

- **Library card**: cover, recognizable original name with readable word
  spacing (keep acronyms and product names intact), then type and three aligned
  rows: **Formats**, **Renderer**, **Source size**. Use compact file extensions
  with full names available on hover and in the drawer. Use a dash for an
  undocumented value rather than shifting rows. Keep job and artist in the
  drawer and in search rather than adding a different last line to some cards. The long shared
  ID, source badge and file-facts line stay out of the grid. Hovering the card
  still exposes the full technical facts, and the inspector has everything.
  Prepared metadata is per-asset: it must follow the card into **All sources**
  and category scopes, not only the prepared collection filter. Grid rows use
  the taller metadata footer whenever prepared assets are present; List / Compare
  uses the same per-asset name, category and published formats.
- **Search by job and artist**: the scanner adds job, artist, renderer and
  original format to the indexed search text, so a search for a show, a person
  or “Arnold” can find the asset. Rescan after editing a manifest while the app
  is running.
- **Turntable first**: when `hero` is a video, the drawer opens on the
  **Turntable** and plays it muted on a loop. 3D and Resources remain one click
  away. Without a video, the drawer opens on 3D and Render is available.
- **Specs**: **Published formats**, **Source size**, **Production renderer**,
  then **Source geometry** when documented (otherwise the best curated fact).
  Asset-specific details such as the rig, look or pack count go in **More
  specifications**. The assembled dimensions follow, with the shared human-scale
  comparison where usable measurements are provided.
- **Anatomy** for named parts, face/vertex counts, material slots, UDIM tiles
  and part thumbnails. Notes stay in the row tooltip.
- **Textures & masks** cards for the primary channels, with resolution, format,
  version and per-tile thumbnails. Other maps sit behind a closed disclosure.
- **Media** for authored stills, a contact sheet, a reference frame and detail
  crops, with fullscreen navigation. Use collapsed groups for optional imagery:
  `Authored lookdev` for source stills/reels, `Authored reference` for native DCC
  renders that are not the portable look, and `Detail` for close-ups such as a
  character face or a mechanism. Do not let these crowd the four angle views.
- **Production sources & notes** behind a closed disclosure. Version timeline
  metadata is retained in the sidecar but is not shown as a dropdown.
- A collapsed list of skipped media or map entries.

The rule is selection, not omission. The manifest can carry more than the page
shows; `primary: true` marks the facts and maps that deserve the first screen.
The rest remains one click away.

## Local and online in one browser

Keep the same card hierarchy, density, dark preview surface and focus states
for both sources. Share the grid, List / Compare, selection, keyboard and
drawer interactions where their behavior matches. Let a local turntable lead
when available; use the best available online preview when there is no
turntable. Do not add a checkerboard or a separate visual style for transparent
local media. Keep the four inspection angles together and put native imagery
and optional close-ups in labeled, collapsed groups.

| Shared interaction | Local studio asset | Online asset |
| --- | --- | --- |
| Browse and compare | Readable name, normalized type, and published formats; job and artist are separate fields only when verified. | Same hierarchy, plus provider and license/availability where relevant. |
| Inspect | Explain whether the preview is translated or technical-only. Separate verified dimensions, bindings and provenance from what is merely declared. | Keep provider-supplied claims labeled; do not infer missing formats, dimensions, or tiers. |
| Handoff | **Copy with dependencies** uses the files actually on disk. A published Max or Maya format on a prepared card does not mean that source is included. | **Download** or open acquired files, with entitlement and available tiers checked by the provider workflow. |

In a future mixed view, preserve stable source-aware identities through search,
filters, sorting, selection, comparison and previous/next. Don't merge two
records just because their names match. Show origin where it changes a user's
choice, and route mixed selection to the right per-item action; never turn a
local copy into an acquisition or imply an online entitlement for a studio
file. Test a mixed result set end to end once this exists. **Discover → All
is online-only today**; the Library's **All sources** scope is not that
integration.

## Safety and portability

The sidecar is read-only and is validated before anything is returned to the
renderer:

- The manifest must be at most 256 KiB and declare `"schemaVersion": 1`.
- Media and map paths must be relative, must not contain `..`, must resolve
  inside the presentation folder, and must be regular files after symlink
  resolution.
- Images are limited to 64 MiB and videos to 512 MiB.
- Supported image extensions are PNG, JPEG, WebP, AVIF and GIF. Supported video
  extensions are MP4, WebM and M4V.
- Absolute paths, `file:` URLs and remote media are rejected. Only `https:`
  links are exposed as external actions.
- Text fields and array lengths are capped. No HTML is rendered.

Keep the presentation folder portable: use forward slashes, keep media beside
the GLB, and do not point at a production share. The source package stays local;
the presentation is the review copy that can be copied to another workstation.

## Visual acceptance gate

Run this before calling a prepared asset ready and after changes to shared
Library UI. Use the **current packaged app**, record the version/platform and
viewport size, and actually look at the captures. A fixture, successful build,
or list of passing selectors does not prove the images look right. For shared
changes, review the full small prepared comparison set; for a single ingest,
review that asset alongside the untouched benchmark and a sibling.

| Surface | What to look at and exercise |
| --- | --- |
| Grid | Compare Compact and Large, and check a narrow window. Covers should be recognizable and free of clipped edges, distracting halos or moiré. Compare a long two-line name, a card with many formats, and a card with unknown metadata side by side: type and spec rows should align, labels should not clip, and unknown values should not move other fields. |
| Scopes and comparison | Check All sources, the prepared collection and 3D Assets; names, types and available source formats should agree. Open a four-up comparison, check image loading and that unavailable measurements aren't invented. |
| Drawer and turntable | Verify default muted looping playback and 1080p alpha on the dark background. Compare the first three Specs labels and their order across assets; any fourth-slot variation should reflect available evidence rather than a different layout. |
| Viewing angles and details | Open an angle in the lightbox, browse to the next image and close. Inspect any authored/reference, detail and map groups the asset actually has; absent media should not produce empty sections or broken cards. |
| Interactive 3D | Load inline, enter fullscreen, orbit to a different view and exit with Escape. Check visible materials and the inspector's actual channels. No LOD is not proof of a single internal mesh. |
| Resources and handoff | Confirm the actual local file and dependencies. Exercise copy only into a scratch project or via the UI fixture; don't imply published provenance files are included. |

Save a private evidence set: grid at both densities, List / Compare and per-asset
turntable, gallery and fullscreen/orbit views. Add screenshots for specific
regressions or exceptions. In the handoff, mark each row pass, fail or not
tested with a reason; after a fix, revisit the affected surface in the rebuilt
app. Keep paths, asset names and images private. If the scope includes online
parity, compare a comparable online asset as well and label any untested
provider or platform explicitly.

### Supporting file checks

- Compare the prepared card in **All sources**, its collection and List /
  Compare. Check the type, readable name and source formats against the drawer.
  Published formats are provenance, not the files delivered by **Copy with
  dependencies**. Use **Resources** to verify that distinction.
- Inspect the delivered GLB, not just the working export: trace visible mesh
  primitives through materials and textures to their embedded images. A texture
  card, a matching filename or a successful export does not prove a binding.
  Label source-only maps and distinguish individual bitmaps from packed or
  generated images. After a GLB optimization, repeat this check.
- Resources can correctly report no separate map files for a self-contained
  GLB. Verify embedded materials independently. Don't imply that every packed
  channel shown in the gallery can be isolated in the 3D inspector.
- If a model mixes recovered textures with generated materials, name the
  unresolved parts in **Production sources** and distinguish the number of
  embedded images from the number of textured meshes. Verify a real orbit
  in the packaged app as well as the default camera and turntable.
- Render the turntable and detail views from the delivered model where possible.
  Use `ffprobe` to check encoded size, frame rate and duration, and
  `scripts/check-preview-alpha.py` to check decoded alpha on the full orbit.
  Open the turntable, interactive 3D, the angle lightbox and any detail/reference
  groups in the packaged app. For layered or transparent surfaces, inspect a
  close-up as well as the full asset; one good angle is not enough.

## Schema

All fields are optional except `schemaVersion`. Unknown fields are ignored.

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | number | Must be `1`. |
| `category` | string | Studio asset type, such as `Prop`. Shown on the card and in the drawer when known. |
| `title`, `subtitle`, `summary` | string | Retained as authored metadata. The library headline uses the indexed asset name with readable word spacing. |
| `job` | string | Show or job name. Shown on the card and as the drawer byline; indexed for search. |
| `artist` | string | Artist name. Shown on the card and as the drawer byline; indexed for search. |
| `renderer` | string | Primary renderer, for example `Arnold`. Shown on the card and specs; indexed for search. |
| `original` | object | `{ format?, formats?, size?, detail? }` for model file formats only (for example Maya `.mb` and Alembic `.abc`). Do not include texture/project formats such as `.spp` or UDIM images. Additional format names and `detail` appear on the card and under **More specifications**. `size` is the primary model file size, not the whole asset root or preview GLB. |
| `hero` | media | Image or video. A video makes **Turntable** the default drawer view. |
| `media` | media[] | Up to 24 image or video entries; images appear in the Media gallery. |
| `facts` | fact[] | Up to 24 `{ label, value, detail?, primary? }` entries. `primary` marks the first-screen specs. |
| `parts` | part[] | Up to 64 named parts. `faces`, `vertices`, `material`, `tile`, `color`, `preview` and `note` are optional. `note` is shown as a tooltip. |
| `maps` | map[] | Up to 64 texture channels. `primary` marks the visible cards; `tiles`, `resolution`, `format`, `version`, `preview`, `tilePreviews` and `note` are optional. |
| `versions` | version[] | Up to 24 `{ label, kind?, date?, note?, current? }` milestones retained for provenance, but not currently rendered in the asset drawer. |
| `links` | link[] | Up to 16 `{ label, value?, href?, note? }` source notes. `href` must be HTTPS. |
| `credits` | credit[] | Up to 12 `{ role, name }` entries. |
| `notes` | string[] | Up to 12 curator notes. |
| `warnings` | — | Output only. The reader adds skipped-entry warnings; do not author this field. |

### Media entry

```json
{
  "kind": "video",
  "src": "media/turntable.mp4",
  "poster": "media/turntable-poster.jpg",
  "label": "Lookdev turntable",
  "caption": "100 frames · 1920 × 1080 · 23.976 fps",
  "mimeType": "video/mp4",
  "width": 1920,
  "height": 1080,
  "durationSeconds": 4.2,
  "alt": "Turntable of the prop in a lit set"
}
```

`kind` may be omitted and inferred from the extension. Video posters are
optional; if omitted, the first gallery image becomes the poster. Width, height
and duration are display metadata; OpenBridge does not decode the file to
verify them.

### Choosing the first screen

For translated looks, distinguish the production renderer from the viewer
look. Keep the neutral transparent turntable as the lead preview, put
native studio renders in an `Authored reference` group, and label native-only
texture references separately from textures bound in the viewer.

Mark at most four facts and roughly four to six maps as `primary`. The drawer
shows those first. If a manifest has no primary marks, it falls back to the
first four facts and the full map list, so small hand-authored sidecars still
work. For an asset-hunting view, the first four are usually **model formats,
model size, renderer and source face count**. The card uses `job`, `artist`,
`original.format`, `original.formats`, `renderer` and `original.size`
independently of the facts. `original.formats` should contain every available
model format (not texture or project formats), and `original.detail` can list
versioned filenames and per-file sizes.

Keep primary values short enough to scan in one pass; primary facts render as
compact label/value stats, so `detail` text is only shown for secondary facts.
Put project codes, source applications, publish dates and review history in the
secondary facts or the closed disclosures.

### Map entry

```json
{
  "channel": "basecolor",
  "label": "Base color",
  "primary": true,
  "part": "All parts",
  "tiles": [1001, 1002, 1003, 1004, 1005, 1006],
  "resolution": "4096 × 4096",
  "format": "EXR 16f",
  "version": "v002",
  "preview": "media/maps/DIF_1001.jpg",
  "note": "The later publish updates the grip and guide tiles.",
  "tilePreviews": [
    { "tile": 1001, "src": "media/maps/DIF_1001.jpg" },
    { "tile": 1002, "src": "media/maps/DIF_1002.jpg" }
  ]
}
```

Generate browser-friendly previews for EXR or other formats the browser cannot
display. Keep the channel names aligned with the viewer inspector where
possible: `basecolor`, `normal`, `roughness`, `metalness`, `opacity`, `emissive`,
`ao`, `orm`, `gloss`, `displacement`, `specular`, `translucency`. Brand masks and
other auxiliary maps can use a free-form channel such as `brand`.

## A complete small example

```json
{
  "schemaVersion": 1,
  "title": "Studio prop",
  "subtitle": "Hero variant",
  "summary": "Prepared review copy with named parts and a published UDIM texture set.",
  "job": "Spring campaign 2027",
  "artist": "Alex Example",
  "renderer": "Arnold",
  "original": {
    "format": "Maya .mb",
    "formats": ["Maya .mb", "Alembic .abc"],
    "size": "6.9 MB",
    "detail": "Maya .mb 6.9 MB · Alembic .abc 4.5 MB"
  },
  "hero": {
    "kind": "video",
    "src": "media/turntable.mp4",
    "poster": "media/turntable-poster.jpg",
    "label": "Lookdev turntable",
    "caption": "100 frames · 1920 × 1080"
  },
  "media": [
    { "kind": "image", "src": "media/stills/beauty.jpg", "label": "Beauty still" },
    { "kind": "image", "src": "media/stills/detail.jpg", "label": "Detail crop" }
  ],
  "facts": [
    { "label": "Original", "value": "Maya .mb", "detail": "Alembic .abc · Substance .spp · UDIM EXR", "primary": true },
    { "label": "Model size", "value": "6.9 MB", "detail": "Maya .mb 6.9 MB · Alembic .abc 4.5 MB", "primary": true },
    { "label": "Renderer", "value": "Arnold", "detail": "Houdini 20.5 · HtoA 6.4.5", "primary": true },
    { "label": "Faces", "value": "50,740", "detail": "126k triangles in the GLB", "primary": true }
  ],
  "parts": [
    { "name": "frame", "label": "Frame", "faces": 1840, "vertices": 918, "material": "phong1", "tile": 1005, "color": "#e05a8a", "preview": "media/anatomy/frame.png", "note": "Outer frame." },
    { "name": "handle", "label": "Handle", "faces": 792, "vertices": 416, "material": "lambert3", "tile": 1001, "color": "#9b8cff", "preview": "media/anatomy/handle.png", "note": "Grip is subdivided in the review GLB." }
  ],
  "maps": [
    {
      "channel": "basecolor",
      "label": "Base color",
      "primary": true,
      "part": "All parts",
      "tiles": [1001, 1002],
      "resolution": "4096 × 4096",
      "format": "EXR 16f",
      "version": "v002",
      "preview": "media/maps/DIF_1001.jpg",
      "tilePreviews": [{ "tile": 1001, "src": "media/maps/DIF_1001.jpg" }]
    }
  ],
  "versions": [
    { "label": "Model v004", "kind": "Geometry", "date": "22 Oct 2026", "note": "Lookdev reference." },
    { "label": "Texture publish v002", "kind": "Texture", "date": "23 Oct 2026", "current": true, "note": "Current UDIM publish." }
  ],
  "links": [
    { "label": "Texture publish", "value": "Substance 3D Painter · UDIM", "note": "Production media stays on the studio share." }
  ],
  "credits": [
    { "role": "Geometry and texture", "name": "Studio asset team" }
  ],
  "notes": [
    "Preview uses portable PBR inputs baked from the published UDIM set.",
    "Source face counts stay in the anatomy list; the GLB count is noted where it differs."
  ]
}
```

## Preparing useful media

- Use the authored cover as the visual anchor, not a generic screenshot.
- Keep the visible set small: four primary facts, five primary texture channels,
  and one row of media. Move the rest behind disclosures.
- Export the turntable as H.264 MP4 at 1080p with `-movflags +faststart` and a
  matching poster frame. A four-second 1080p reel can stay below 1 MiB for a
  mostly static studio scene.
- Prefer a 10 × 10 contact sheet for a 100-frame turntable. It shows the whole
  rotation at a glance and gives reviewers a single image to share.
- Crop detail stills around the parts and marks that matter. Label them with the
  frame or source comp.
- Convert EXR, TX or other non-browser maps to small PNG/JPEG previews. Keep the
  original publish version and tile list in the map entry; the Resources view
  still lists the actual files.
- Anatomy renders can be generated from the same GLB. Assign one colour per
  part, render a front overview for the gallery, then one framed image per part.
  Transparent part images work well as small list thumbnails; the part list and
  the images then use the same names and colours.
- Keep the folder lightweight. The GLB is the payload; media is review context.
  Link to production sources instead of copying a 14 GB asset tree.

## What to show, and what not to claim

Use the strongest available evidence and label its source:

| Evidence | Good use |
| --- | --- |
| Job, artist and renderer | Card byline, drawer byline, search fields. |
| Original model formats and model file size | Primary specs and card format line. Do not use the whole asset root or substitute the preview GLB. |
| Authored comp or turntable | Hero video, cover, stills, contact sheet; default drawer view. |
| Published model version | Anatomy counts, material slots, source units, bounds. |
| Published texture manifests | Channel list, UDIM tiles, resolution, bit depth, version. |
| Saved lookdev or render scene | Frame size, colour space, source task. |
| Publish metadata | Authoring application, source task, publish date, hashes. |
| Nearby files or names alone | Keep as an unverified note, not a fact. |

Do not turn a filename match into a material assignment, and do not claim a
physical size that the model does not declare. When the real-time GLB is
modified for review (for example a subdivided grip for baked displacement), say
so in the relevant part note (shown as a tooltip) and keep the source count
visible.

## Testing

The shared-library UI fixture writes a presentation manifest beside a prepared
GLB and verifies the headline, facts, media gallery, anatomy, map preview,
timeline, skipped-entry warning and fullscreen navigation:

```sh
npm run build
npm run test:shared-library:ui
```

For a local studio presentation, launch the app with a profile that registers
the prepared collection, open the asset, and check the 3D and Turntable views,
the media lightbox, the map previews and the version timeline. The manifest is
read on demand; adding or changing it does not require re-indexing the prepared
folder.
