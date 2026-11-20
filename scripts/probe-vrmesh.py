"""Read one proxy frame through an explicitly configured Chaos converter."""

import argparse
import json
from pathlib import Path
import re
import subprocess

COUNTS = {
    "frames": "Number of frames",
    "objects": "Total number of objects",
    "triangles": "Total number of triangles",
    "preview_triangles": "Preview triangles",
    "uv_sets": "UV sets",
    "shader_sets": "Shader sets",
}


def parse_report(text):
    fields = {}
    for key, label in COUNTS.items():
        match = re.search(rf"^\s*{re.escape(label)}:[ \t]*(\d+(?:,\d{{3}})*)(?=[ \t\r\n]|$)", text, re.M)
        if match:
            fields[key] = int(match[1].replace(",", ""))
    bounds = re.search(r"^\s*Vertices bounding box:[ \t]*(.+)$", text, re.M)
    if bounds:
        fields["vertices_bounds_reported"] = bounds[1].strip()
    if "frames" not in fields or "triangles" not in fields:
        raise ValueError("No recognized proxy frame report from ply2vrmesh")
    return fields


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("proxy", type=Path)
    parser.add_argument("--tool", required=True, type=Path, help="Path to the Chaos ply2vrmesh executable")
    parser.add_argument("--frame", default=0, type=int)
    args = parser.parse_args()
    proxy = args.proxy.resolve(strict=True)
    if proxy.suffix.lower() != ".vrmesh" or not proxy.is_file() or args.frame < 0:
        parser.error("Expected a .vrmesh file and a nonnegative frame index")
    result = subprocess.run([
        str(args.tool.resolve(strict=True)), "-info", "-perObject", "-frame", str(args.frame), str(proxy)
    ], capture_output=True, text=True, errors="replace", timeout=30, check=True)
    print(json.dumps({
        "frame": args.frame,
        **parse_report(result.stdout + "\n" + result.stderr),
        "scope": "Proxy metadata only; shader assignments must be verified in the host scene.",
    }, indent=2))


if __name__ == "__main__":
    main()
