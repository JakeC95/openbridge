"""Render transparent, consistently lit asset previews with Blender.

Run with:
  blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python scripts/render-shared-preview.py -- \
    --input asset.glb --output /path/to/preview --hdri src/renderer/assets/monochrome_studio_02_1k.hdr

The source file is read-only. Renders include transparent PNG stills and a VP9
WebM turntable with alpha. No ground/backdrop geometry is created.
"""

import argparse
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

import bpy
from mathutils import Vector


def arguments():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    # Blender's command-line parser currently splits quoted values forwarded
    # after `--`. Rejoin path tokens up to the next option so asset/library
    # directories containing spaces remain usable.
    value_options = {
        "--input", "--output", "--hdri", "--frames", "--fps",
        "--width", "--height", "--samples", "--crf", "--source-frame", "--margin", "--elevation", "--azimuth",
    }
    joined = []
    index = 0
    while index < len(argv):
        token = argv[index]
        option, separator, value = token.partition("=")
        if token in value_options or (separator and option in value_options):
            values = [value] if separator else []
            index += 1
            while index < len(argv) and not argv[index].startswith("--"):
                values.append(argv[index])
                index += 1
            if not values:
                joined.append(token)
            else:
                joined.extend([option, " ".join(values)])
            continue
        joined.append(token)
        index += 1
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--hdri", type=Path)
    parser.add_argument("--frames", type=int, default=72)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--samples", type=int, default=12)
    parser.add_argument("--crf", type=int, default=30)
    parser.add_argument("--source-frame", type=int, default=0, help="Sample animated inputs at this frame for the entire turntable.")
    parser.add_argument("--margin", type=float, default=0.12, help="Extra framing space as a fraction of fitted span.")
    parser.add_argument("--elevation", type=float, default=27)
    parser.add_argument("--azimuth", type=float, default=-54)
    parser.add_argument("--stills", action="store_true", help="Also render four transparent angle stills.")
    return parser.parse_args(joined)


def import_asset(path):
    suffix = path.suffix.lower()
    before = set(bpy.data.objects)
    if suffix == ".abc":
        bpy.ops.wm.alembic_import(filepath=str(path), as_background_job=False)
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    elif suffix in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    elif suffix == ".stl":
        bpy.ops.wm.stl_import(filepath=str(path))
    elif suffix == ".ply":
        bpy.ops.wm.ply_import(filepath=str(path))
    elif suffix == ".dae":
        bpy.ops.wm.collada_import(filepath=str(path))
    elif suffix in (".usd", ".usda", ".usdc", ".usdz"):
        bpy.ops.wm.usd_import(filepath=str(path))
    else:
        raise ValueError(f"Unsupported input format: {suffix}")
    imported = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("The imported asset contains no mesh objects.")
    # Imported cameras and lights are not part of an asset presentation.
    for obj in imported:
        if obj.type in {"CAMERA", "LIGHT"}:
            obj.hide_render = True
    return imported, meshes


def bounds(meshes, depsgraph):
    points = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        if obj.hide_render or not evaluated.data.polygons:
            continue
        points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    if not points or not all(math.isfinite(value) for point in points for value in point):
        raise RuntimeError("Expected finite bounds from at least one renderable mesh with faces.")
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    return low, high, (low + high) * 0.5


def load_environment(scene, hdri):
    if not hdri.is_file():
        raise FileNotFoundError(f"Shared viewer HDRI not found: {hdri}")
    world = bpy.data.worlds.new("OpenBridge · shared studio HDRI")
    world.use_nodes = True
    scene.world = world
    nodes = world.node_tree.nodes
    nodes.clear()
    environment = nodes.new("ShaderNodeTexEnvironment")
    environment.image = bpy.data.images.load(str(hdri), check_existing=True)
    environment.interpolation = "Linear"
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Strength"].default_value = 0.2
    output = nodes.new("ShaderNodeOutputWorld")
    world.node_tree.links.new(environment.outputs["Color"], background.inputs["Color"])
    world.node_tree.links.new(background.outputs["Background"], output.inputs["Surface"])


def area_light(scene, name, center, direction, radius, power, size_factor, color):
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = power * radius * radius
    data.shape = "DISK"
    data.size = max(radius * size_factor, 0.001)
    data.color = color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = center + Vector(direction) * radius
    obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()


def set_studio(scene, center, radius):
    # Mirrors the viewer's neutral key/fill balance; HDRI is the same bundled
    # environment used by ModelViewer.tsx, and its yaw starts at zero.
    area_light(scene, "Viewer key", center, (0.55, -0.75, 0.9), radius, 140, 2.8, (1, 1, 1))
    area_light(scene, "Viewer fill", center, (-0.8, 0.35, 0.25), radius, 45, 3.8, (1, 1, 1))
    area_light(scene, "Viewer rim", center, (0.1, 0.9, 0.65), radius, 60, 2.4, (1, 1, 1))


