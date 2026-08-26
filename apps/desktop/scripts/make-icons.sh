#!/usr/bin/env bash
#
# Rasterises build/icon.svg into everything electron-builder packages.
#
# Two outputs, because macOS wants different artwork from the others:
#
#   build/icons/<N>x<N>.png  — the plate as drawn, rounded corners baked in.
#                              Windows and Linux composite nothing, so the icon
#                              has to arrive already shaped.
#   build/icon-mac.png       — the same art with square corners.
#
# macOS 26 (Tahoe) masks every legacy .icns into its own rounded tile and draws
# the platter itself. Handing it the rounded plate puts one rounded rectangle
# inside another — which is the bug this script exists to avoid. Handing it a
# full-bleed square lets the system cut the corners, and the tile keeps #1B1B1B
# instead of the system's #303130 (measured under both light and dark
# appearance; the system platter ignores the theme either way).
#
# Every size is rendered from the vector rather than downsampled from the
# largest: a 16px icon reduced from 1024px is mush.
#
# Needs librsvg: brew install librsvg. Author-side only — CI reads the committed
# PNGs and never runs this.

set -euo pipefail

cd "$(dirname "$0")/.."

SOURCE=build/icon.svg
SIZES=(16 32 48 64 128 256 512 1024)

[ -f "$SOURCE" ] || { echo "$SOURCE is missing." >&2; exit 1; }
command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found. brew install librsvg" >&2; exit 1; }

mkdir -p build/icons
for size in "${SIZES[@]}"; do
  rsvg-convert -w "$size" -h "$size" "$SOURCE" -o "build/icons/${size}x${size}.png"
done

# Squaring off the corners by rewriting the plate's rx. Guarded, because a
# silent no-op here would ship the rounded art to macOS and quietly bring the
# nested-tile bug back.
grep -q 'rx="100"' "$SOURCE" || {
  echo "$SOURCE no longer has the rx=\"100\" plate this script squares off for macOS." >&2
  echo "Update SOURCE handling in $(basename "$0") before regenerating." >&2
  exit 1
}
SQUARE=$(mktemp -t icon-square-XXXXXX.svg)
trap 'rm -f "$SQUARE"' EXIT
sed 's/rx="100"/rx="0"/' "$SOURCE" > "$SQUARE"
rsvg-convert -w 1024 -h 1024 "$SQUARE" -o build/icon-mac.png

echo "build/icons/{$(IFS=,; echo "${SIZES[*]}")} and build/icon-mac.png regenerated from $SOURCE"
