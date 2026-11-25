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
    obj.write_text("v 2 3 4\nv 3 3 4\nv 2 4 4\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1\n")
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
    prepared = branch.geometry()
    bounds = prepared.boundingBox()
    assert abs(bounds.center()[0]) < 1e-6 and abs(bounds.center()[2]) < 1e-6
    assert abs(bounds.minvec()[1]) < 1e-6 and abs(bounds.sizevec()[0] - 1) < 1e-6
    normal = prepared.prims()[0].normal()
    assert all(hou.Vector3(v.attribValue("N")).dot(normal) > 0.9 for v in prepared.prims()[0].vertices())
    assert hou.node(object_path).worldTransform().isAlmostEqual(hou.hmath.identityTransform())
    ground = hou.node(object_path + "/center_and_ground")
    assert ground.parm("justify_x").evalAsString() == "center"
    assert ground.parm("justify_y").evalAsString() == "min"
    assert ground.parm("justify_z").evalAsString() == "center"
    assert ground.parm("goal_x").evalAsString() == "same"
    assert ground.parm("goal_y").evalAsString() == "same"
    assert ground.parm("goal_z").evalAsString() == "same"
    assert ground.parm("dotranslate").eval() == 1 and ground.parm("doscale").eval() == 0
    # Exercise the canonical Alembic object-path request with an actual cache.
    archive = root / "source.abc"
    export = hou.node("/out").createNode("alembic")
    export.parm("filename").set(str(archive))
    other_path = import_asset(target, "Second mesh", recipe, "arnold")
    export.parm("objects").set(f"{object_path} {other_path}")
    export.render()
    probe = existing.createNode("alembic", "inspect_source_path")
    probe.parm("fileName").set(str(archive))
    keys = set(probe.geometry().primStringAttribValues("path"))
    probe.destroy()
    assert len(keys) == 2
    alembic_path = import_asset(existing, "Source cache", {
        "geometry": str(archive), "bindingAttribute": "path", "metersPerUnit": 1.0,
        "materials": [{"group": key, "materialId": "shared-look", "maps": {},
                       "baseColor": [0.2, 0.3, 0.4], "roughness": 0.5} for key in sorted(keys)]
    }, "arnold")
    cached = hou.node(alembic_path)
    assert cached.geometry().prims()[0].type() == hou.primType.PackedGeometry
    bindings = cached.node("assign_materials").geometry().primStringAttribValues("shop_materialpath")
    assert len(bindings) == 2 and len(set(bindings)) == 1
    check = existing.createNode("unpack", "verify_packed_materials")
    check.setInput(0, cached)
    assert check.geometry().primStringAttribValues("shop_materialpath") == bindings
    assert check.geometry().findVertexAttrib("N")
    check.destroy()
    sop = hou.node(alembic_path + "/library_geometry")
    assert sop.parm("loadmode").evalAsString() == "unpack"
    assert sop.parm("groupnames").evalAsString() == "xformbase"
    assert len(sop.geometry().primGroups()) == 2
    assert not any(n.type().name() == "unpack" for n in hou.node(alembic_path).children())
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
    assert hou.node(alembic_path).geometry().prims()[0].type() == hou.primType.PackedGeometry
    assert hou.node(alembic_path + "/assign_materials").geometry().primStringAttribValues("shop_materialpath")
    for path in (object_path, sop_path):
        out = hou.node(path + "/OUT").geometry()
        material = hou.node(out.primStringAttribValues("shop_materialpath")[0])
        assert material.node("base_color").parm("filename").eval() == str(texture)
    print("Houdini Arnold OBJ and SOP handoff, rollback, and HIP reopen passed.", flush=True)
