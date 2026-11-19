#!/usr/bin/env bash
# Rebuild vendor/three.bundle.js.
# Usage: build-vendor.sh <work dir>   (the work dir gets: npm i three@0.160.0 esbuild@0.24.0 n8ao@1.10.3 postprocessing@6.36.0 plinkfx@0.3.0 @dimforge/rapier3d-compat@0.14.0 yuka@0.7.8)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:?usage: build-vendor.sh <work dir>}"
mkdir -p "$WORK" && cd "$WORK"
[ -d node_modules/three ] || { npm init -y >/dev/null; npm i three@0.160.0 esbuild@0.24.0 n8ao@1.10.3 postprocessing@6.36.0 plinkfx@0.3.0 @dimforge/rapier3d-compat@0.14.0 yuka@0.7.8 --silent; }
cp "$HERE/three-entry.js" ./three-entry.js
cp "$HERE/physics-entry.js" ./physics-entry.js
./node_modules/.bin/esbuild three-entry.js --bundle --minify --format=iife --legal-comments=eof \
  --outfile="$HERE/../vendor/three.bundle.js" --log-level=warning
./node_modules/.bin/esbuild physics-entry.js --bundle --minify --format=iife --legal-comments=eof \
  --outfile="$HERE/../vendor/physics.bundle.js" --log-level=warning
