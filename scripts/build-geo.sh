#!/usr/bin/env bash
# Rebuilds the simplified boundary files in src/data/geo from their open sources.
# Requires: curl, npx (downloads mapshaper on demand).
set -euo pipefail
OUT="$(cd "$(dirname "$0")/.." && pwd)/src/data/geo"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

# India districts (Census 2011 based, with Telangana/Ladakh updates) - github.com/udit-001/india-maps-data
curl -fsSL -o india.geojson https://raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/india.geojson
curl -fsSL -o telangana.geojson https://raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/states/telangana.geojson
# GHMC ward boundaries (OpenStreetMap derived) - github.com/datameet/Municipal_Spatial_Data
curl -fsSL -o ghmc-wards.geojson https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Hyderabad/ghmc-wards.geojson

MS="npx --yes mapshaper@0.6"
$MS india.geojson -dissolve st_nm copy-fields=st_code -simplify 9% keep-shapes \
  -o format=geojson precision=0.001 "$OUT/india-states.json"
$MS telangana.geojson -filter-fields district,dt_code -simplify 25% keep-shapes \
  -o format=geojson precision=0.0005 "$OUT/telangana-districts.json"
$MS ghmc-wards.geojson -filter-fields name -simplify 35% keep-shapes \
  -o format=geojson precision=0.00005 "$OUT/ghmc-wards.json"
echo "Wrote $OUT"
