"""Opt-in Blender worker for inspecting a MAX scene using a reviewed io_scene_max checkout."""

import argparse
import importlib.util
import json
import os
import sys
from collections import Counter
from pathlib import Path

import bpy
from mathutils import Vector


def material_report(material):
    tree = material.node_tree
    report = {"name": material.name, "nodes": [], "links": []}
    if not tree:
        return report
    for node in tree.nodes:
        entry = {"name": node.name, "type": node.bl_idname}
        if node.type == "TEX_IMAGE":
            image = node.image
            entry["image"] = image.name if image else None
            if image:
                entry["colorspace"] = image.colorspace_settings.name
        if node.type == "BSDF_PRINCIPLED":
            entry["values"] = {}
            for name in ("Base Color", "Metallic", "Roughness", "IOR", "Alpha", "Transmission Weight", "Coat Weight"):
                socket = node.inputs.get(name)
                if socket and not socket.is_linked:
                    value = socket.default_value
                    entry["values"][name] = value if isinstance(value, (float, int)) else list(value)
        report["nodes"].append(entry)
    report["links"] = [{
        "from": [link.from_node.name, link.from_socket.identifier],
        "to": [link.to_node.name, link.to_socket.identifier],
    } for link in tree.links if link.is_valid]
    return report


def mesh_report(obj):
    obj.data.calc_loop_triangles()
    return {
        "name": obj.name, "parent": obj.parent.name if obj.parent else None,
        "vertices": len(obj.data.vertices), "faces": len(obj.data.polygons),
        "triangles": len(obj.data.loop_triangles),
        "material_slots": [slot.material.name if slot.material else None for slot in obj.material_slots],
        "faces_per_slot": dict(sorted(Counter(p.material_index for p in obj.data.polygons).items())),
        "uv_layers": [uv.name for uv in obj.data.uv_layers],
    }


def image_report(image):
    return {
        "name": image.name, "size": list(image.size), "users": image.users,
        "source": image.source, "declared_path": image.filepath,
        "packed": bool(image.packed_files),
        "decoded": all(dimension > 0 for dimension in image.size),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=os.environ.get("OPENBRIDGE_MAX_INPUT"))
    parser.add_argument("--addon", required=True, type=Path, help="Extension source directory")
    parser.add_argument("--exclude", action="append", default=[], help="Exact non-asset mesh name")
    parser.add_argument("--glb", type=Path, help="Optional experimental preview export; not a native look reproduction")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if not args.input:
        parser.error("Pass --input or set OPENBRIDGE_MAX_INPUT")
    source = args.input.resolve(strict=True)
    if not source.is_file() or source.suffix.lower() != ".max":
        parser.error("--input must be a .max file")
    output = args.glb.resolve() if args.glb else None
    if output and (output.suffix.lower() != ".glb" or output.exists()):
        parser.error("--glb must name a new .glb file")
    addon = args.addon.resolve(strict=True)
    spec = importlib.util.spec_from_file_location(
        "openbridge_max_worker", addon / "__init__.py", submodule_search_locations=[str(addon)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    module.register()
    result = bpy.ops.import_scene.max(filepath=str(source), use_image_search=True)
    if "FINISHED" not in result:
        raise RuntimeError(f"MAX import returned {result}")
    for name in args.exclude:
        obj = bpy.context.scene.objects.get(name)
        if obj is None or obj.type != "MESH":
            raise RuntimeError(f"Excluded mesh was not found: {name}")
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.data.polygons]
    if not meshes:
        raise RuntimeError("No meshes with faces were imported")
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    materials = {slot.material for obj in meshes for slot in obj.material_slots if slot.material}
    print("MAX_PROBE " + json.dumps({
        "blender": bpy.app.version_string,
        "bounds_in_import_units": [max(p[i] for p in points) - min(p[i] for p in points) for i in range(3)],
        "excluded": args.exclude,
        "meshes": [mesh_report(obj) for obj in meshes],
        "materials": [material_report(m) for m in sorted(materials, key=lambda m: m.name)],
        "images": [image_report(image) for image in bpy.data.images],
    }, allow_nan=False))
    if output and "FINISHED" not in bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB"):
        raise RuntimeError("Experimental GLB export failed")


if __name__ == "__main__":
    main()
