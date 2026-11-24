"""Run with Houdini 20.5 hython and HtoA enabled. Uses generated fixture files."""
import base64
import sys
import tempfile
from pathlib import Path

import hou

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "integrations/houdini/scripts/python"))
from openbridge_houdini import _renderer, _texture_space, import_asset


with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    obj = root / "fixture.obj"
    obj.write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n")
    texture = root / "fixture.png"
    texture.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII="))
    recipe = {"geometry": str(obj), "metersPerUnit": 1.0, "materials": [
        {"group": "", "maps": {"base_color": {"path": str(texture), "colorSpace": "auto"}}}
    ]}
    target = hou.node("/obj")
    assert _texture_space({"fileColorSpace": "srgb"}, "base_color")
    assert _texture_space({"fileColorSpace": "raw"}, "normal")
    try:
        _texture_space({"fileColorSpace": "srgb"}, "normal")
    except ValueError:
        pass
    else:
        raise AssertionError("A color transform was accepted for data")
    driver = target.createNode("ropnet", "LookDev").createNode("arnold")
    assert _renderer("auto") == "arnold"
    driver.bypass(True)
    hou.putenv("OPENBRIDGE_JOB_RENDERER", "vray")
    assert _renderer("auto") == "vray"
    assert _renderer("arnold") == "arnold"
    hou.unsetenv("OPENBRIDGE_JOB_RENDERER")
    existing = target.createNode("geo", "existing", run_init_scripts=False)
    original = existing.createNode("box", "original")
    original.setDisplayFlag(True)
    object_path = import_asset(target, "Fixture", recipe, "arnold")
    sop_path = import_asset(existing, "Fixture", recipe, "arnold")
    branch = hou.node(sop_path)
    assert not branch.inputs() or not any(branch.inputs())
    assert original.isDisplayFlagSet()
    assert not original.outputs()
    assert branch.geometry().primStringAttribValues("shop_materialpath")
    old = existing.children()
    recipe["materials"][0]["group"] = "not_a_group"
    try:
        import_asset(existing, "Should fail", recipe, "arnold")
    except ValueError:
        assert existing.children() == old
    else:
        raise AssertionError("Missing group accepted")
    hip = root / "fixture.hip"
    hou.hipFile.save(str(hip))
    hou.hipFile.load(str(hip), suppress_save_prompt=True)
    for path in (object_path, sop_path):
        out = hou.node(path + "/OUT").geometry()
        material = hou.node(out.primStringAttribValues("shop_materialpath")[0])
        assert material.node("base_color").parm("filename").eval() == str(texture)
    print("Houdini Arnold OBJ and SOP handoff, rollback, and HIP reopen passed.", flush=True)
