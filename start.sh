#!/usr/bin/env bash
# Window Seat — macOS / Linux launcher. First run sets everything up.
set -e
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python) || { echo "Install Python 3.10+ first: https://www.python.org/downloads/"; exit 1; }
[ -x .venv/bin/python ] || { echo "Setting up for the first time…"; "$PY" -m venv .venv; }
STAMP=$(cksum pyproject.toml)
if [ "$(cat .venv/installed.txt 2>/dev/null)" != "$STAMP" ]; then
  echo "Installing dependencies…"
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/python -m pip install --quiet -e .
  echo "$STAMP" > .venv/installed.txt
fi
if [ -n "$1" ]; then mkdir -p flights && cp "$1" flights/; fi
exec .venv/bin/python -m windowseat.cli start
