# Studio asset ingest playbook

Process one asset through discovery, preview and visual review before moving
to the next. Work read-only on production sources. Keep asset-specific paths,
artwork and evidence logs in local handoffs, not in this public repository.

## Iteration handoff

`AGENTS.md` requires each agent to add reusable findings before picking up the
next asset. Capture the symptom, what proved it, what worked, and what to check
next time. Include failed experiments when they can save another agent time;
label a tested failure separately from its suspected cause. Put rendering
recipes in [preview rendering](ASSET-PREVIEW-RENDERING.md) and browsing or
handoff conventions in [presentation details](PRESENTATION-DETAILS.md).

The private handoff records exact source candidates and versions, matched
bindings, selected roots or parts, tool versions and limits, preview-only edits,
acceptance evidence and the next unresolved question. Mark the result as
authored/native, translated, technical-only, or unverified where applicable.
Never publish studio files, paths, screenshots or logs. Do not mutate the
production source or a curated comparison benchmark to make a new asset pass.

## Discovery

1. Record the original asset name/type and inventory the whole asset folder:
   native scenes, exchange publishes, texture roots, render output, references,
   delivery archives, manifests and version folders. Ignore AppleDouble
   `._*` files and `.DS_Store`. Check whether folders or files are links.
2. Search adjacent assets and relevant project ingest, source, library and
   publish roots using aliases, asset IDs, normalized spellings and distinctive
   dependency basenames. Bound searches on network shares. Record roots, depth,
   access failures and timeouts; “not found in these locations” is not “absent.”
   A broken `latest` link is not a version: compare direct versioned files and
   verify the one used. Matching counts alone do not establish equivalence;
   compare transforms, bounds and assignments, or hashes for byte identity.
3. Compare candidates by what they preserve, not extension, size or date.
   Inspect mesh names, hierarchy, material slots, image bindings, UVs, scale
   and animation. Check OBJ `mtllib` and MTL map directives; inspect FBX image
   nodes and embedded media; for LWO2, inspect `TAGS`, `SURF` and `CLIP`.
   Hash companion images to detect duplicate export bundles.
4. **Inspect native scenes even when exchanges import successfully.** When a
   3ds Max scene is a Compound File, `7z l scene.max` can list its streams.
   `7z x -so scene.max FileAssetMetaData2 | strings -el` (also check
   `FileAssetMetaData3` where present) can recover historical bitmap and output
   filenames. Inspect scene/class strings for plugin
   evidence. `SummaryInformation` can contain a clipboard-format thumbnail
   (for example a DIB inside property 17). Extract only with bounded,
   validated parsing and visually check it. These are read-only evidence
   techniques, not substitutes for native scene evaluation. Use a compatible
   DCC and renderer for an authoritative material report or re-export.
5. Search recovered dependency basenames again. Classify each hit as **bound**,
   **present but unbound**, **referenced but unresolved**, or **unverified**.
   Distinguish source textures from render outputs, previews and references.
   A matching basename or a native thumbnail does not recover shader graphs.
   Record file counts separately from unique bitmaps, bound inputs and exported
   payloads. A generated 1×1 texture is not a recovered bitmap, and one source
   image may export twice for color and packed scalar channels. A LUT or grade
   is not a surface texture.

## Prop packs and catalog walls

Some folders are libraries, not single assets. Check root groups and their
bounds before choosing a preview:

- Inventory a library by volume or sub-package, and join models, previews and
  textures by confirmed IDs or bindings. Process one representative entry first
  rather than batch-importing unverified variants or guessing from filenames.
  A directory listing does not establish file access; report inaccessible
  volumes separately. Match by the stable ID, allowing harmless differences
  in filename case, prefix or punctuation rather than renaming the source.
