"""Render transparent, consistently lit asset previews with Blender.

Run with:
  blender --background --python scripts/render-shared-preview.py -- \
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
        "--width", "--height", "--samples", "--crf",
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
        points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    if not points:
        raise RuntimeError("Could not calculate mesh bounds.")
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


def setup_camera(scene, center, low, high, width, height):
    aspect = width / height
    direction = Vector((0.72, -1.0, 0.63)).normalized()
    rotation = (-direction).to_track_quat("-Z", "Y")
    right = rotation @ Vector((1, 0, 0))
    up = rotation @ Vector((0, 1, 0))
    corners = [Vector((x, y, z))
               for x in (low.x, high.x)
               for y in (low.y, high.y)
               for z in (low.z, high.z)]
    projected = [corner - center for corner in corners]
    half_width = max(abs(p.dot(right)) for p in projected)
    half_height = max(abs(p.dot(up)) for p in projected)
    # Blender orthographic scale is the horizontal span. Include a fixed 12%
    # breathing margin and derive it from the projected bounds, not source units.
    span = max(half_width * 2, half_height * 2 * aspect) * 1.12
    distance = max((high - low).length * 2.5, 1.0)
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
    for obj in roots:
        world_matrix = obj.matrix_world.copy()
        obj.parent = pivot
        obj.matrix_world = world_matrix
    return pivot


def assert_rgba_png(path, require_transparency=False):
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
    for _ in range(height):
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
        for index in range(3, stride, 4):
            alpha_zero |= row[index] == 0
            alpha_visible |= row[index] > 0
        previous = row
    if not alpha_zero or not alpha_visible:
        raise RuntimeError(f"Render has no transparent background pixels: {path}")


def render_frame(scene, pivot, frame, path):
    scene.frame_set(frame)
    pivot.rotation_euler.z = 2 * math.pi * frame / scene.frame_end
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
    hdri = args.hdri.expanduser().resolve() if args.hdri else (
        Path(__file__).resolve().parents[1] / "src/renderer/assets/monochrome_studio_02_1k.hdr"
    )
    ffmpeg = shutil.which(os.environ.get("FFMPEG_BIN", "ffmpeg"))
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to encode the alpha turntable WebM.")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    imported, meshes = import_asset(source)
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    low, high, center = bounds(meshes, depsgraph)
    radius = max((high - low).length * 0.5, 0.001)

    load_environment(scene, hdri)
    set_studio(scene, center, radius)
    setup_camera(scene, center, low, high, args.width, args.height)
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
    scene.frame_start = 0
    scene.frame_end = args.frames
    output.mkdir(parents=True, exist_ok=True)

    still_dir = output / "media" / "stills"
    if args.stills:
        still_dir.mkdir(parents=True, exist_ok=True)
    still_frames = {
        0: "three-quarter",
        args.frames // 4: "profile",
        args.frames // 2: "rear-three-quarter",
        (args.frames * 3) // 4: "opposite-profile",
    }
    with tempfile.TemporaryDirectory(prefix="openbridge-preview-") as temp:
        frames_dir = Path(temp)
        for frame in range(args.frames):
            frame_path = frames_dir / f"frame_{frame:04d}.png"
            render_frame(scene, pivot, frame, frame_path)
            if args.stills and frame in still_frames:
                target = still_dir / f"{still_frames[frame]}.png"
                shutil.copy2(frame_path, target)
            if frame == 0:
                poster = output / "media" / "turntable-poster.png"
                poster.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(frame_path, poster)
                shutil.copy2(frame_path, output / f"{source.stem}.png")
                assert_rgba_png(poster, require_transparency=True)

        video = output / "media" / "turntable.webm"
        video.parent.mkdir(parents=True, exist_ok=True)
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

    print(f"Rendered {args.frames} alpha frames with {hdri.name}: {video}")


if __name__ == "__main__":
    main()
