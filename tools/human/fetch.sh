#!/usr/bin/env bash
# Fetch the CC0 MakeHuman / MPFB source data used by build.py (sparse, ~150 MB).
# Usage: tools/human/fetch.sh [dest]   (default: tools/human/.src)
set -euo pipefail
DEST="${1:-$(dirname "$0")/.src}"
mkdir -p "$DEST"
cd "$DEST"

if [ ! -d makehuman ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/makehumancommunity/makehuman.git
  git -C makehuman sparse-checkout set \
    makehuman/data/3dobjs makehuman/data/targets/macrodetails makehuman/data/targets/breast makehuman/data/eyes
fi

if [ ! -d mpfb2 ]; then
  git clone --depth 1 --filter=blob:none --no-checkout https://github.com/makehumancommunity/mpfb2.git
  git -C mpfb2 sparse-checkout init --no-cone
  git -C mpfb2 sparse-checkout set '/src/mpfb/data/textures/' '/src/mpfb/data/rigs/standard/' '/src/mpfb/data/mesh_metadata/' '/LICENSE*'
  git -C mpfb2 checkout
fi
echo "sources ready in $DEST"
