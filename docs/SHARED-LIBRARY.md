# Shared asset library design

## Shared folders in 1.7.0

Open **Settings → Shared library folders**, add a model
folder and an HDRI folder, name each source, and save. In **Library**, select **Shared folders**.
The category tree includes the root labels and nested folders. Search by file or folder name,
or file extension. Use **Rescan** after changing files or reconnecting a share.

OpenBridge supports the Library grid, list, selection and comparison, account-free favorites,
compatible 3D previews, flat HDR and 360° HDRI previews, and same-name render images. Each model
or HDR file has its own Library item. Turn on **Group variants** to see one representative
per likely group in a folder. The inspector links possible versions, LODs and resolution
variants. It can reveal, open or copy the selected original. Copy
prompts for a destination and refuses to overwrite an existing file.

Use **Organize** in the shared inspector to save tags, collections and notes. The Library
searches that information and offers folder, format, tag and collection filters under **Shared folders**.
Organization is private to the application profile and survives index rebuilds. Use **Saved
searches** to recall a shared query and its folder, format, collection, tag, category, sort, grouping and favorites filters.

For glTF, GLB or OBJ, **Copy with dependencies** creates a new directory and preserves the
relative paths for referenced buffers, material libraries and textures. Absolute, remote,
missing and linked references fail with an explanation. Other formats can still be copied
as single files. Select up to 100 shared items for a batch. OpenBridge packages supported
models and copies other originals into separate folders, reporting failures by asset. You can
stop between assets and keep the copies that already finished.

The scanner skips hidden folders, archives and cache folders. It scans registered roots in the
background, publishes new results in batches and preserves the last good index when a share
goes offline. Use **Stop shared indexing** to pause a long scan and **Rescan** to continue.
OpenBridge saves a checkpoint in the local index, so a restart on the same mount can continue
from the last completed batch. Partial scans keep cached results until a full scan completes. The Library checks individual files for zero bytes in the health report.
Model previews have a 96 MiB source limit and resolve eligible dependencies beside the model
or in conventional resource subfolders. HDR previews use the existing 8K and 160 MiB limits. The current source also inspects
dimensions from oversized HDR headers, so source facts remain available when decoding is unavailable.
Large or native files can be opened in the associated application. Automatic grouping across
folders, dependency packaging for more formats, and explicit shared file edits remain planned.

## Source metadata inspection

Opening a shared asset inspects its source in a separate bounded worker and caches the
result in the local index. Select up to 500 shared files and choose **Inspect metadata**, or use **Inspect matching files**
to process the full current shared-folder/filter scope
to enrich a batch, with progress, per-file errors and **Stop after current file**.
Unchanged files reuse cached facts; source size/timestamp changes invalidate them.
The shared roots remain read-only. Progress and stop controls remain available after navigating
away from Library and back; completed facts stay cached across app restarts.

- HDR/EXR: pixel dimensions, aspect-ratio projection hint, channel names and precision,
  compression and EXR layout/view information. Inspection reads at most 1 MiB of headers,
  including for files too large for live preview. A 2:1 aspect is a panorama candidate;
  it does not establish the camera projection. RGBE uses a shared exponent. Header signatures
  identify the encoding even when a `.hdr`/`.exr` filename suffix is incorrect; the inspector
  discloses that mismatch and previews use the detected encoding.
- OBJ: stored vertices, polygon triangle counts, UVs/normals, assigned material names,
  referenced material libraries and bounds in source units. OBJ does not declare metres.
  The metadata parser reads at most 24 MiB and does not load material textures.
- glTF 2.0/GLB: declared accessor geometry, material/image counts, PBR map types and bounds
  in mesh-local metres. Only JSON is inspected (at most 8 MiB), without reading external
  buffers or images. Scene transforms, instances, morphs and skinning are excluded from
  these geometry bounds/counts. The inspector explains those limits.
- Binary FBX: selective source-record inspection for stored geometry/material/image counts,
  unit-scale evidence and mesh-local bounds. Both 32-bit and 64-bit record layouts are supported.
  Inspection reads at most 32 MiB, decodes at most 24 MiB of selected arrays and caps individual
  arrays at 8 MiB. Larger arrays retain labelled declared element counts; their triangles/bounds
  remain unknown. ASCII FBX remains available in the 3D viewer with limited source metadata.
