#!/bin/sh
# Loads the Galápagos geographic database (BDG_Galapagos_mapas: one folder per
# map, one shapefile .zip per layer, indice_capas.xlsx as reference) into the
# Geoportal of the running production stack.
#
#   scripts/bdg-galapagos/run.sh <BDG folder> <ADMIN user id> [work dir]
#
# 1. GDAL (worker image, no network, folder mounted read-only) reprojects every
#    layer from its .prj to EPSG:4326, drops Z and reads text as the .cpg says.
# 2. Each layer is checked against the index (records, geometry, extent, UTF-8).
# 3. Inside pma-api, the deployed createMap/createLayer modules store the maps
#    and layers (NAS + revisions), exactly like an upload from the web editor.
# 4. Everything is read back from the NAS and compared byte for byte.
#
# Re-running is safe: maps are matched by title + "BDG Galápagos" tag and layers
# by name, so only what is missing gets created and the stack order is restored.
# The original folder is never written to.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "${1:?carpeta BDG_Galapagos_mapas}" && pwd)
ACTOR=${2:?id del usuario ADMIN que firma la carga}
WORK=${3:-$(mktemp -d)}
mkdir -p "$WORK/out" "$WORK/staging"
rm -rf "$WORK/out"/* "$WORK/staging"/*

node "$HERE/dump_index.cjs" "$SRC/indice_capas.xlsx" "$WORK/index.json"
docker run --rm --network none --user "$(id -u):$(id -g)" --entrypoint sh \
  -v "$SRC:/data:ro" -v "$WORK/out:/out" -v "$HERE:/scripts:ro" \
  pma-management/worker:prod /scripts/convert.sh | awk '$1 != 0 { bad++ } END { print NR " capas convertidas, " bad+0 " con error" }'
node "$HERE/analyze.cjs" "$WORK/index.json" "$WORK/out" "$WORK/analysis.json"
node "$HERE/check_dbf.cjs" "$SRC" "$WORK/dbf_check.json"
node "$HERE/build_plan.cjs" "$WORK/analysis.json" "$WORK/out" "$SRC" "$WORK/staging" | head -1

docker exec pma-api rm -rf /tmp/bdg-import
docker cp "$WORK/staging" pma-api:/tmp/bdg-import
docker cp "$HERE/load.mjs" pma-api:/tmp/bdg-import/load.mjs
docker cp "$HERE/verify.mjs" pma-api:/tmp/bdg-import/verify.mjs
docker exec -w /app pma-api node /tmp/bdg-import/load.mjs /tmp/bdg-import "$ACTOR" > "$WORK/load.log"
awk -F' [|] ' '{ print $2 }' "$WORK/load.log" | sort | uniq -c
docker exec -w /app pma-api node /tmp/bdg-import/verify.mjs /tmp/bdg-import | head -1
docker cp pma-api:/tmp/bdg-import/results.json "$WORK/results.json"
docker cp pma-api:/tmp/bdg-import/verify.json "$WORK/verify.json"
docker exec pma-api rm -rf /tmp/bdg-import

node "$HERE/report.cjs" "$WORK" "$WORK/reporte_carga_BDG_Galapagos.xlsx" | head -3
echo "Reporte: $WORK/reporte_carga_BDG_Galapagos.xlsx"
