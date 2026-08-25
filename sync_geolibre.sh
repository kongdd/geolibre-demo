#!/usr/bin/env bash
# patch 对 2026-08-24 38ce4cd；行号变了对照 geolibre/SOURCE 重做
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
src=${GEOLIBRE:-/home/kong/GitHub/kongdd/GeoLibre}
cp -f "$src/packages/plugins/src/plugins/basemap-thumbnails.ts" "$root/geolibre/"
git -C "$src" log -1 --format='%ci  %h  %s' -- packages/plugins/src/plugins/basemap-thumbnails.ts | tee "$root/geolibre/SOURCE"
patch -d "$root/geolibre" -p0 --forward --batch < "$root/geolibre/basemap-thumbnails.patch"
