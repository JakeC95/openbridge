# Studio asset ingest playbook

Process one asset through discovery, preview and visual review before moving
to the next. Work read-only on production sources. Keep asset-specific paths,
artwork and evidence logs in local handoffs, not in this public repository.

## Discovery

1. Record the original asset name/type and inventory the whole asset folder:
   native scenes, exchange publishes, texture roots, render output, references,
   delivery archives, manifests and version folders. Ignore AppleDouble
   `._*` files and `.DS_Store`. Check whether folders or files are links.
2. Search adjacent assets and relevant project ingest, source, library and
   publish roots using aliases, asset IDs, normalized spellings and distinctive
   dependency basenames. Bound searches on network shares. Record roots, depth,
   access failures and timeouts; “not found in these locations” is not “absent.”
3. Compare candidates by what they preserve, not extension, size or date.
   Inspect mesh names, hierarchy, material slots, image bindings, UVs, scale
   and animation. Check OBJ `mtllib` and MTL map directives; inspect FBX image
   nodes and embedded media; for LWO2, inspect `TAGS`, `SURF` and `CLIP`.
   Hash companion images to detect duplicate export bundles.
4. **Inspect native scenes even when exchanges import successfully.** When a
   3ds Max scene is a Compound File, `7z l scene.max` can list its streams.
   `7z x -so scene.max FileAssetMetaData2 | strings -el` can recover historical
   bitmap and output filenames. Inspect scene/class strings for plugin
   evidence. `SummaryInformation` can contain a clipboard-format thumbnail
   (for example a DIB inside property 17). Extract only with bounded,
   validated parsing and visually check it. These are read-only evidence
   techniques, not substitutes for native scene evaluation. Use a compatible
   DCC and renderer for an authoritative material report or re-export.
5. Search recovered dependency basenames again. Classify each hit as **bound**,
   **present but unbound**, **referenced but unresolved**, or **unverified**.
   Distinguish source textures from render outputs, previews and references.
   A matching basename or a native thumbnail does not recover shader graphs.

## Prepare and verify

- Choose the best verified geometry source and the best verified look source
  independently. If only geometry is reproducible, show a neutral preview and
  label it accordingly. A recovered native thumbnail is useful as optional
  authored reference, not as proof the interactive look matches.
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
