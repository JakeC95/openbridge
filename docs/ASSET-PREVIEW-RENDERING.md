# Consistent local asset previews

Use `scripts/render-shared-preview.py` to create a consistent turntable and
transparent stills from a supported mesh publish. The script is read-only with
respect to its input.

```sh
blender --background --python scripts/render-shared-preview.py -- \
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
- Cycles with denoising and AgX is used for deterministic offline renders.
  Neutral white key/fill/rim lights supplement the HDRI to approximate the
  viewer's light balance.
- There is no floor, backdrop, turntable disk, or other presentation geometry.
- The orthographic camera frames evaluated mesh bounds with a fixed breathing
  margin. Imported object hierarchies and materials are retained; only a
  temporary parent is used to rotate the asset around its bounds center.
- Default delivery is a 72-frame, 1920 × 1080, 24 fps VP9 WebM turntable with
  alpha, an RGBA PNG poster, and—when `--stills` is set—four matching RGBA
  PNG angles. Temporary frame sequences are removed after encoding.
- Encoding is checked by decoding with FFmpeg's `libvpx-vp9` decoder and
  validating transparent as well as visible pixels. FFmpeg's native VP9
  decoder may discard the alpha plane, so do not use it to verify a transparent
  WebM.

The shared HDRI, white lighting, neutral color management, transparent output,
and automatic framing provide a common starting point across assets. Blender's
Cycles/AgX output is not pixel-identical to the Three.js/ACES viewer; evaluate
visual consistency in the app and adjust shared defaults rather than adding
per-asset lighting exceptions. Keep source lookdev distinct from generated
technical previews in the presentation metadata.

## Consistent presentation metadata

- Use the generated turntable as the hero and include the same four angles in
  this order: three-quarter, profile, rear three-quarter, opposite profile.
- Use the shared labels `Blender technical turntable` and
  `Three-quarter · Blender preview` (likewise for the other angle names).
- Keep the four primary facts consistent and in this order: prepared GLB size,
  preview renderer, preview geometry, and model parts. Put source-publish facts
  in the expanded specifications and identify source files that are not
  included in the prepared folder.
- Put optional authored/production imagery in a named `group` (for example,
  `Authored lookdev`) so it stays available without crowding the shared
  technical-preview gallery.
