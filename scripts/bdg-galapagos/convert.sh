#!/bin/sh
# Runs inside a throwaway GDAL container. /data is the original folder (read-only),
# /out is the scratch output. For each zip: layer info, .prj EPSG, and a 2D
# EPSG:4326 GeoJSON (RFC 7946) with the attribute encoding taken from the .cpg.
set -u
cd /data
for zip in */*.zip; do
  folder=${zip%%/*}; base=$(basename "$zip" .zip)
  mkdir -p "/out/info/$folder" "/out/geojson/$folder"
  info="/out/info/$folder/$base"
  shp=$(unzip -Z1 "$zip" 2>/dev/null | grep -i '\.shp$' | head -1)
  prj=$(unzip -Z1 "$zip" 2>/dev/null | grep -i '\.prj$' | head -1)
  cpg=$(unzip -Z1 "$zip" 2>/dev/null | grep -i '\.cpg$' | head -1)
  unzip -Z1 "$zip" > "$info.entries" 2>&1
  [ -n "$prj" ] && unzip -p "$zip" "$prj" > "$info.prj"
  [ -n "$cpg" ] && unzip -p "$zip" "$cpg" > "$info.cpg"
  [ -n "$prj" ] && gdalsrsinfo -e -o epsg "/vsizip//data/$zip/$prj" > "$info.epsg" 2>&1
  ogrinfo -ro -so -al "/vsizip//data/$zip/$shp" > "$info.ogrinfo" 2>&1
  ogr2ogr -f GeoJSON -t_srs EPSG:4326 -dim XY -lco RFC7946=YES -lco WRITE_NAME=NO \
    "/out/geojson/$folder/$base.geojson" "/vsizip//data/$zip/$shp" > "$info.ogr2ogr.log" 2>&1
  echo "$? $zip"
done
