#!/usr/bin/env python3
"""Build the browser runtime for the composer without archived automation code."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "content-composer.js"
OUTPUT = ROOT / "content-composer-runtime.js"
START = "/*\n * Removed legacy autonomous posting implementation."


def build() -> str:
    source = SOURCE.read_text(encoding="utf-8")
    start = source.find(START)
    if start < 0:
        raise RuntimeError("Archived automation block marker is missing")
    end = source.find("\n*/", start)
    if end < 0:
        raise RuntimeError("Archived automation block is not closed")
    output = source[:start] + source[end + len("\n*/") :]
    return "\n".join(line.rstrip() for line in output.splitlines()).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    content = build()

    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != content:
            print(f"STALE {OUTPUT}; run npm run build:composer", file=sys.stderr)
            return 1
        print(f"OK verified {OUTPUT} ({len(content.encode())} bytes)")
    else:
        OUTPUT.write_text(content, encoding="utf-8")
        print(f"OK wrote {OUTPUT} ({len(content.encode())} bytes)")

    result = subprocess.run(["node", "--check", str(OUTPUT)], check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
