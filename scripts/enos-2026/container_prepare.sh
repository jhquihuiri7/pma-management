#!/bin/sh
# Runs inside a throwaway GDAL container (no network).
#   /data  the extracted "Santa_Cruz_shapefiles" folder, read-only
#   /out   work directory
# Per shapefile: a 2D EPSG:4326 GeoJSON and its ogrinfo summary. The source .zip
# per layer is made on the host (the GDAL image has no Python): see README.
set -eu
mkdir -p /out/geojson /out/logs
cd /data
for shp in *.shp; do
  l=$(basename "$shp" .shp)
  ogrinfo -ro -so -al "$shp" > "/out/logs/$l.ogrinfo" 2>&1
  ogr2ogr -f GeoJSON -t_srs EPSG:4326 -dim XY -lco RFC7946=YES -lco WRITE_NAME=NO \
    "/out/geojson/$l.geojson" "$shp" > "/out/logs/$l.log" 2>&1
  echo "$l: $(grep -c . "/out/logs/$l.log" || true) avisos"
done
