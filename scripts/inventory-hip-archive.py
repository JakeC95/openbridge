"""Read node types and serialized parameter evidence from uncompressed odc HIP files."""

import argparse
import json
import re
from pathlib import Path

TYPE = re.compile(r"^type\s*=\s*(.+)$", re.M)
PARAM = re.compile(r"^\s*(\S+)[ \t]+\[[^\n]*\][ \t]*\([ \t]*(.*?)[ \t]*\)[ \t]*$", re.M)
PATH = re.compile(r"\.(?:abc|bgeo(?:\.sc)?|usd[acz]?|ass(?:\.gz)?|exr|tx|png|jpe?g|tiff?|rat|vrmesh|vrscene)\b", re.I)


def inventory(source):
    nodes, evidence = {}, []
    length = source.stat().st_size
    with source.open("rb") as stream:
        for _ in range(100000):
            header = stream.read(76)
            if len(header) != 76 or header[:6] != b"070707":
                raise ValueError("Expected an uncompressed odc HIP archive")
            name_size, size = int(header[59:65], 8), int(header[65:76], 8)
            if not 1 <= name_size <= 4096 or stream.tell() + name_size + size > length:
                raise ValueError("Invalid HIP archive member size")
            raw_name = stream.read(name_size)
            if not raw_name.endswith(b"\0"):
                raise ValueError("Invalid HIP archive member name")
            name = raw_name[:-1].decode("utf-8", "replace")
            if name == "TRAILER!!!":
                return {"nodes": nodes, "parameter_evidence": evidence}
            if size > 1024 * 1024 or not name.endswith((".init", ".parm")):
                stream.seek(size, 1)
                continue
            text = stream.read(size).decode("utf-8", "replace")
            node = "/" + name.rsplit(".", 1)[0].lstrip("/")
            if name.endswith(".init"):
                match = TYPE.search(text)
                if match:
                    nodes[node] = match[1].strip()
            else:
                for parm, value in PARAM.findall(text):
                    if PATH.search(value) or re.search(
                        r"shop_materialpath|group|^(?:(?:shop_)?material|[ml]packedname)\d*$",
                        parm, re.I,
                    ):
                        evidence.append({"node": node, "parameter": parm, "value": value})
    raise ValueError("HIP archive exceeded the member limit")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scene", type=Path)
    print(json.dumps(inventory(parser.parse_args().scene), indent=2))
