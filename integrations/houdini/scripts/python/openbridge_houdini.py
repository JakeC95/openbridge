"""OpenBridge's local Houdini 20.5 connector. No scene or library writes."""

import atexit
import json
import os
import queue
import re
import secrets
import socketserver
from pathlib import Path

import hou

LIMIT = 65536
ROLES = {"base_color", "specular_roughness", "metalness", "normal"}

def _texture_space(texture, role):
    """Resolve the file encoding against the config Houdini/Arnold is using."""
    name = texture.get("fileColorSpace", texture.get("colorSpace"))
    if name == "auto" and "fileColorSpace" not in texture:
        return name  # Old synthetic pilot recipes only; never emit this in ingest.
    import PyOpenColorIO as ocio
    path = hou.getenv("OCIO")
    if not path:
        raise ValueError("Houdini has no active OCIO config; cannot validate file colorspaces.")
    config = ocio.Config.CreateFromFile(hou.expandString(path))
    aliases = {
        "raw": ("data", "Raw", "Utility - Raw"),
        "srgb": ("sRGB - Texture", "Utility - sRGB - Texture", "sRGB Encoded Rec.709 (sRGB)"),
        "linear-rec709": ("Linear Rec.709 (sRGB)", "Utility - Linear - sRGB"),
        "acescg": ("ACEScg", "ACES - ACEScg"),
    }
    for candidate in (name, *aliases.get(str(name).lower(), ())):
        space = config.getColorSpace(candidate) if candidate else None
        if space is None:
            continue
        if (role != "base_color") != space.isData():
            raise ValueError(f"{role} requires {'a data' if role != 'base_color' else 'a color'} space, not {space.getName()}.")
        if not space.isData():
            working = config.getColorSpace("scene_linear") or config.getColorSpace("rendering")
            if working is None:
                raise ValueError("Active OCIO config does not define the scene-linear working space.")
            config.getProcessor(space.getName(), working.getName())
        return space.getName()
    raise ValueError(f"File colorspace {name!r} is not defined in the active OCIO config.")


def _source(path, extension=None):
    if not isinstance(path, str) or any(c in path for c in "$`\\\r\n\0"):
        raise ValueError("Invalid library file path.")
    file = Path(path)
    if not file.is_absolute() or not file.is_file() or (extension and file.suffix.lower() != extension):
        raise ValueError(f"Required library file is unavailable: {path}")
    return path


def _arnold_material(network, name, material):
    builder = network.createNode("arnold_materialbuilder", name)
    shader = builder.createNode("arnold::standard_surface", "surface")
    builder.node("OUT_material").setInput(0, shader)
    if "baseColor" in material:
        shader.parmTuple("base_color").set(material["baseColor"])
    if "roughness" in material:
        shader.parm("specular_roughness").set(material["roughness"])
    for role, texture in material["maps"].items():
        image = builder.createNode("arnold::image", role)
        image.parm("filename").set(texture["path"])
        image.parm("color_space").set(_texture_space(texture, role))
        if role == "normal":
            normal = builder.createNode("arnold::normal_map", "tangent_normal")
            normal.setNamedInput("input", image, 0)
            shader.setNamedInput("normal", normal, 0)
        else:
            shader.setNamedInput(role, image, 0)
    builder.layoutChildren()
    return builder


ADAPTERS = {"arnold": ("arnold_materialbuilder", _arnold_material)}

_NORMAL_VEX = '''
int p = vertexprim(0, @vtxnum);
vector f = prim_normal(0, p, 0.5, 0.5);
int usable_face = isfinite(f.x) && isfinite(f.y) && isfinite(f.z) && length2(f) > 1e-12;
vector n = hasvertexattrib(0, "N") ? vector(vertex(0, "N", @vtxnum)) :
    (haspointattrib(0, "N") ? vector(point(0, "N", @ptnum)) : vector(prim(0, "N", p)));
if (!isfinite(n.x) || !isfinite(n.y) || !isfinite(n.z) || length2(n) < 1e-12)
    n = usable_face ? f : {0, 1, 0};
else if (usable_face && dot(n, f) < 0)
    n = -n;
v@N = normalize(n);
'''

