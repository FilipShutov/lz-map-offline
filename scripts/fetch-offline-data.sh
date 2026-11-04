#!/usr/bin/env bash
# Downloads everything the app needs offline: repeater data, coverage images and Bulgaria map tiles.
# Runs in GitHub Actions. Needs: curl, jq, node, gh (for the pmtiles CLI download).
set -euo pipefail

MAXZOOM="${MAXZOOM:-13}"
BBOX="${BBOX:-22.0,41.0,29.0,44.4}"   # Bulgaria with a small margin
mkdir -p www/data www/coverage www/tiles

echo "== Repeater data"
curl -fsSL --retry 3 https://api.varna.radio/v1/ -o www/data/repeaters.json
echo "repeaters: $(jq length www/data/repeaters.json)"

echo "== Coverage images"
curl -fsSL --retry 3 https://lz-map.org/coverage/manifest.json -o /tmp/coverage-manifest.json
echo '{}' > www/data/coverage.json
for call in $(jq -r 'keys[]' /tmp/coverage-manifest.json); do
  path=$(jq -r --arg c "$call" '.[$c].bounds[0]' /tmp/coverage-manifest.json)
  if curl -fsSL --retry 2 "https://lz-map.org/${path}" -o "www/coverage/${call}.png"; then
    jq --arg c "$call" --slurpfile m /tmp/coverage-manifest.json '. + {($c): $m[0][$c]}' www/data/coverage.json > /tmp/cov.json
    mv /tmp/cov.json www/data/coverage.json
  else
    echo "  skip $call"; rm -f "www/coverage/${call}.png"
  fi
done
echo "coverage images: $(ls www/coverage | wc -l), $(du -sh www/coverage | cut -f1)"

echo "== Map tiles (Protomaps daily build, z0-${MAXZOOM})"
if ! command -v pmtiles >/dev/null; then
  gh release download -R protomaps/go-pmtiles -p '*Linux_x86_64.tar.gz' -O /tmp/pmtiles.tgz
  tar -xzf /tmp/pmtiles.tgz -C /tmp pmtiles
  PMTILES=/tmp/pmtiles
else
  PMTILES=pmtiles
fi

SRC=""
for i in $(seq 0 14); do
  d=$(date -u -d "-${i} day" +%Y%m%d)
  if curl -fsI "https://build.protomaps.com/${d}.pmtiles" >/dev/null 2>&1; then SRC="https://build.protomaps.com/${d}.pmtiles"; break; fi
done
[ -n "$SRC" ] || { echo "No Protomaps build found"; exit 1; }
echo "source: $SRC"

"$PMTILES" extract "$SRC" /tmp/bulgaria.pmtiles --bbox="$BBOX" --maxzoom="$MAXZOOM"
ls -lh /tmp/bulgaria.pmtiles
node scripts/extract-tiles.mjs /tmp/bulgaria.pmtiles www/tiles
du -sh www/tiles
