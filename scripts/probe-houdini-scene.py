"""Inventory a trusted Houdini scene with hython; never save or export the scene."""

import argparse
import json
from pathlib import Path

import hou


def geometry_report(path):
    node = hou.node(path)
    if not isinstance(node, hou.SopNode):
        raise ValueError(f"Expected a SOP path: {path}")
    geo = node.geometry()
    prim_strings = {}
    for name in ("name", "path", "shop_materialpath", "material"):
        attr = geo.findPrimAttrib(name)
        if attr and attr.dataType() == hou.attribData.String and attr.size() == 1:
            values = sorted(set(attr.strings()) - {""})
            prim_strings[name] = {"count": len(values), "values": values[:256]}
    bounds = geo.boundingBox()
    return {
        "node": path,
        "counts": {key: int(geo.intrinsicValue(key)) for key in ("pointcount", "primitivecount", "vertexcount")},
        "local_bounds": [list(bounds.minvec()), list(bounds.maxvec())] if bounds.isValid() else None,
        "groups": {name: [group.name() for group in groups][:256] for name, groups in (
            ("point", geo.pointGroups()), ("primitive", geo.primGroups()), ("edge", geo.edgeGroups()))},
        "attributes": {name: [attr.name() for attr in attrs] for name, attrs in (
            ("point", geo.pointAttribs()), ("vertex", geo.vertexAttribs()), ("primitive", geo.primAttribs()))},
        "primitive_string_tables": prim_strings,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", type=Path)
    parser.add_argument("--geometry", action="append", default=[], metavar="/PATH/TO/SOP")
    parser.add_argument("--frame", type=float)
    args = parser.parse_args()
    source = args.scene.resolve(strict=True)
    if source.suffix.lower() not in {".hip", ".hiplc", ".hipnc"} or not source.is_file():
        parser.error("Expected a Houdini scene file")
    warnings = []
    try:
        hou.hipFile.load(str(source), suppress_save_prompt=True)
    except hou.LoadWarning as error:
        warnings.append(str(error))
    if args.frame is not None:
        hou.setFrame(args.frame)
    nodes = []
    for node in hou.node("/").allSubChildren():
        node_type = node.type()
        nodes.append({"path": node.path(), "type": node_type.nameWithCategory(),
                      "inputs": [item.path() for item in node.inputs() if item is not None]})
    refs = []
    for parm, value in hou.fileReferences():
        refs.append({"parameter": parm.path() if parm else None, "reference": value})
    report = {
        "houdini": hou.applicationVersionString(), "frame": hou.frame(), "load_warnings": warnings,
        "nodes": nodes, "file_references": refs,
        "geometry": [geometry_report(path) for path in args.geometry],
    }
    print("HOUDINI_PROBE " + json.dumps(report, allow_nan=False))


if __name__ == "__main__":
    main()
