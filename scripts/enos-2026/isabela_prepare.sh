#!/bin/sh
# Same as container_prepare.sh for the Isabela_shapefiles.zip delivery (2026-11-24),
# whose shapefiles sit in two folders (Isabela/ and Isabela/Hidrologia_Isabela_DTM_10_m/).
# Runs inside a throwaway GDAL container (no network).
#   /data  the extracted zip, read-only
#   /out   work directory
set -eu
mkdir -p /out/geojson /out/logs
find /data -name '*.shp' | sort | while read -r shp; do
  l=$(basename "$shp" .shp)
  ogrinfo -ro -so -al "$shp" > "/out/logs/$l.ogrinfo" 2>&1
  ogr2ogr -f GeoJSON -t_srs EPSG:4326 -dim XY -lco RFC7946=YES -lco WRITE_NAME=NO \
    "/out/geojson/$l.geojson" "$shp" > "/out/logs/$l.log" 2>&1
  echo "$l: $(grep -c . "/out/logs/$l.log" || true) avisos"
done