_REVERSE_VEX = '''
// Only reverse whole, coherently inverted shells. Signed volume is
// reliable for closed shells; open surfaces with a negative volume and
// every vertex normal opposed are also treated as inverted.
dict counts; dict fulls; dict vols;
for (int i = 0; i < nprimitives(0); i++) {
    string key = hasprimattrib(0, "name") ? prim(0, "name", i) :
        (hasprimattrib(0, "path") ? prim(0, "path", i) : "");
    counts[key] += 1;
    int vs[] = primvertices(0, i);
    vector fn = prim_normal(0, i, 0.5, 0.5);
    if (length2(fn) <= 1e-12) continue;
    int opp = 0;
    foreach (int v; vs) {
        vector n = vector(vertex(0, "N", v));
        if (length2(n) > 1e-12 && dot(normalize(n), normalize(fn)) < -0.05) opp++;
    }
    if (len(vs) > 0 && opp == len(vs)) fulls[key] += 1;
    if (len(vs) >= 3) {
        vector a = point(0, "P", vertexpoint(0, vs[0]));
        for (int j = 1; j < len(vs) - 1; j++) {
            vector b = point(0, "P", vertexpoint(0, vs[j]));
            vector c = point(0, "P", vertexpoint(0, vs[j + 1]));
            vols[key] += dot(a, cross(b, c)) / 6.0;
        }
    }
}
for (int i = 0; i < nprimitives(0); i++) {
    string key = hasprimattrib(0, "name") ? prim(0, "name", i) :
        (hasprimattrib(0, "path") ? prim(0, "path", i) : "");
    if (vols[key] < 0 && fulls[key] > counts[key] * 0.95)
        setprimattrib(0, "openbridge_reverse", i, 1, "set");
}
'''

def _reverse_inverted_parts(network, stream):
    marks = network.createNode("attribwrangle", "mark_inverted_shells")
    marks.setInput(0, stream)
    marks.parm("class").set("detail")
    marks.parm("snippet").set(_REVERSE_VEX)
    reverse = network.createNode("reverse", "reverse_inverted_shells")
    reverse.setInput(0, marks)
    reverse.parm("group").set("@openbridge_reverse=1")
    cleanup = network.createNode("attribdelete", "remove_reverse_marker")
    cleanup.setInput(0, reverse)
    cleanup.parm("primdel").set("openbridge_reverse")
    cleanup.parm("dovtxdel").set(0)
    cleanup.parm("doptdel").set(0)
    cleanup.parm("dodtldel").set(0)
    return cleanup


def _prepare_geometry(network, stream):
    """Keep authored smoothing and reconcile vertex normals to source winding."""
    ground = network.createNode("matchsize", "center_and_ground")
    ground.setInput(0, stream)
    ground.parm("justifytarget").set("origin")
    ground.parm("dotranslate").set(1)
    ground.parm("doscale").set(0)
    for axis, side in (("x", "center"), ("y", "min"), ("z", "center")):
        ground.parm(f"justify_{axis}").set(side)
        ground.parm(f"goal_{axis}").set("same")
    stream = ground
    geo = stream.geometry()
    if not (geo.findVertexAttrib("N") or geo.findPointAttrib("N") or geo.findPrimAttrib("N")):
        normal = network.createNode("normal", "generate_missing_normals")
        normal.setInput(0, stream)
        normal.parm("type").set("typevertex")
        stream = normal
    stream = _reverse_inverted_parts(network, stream)
    repair = network.createNode("attribwrangle", "check_vertex_normals")
    repair.setInput(0, stream)
    repair.parm("class").set("vertex")
    repair.parm("snippet").set(_NORMAL_VEX)
    return repair


def _pack_alembic_output(network, stream):
    pack = network.createNode("pack", "pack_alembic_output")
    pack.setInput(0, stream)
    pack.parm("pivot").set("origin")
    switch = network.createNode("switch", "use_packed_output")
    switch.setInput(0, stream)
    switch.setInput(1, pack)
    switch.parm("input").set(1)
    switch.setComment("1: packed by default. 0: editable polygon output.")
    return switch


