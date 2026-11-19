#!/usr/bin/env bash
# Rebuild vendor/three.bundle.js.
# Usage: build-vendor.sh <work dir>   (the work dir gets: npm i three@0.160.0 esbuild@0.24.0)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:?usage: build-vendor.sh <work dir>}"
mkdir -p "$WORK" && cd "$WORK"
[ -d node_modules/three ] || { npm init -y >/dev/null; npm i three@0.160.0 esbuild@0.24.0 --silent; }
cp "$HERE/three-entry.js" ./three-entry.js
./node_modules/.bin/esbuild three-entry.js --bundle --minify --format=iife --legal-comments=eof \
  --outfile="$HERE/../vendor/three.bundle.js" --log-level=warning
