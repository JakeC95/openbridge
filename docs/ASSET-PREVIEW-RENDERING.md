# Consistent local asset previews

Use `scripts/render-shared-preview.py` to create a consistent turntable and
transparent stills from a supported mesh publish. The script is read-only with
respect to its input.

```sh
blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python scripts/render-shared-preview.py -- \
  --input "/path/to/model.glb" \
  --output "/path/to/prepared-asset" \
  --stills
```

`--input` supports Alembic, FBX, glTF/GLB, OBJ, STL, PLY, Collada, and USD
variants supported by the installed Blender build. Relative dependencies such
as OBJ material files are resolved by Blender. Maya scenes and native Blender
scenes are not import inputs for this recipe; publish an exchange-format mesh
first. Use an optional `--hdri` to override the bundled environment only when a
specific review calls for it.

## Shared defaults

- The default HDRI is the same bundled `monochrome_studio_02_1k.hdr` used by
  the app's `ModelViewer`.
- World yaw is zero. The environment lights the model; `film_transparent`
  keeps it out of the camera background.
- Cycles with denoising and AgX is used for repeatable offline renders. Pin
  Blender and FFmpeg versions across workers; output is not guaranteed to be
  bit-identical across versions and hardware.
  Neutral white key/fill/rim lights supplement the HDRI to approximate the
  viewer's light balance.
- There is no floor, backdrop, turntable disk, or other presentation geometry.
- The orthographic camera fits the whole rotation in portrait or landscape.
  Use `--margin`, `--elevation`, and `--azimuth` to tune framing. Imported
  hierarchies and materials are retained. `--source-frame` selects a single
  evaluated pose (default: 0); the turntable does not advance source animation.
- Default delivery is a 72-frame, 1920 × 1080, 24 fps VP9 WebM turntable with
  alpha, an RGBA PNG poster, and—when `--stills` is set—four matching RGBA
  PNG angles. Temporary frame sequences are removed after encoding.
- Encoding is checked by decoding with FFmpeg's `libvpx-vp9` decoder and
  validating transparent as well as visible pixels. FFmpeg's native VP9
  decoder may discard the alpha plane, so do not use it to verify a transparent
  WebM.
- Previews are staged in the output directory and validated before replacing
  existing files. Replacements are atomic per file, not as a batch; run one
  render job per output directory.
- A supported extension does not guarantee that a particular publish is
  self-contained. Missing textures, unsupported shaders, procedural scenes,
  and non-mesh assets still need format-specific ingest checks.

The shared HDRI, white lighting, neutral color management, transparent output,
and automatic framing provide a common starting point across assets. Blender's
Cycles/AgX output is not pixel-identical to the Three.js/ACES viewer; evaluate
visual consistency in the app and adjust shared defaults rather than adding
per-asset lighting exceptions. Keep source lookdev distinct from generated
technical previews in the presentation metadata.

## Fidelity review before replacing previews

Use the native scene as evidence for shader assignments, not as a reason to
change the shared thumbnail or turntable style. Compare front and rear proofs
under the same camera and lights. Check transparent covers, clear coat and the
texture channels actually exported to the interactive model. Keep any native
studio render separately as an authored reference. See the
[ingest playbook](ASSET-INGEST-PLAYBOOK.md) for native scene and proxy tooling.

Stage the model, poster, stills and turntable together. Verify frame count,
resolution, decoded alpha, and playback, then open the interactive model in
the packaged app. Do not replace a working entry with a partial render.
Use `ffprobe` to confirm dimensions and frame rate, then run
`python3 scripts/check-preview-alpha.py path/to/turntable.webm` to check all
72 decoded frames for visible pixels, transparency, and clear edges.
Pass explicit dimensions and frame count for nonstandard proofs.

### Characters and layered skin

- Keep the full source pose in the shared 16:9 frame. A T/A pose is wider than
  a prop; do not crop the arms just to make the character look larger.
- Add a collapsed `Detail` group with a 16:9 face crop from the three-quarter
  still. Check the head, eyes and skin at 1080p; whole-body thumbnails hide
  eye and material errors.
- Separate rig capability from the static viewer. It is valid to list joints
  and skin clusters in the metadata, but the preview is a geometry snapshot
  unless the viewer actually supports the rig.
- Legacy SSS characters often ship overall, epidermal and subdermal color
  layers rather than ready-made albedo. A blended portable color is an
  approximation; label it and leave the native reference distinct. Do not
  imply that displacement or subsurface scattering survived.
- Use a neutral sclera color rather than a production mask texture. If the
  sclera has a transparency map, invert it for glTF opacity (white often means
  transparent in DCC shaders) and verify the iris reads through the opening.
- Exclude blendshape targets, collision meshes and simulation inputs with an
  explicit allowlist, then reimport the review export and check part names,
  face counts and UV layers.

## Consistent presentation metadata

- Use the generated turntable as the hero and include the same four angles in
  this order: three-quarter, profile, rear three-quarter, opposite profile.
- Use the shared labels `Blender technical turntable` and
  `Three-quarter · Blender preview` (likewise for the other angle names).
- Put published formats and other source-publish facts first. Keep generated
  preview settings out of the artist-facing metadata.
- Put optional authored/production imagery in a named `group` (for example,
  `Authored lookdev`) so it stays available without crowding the shared
  technical-preview gallery.