- Filename LOD/version tokens are labelled as filename information. Other native model
  formats retain their file facts and show that geometry inspection is unavailable.

Inspected HDR resolution and known model triangles feed Library sorting, comparison and
triangle filters. Unknown facts remain unset. File inspection does not infer provider
ownership, licensing, semantic categories, weather or physically measured scale.

Model previews retain valid OBJ/glTF dependencies when another referenced file is missing and
show a missing-resource note. Copying a model package still rejects incomplete dependencies.

## Prepared asset presentations

For assets assembled from a studio project, use **Settings → Add prepared assets…**
to register a folder containing reviewed portable presentations. Put each asset in its own
folder with a same-named GLB and cover image, for example `Character/Character.glb`
and `Character/Character.png`. OpenBridge indexes one entry and keeps alternate
exports and nested work folders out of that presentation. Selecting **Shared folders**
opens the first registered prepared collection when one exists. The folder selector
can switch to the original source roots for file-level work.

A portable presentation can bake a studio material into textures and package those
textures with its mesh. Choose the source publish and material version from project
evidence. A rendered cover and browser lighting need not reproduce the original DCC
renderer’s node graph.

Use the strongest evidence available when preparing a presentation:

| Evidence | How to use it |
| --- | --- |
| Approved self-contained GLB and cover | Use the existing presentation directly. |
| ASS or USD with explicit geometry, shader and texture bindings | Follow the authored bindings, record the chosen versions and translate or bake the materials for portable viewing. |
| Saved Houdini lookdev scene | Identify the referenced geometry and texture publishes, even when a newer file exists. Old paths need a verified remap into the same asset package. External renderer shaders may need baking. |
| Package manifest or a documented folder layout | Match explicit asset IDs, versions, material slots and tile numbers within the package. |
| Filenames and nearby folders alone | Keep possible matches available for review. Unverified combinations do not become prepared presentations. |

Prepared indexing reads the exported files. Automatic ASS and Houdini scene analysis
is outside this indexing pass. The pilot extracted saved references as data and did
not run the source scene or its scripts.

## Authored covers in model collections

OpenBridge looks for a matching image in a collection’s `preview` or `previews` folder.
This covers layouts such as `collection/model/asset.abc` beside
`collection/preview/asset.jpg`. Explicit version and LOD suffixes can share an unversioned
cover. Duplicate cover candidates are skipped and distinct asset identifiers are preserved.
Rescan an existing shared library to populate the new associations.

Shared folders start with **Previews first**, ranking authored covers ahead of files eligible
for the 3D viewer. Use **Recently modified** to browse by file date. A cover is available for
browsing even when the source format needs its associated application for geometry viewing.

## Models with separated texture files

- A shared OBJ in an `OBJ` folder can resolve a missing bare MTL texture filename in the
  same package’s sibling `TEXTURES` folder. A unique case-insensitive filename match
  handles Windows-authored extensions on Linux. Authored material slots and texture options
  remain in use. **Copy with dependencies** still requires the original references to resolve.
- A legacy binary FBX in an `FBX` folder can use a matching OBJ export from the same
  package’s `OBJ` folder. The inspector names the actual preview mesh. Only an unambiguous
  matching filename, including an explicit `_Scanline` export suffix, qualifies.
- A supported FBX can resolve authored texture filenames in its own `<mesh>.fbm` folder.
  A mesh with a trailing LOD number can also find maps named for the asset stem, while
  the viewer retains its existing map quality and LOD selection rules.

Published Maya rigs, Alembic caches and Substance Painter work exports can occur in the
same project. Their paths alone do not identify a textured representation. Tiled EXR
materials need the matching UV layout and an explicit assignment or material export.

## Resource browsing and thumbnails

The shared model inspector offers **3D** and **Resources** views, plus a **Render** view when a
matching source preview exists. Resources lists project-relative dependency files and sizes,
material names and original map slots, with searchable PNG/JPEG/WebP map cards and fullscreen
navigation. OBJ/MTL and glTF/GLB references supply map semantics; arbitrary filename matches do
not create material evidence. Packed glTF textures retain their separate channel roles. Unsupported
image formats remain listed without pretending a browser preview is available. Missing and unsafe reference
notes remain visible; preview omits those references while retaining validated resources, and copying requires the full external dependency set.