- An Alembic cache can retain UVs and named mesh parts but import without
  material slots. Try a small proof with exact part-to-map matches and check
  it against the supplied reference. This establishes a translated binding,
  not the original shader. Don't assume neighboring asset maps for reused
  components or treat a file named `Reflection` as roughness without evidence.
  Before using filename guesses, run the Alembic SDK's `abcecho` to inspect
  `.arbGeomParams` for Houdini's `shop_materialpath`. If present, use the
  matching SDK to expand the indexed string parameter and compare its scope
  and count to the face counts. An archive-wide string list or a user property
  cannot establish which faces use a material. A uniform assignment allows
  a verified whole-mesh binding; mixed assignments also require proving the
  face order survives import. Match the recovered material IDs against the
  entire companion folder, including shared or differently named parts,
  and keep native shader graphs and unresolved channels separately labeled.
  Compare coverage by mesh and material, not just by the number of bundled
  images. Accessories, interior cards and repeated instances may use a common
  material name instead of the model ID. Prefer a verified same-package alias
  over borrowing from a neighboring entry. An assigned glass material with no
  matching bitmap is not necessarily missing a texture; the native parameters
  may simply be unavailable.
- If the source is a product wall/grid, do not turntable the whole catalog.
  Isolate one representative hero variant by its root and descendants, record
  why it was chosen, and keep the pack count/context in facts or a collapsed
  group.
- Verify the isolated export contains the intended meshes, materials and
  images. Report hero counts separately from pack counts.
- Inspect transparent shells, bottles, glass and overlapping parts at full
  resolution. Alpha dithering, hidden internal rings or z-fighting are reasons
  to choose another variant; do not promote a hero with artifacts.
- A pack overview is optional. If it is not readable at gallery size, keep it
  out of the primary gallery or make a larger, clearly labeled reference
  image. A tiny catalog thumbnail is worse than no image.
- Treat supplied exchange variants (for example separate renderer exports) as
  alternate evidence, not proof that the hero's materials survived. Test the
  alternate in a separate process if one importer crashes. Spatial proximity
  alone can merge an entire pack; verify root descendants and reference views
  before isolating a model, and record exactly which source supplied it.

## Native scene adapters

- **Maya characters (`.ma`, `.mb`):** Separate stock ingest, shot work,
  exchange exports, and rig publishes. A shared folder name does not prove
  that a stock skin texture set matches a later clothed character's UVs.
  For ASCII scenes, inventory plugin requirements, units and declared file
  nodes without running the scene. Resolve historical paths against the
  asset root, then verify shader connections, UVs and deformation separately.
  Preserve authored subsurface, gloss and displacement semantics; do not
  label them as portable base color, roughness or normals without a verified
  conversion. For binary scenes, use a restricted Maya worker with script
  nodes disabled and references unloaded on the first inspection. Report
  unavailable plugins and unloaded references as limits on the result.
  For a static preview, inspect parent visibility and display layers as
  well as intermediate shape flags. Exclude blendshape targets, collision
  meshes and simulation inputs from the review export. Keep the native
  rig and its controls distinct from the static viewer copy.
  Do not trust a successful FBX export alone: reimport it and check the
  expected part names, face counts and UV layers. If rig visibility or export
  rules omit an intended part, explicitly snapshot evaluated geometry and
  UVs for the approved meshes in a scratch scene. Document which shader
  channels were translated versus left out.
  For stock characters, separate the base ingest, rig publish, shot scene and
  clothed exchange variant. A shot scene may contain set geometry and a single
  shared material, so it is not evidence of the character's look. Check the
  rendered face at full resolution: eyes and layered skin errors disappear in
  a whole-body thumbnail. Legacy SSS maps (overall, epidermal, subdermal) are
  layers, not ready-made albedo; a blended preview must be labeled as an
  approximation. A sclera transparency map may use white for transparent;
  invert it for glTF opacity and verify that the iris reads through the opening.

