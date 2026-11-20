"""Validate the decoded alpha plane of every frame of a prepared WebM."""

import argparse
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--frames", type=int, default=72)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()
    width, height = args.width, args.height
    if min(width, height, args.frames) <= 0:
        parser.error("Dimensions and frame count must be positive")
    size = width * height
    # Read only alpha, and limit decode to one extra frame to detect overruns.
    with tempfile.TemporaryFile() as errors, subprocess.Popen([
        args.ffmpeg, "-v", "error", "-c:v", "libvpx-vp9",
        "-i", str(args.video.resolve(strict=True)), "-map", "0:v:0",
        "-vf", "alphaextract", "-frames:v", str(args.frames + 1),
        "-f", "rawvideo", "-pix_fmt", "gray", "-"
    ], stdout=subprocess.PIPE, stderr=errors) as decode:
        try:
            for index in range(args.frames):
                alpha = decode.stdout.read(size)
                if len(alpha) != size:
                    raise RuntimeError(f"Short alpha stream at frame {index}")
                if not any(alpha) or 0 not in alpha:
                    raise RuntimeError(f"Frame {index} lacks visible or transparent pixels")
                if any(alpha[:width] + alpha[-width:] + alpha[::width] + alpha[width - 1::width]):
                    raise RuntimeError(f"Frame {index} touches the image edge")
            if decode.stdout.read(1):
                raise RuntimeError("Alpha stream is longer than expected")
            if decode.wait():
                raise RuntimeError("FFmpeg alpha decoding failed")
        finally:
            if decode.poll() is None:
                decode.kill()
    print(f"Verified {args.frames} alpha frames with clear edges")


if __name__ == "__main__":
    main()