Shared HDR grid and comparison cards lazily generate genuine tone-mapped PNG thumbnails when
visible. These use the existing bounded HDR decoder, two pending UI requests, source-identity
invalidation and cancellation when cards leave view. Generated images have a maximum 512-pixel
axis and live in a 128 MiB cache beside the local database state. The cache prunes by tracked LRU
usage. Source files are never modified. Tiled, deep, multipart, multiview and oversized sources
retain explicit preview-unavailable explanations and their inspectable metadata.

Shared OBJ, FBX, glTF/GLB, STL, PLY and DAE cards can also generate cached **Geometry previews**.
A separate sandboxed renderer uses the existing camera/framing and neutral lit materials, without
loading authored texture images or sharing account cookies. It accepts only validated geometry
resources, blocks network requests, serializes jobs and enforces source-byte, vertex, triangle,
output and timeout budgets. Generated geometry images use a separate 128 MiB local LRU cache.
Open the normal 3D viewer for textured inspection. Native DCC files and USD archives require a
source render or a supported mesh representation for a generated card. The **3D viewer formats**
format filter selects supported, nonempty source files within the existing 96 MiB viewer limit.

The next priorities are proxies for oversized/special HDR layouts, additional geometry formats,
broader dependency health and explicit asset-family/preview associations. Native scenes often
lack an unambiguous render or mesh proxy. Nearby textures, reference photos and repeated generic
filenames must not be treated as proof of an asset representation. User-confirmed path aliases
for older authored references and explicit preview associations remain planned.
Keep geometry metadata separate from runtime preview measurements so scene instances and
transforms cannot silently change the meaning of a stored metric.

## Design and next stages

The design below describes the full shared library work, including behavior beyond this pilot.

## 1. Index existing folders

- Give each root a stable ID, label, type and machine-specific path. A Linux mount and a Windows
  UNC path or mapped drive can represent the same root. Store asset locators relative to that
  root. Keep filename spelling and report case collisions that prevent resolution on Windows.
- Add shared assets as a local origin in Library. Keep catalogue provider IDs and download
  dispatch separate. Use SQLite and FTS for search, counts and paging, with the index on local
  storage. Reconcile each root or scanned branch only after a successful scan. A disconnected
  mount or a permissions error should preserve the last good index and mark it unavailable.
- Start with bounded, cancellable background scans. Read names, timestamps and sizes first.
  Probe geometry, images and dependencies when needed. Avoid full-file hashing and scanning
  archives on startup. Exclude staging and cache folders by configurable rules. Prevent
  symlinks and Windows reparse points from escaping registered roots.
- Support both standalone files and nested asset folders. Use explicit manifests where they
  exist. Group versions, LODs, maps, UDIMs, renders and variants when filenames or metadata
  support the grouping. Keep ambiguous files separate and allow explicit grouping and relinking.
  Count independent assets in the same folder separately.

## 2. Reuse model and HDRI previews

- Use the existing 3D viewer for supported interchange files such as GLB, glTF, FBX, OBJ and
  USD. Offer available variants, versions and LODs. Build manifests from indexed file IDs and
  validate dependency paths before loading. Preserve relative paths so textures and OBJ
  materials resolve correctly even when other assets have files with the same name.
- Offer **Open in DCC** for native project files or interchange files the viewer cannot
  inspect, such as Maya scenes and Alembic caches. An artist can publish a viewer-friendly
  proxy beside a native scene. The indexer does not execute embedded scripts or unpack
  archives. Show missing dependencies and unsupported formats in the inspector.
- Use the local HDR worker and existing flat, panorama and exposure viewers for supported HDR
  and EXR files. Check image dimensions and projection before offering panorama mode. Prefer
  an existing preview or an appropriate smaller variant for oversized files. Add optional
  bounded proxy generation later, with linear colour retained for exposure controls. Tiled,
  multipart, deep or oversized EXRs can still be opened or exported in their original form.
- Keep thumbnails and proxies under local app data. Invalidate cached previews when their
  source changes. Show which file and resolution a preview uses.

## 3. Bring Library workflows across

