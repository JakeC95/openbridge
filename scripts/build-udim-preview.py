"""Build a self-contained review GLB from an inspected local Houdini recipe.

Run in Blender background mode with --factory-startup --disable-autoexec.
Arguments after --: recipe.json output.glb metres-per-unit normal-strength.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import zlib

import bpy
import numpy as np


def png_chunk(name, content):
    return struct.pack(">I", len(content)) + name + content + struct.pack(">I", zlib.crc32(name + content))


def save_png(path, pixels):
    height, width, channels = pixels.shape
    color_type = {3: 2, 4: 6}[channels]
    header = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    rows = b"".join(b"\0" + row.tobytes() for row in pixels[::-1])
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) +
                     png_chunk(b"IDAT", zlib.compress(rows, 6)) + png_chunk(b"IEND", b""))


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_tile(record, side, color=False):
    path = Path(record["path"])
    if path.stat().st_size != record["bytes"]:
        raise ValueError(f"Tile size changed after inspection: {path.name}")
    if "sha256" in record and file_hash(path) != record["sha256"]:
        raise ValueError(f"Tile digest changed after inspection: {path.name}")
    image = bpy.data.images.load(str(path), check_existing=False)
    if not color:
        image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    if min(width, height) < 1 or max(width, height) > 8192 or width * height > 32 * 1024 * 1024:
        raise ValueError(f"Image exceeds the preview budget: {path.name}")
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    pixels = pixels.reshape(height, width, 4)
    x = ((np.arange(side) + 0.5) * width / side - 0.5).clip(0, width - 1)
    y = ((np.arange(side) + 0.5) * height / side - 0.5).clip(0, height - 1)
    x0, y0 = x.astype(int), y.astype(int)
    x1, y1 = (x0 + 1).clip(0, width - 1), (y0 + 1).clip(0, height - 1)
    wx, wy = (x - x0)[None, :, None], (y - y0)[:, None, None]
    lower = pixels[y0[:, None], x0] * (1 - wx) + pixels[y0[:, None], x1] * wx
    upper = pixels[y1[:, None], x0] * (1 - wx) + pixels[y1[:, None], x1] * wx
    return np.nan_to_num(lower * (1 - wy) + upper * wy).clip(0, 1)


def srgb(linear):
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)


def discover_uvs(objects):
    faces = []
    tiles = set()
    for obj in objects:
        uvs = obj.data.uv_layers.active
        if not uvs:
            raise ValueError(f"Mesh needs an authored UV map: {obj.name}")
        for poly in obj.data.polygons:
            indices = tuple(poly.loop_indices)
            points = [uvs.data[index].uv.copy() for index in indices]
            u = math.floor(sum(point.x for point in points) / len(points))
            v = math.floor(sum(point.y for point in points) / len(points))
            if not 0 <= u < 10 or not 0 <= v < 90:
                raise ValueError(f"UV face falls outside the supported tile range: {obj.name}")
            local_uvs = [(point.x - u, point.y - v) for point in points]
            if any(not (-0.0001 <= x <= 1.0001 and -0.0001 <= y <= 1.0001) for x, y in local_uvs):
                raise ValueError(f"UV face straddles a tile border: {obj.name}")
            tile = 1001 + u + 10 * v
            tiles.add(tile)
            faces.append((uvs, indices, local_uvs, tile))
    return faces, sorted(tiles)


def make_preview(recipe, output, scale, normal_strength):
    root = Path(recipe["root"]).resolve(strict=True)
    output = output.resolve()
    if output.suffix.lower() != ".glb" or output.is_relative_to(root):
        raise ValueError("Choose a GLB destination outside the source asset.")
    if not (math.isfinite(scale) and scale > 0 and math.isfinite(normal_strength) and 0 <= normal_strength <= 1):
        raise ValueError("Use a positive unit scale and a normal strength between zero and one.")
    if file_hash(recipe["model"]) != recipe["modelSha256"]:
        raise ValueError("The geometry publish changed after inspection.")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.alembic_import(filepath=recipe["model"], scale=scale, set_frame_range=False, as_background_job=False)
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not objects or sum(len(obj.data.polygons) for obj in objects) > 1_000_000:
        raise ValueError("Preview requires a bounded polygon mesh.")
    faces, tiles = discover_uvs(objects)
    if not 1 <= len(tiles) <= 16:
        raise ValueError("Preview supports between one and sixteen used UV tiles.")
    print(f"Verified {len(objects)} meshes, {len(faces)} faces and tiles {tiles}", flush=True)

    maps = {}
    for texture in recipe["textures"]:
        tag = texture.get("mapTag")
        if tag not in {"DIF", "MET", "RGH", "NRM", "EM", "OP"}:
            continue
        if tag in maps:
            raise ValueError(f"More than one publish is referenced for {tag}.")
        maps[tag] = {record["tile"]: record for record in texture["files"]}
    if "DIF" not in maps or any(tile not in files for files in maps.values() for tile in tiles):
        raise ValueError("The material bindings do not cover the geometry's tiles.")

    columns = math.ceil(math.sqrt(len(tiles)))
    rows = math.ceil(len(tiles) / columns)
    side, padding = (1024 if len(tiles) <= 9 else 768), 12
    stride = side + 2 * padding
    width, height = columns * stride, rows * stride
    outputs = {
        "Base": np.full((height, width, 4), 255, dtype=np.uint8),
        **({"Material": np.zeros((height, width, 3), dtype=np.uint8)} if "MET" in maps or "RGH" in maps else {}),
        **({"Normal": np.zeros((height, width, 3), dtype=np.uint8)} if "NRM" in maps else {}),
        **({"Emission": np.zeros((height, width, 3), dtype=np.uint8)} if "EM" in maps else {}),
    }
    if "Normal" in outputs:
        outputs["Normal"][:, :] = (128, 128, 255)
    positions = {tile: (i % columns * stride, i // columns * stride) for i, tile in enumerate(tiles)}

    def paint(name, tile, pixels):
        x, y = positions[tile]
        padded = np.pad(pixels, ((padding, padding), (padding, padding), (0, 0)), mode="edge")
        outputs[name][y:y + stride, x:x + stride] = np.rint(padded * 255).astype(np.uint8)

    for tile in tiles:
        base = srgb(load_tile(maps["DIF"][tile], side, color=True)[:, :, :3])
        alpha = load_tile(maps["OP"][tile], side)[:, :, :1] if "OP" in maps else np.ones((side, side, 1))
        paint("Base", tile, np.concatenate([base, alpha], axis=2))
        if "Normal" in outputs:
            paint("Normal", tile, load_tile(maps["NRM"][tile], side)[:, :, :3])
        if "Material" in outputs:
            packed = np.ones((side, side, 3))
            packed[:, :, 1] = load_tile(maps["RGH"][tile], side)[:, :, 0] if "RGH" in maps else 0.5
            packed[:, :, 2] = load_tile(maps["MET"][tile], side)[:, :, 0] if "MET" in maps else 0.0
            paint("Material", tile, packed)
        if "Emission" in outputs:
            paint("Emission", tile, srgb(load_tile(maps["EM"][tile], side, color=True)[:, :, :3]))
        print(f"Converted tile {tile}", flush=True)
    if "Emission" in outputs and not outputs["Emission"].any():
        del outputs["Emission"]

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="openbridge-atlas-") as temporary:
        material = bpy.data.materials.new("Prepared lookdev")
        material.use_nodes = True
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = nodes.get("Principled BSDF")
        images = {}
        for name, pixels in outputs.items():
            path = Path(temporary) / (name + ".png")
            save_png(path, pixels)
            node = nodes.new("ShaderNodeTexImage")
            node.image = bpy.data.images.load(str(path))
            node.image.name = name
            node.image.colorspace_settings.name = "Non-Color" if name in {"Normal", "Material"} else "sRGB"
            images[name] = node
        links.new(images["Base"].outputs["Color"], shader.inputs["Base Color"])
        if outputs["Base"][:, :, 3].min() < 255:
            links.new(images["Base"].outputs["Alpha"], shader.inputs["Alpha"])
        if "Material" in images:
            channels = nodes.new("ShaderNodeSeparateColor")
            links.new(images["Material"].outputs["Color"], channels.inputs["Color"])
            links.new(channels.outputs["Green"], shader.inputs["Roughness"])
            links.new(channels.outputs["Blue"], shader.inputs["Metallic"])
        if "Normal" in images:
            normal = nodes.new("ShaderNodeNormalMap")
            normal.inputs["Strength"].default_value = normal_strength
            links.new(images["Normal"].outputs["Color"], normal.inputs["Color"])
            links.new(normal.outputs["Normal"], shader.inputs["Normal"])
        if "Emission" in images:
            links.new(images["Emission"].outputs["Color"], shader.inputs["Emission Color"])
            shader.inputs["Emission Strength"].default_value = 1.0
        for uvs, indices, local_uvs, tile in faces:
            x, y = positions[tile]
            for index, (u, v) in zip(indices, local_uvs):
                uvs.data[index].uv = (
                    (x + padding + side * min(1, max(0, u))) / width,
                    (y + padding + side * min(1, max(0, v))) / height,
                )
        for obj in objects:
            obj.data.materials.clear()
            obj.data.materials.append(material)
            for poly in obj.data.polygons:
                poly.material_index = 0
            obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_animations=False,
                                  export_cameras=False, export_lights=False, export_tangents="NRM" in maps,
                                  use_selection=True)
    print(f"Exported review GLB: {output.stat().st_size} bytes", flush=True)


recipe_path, output_path, units, normal = sys.argv[sys.argv.index("--") + 1:]
with open(recipe_path, encoding="utf8") as recipe_file:
    recipe = json.load(recipe_file)
make_preview(recipe, Path(output_path), float(units), float(normal))
