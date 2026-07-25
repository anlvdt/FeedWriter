#!/usr/bin/env python3
"""Rebuild service-worker.js from source modules (no importScripts).

Chrome MV3 often fails with:
  NetworkError: Failed to execute 'importScripts' ... utils.js failed to load
when the extension is on an external volume or after flaky reloads.

The service worker entry (manifest.background.service_worker) must be the
single bundled file produced by this script.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ORDER = ["utils.js", "bg-prompts.js", "bg-api.js", "background.js"]
OUT = ROOT / "service-worker.js"

HEADER = """/* ==========================================================================
 * FeedWriter service-worker.js (GENERATED — do not edit by hand)
 * Bundle of: utils.js + bg-prompts.js + bg-api.js + background.js
 * Rebuild: python3 scripts/build-sw.py
 * ========================================================================== */
"""


def main() -> int:
    chunks = [HEADER]
    for name in ORDER:
        path = ROOT / name
        if not path.is_file():
            print(f"missing {path}", file=sys.stderr)
            return 1
        body = path.read_text(encoding="utf-8")
        if name == "background.js":
            lines = []
            for line in body.splitlines(keepends=True):
                if "importScripts(" in line and "utils.js" in line:
                    lines.append(
                        "// importScripts inlined into service-worker.js — do not re-import\n"
                    )
                    continue
                lines.append(line)
            body = "".join(lines)
        chunks.append(f"\n/* ===== BEGIN {name} ===== */\n")
        chunks.append(body.rstrip() + "\n")
        chunks.append(f"/* ===== END {name} ===== */\n")

    OUT.write_text("".join(chunks), encoding="utf-8")
    r = subprocess.run(
        ["node", "--check", str(OUT)],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        return 1
    print(f"OK wrote {OUT} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
