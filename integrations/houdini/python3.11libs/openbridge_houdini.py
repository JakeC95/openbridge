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
ROLES = {"base_color", "specular_roughness", "metalness"}


def _source(path, extension=None):
    if not isinstance(path, str) or any(c in path for c in "$`\\\r\n\0"):
        raise ValueError("Invalid library file path.")
    file = Path(path)
    if not file.is_absolute() or not file.is_file() or (extension and file.suffix.lower() != extension):
        raise ValueError(f"Required library file is unavailable: {path}")
    return path


def _arnold_material(network, name, maps):
    builder = network.createNode("arnold_materialbuilder", name)
    shader = builder.createNode("arnold::standard_surface", "surface")
    builder.node("OUT_material").setInput(0, shader)
    for role, texture in maps.items():
        image = builder.createNode("arnold::image", role)
        image.parm("filename").set(texture["path"])
        image.parm("color_space").set(texture["colorSpace"])
        shader.setNamedInput(role, image, 0)
    builder.layoutChildren()
    return builder


ADAPTERS = {"arnold": ("arnold_materialbuilder", _arnold_material)}


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
    geometry = _source(recipe["geometry"], ".obj")
    scale = recipe["metersPerUnit"]
    if not isinstance(scale, (float, int)) or not 0 < scale < float("inf"):
        raise ValueError("Invalid source scale.")
    materials = recipe["materials"]
    if not isinstance(materials, list) or not 1 <= len(materials) <= 64:
        raise ValueError("No verified material bindings.")
    for material in materials:
        maps = material["maps"]
        if "base_color" not in maps or not set(maps) <= ROLES:
            raise ValueError("Unsupported texture roles.")
        for texture in maps.values():
            _source(texture["path"])
    safe_name = re.sub(r"[^a-zA-Z0-9_]+", "_", name).strip("_")[:64] or "asset"
    at_object = target.path() == "/obj"
    root = None
    with hou.undos.group("OpenBridge import"):
        try:
            root = target.createNode("geo" if at_object else "subnet", f"OB_{safe_name}", run_init_scripts=False)
            source = root.createNode("file", "library_geometry")
            source.parm("file").set(geometry)
            mesh = source.geometry()
            if not mesh.prims() or not (mesh.findVertexAttrib("uv") or mesh.findPointAttrib("uv")):
                raise ValueError("Source geometry has no polygons or UVs.")
            # Check that the declared groups cover each primitive exactly once.
            covered = set()
            for material in materials:
                group = material["group"]
                if not re.fullmatch(r"[a-zA-Z0-9_]*", group) or (not group and len(materials) != 1):
                    raise ValueError("Invalid material group selector.")
                primitive_group = mesh.findPrimGroup(group) if group else None
                indices = ({p.number() for p in primitive_group.prims()} if primitive_group is not None else
                           set(range(len(mesh.prims()))) if not group else set())
                if not indices or covered.intersection(indices):
                    raise ValueError(f"Empty or overlapping material group: {group}")
                covered.update(indices)
            if len(covered) != len(mesh.prims()):
                raise ValueError("Some imported faces have no verified material binding.")
            stream = source
            if scale != 1:
                stream = root.createNode("xform", "source_units_to_metres")
                stream.setInput(0, source)
                stream.parm("scale").set(scale)
            matnet = root.createNode("matnet", "materials")
            assign = root.createNode("material", "assign_materials")
            assign.setInput(0, stream)
            assign.parm("num_materials").set(len(materials))
            for index, material in enumerate(materials, 1):
                shader = build_material(matnet, f"look_{index}", material["maps"])
                assign.parm(f"group{index}").set(material["group"])
                assign.parm(f"shop_materialpath{index}").set(shader.path())
            out = root.createNode("null", "OUT")
            out.setInput(0, assign)
            if not at_object:
                output = root.createNode("output", "output")
                output.setInput(0, out)
            out.setDisplayFlag(True)
            out.setRenderFlag(True)
            cooked = root.geometry() if not at_object else out.geometry()
            bindings = cooked.findPrimAttrib("shop_materialpath")
            if not bindings or any(not value or not hou.node(value) for value in cooked.primStringAttribValues("shop_materialpath")):
                raise ValueError("Material assignments did not survive the SOP cook.")
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
    names = {node.type().name().lower() for node in hou.node("/out").children()
             if not node.isBypassed()}
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
