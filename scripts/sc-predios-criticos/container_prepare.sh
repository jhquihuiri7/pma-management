#!/bin/sh
# Runs inside a throwaway GDAL container (worker image, no network).
#   /data  the extracted "Hidrología_San_Cristobal" folder (SHP/ and KML/), read-only
#   /out   work directory
# Per shapefile: a 2D EPSG:4326 GeoJSON (what the Geoportal renders), its
# ogrinfo summary, and a source .zip with every file the delivery brings for that
# layer (.shp .shx .dbf .prj .cpg .qml .sld and the KML copy), stored flat.
set -eu
mkdir -p /out/geojson /out/source /out/logs
cd /data
for shp in SHP/*.shp SHP/*/*.shp; do
  l=$(basename "$shp" .shp)
  d=$(dirname "$shp")
  k="KML${d#SHP}/$l.kml"
  ogrinfo -ro -so -al "$shp" > "/out/logs/$l.ogrinfo" 2>&1
  ogr2ogr -f GeoJSON -t_srs EPSG:4326 -dim XY -lco RFC7946=YES -lco WRITE_NAME=NO \
    "/out/geojson/$l.geojson" "$shp" > "/out/logs/$l.log" 2>&1
  rm -f "/out/source/$l.zip"
  python3 -I -m zipfile -c "/out/source/$l.zip" "$d/$l".* "$k"
  echo "$l: $(ls "$d/$l".* "$k" | wc -l) archivos de origen"
done
