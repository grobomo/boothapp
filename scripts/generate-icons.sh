#!/usr/bin/env bash
# Generate Chrome extension icons for BoothApp
# Requires: ImageMagick (convert)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$ROOT_DIR/extension/icons"

mkdir -p "$ICONS_DIR"

if ! command -v convert &>/dev/null; then
  echo "ERROR: ImageMagick not found. Install with: apt-get install imagemagick"
  exit 1
fi

# Generate 128px master icon: dark rounded rect with red "B"
convert -size 128x128 xc:none \
  -fill '#1a1a2e' -draw 'roundrectangle 0,0 127,127 20,20' \
  -stroke '#D71920' -strokewidth 3 -fill none -draw 'roundrectangle 4,4 123,123 17,17' \
  -stroke none -fill '#D71920' \
  -font DejaVu-Sans-Bold -pointsize 92 -gravity center \
  -annotate +0+4 'B' \
  "$ICONS_DIR/icon-128.png"
echo "Created icon-128.png"

# Resize to 48 and 16
convert "$ICONS_DIR/icon-128.png" -resize 48x48 "$ICONS_DIR/icon-48.png"
echo "Created icon-48.png"

convert "$ICONS_DIR/icon-128.png" -resize 16x16 "$ICONS_DIR/icon-16.png"
echo "Created icon-16.png"

# Also save SVG source for reference
cat > "$ICONS_DIR/icon.svg" << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="20" ry="20" fill="#1a1a2e"/>
  <rect x="4" y="4" width="120" height="120" rx="17" ry="17" fill="none" stroke="#D71920" stroke-width="3" opacity="0.4"/>
  <text x="64" y="98" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="92" fill="#D71920">B</text>
</svg>
SVGEOF

echo "Done! Icons generated in $ICONS_DIR"
ls -la "$ICONS_DIR"/icon-*.png