def setup_camera(scene, center, low, high, args):
    aspect = args.width / args.height
    elevation, azimuth = map(math.radians, (args.elevation, args.azimuth))
    direction = Vector((math.cos(elevation) * math.cos(azimuth),
                        math.cos(elevation) * math.sin(azimuth), math.sin(elevation)))
    rotation = (-direction).to_track_quat("-Z", "Y")
    right = rotation @ Vector((1, 0, 0))
    up = rotation @ Vector((0, 1, 0))
    corners = [Vector((x, y, z))
               for x in (low.x, high.x)
               for y in (low.y, high.y)
               for z in (low.z, high.z)]
    projected = [corner - center for corner in corners]
    # A point rotating around Z traces a circle. Its maximum projection on
    # either camera axis is its XY radius times that axis's XY length plus
    # its fixed vertical contribution. Fit the entire orbit, not frame zero.
    def extent(axis):
        return max(math.hypot(p.x, p.y) * math.hypot(axis.x, axis.y) + abs(p.z * axis.z)
                   for p in projected)

    # Blender's orthographic scale is the span of the longer image axis.
    span = 2 * max(extent(right) * max(1, 1 / aspect),
                   extent(up) * max(1, aspect)) * (1 + args.margin)
    distance = max((high - low).length * 2.5, 0.001)
    data = bpy.data.cameras.new("OpenBridge · fitted orthographic camera")
    data.type = "ORTHO"
    data.ortho_scale = max(span, 0.001)
    camera = bpy.data.objects.new(data.name, data)
    scene.collection.objects.link(camera)
    camera.location = center + direction * distance
    camera.rotation_euler = rotation.to_euler()
    data.clip_start = max(distance / 10000, 0.0001)
    data.clip_end = distance * 10
    scene.camera = camera


def add_turntable_parent(scene, imported, center):
    pivot = bpy.data.objects.new("OpenBridge · turntable pivot", None)
    scene.collection.objects.link(pivot)
    pivot.location = center
    bpy.context.view_layer.update()
    # Parent only top-level imported roots so imported hierarchies and armatures
    # remain intact, while the complete asset still rotates as one unit.
    roots = [obj for obj in imported if obj.parent is None and obj.type not in {"CAMERA", "LIGHT"}]
    parent_inverse = pivot.matrix_world.inverted()
    for obj in roots:
        obj.parent = pivot
        # Preserve the imported local transform channels, including any
        # animation. Rewriting matrix_world can be undone on evaluation.
        obj.matrix_parent_inverse = parent_inverse
    return pivot


