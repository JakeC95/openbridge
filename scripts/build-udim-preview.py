"""Build a self-contained review GLB from an inspected local Houdini recipe.

Run in Blender background mode with --factory-startup --disable-autoexec.
Arguments after --: recipe.json output.glb metres-per-unit normal-strength.
"""
import argparse
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


def verified_tile_path(record):
    path = Path(record["path"])
    if path.stat().st_size != record["bytes"]:
        raise ValueError(f"Tile size changed after inspection: {path.name}")
    if "sha256" in record and file_hash(path) != record["sha256"]:
        raise ValueError(f"Tile digest changed after inspection: {path.name}")
    return path


def load_tile(record, side, color=False, *, native=False):
    path = verified_tile_path(record)
    image = bpy.data.images.load(str(path), check_existing=False)
    if not color:
        image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    if min(width, height) < 1 or max(width, height) > 8192 or width * height > 32 * 1024 * 1024:
        raise ValueError(f"Image exceeds the preview budget: {path.name}")
    if native and (width != height or width > 4096 or (side is not None and width != side)):
        raise ValueError(f"Unsupported native tile dimensions: {path.name} ({width} × {height})")
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    pixels = pixels.reshape(height, width, 4)
    if native or (width == side and height == side):
        np.nan_to_num(pixels, copy=False)
        np.clip(pixels, 0, 1, out=pixels)
        return pixels
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


def make_preview(recipe, output, scale, normal_strength, native_tiles=False, displacement=None):
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
        if tag not in {"DIF", "MET", "RGH", "NRM", "EM", "OP"} and not (tag == "BMP" and displacement):
            continue
        if tag in maps:
            raise ValueError(f"More than one publish is referenced for {tag}.")
        maps[tag] = {record["tile"]: record for record in texture["files"]}
    if "DIF" not in maps or any(tile not in files for files in maps.values() for tile in tiles):
        raise ValueError("The material bindings do not cover the geometry's tiles.")

    if native_tiles:
        export_native_tiles(output, objects, faces, tiles, maps, normal_strength, displacement)
        return
    if displacement:
        raise ValueError("Reviewed displacement is available with --native-tiles.")
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


