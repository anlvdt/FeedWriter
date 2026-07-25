#!/usr/bin/env bash
# Sync FeedWriter to a local path Chrome can load reliably.
# EXTERNAL volumes (even APFS) often break MV3 with:
#   "An unknown error occurred when fetching the script"
#
# Usage:
#   ./scripts/sync-local.sh           # sync only (does NOT open Finder)
#   ./scripts/sync-local.sh --open    # sync + reveal folder in Finder
#
# Then chrome://extensions → Load unpacked → that path (or Reload).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${FEEDWRITER_LOCAL_DIR:-$HOME/Library/Application Support/FeedWriter-ext}"
DO_OPEN=0
for arg in "$@"; do
  case "$arg" in
    --open|-o) DO_OPEN=1 ;;
  esac
done

mkdir -p "$DEST"
# Exclude heavy / non-runtime trees
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'ctv-samples/' \
  --exclude '.keys*' \
  --exclude '*.backup' \
  --exclude 'repomix-output.xml' \
  --exclude '.DS_Store' \
  "$ROOT/" "$DEST/"

# Clear macOS provenance attrs that sometimes confuse Chrome
xattr -cr "$DEST" 2>/dev/null || true

# Ensure SW is fresh
if [[ -f "$DEST/scripts/build-sw.py" ]]; then
  python3 "$DEST/scripts/build-sw.py" || true
fi

echo "Synced → $DEST"
echo "Reload extension in chrome://extensions if already loaded from this path."

if [[ "$DO_OPEN" -eq 1 ]]; then
  open "$DEST" 2>/dev/null || true
fi
