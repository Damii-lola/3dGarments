#!/bin/sh
# npm postinstall: the Python libraries the sewing-pattern builder needs (py/pattern.py), installed into
# server/.pydeps. Never fails the install: without Python, /api/ngl/pattern answers 503 and the rest works.
cd "$(dirname "$0")/.." || exit 0
[ -n "$SKIP_PYDEPS" ] && exit 0
command -v python3 >/dev/null 2>&1 || { echo "pydeps: no python3, skipping"; exit 0; }
if [ -f .pydeps/.ok ] && cmp -s py/requirements.txt .pydeps/.ok; then echo "pydeps: up to date"; exit 0; fi
PIP="python3 -m pip"
if ! $PIP --version >/dev/null 2>&1; then
  echo "pydeps: bootstrapping pip"
  curl -sSf https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py && python3 /tmp/get-pip.py --target /tmp/pipboot -q --break-system-packages 2>/dev/null \
    || python3 /tmp/get-pip.py --target /tmp/pipboot -q || { echo "pydeps: no pip, skipping"; exit 0; }
  PIP="env PYTHONPATH=/tmp/pipboot python3 -m pip"
fi
rm -rf .pydeps && $PIP install -q --no-cache-dir --target .pydeps -r py/requirements.txt --break-system-packages 2>/dev/null \
  || $PIP install -q --no-cache-dir --target .pydeps -r py/requirements.txt \
  || { echo "pydeps: install failed, skipping"; exit 0; }
cp py/requirements.txt .pydeps/.ok && echo "pydeps: installed"