def import_asset(target, name, recipe, renderer):
    """Create only new nodes; roll them back on any failure."""
    if renderer not in ADAPTERS:
        raise ValueError(f"The {renderer} renderer adapter is not available in this pilot.")
    required_type, build_material = ADAPTERS[renderer]
    if required_type not in hou.vopNodeTypeCategory().nodeTypes():
        raise ValueError("Load the Houdini 20.5 Arnold plug-in (HtoA) before sending.")
    if target is None or not target.isEditable() or (
        target.path() != "/obj" and target.childTypeCategory() != hou.sopNodeTypeCategory()
    ):
        raise ValueError("Choose an editable /obj or SOP network in Houdini.")
    geometry = _source(recipe["geometry"])
    extension = Path(geometry).suffix.lower()
    if extension not in {".abc", ".obj"}:
        raise ValueError("Houdini requires explicit OBJ or Alembic source geometry.")
    binding_attribute = recipe.get("bindingAttribute", "shop_materialpath")
    if binding_attribute not in {"path", "shop_materialpath"} or (binding_attribute == "path" and extension != ".abc"):
        raise ValueError("Unsupported source binding attribute.")
    scale = recipe["metersPerUnit"]
    if not isinstance(scale, (float, int)) or not 0 < scale < float("inf"):
        raise ValueError("Invalid source scale.")
    materials = recipe["materials"]
    if not isinstance(materials, list) or not 1 <= len(materials) <= 256:
        raise ValueError("No verified material bindings.")
    for material in materials:
        maps = material["maps"]
        if ("base_color" not in maps and "baseColor" not in material) or not set(maps) <= ROLES:
            raise ValueError("Unsupported texture roles.")
        for texture in maps.values():
            _source(texture["path"])
    safe_name = re.sub(r"[^a-zA-Z0-9_]+", "_", name).strip("_")[:64] or "asset"
    at_object = target.path() == "/obj"
    root = None
    with hou.undos.group("OpenBridge import"):
        try:
            root = target.createNode("geo" if at_object else "subnet", f"OB_{safe_name}", run_init_scripts=False)
            alembic = extension == ".abc"
            source = root.createNode("alembic" if alembic else "file", "library_geometry")
            source.parm("fileName" if alembic else "file").set(geometry)
            if alembic:
                source.parm("loadmode").set("unpack")
                source.parm("groupnames").set("xformbase")
                # Keep polygons editable through the normal and material
                # operations. Pack only the finished output.
                source.parm("polysoup").set("none")
            mesh = source.geometry()
            if not mesh.prims() or (any(m["maps"] for m in materials) and
                                    not (mesh.findVertexAttrib("uv") or mesh.findPointAttrib("uv"))):
                raise ValueError("Source geometry is empty or textured geometry has no UVs.")
            # Check that the declared groups cover each primitive exactly once.
            covered = set()
            index_by_material = {}
            if alembic:
                if not mesh.findPrimAttrib(binding_attribute):
                    raise ValueError("Alembic is missing its authored face material assignments.")
                for index, value in enumerate(mesh.primStringAttribValues(binding_attribute)):
                    index_by_material.setdefault(value, set()).add(index)
            expected_bindings = {}
            for material in materials:
                group = material["group"]
                pattern = r"(?:/[a-zA-Z0-9_.-]+)+" if alembic else r"[a-zA-Z0-9_]*"
                if not re.fullmatch(pattern, group) or (not group and len(materials) != 1):
                    raise ValueError("Invalid material group selector.")
                if alembic:
                    indices = index_by_material.get(group, set())
                else:
                    primitive_group = mesh.findPrimGroup(group) if group else None
                    indices = ({p.number() for p in primitive_group.prims()} if primitive_group is not None else
                               set(range(len(mesh.prims()))) if not group else set())
                if not indices or covered.intersection(indices):
                    raise ValueError(f"Empty or overlapping material group: {group}")
                covered.update(indices)
                expected_bindings[group] = indices
            if len(covered) != len(mesh.prims()):
                raise ValueError("Some imported faces have no verified material binding.")
            stream = source
            if scale != 1:
                stream = root.createNode("xform", "source_units_to_metres")
                stream.setInput(0, source)
                stream.parm("scale").set(scale)
            stream = _prepare_geometry(root, stream)
            matnet = root.createNode("matnet", "materials")
            assign = root.createNode("material", "assign_materials")
            assign.setInput(0, stream)
            assign.parm("num_materials").set(len(materials))
            material_paths = {}
            builders = {}
            for index, material in enumerate(materials, 1):
                # One portable look may be assigned to many cached objects.
                # Reuse by declared ID, not by coincidentally equal parameters.
                material_id = material.get("materialId")
                definition = {key: value for key, value in material.items() if key not in {"group", "materialId"}}
                if material_id and material_id in builders:
                    shader, previous = builders[material_id]
                    if previous != definition:
                        raise ValueError(f"Conflicting definitions for material {material_id}.")
                else:
                    shader = build_material(matnet, f"look_{index}", material)
                    if material_id:
                        builders[material_id] = (shader, definition)
                group = material["group"]
                assign.parm(f"group{index}").set(f"@{binding_attribute}={group}" if alembic else group)
                assign.parm(f"shop_materialpath{index}").set(shader.path())
                material_paths[group] = shader.path()
            out = root.createNode("null", "OUT")
            out.setInput(0, _pack_alembic_output(root, assign) if alembic else assign)
            if not at_object:
                output = root.createNode("output", "output")
                output.setInput(0, out)
            out.setDisplayFlag(True)
            out.setRenderFlag(True)
            cooked = assign.geometry()
            bindings = cooked.primStringAttribValues("shop_materialpath") if cooked.findPrimAttrib("shop_materialpath") else ()
            if len(bindings) != len(mesh.prims()) or any(
                bindings[index] != material_paths[group]
                for group, indices in expected_bindings.items() for index in indices
            ):
                raise ValueError("Material assignments did not survive the SOP cook.")
            final_geo = out.geometry()
            if not final_geo.prims() or (alembic and final_geo.prims()[0].type() != hou.primType.PackedGeometry):
                raise ValueError("The final SOP output did not cook as requested.")
            root.layoutChildren()
            root.moveToGoodPosition(move_inputs=False, move_outputs=False, move_unconnected=False)
            root.setSelected(True, clear_all_selected=True)
        except Exception:
            if root is not None:
                root.destroy()
            raise
    return root.path()


