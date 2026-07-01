#!/usr/bin/env bash
# Scaffold a new spleak2me site into <output-dir> by copying the template shell.
# Does NOT create content.js — you author that per input.
# Usage: scaffold.sh <output-dir>
set -euo pipefail
DIR="${1:?usage: scaffold.sh <output-dir>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPL="$HERE/../assets/template"
mkdir -p "$DIR"
cp "$TPL/index.html" "$TPL/styles.css" "$TPL/app.js" "$TPL/audio-manifest.js" "$DIR/"
echo "scaffolded spleak2me shell → $DIR"
echo "next: write $DIR/content.js  (window.DOC = {...}),  then optionally: node $HERE/gen-audio.js $DIR"