def export_native_tiles(output, objects, faces, tiles, maps, normal_strength, displacement):
    """Use one material per tile to preserve source-resolution textures."""
    materials = {}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="openbridge-tiles-") as directory:
        temporary = Path(directory)
        for tile in tiles:
            material = bpy.data.materials.new(f"Lookdev tile {tile}")
            material.use_nodes = True
            nodes, links = material.node_tree.nodes, material.node_tree.links
            shader = nodes.get("Principled BSDF")

            def make_image(name, array, data=False):
                path = temporary / f"{name}-{tile}.png"
                save_png(path, array)
                image = bpy.data.images.load(str(path))
                image.colorspace_settings.name = "Non-Color" if data else "sRGB"
                return image

            def link_image(image):
                node = nodes.new("ShaderNodeTexImage")
                node.image = image
                return node

            def rgb8(array, transfer=False):
                if transfer:
                    array = srgb(array)
                return np.rint(array * 255).astype(np.uint8)

            # The native variant retains the base-color source dimensions and
            # refuses unexpected mixed image sizes instead of silently resizing.
            base = rgb8(load_tile(maps["DIF"][tile], None, color=True, native=True)[:, :, :3], transfer=True)
            height, width, _ = base.shape
            alpha = rgb8(load_tile(maps["OP"][tile], width, native=True)[:, :, :1]) if "OP" in maps else None
            with_alpha = alpha is not None and alpha.min() < 255
            if with_alpha:
                base = np.concatenate([base, alpha], axis=2)
            color_node = link_image(make_image("Base", base))
            links.new(color_node.outputs["Color"], shader.inputs["Base Color"])
            if with_alpha:
                links.new(color_node.outputs["Alpha"], shader.inputs["Alpha"])

            packed = np.full((width, width, 3), 255, dtype=np.uint8)
            for tag, channel, socket, default in [
                ("RGH", 1, "Roughness", 0.5), ("MET", 2, "Metallic", 0.0)
            ]:
                if tag in maps:
                    packed[:, :, channel] = rgb8(load_tile(maps[tag][tile], width, native=True)[:, :, 0])
                else:
                    packed[:, :, channel] = round(default * 255)
                shader.inputs[socket].default_value = float(packed[0, 0, channel]) / 255
            varying = [packed[:, :, channel].min() != packed[:, :, channel].max() for channel in (1, 2)]
            if any(varying):
                material_node = link_image(make_image("Material", packed, data=True))
                channels = nodes.new("ShaderNodeSeparateColor")
                links.new(material_node.outputs["Color"], channels.inputs["Color"])
                for varies, channel, socket in zip(varying, ("Green", "Blue"), ("Roughness", "Metallic")):
                    if varies:
                        links.new(channels.outputs[channel], shader.inputs[socket])

            if "NRM" in maps:
                normal_pixels = rgb8(load_tile(maps["NRM"][tile], width, native=True)[:, :, :3])
                normal = nodes.new("ShaderNodeNormalMap")
                normal.inputs["Strength"].default_value = normal_strength
                links.new(link_image(make_image("Normal", normal_pixels, data=True)).outputs["Color"], normal.inputs["Color"])
                links.new(normal.outputs["Normal"], shader.inputs["Normal"])
            if "EM" in maps:
                emission = rgb8(load_tile(maps["EM"][tile], width, color=True, native=True)[:, :, :3], transfer=True)
                if emission.any():
                    links.new(link_image(make_image("Emission", emission)).outputs["Color"], shader.inputs["Emission Color"])
                    shader.inputs["Emission Strength"].default_value = 1.0

            materials[tile] = material
            print(f"Prepared native tile {tile} at {width} × {height}", flush=True)

        tile_by_polygon = [face[3] for face in faces]
        offset = 0
        selected_displacement = False
        for obj in objects:
            uv = obj.data.uv_layers.active
            used_tiles = tile_by_polygon[offset:offset + len(obj.data.polygons)]
            offset += len(used_tiles)
            obj.data.materials.clear()
            slots = sorted(set(used_tiles))
            for tile in slots:
                obj.data.materials.append(materials[tile])
            for poly, tile in zip(obj.data.polygons, used_tiles):
                poly.material_index = slots.index(tile)
                for loop_index in poly.loop_indices:
                    coord = uv.data[loop_index].uv
                    coord.x = min(1, max(0, coord.x - (tile - 1001) % 10))
                    coord.y = min(1, max(0, coord.y - (tile - 1001) // 10))

            if displacement and obj.name == displacement[0]:
                if len(slots) != 1 or "BMP" not in maps:
                    raise ValueError("The reviewed displacement mesh needs one tile and a BMP publish.")
                bpy.context.view_layer.objects.active = obj
                tile = slots[0]
                # Use the original float EXR as the height field.
                height_image = bpy.data.images.load(str(verified_tile_path(maps["BMP"][tile])))
                height_image.colorspace_settings.name = "Non-Color"
                height_texture = bpy.data.textures.new("Reviewed displacement", type="IMAGE")
                height_texture.image = height_image
                height_texture.extension = "EXTEND"
                subdiv = obj.modifiers.new("Review subdivision", "SUBSURF")
                subdiv.levels = 3
                subdiv.render_levels = 3
                bpy.ops.object.modifier_apply(modifier=subdiv.name)
                relief = obj.modifiers.new("Review displacement", "DISPLACE")
                relief.texture = height_texture
                relief.texture_coords = "UV"
                relief.uv_layer = obj.data.uv_layers.active.name
                relief.mid_level = 0.0
                bpy.context.view_layer.update()
                relief.strength = float(displacement[1]) / obj.matrix_world.to_scale().x
                bpy.ops.object.modifier_apply(modifier=relief.name)
                selected_displacement = True
                print(f"Baked displacement on {obj.name}", flush=True)
            obj.select_set(True)
        if displacement and not selected_displacement:
            raise ValueError("The reviewed displacement mesh was not found.")
        bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB",
                                  export_image_format="AUTO",
                                  export_animations=False, export_cameras=False, export_lights=False,
                                  export_tangents="NRM" in maps, use_selection=True)
    print(f"Exported native review GLB: {output.stat().st_size} bytes", flush=True)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("recipe")
parser.add_argument("output", type=Path)
parser.add_argument("metres_per_unit", type=float)
parser.add_argument("normal_strength", type=float)
parser.add_argument("--native-tiles", action="store_true")
parser.add_argument("--displace", nargs=2, metavar=("OBJECT", "HEIGHT_METRES"))
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
if args.displace and not (math.isfinite(float(args.displace[1])) and 0 < float(args.displace[1]) <= 0.05):
    parser.error("Reviewed displacement must be between 0 and 0.05 metres.")
with open(args.recipe, encoding="utf8") as recipe_file:
    recipe = json.load(recipe_file)
make_preview(recipe, args.output, args.metres_per_unit, args.normal_strength, args.native_tiles, args.displace)