def assert_rgba_png(path, require_transparency=False, require_clear_edges=False):
    with path.open("rb") as image:
        raw = image.read()
    if len(raw) < 26 or raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"Expected a PNG with alpha channel: {path}")
    width, height, bit_depth, color_type = struct.unpack(">IIBB", raw[16:26])
    if color_type != 6 or bit_depth != 8:
        raise RuntimeError(f"Expected an 8-bit RGBA PNG: {path}")
    if not require_transparency:
        return
    compressed = bytearray()
    offset = 8
    while offset + 12 <= len(raw):
        length = struct.unpack(">I", raw[offset:offset + 4])[0]
        kind = raw[offset + 4:offset + 8]
        payload = raw[offset + 8:offset + 8 + length]
        if kind == b"IDAT":
            compressed.extend(payload)
        offset += length + 12
        if kind == b"IEND":
            break
    data = zlib.decompress(compressed)
    stride = width * 4
    previous = bytearray(stride)
    alpha_zero = False
    alpha_visible = False

    def paeth(a, b, c):
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        return a if pa <= pb and pa <= pc else b if pb <= pc else c

    cursor = 0
    for y in range(height):
        filter_type = data[cursor]
        cursor += 1
        row = bytearray(data[cursor:cursor + stride])
        cursor += stride
        for index in range(stride):
            left = row[index - 4] if index >= 4 else 0
            above = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                row[index] = (row[index] + left) & 255
            elif filter_type == 2:
                row[index] = (row[index] + above) & 255
            elif filter_type == 3:
                row[index] = (row[index] + ((left + above) // 2)) & 255
            elif filter_type == 4:
                row[index] = (row[index] + paeth(left, above, upper_left)) & 255
            elif filter_type != 0:
                raise RuntimeError(f"Unsupported PNG filter {filter_type}: {path}")
        alpha = row[3::4]
        alpha_zero |= 0 in alpha
        alpha_visible |= any(alpha)
        if require_clear_edges:
            edge = alpha if y in (0, height - 1) else (alpha[0], alpha[-1])
            if any(edge):
                raise RuntimeError(f"Asset touches the image edge: {path}. Increase --margin.")
        previous = row
    if not alpha_zero or not alpha_visible:
        raise RuntimeError(f"Render needs both visible and transparent pixels: {path}")


def render_frame(scene, pivot, angle, path):
    pivot.rotation_euler.z = angle
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    assert_rgba_png(path)


def main():
    args = arguments()
    source = args.input.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if args.frames < 4 or args.width < 64 or args.height < 64 or args.samples < 1:
        raise ValueError("frames must be >=4, dimensions >=64, and samples >=1.")
    if args.width % 2 or args.height % 2 or not 1 <= args.fps <= 240 or not 0 <= args.crf <= 63:
        raise ValueError("Use even dimensions, FPS in [1, 240], and CRF in [0, 63].")
    if not 0 <= args.margin <= 2 or not -89 <= args.elevation <= 89 or not math.isfinite(args.azimuth):
        raise ValueError("Use margin in [0, 2], elevation in [-89, 89], and a finite azimuth.")
    hdri = args.hdri.expanduser().resolve() if args.hdri else (
        Path(__file__).resolve().parents[1] / "src/renderer/assets/monochrome_studio_02_1k.hdr"
    )
    ffmpeg = shutil.which(os.environ.get("FFMPEG_BIN", "ffmpeg"))
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to encode the alpha turntable WebM.")
    if not hdri.is_file():
        raise FileNotFoundError(f"Shared viewer HDRI not found: {hdri}")
    encoders = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], check=True, capture_output=True, text=True).stdout
    if not any("libvpx-vp9" in line.split() for line in encoders.splitlines()):
        raise RuntimeError("ffmpeg must include the libvpx-vp9 encoder.")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    imported, meshes = import_asset(source)
    scene = bpy.context.scene
    scene.frame_set(args.source_frame)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    low, high, center = bounds(meshes, depsgraph)
    radius = max((high - low).length * 0.5, 0.001)

    load_environment(scene, hdri)
    set_studio(scene, center, radius)
    setup_camera(scene, center, low, high, args)
    pivot = add_turntable_parent(scene, imported, center)

    scene.render.engine = "CYCLES"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 15
    scene.render.fps = args.fps
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.5
    scene.view_settings.gamma = 1
    output.mkdir(parents=True, exist_ok=True)

    still_frames = {
        0: "three-quarter",
        args.frames // 4: "profile",
        args.frames // 2: "rear-three-quarter",
        (args.frames * 3) // 4: "opposite-profile",
    }
    with tempfile.TemporaryDirectory(prefix=".openbridge-preview-", dir=output) as temp:
        frames_dir = Path(temp)
        publish = {}
        for frame in range(args.frames):
            frame_path = frames_dir / f"frame_{frame:04d}.png"
            render_frame(scene, pivot, math.tau * frame / args.frames, frame_path)
            if args.stills and frame in still_frames:
                publish[output / "media" / "stills" / f"{still_frames[frame]}.png"] = frame_path
            if frame == 0:
                publish[output / "media" / "turntable-poster.png"] = frame_path
                publish[output / f"{source.stem}.png"] = frame_path
            if frame in still_frames:
                assert_rgba_png(frame_path, require_transparency=True, require_clear_edges=args.margin >= 0.05)

        video = frames_dir / "turntable.webm"
        command = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-framerate", str(args.fps), "-i", str(frames_dir / "frame_%04d.png"),
            "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
            "-auto-alt-ref", "0", "-b:v", "0", "-crf", str(args.crf),
            "-deadline", "good", "-row-mt", "1", "-metadata:s:v:0", "alpha_mode=1",
            str(video),
        ]
        subprocess.run(command, check=True)
        # Decode one frame back to RGBA and verify the encoded video kept alpha.
        decoded = frames_dir / "webm-alpha-check.png"
        subprocess.run([
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            # FFmpeg's native VP9 decoder may discard WebM alpha; use libvpx.
            "-c:v", "libvpx-vp9", "-i", str(video),
            "-frames:v", "1", "-pix_fmt", "rgba", str(decoded),
        ], check=True)
        assert_rgba_png(decoded, require_transparency=True)
        publish[output / "media" / video.name] = video
        for index, (target, staged) in enumerate(publish.items()):
            target.parent.mkdir(parents=True, exist_ok=True)
            replacement = frames_dir / f"publish-{index}"
            shutil.copyfile(staged, replacement)
            replacement.replace(target)

    print(f"Rendered {args.frames} alpha frames with {hdri.name}: {output / 'media' / video.name}")


if __name__ == "__main__":
    main()