- **Houdini (`.hip`, `.hiplc`, `.hipnc`):** Prefer published lookdev and
  assembly scenes for assignments, and model publishes for geometry. Compare the
  published scene with the work scene rather than assuming they match. Start
  with `python3 scripts/inventory-hip-archive.py <scene>` for uncompressed odc
  archives. It reads serialized node types and parameter evidence without
  extracting members, executing scene code, or following paths. Pair numbered
  group selectors with material paths on the same SOP, then trace image nodes
  and distinguish input files from render/export destinations. Texture tokens
  such as `<UDIM>` and `latest` are declarations, not proof of tile availability.
  Resolve and record exact publish versions before preparing a preview.
  Older Packed Edit SOPs can leave `mgroupN` empty but assign a material
  through `mpackednameN` and `shop_materialpathN`. Match the indexed packed
  selector to Alembic object paths before translating the look. A blank group
  field does not mean the assignment is global. A blank texture directory does
  not mean a smooth surface is correct: inspect procedural shader nodes (such
  as UV-based perforation or bump) and distinguish them from missing bitmaps.
  Trace links to the surface or displacement output: an archived generator can
  be disconnected. A pattern based on its parameters is a preview approximation,
  not a recovered authored material. Verify tiled UVs and inspect close-ups and
  normal shading in the delivered GLB, not just the scratch scene.

  For trusted scenes use the matching studio Houdini/plugin environment and
  `hython scripts/probe-houdini-scene.py <scene> --geometry /path/to/output`.
  The optional geometry probe cooks the selected SOP and reports local bounds,
  groups and attribute tables. String tables are not per-face assignments.
  For packed Alembic and Solaris, verify packed contents or USD prim material
  bindings separately. Loading/cooking a scene can execute custom code: use a
  restricted worker with read-only mounts and a deadline, never app indexing.
  If Houdini or renderer startup fails, label archive results as declared
  evidence and do not promote them to evaluated geometry or shader facts.