| Workflow | Shared folder equivalent |
| --- | --- |
| Search, filters and saved searches | Search names, valid metadata and tags. Filter by root, type, format and available map, LOD or HDR resolution. Use global quick matches and saved searches without an account. |
| Grid, list, comparison and inspector | Reuse the Library views, multi-select and preview controls. Show measured or declared dimensions, triangles, maps, file sizes and formats when known. |
| Favorites, tags, notes and collections | Store user metadata separately from the rebuildable index so it survives re-scans and offline shares. Team-wide metadata can follow once permissions and concurrent edits are defined. |
| Health, missing assets and duplicates | Report offline roots, missing references, unsupported previews, empty files and duplicate candidates. Make the distinction between a missing file and a disconnected share visible. |
| Copy, export and open | Reveal the source, open it in a DCC, or copy selected variants and dependencies into a project with progress and conflict handling. Build exports from the selected file manifest and preserve the legacy Bridge export for managed assets. |
| Acquisition, credits and downloads | Use file availability, local versions, copy and export status. Ownership, purchases and provider signing remain catalogue operations. |

The first release treats registered roots as read-only. Organization happens in OpenBridge,
and copy or export writes only to an explicit destination. Removing an item from a collection
does not delete source files. Shared renames, moves and deletes can follow once permissions,
path validation, audit and conflict handling are defined.

## Pilot and acceptance checks

1. Register one model root and one HDRI root. Sample a nested project, a loose interchange
   model with textures, a native-only scene, a multi-resolution HDRI and an oversized EXR.
2. Verify quick matches, filters, comparison, 3D materials, HDR exposure and native-file
   handoff on representative assets. Verify that missing facts remain unknown.
3. Restart, rebuild the index, remap a root and disconnect and reconnect the share. Confirm
   cached results and user organization survive. Exercise cancellation and measure scanning
   and preview latency with the share in use.
4. Exercise spaces, Unicode, duplicate basenames, case differences, sidecar references and
   references outside the root. Use synthetic fixtures for CI on Windows and Linux.
5. Copy a selected package to a disposable project. Verify its dependencies, check the
   original tree for changes, and confirm provider-managed downloads and exports still work.

## Implementation starting points

- `src/main/library.ts` and `src/main/library-index.ts` handle scans and FTS. Root-scoped
  reconciliation is needed before mount changes can be tracked independently.
- `src/main/model-preview.ts` and `src/renderer/components/ModelViewer.tsx` handle local models
  and rendering. Shared model loading needs exact indexed files and validated dependencies.
- `src/main/hdr-decode-worker.ts`, `src/renderer/components/HdrCanvas.tsx` and
  `src/renderer/components/PanoramaCanvas.tsx` provide the existing decode and viewing paths.
- `src/renderer/views/LibraryView.tsx` and `src/main/exporter.ts` are the starting points for
  local browsing and file operations. Add shared source capabilities before exposing actions.

## Inspect a Houdini lookdev publish

The offline recipe tool can inspect readable parameters in a saved HIP without opening the
scene. It accepts one unambiguous Alembic reference and explicit `<UDIM>` image paths
inside the given asset root. It resolves version links inside that root and checks file
sizes and digests against recognized publish manifests. Binary or procedural references
that do not resolve this way require review in their authoring application.

```sh
node scripts/study-houdini-preview.mjs "$ASSET_ROOT" "$LOOKDEV_HIP" > "$RECIPE"
blender --background --factory-startup --disable-autoexec --python-exit-code 3 \
  --python scripts/build-udim-preview.py -- "$RECIPE" "$PREVIEW_GLB" "$METRES_PER_UNIT" "$NORMAL_STRENGTH"
```

Review the recipe against the lookdev shader bindings before baking. Keep the recipe local
because it records source paths. The Blender tool requires the Alembic importer and glTF
exporter. It checks the primary UV layer of each mesh, rejects faces that cross tile borders
and translates the reviewed diffuse, roughness, metalness, tangent normal, opacity and
emission maps to portable material inputs.

The default packs the tiles into padded, reduced-resolution textures. For close-up review,
pass `--native-tiles` after the positional arguments. This retains matching square source
tiles up to 4096 pixels per side as 8-bit PNG textures and creates a separate material for
each tile. Check the GLB against the viewer’s 96 MiB limit before publishing it.

Add `--displace OBJECT HEIGHT_METRES` with `--native-tiles` when the reviewed lookdev
connects a zero-based height map to a specific single-tile mesh. This applies three
Catmull–Clark subdivision levels and bakes the verified BMP map into the mesh. Use the
exact imported object name and the displacement height converted to metres.

The preview uses Blender’s source color interpretation and glTF lighting. Save the GLB
and an authored cover in a prepared collection, then compare them with the original
lookdev render.
