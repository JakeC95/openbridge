"""Inventory a text .vrscene without loading its includes or dependencies."""

import argparse
from collections import Counter
import json
from pathlib import Path
import re

LIMIT = 32 * 1024 * 1024
TOKEN = re.compile(
    r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/|'
    r'\#[ \t]*include\b|[A-Za-z_][\w@.:|\-]*|[{}=;]|[^\s]'
)
PATH_FIELDS = {
    "BitmapBuffer": {"file"},
    "GeomMeshFile": {"file"},
    "LightIES": {"ies_file", "file"},
}
LINK_FIELDS = {"geometry", "material", "bitmap", "brdf", "uvwgen"}


def inventory(text):
    counts, plugins, includes = Counter(), [], []
    recent = []
    current = None
    depth = 0
    for match in TOKEN.finditer(text):
        value = match.group()
        if value.startswith(("//", "/*")):
            continue
        if not depth and recent and recent[-1].replace(" ", "").replace("\t", "") == "#include":
            if value.startswith('"'):
                includes.append(value[1:-1])
                recent.clear()
                continue
        if value == "{":
            if depth == 0 and len(recent) == 2:
                kind, name = recent
                counts[kind] += 1
                current = {"type": kind, "name": name, "references": {}}
            depth += 1
        elif value == "}":
            depth -= 1
            if depth < 0:
                raise ValueError("Unmatched closing brace")
            if depth == 0 and current:
                if current["references"]:
                    plugins.append(current)
                current = None
        elif depth == 1 and current and len(recent) == 2 and recent[-1] == "=":
            field = recent[0]
            if field in PATH_FIELDS.get(current["type"], ()) and value.startswith('"'):
                current["references"][field] = value[1:-1]
            elif field in LINK_FIELDS and re.fullmatch(r"[A-Za-z_][\w@.:|\-]*", value):
                current["references"][field] = value
        if value in ("{", "}", ";"):
            recent.clear()
        else:
            recent = (recent + [value])[-2:]
    if depth:
        raise ValueError("Unclosed plugin block")
    return {"plugin_counts": dict(sorted(counts.items())), "includes": includes,
            "plugins_with_references": plugins,
            "scope": "Declared references only; includes and external files were not opened."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", type=Path)
    source = parser.parse_args().scene
    if source.suffix.lower() != ".vrscene" or not source.is_file():
        parser.error("Expected a .vrscene file")
    with source.open("rb") as stream:
        data = stream.read(LIMIT + 1)
    if len(data) > LIMIT:
        parser.error("Scene exceeds the 32 MiB inventory limit; use the vendor SDK for larger scenes")
    print(json.dumps(inventory(data.decode("utf-8-sig")), indent=2))