- **MAX:** Try the optional [Blender MAX importer](https://extensions.blender.org/add-ons/io-scene-max/)
  on a scratch copy with verified companion files. `scripts/probe-max-scene.py`
  was exercised with Blender 5.1.2 and importer v1.9.2 (commit `37db107`).
  Use a reviewed checkout, a separate worker, no credentials, read-only source
  access and a time limit. Do not bundle the importer or run it during indexing.
  `MAX_PROBE` is a report of translated data, not a native scene evaluation.
  Compare hierarchy, UV layers, face counts per material slot, shader socket
  values and image links. Explicitly record unsupported or approximated
  channels; a named material with no transmission or map connection is not
  evidence that the original was opaque or untextured.
  Separate **slot present**, **faces using the slot**, **image connected** and
  **image exported**. An image omitted from GLB can belong to an unused slot,
  not a broken exporter. Label a texture by its actual shader connection,
  not its filename. Compare triangulated counts separately from polygon
  counts when assessing topology across formats.

  ```sh
  OPENBRIDGE_MAX_INPUT="/scratch/model.max" blender -b --factory-startup \
    --disable-autoexec --python-exit-code 1 --python scripts/probe-max-scene.py -- \
    --addon /path/to/io_scene_max/source
  ```

  A full scene can include studio geometry that swamps framing. Exclude only
  inspected non-asset meshes with `--exclude`, and compare units, topology,
  material assignments, glass and decals against the exchange source and any
  authored reference before promoting an experimental `--glb` export.
  Check scale against a second publish with known units; native import units
  may differ by 100×. Inspect the exported GLB, not just the Blender scene:
  an imported image can be missing from the export if its node connections
  are unsupported. For glass, verify transmission and tint in both the
  turntable and the interactive viewer. Record any preview-only shader edits
  as approximations and retain the authored reference for comparison.
  Use [3ds Max Batch](https://help.autodesk.com/view/3DSMAX/2026/ENU/?guid=GUID-0968FF0A-5ADD-454D-B8F6-1983E76A4AF9)
  with compatible V-Ray for authoritative evaluation or a native reference render.
- **V-Ray scenes (`.vrscene`):** Use a bounded, non-executing inventory for
  plugin declarations and dependency references. Keep includes and external
  paths unresolved unless explicitly permitted. `python3 scripts/inventory-vrscene.py <scene>`
  reports selected node, material, bitmap and proxy links from text scenes
   up to 32 MiB. It is not a shader or geometry decoder. For larger native
   production exports, inspect supported declarations separately or use the
   vendor runtime. Use the
  [Chaos App SDK](https://documentation.chaos.com/space/APPSDK/132645055/Getting+Started)
  for authoritative plugin graphs or V-Ray Standalone for reference renders.
  The MIT-licensed [C++ vrscene_parser](https://github.com/nilss0n/vrscene_parser)
  is another syntax reader: revision `5551c50` passed a synthetic scene after
  supplying `<cmath>` at compile time. It does not evaluate plugins or load
  binary geometry. [Chaos's Blender add-on source](https://github.com/ChaosGroup/vray_for_blender_addon)
  is useful for parameter mappings, not a standalone replacement for the renderer.
- **V-Ray proxies (`.vrmesh`):** Prefer Chaos
  [`ply2vrmesh -info`](https://documentation.chaos.com/space/VRAY4TOOLS/117637141.md)
  for inventory and the SDK for geometry extraction. Keep viewport preview
  geometry separate from full geometry and material IDs separate from assigned
  shaders; the latter come from the host scene. Check installed Houdini and
  Maya V-Ray bundles even if the converter is not on `PATH` (some Linux builds
  name it `ply2vrmesh.bin`). `scripts/probe-vrmesh.py <proxy> --tool <executable>`
  reads one frame and keeps full and preview triangle counts separate. Verified
  against a one-triangle proxy created with Chaos's July 2025 converter.
  Full mesh extraction through the SDK is not yet verified.

Production exports can be hundreds of MiB. Keep the small text inventory
bounded; use the vendor runtime or stream selected declarations without
retaining geometry payloads. Compare duplicate exports with the timestamp
header excluded. Remap verified bitmap paths in a scratch copy only, and
check native reference images visually: a successful render can still be
limited to the author's saved region. Use `-region=none` for a full-frame
reference. For proxy reports, handle comma-separated counts and inspect
object names before treating aggregate counts as asset-only geometry.
Keep a verified native render in an authored-reference group when the 3D
viewer uses translated materials. Show packed scalar textures as the actual
grayscale channel (for example, green for glTF roughness), not the combined
RGB packing image. Label native-only maps separately from viewer bindings.
Use matched proof renders under the shared preview rig when adjusting a
translated look. Trace native shader values through the actual object
assignment before applying a correction. For example, refractive lamp covers
can translate as opaque despite a preserved IOR, and a layered paint can need
an explicit coat approximation. Keep lighting, camera and framing unchanged
for before/after review; a better material translation should not require a
one-off presentation style.

For native-look parity, obtain a compatible DCC export and reference renders
with the asset isolated. Compare matched views and check geometry, material
assignments, UVs, glass, layered paint, lights and missing map behavior before
replacing a translated preview. Preserve the native source and reference
even when the real-time material must remain an approximation.

## Prepare and verify

- Choose the best verified geometry source and the best verified look source
  independently. If only geometry is reproducible, show a neutral preview and
  label it accordingly. A recovered native thumbnail is useful as optional
  authored reference, not as proof the interactive look matches. If units
  cannot be verified, keep source-axis bounds as units and omit physical
  dimensions and human-scale diagrams.
- Follow [preview rendering](ASSET-PREVIEW-RENDERING.md). Inspect opening,
  side and rear frames plus playback, and compare the turntable to a direct
  render when parts drift. Preserve animated transform channels when adding a
  temporary rotation parent; check hierarchy and trim after reparenting.
- In the packaged app, verify headline, category, source formats, turntable,
  alternate views and relevant disclosures. Prefer artist-useful facts on the
  first screen; disclose gaps accurately without exposing pipeline internals.
- Compare with an equivalent online-provider asset in the same app. Check
  thumbnail framing, name/type hierarchy, card density, grid/list switching,
  selection and keyboard focus, drawer navigation, and preview controls.
  Reuse shared components, design tokens, and browsing state where the behavior
  is the same. Check the end-to-end handoff too: online download and local copy
  are different actions, but both should make the usable files and destination
  clear. Do not present missing source data or unsupported actions as available
  merely to make the two views look alike.
- Check **List / Compare** as well as the grid. Keep the same display name,
  published formats and studio category when changing views. Keep measurements
  blank until verified and distinguish the published format from the preview
  file. Discover → All and Library currently have separate queries; do not
  count shared styling as proof of mixed-source discovery or handoff parity.
- Before starting the next asset, update this playbook with any reusable
  discovery technique, failure mode or verification check. Keep the detailed
  source inventory, evidence and unresolved leads in the private local handoff.
