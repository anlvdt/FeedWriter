#!/usr/bin/env python3
"""Build and verify the browser composer runtime."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "content-composer.js"
OUTPUT = ROOT / "content-composer-runtime.js"


def build() -> str:
    source = SOURCE.read_text(encoding="utf-8")
    return "\n".join(line.rstrip() for line in source.splitlines()).rstrip() + "\n"


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