def _renderer(override):
    if override in ("arnold", "vray"):
        return override
    # Studio lookdev rigs can contain the render driver in an object-level ROP
    # network. Count actual Driver nodes, not shader names or links.
    names = set()
    for path in ("/out", "/obj"):
        root = hou.node(path)
        if root is not None:
            for node in root.allSubChildren(recurse_in_locked_nodes=False):
                if node.type().category() == hou.ropNodeTypeCategory() and not node.isBypassed():
                    names.add(node.type().name().lower())
    candidates = ({"arnold"} if "arnold" in names else set()) | ({"vray"} if names & {"vray", "vray_renderer"} else set())
    if len(candidates) == 1:
        return candidates.pop()
    default = (hou.getenv("OPENBRIDGE_JOB_RENDERER") or "").lower()
    if default in ("arnold", "vray"):
        return default
    raise ValueError("No unambiguous scene renderer or job default. Choose Arnold in OpenBridge.")


_pending = queue.Queue(maxsize=8)
_target = None
_snapshot = None
_server = None
_focus_filter = None


def _tick():
    global _target, _snapshot
    try:
        pane_target = _target.pwd() if _target is not None and _target.isCurrentTab() else None
    except hou.Error:
        pane_target = None
        _target = None
    scene = hou.hipFile.path()
    target = pane_target.path() if pane_target is not None else None
    if _snapshot is None or _snapshot[:2] != (scene, target):
        _snapshot = (scene, target, secrets.token_hex(16))
    try:
        message, reply = _pending.get_nowait()
    except queue.Empty:
        return
    try:
        if message.get("action") == "status":
            reply.put({"scene": scene, "target": target, "token": _snapshot[2]})
        elif message.get("action") == "send" and message.get("token") == _snapshot[2]:
            node = import_asset(pane_target, message["name"], message["recipe"], _renderer(message.get("renderer")))
            reply.put({"node": node})
        else:
            raise ValueError("The destination changed. Recheck the Houdini network and send again.")
    except Exception as error:
        reply.put({"error": str(error)[:2000]})


class _Request(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(2)
        try:
            data = self.rfile.readline(LIMIT)
            if len(data) >= LIMIT:
                raise ValueError("Request exceeds pilot size limit.")
            message = json.loads(data)
            reply = queue.Queue(maxsize=1)
            if not isinstance(message, dict):
                return
            _pending.put_nowait((message, reply))
            self.wfile.write((json.dumps(reply.get(timeout=28)) + "\n").encode())
        except (OSError, ValueError, queue.Full, queue.Empty):
            return


def start():
    """Start once, from Houdini's UI thread."""
    global _server, _focus_filter
    if _server is not None or not hou.isUIAvailable():
        return
    import threading
    import stat
    from hutil.Qt import QtCore, QtWidgets

    class NetworkFocus(QtCore.QObject):
        def eventFilter(self, watched, event):
            global _target
            if event.type() == QtCore.QEvent.MouseButtonPress:
                for pane in hou.ui.paneTabs():
                    if pane.type() == hou.paneTabType.NetworkEditor and pane.isCurrentTab() and pane.isUnderCursor():
                        _target = pane
                        break
            return False

    runtime = Path(os.environ.get("XDG_RUNTIME_DIR") or "/tmp")
    directory = (runtime if runtime.is_absolute() else Path("/tmp")) / f"openbridge-houdini-{os.getuid()}"
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("OpenBridge connector directory must be private to this user.")
    path = directory / f"{os.getpid()}.sock"
    _server = socketserver.UnixStreamServer(str(path), _Request)
    atexit.register(path.unlink, missing_ok=True)
    _focus_filter = NetworkFocus()
    QtWidgets.QApplication.instance().installEventFilter(_focus_filter)
    hou.ui.addEventLoopCallback(_tick)
    threading.Thread(target=_server.serve_forever, daemon=True).start()
