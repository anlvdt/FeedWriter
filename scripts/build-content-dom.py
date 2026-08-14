#!/usr/bin/env python3
"""Build and verify the browser DOM runtime."""

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "content-dom.js"
OUTPUT = ROOT / "content-dom-runtime.js"

def main():
    check = argparse.ArgumentParser()
    check.add_argument("--check", action="store_true")
    args = check.parse_args()
    source = SOURCE.read_text(encoding="utf-8")
    output = "\n".join(line.rstrip() for line in source.splitlines()).rstrip() + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != output:
            print("STALE content-dom runtime; run npm run build:dom", file=sys.stderr)
            return 1
    else:
        OUTPUT.write_text(output, encoding="utf-8")
    print(f"OK {'verified' if args.check else 'wrote'} {OUTPUT} ({len(output.encode())} bytes)")
    return subprocess.run(["node", "--check", str(OUTPUT)], check=False).returncode

if __name__ == "__main__":
    raise SystemExit(main())
