"""Run inside 3ds Max Batch on a scratch copy; export FBX and a scene inventory."""

import json
import os
from pathlib import Path

from pymxs import runtime as rt


def main():
    if not rt.maxOps.isInNonInteractiveMode():
        raise RuntimeError("Use 3ds Max Batch, not an interactive Max session")
    if not rt.maxFileName.lower().endswith(".max"):
        raise RuntimeError("No Max scene loaded")
    output = Path(os.environ["OPENBRIDGE_MAX_REVIEW_OUTPUT"])
    output.mkdir(parents=True, exist_ok=False)
    excluded = os.environ.get("OPENBRIDGE_MAX_EXCLUDE", "").casefold()
    geometry = list(rt.geometry)
    matches = [node for node in geometry if excluded and str(node.name).casefold() == excluded]
    if excluded and len(matches) != 1:
        raise RuntimeError("Expected exactly one geometry node matching the requested exclusion")
    nodes = [node for node in geometry if node not in matches]
    if not nodes:
        raise RuntimeError("No geometry selected for export")
    report = {
        "scene": str(rt.maxFileName),
        "renderer": str(rt.classOf(rt.renderers.current)),
        "excluded": [str(node.name) for node in matches],
        "objects": [{
            "name": str(node.name),
            "parent": str(node.parent.name) if node.parent else None,
            "class": str(rt.classOf(node.baseObject)),
            "material": str(node.material.name) if node.material else None,
            "material_class": str(rt.classOf(node.material)) if node.material else None,
        } for node in nodes],
    }
    (output / "scene-inventory.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    rt.select(rt.Array(*nodes))
    target = output / "asset.fbx"
    rt.exportFile(str(target), rt.Name("noPrompt"), selectedOnly=True, using=rt.FBXEXP)
    if not target.is_file() or not target.stat().st_size:
        raise RuntimeError("FBX export did not produce a nonempty file; inspect the Batch log")


if __name__ == "__main__":
    main()
