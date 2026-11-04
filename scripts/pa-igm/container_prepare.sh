#!/bin/sh
# Runs inside a throwaway GDAL container (worker image, no network).
#   /data    the extracted C_TEMATICA/ and MDT/ of "PUERTO AYORA", read-only
#   /out     work directory
#   /scripts this folder, read-only
# Same steps as scripts/pbm-igm: per vector layer a 2D EPSG:4326 GeoJSON (what
# the Geoportal renders) and a GeoPackage in the original CRS with Z/M and field
# domains (stored as source); the study-area boundary; two display rasters
# derived from the DTM.
set -eu
mkdir -p /out/geojson /out/source /out/logs /out/domains /out/rasters

cd /data/C_TEMATICA
for g in */BDD/*.gdb; do
  t=${g%%/*}
  ogrinfo -ro -so -al "$g" > "/out/domains/$t.fields" 2>/dev/null
  for d in $(grep -o "domain name=[^ ,)]*" "/out/domains/$t.fields" | cut -d= -f2 | sort -u); do
    echo "@@DOMAIN $d"
    ogrinfo -ro -q -fielddomain "$d" "$g"
  done > "/out/domains/$t.domains" 2>&1
  for l in $(ogrinfo -ro -q "$g" | sed -n 's/^ *Layer: \([^ ]*\) .*/\1/p'); do
    ogrinfo -ro -so "$g" "$l" > "/out/logs/$l.ogrinfo" 2>&1
    ogr2ogr -f GeoJSON -t_srs EPSG:4326 -dim XY -lco RFC7946=YES -lco WRITE_NAME=NO \
      "/out/geojson/$l.geojson" "$g" "$l" > "/out/logs/$l.log" 2>&1
    ogr2ogr -f GPKG "/out/source/$l.gpkg" "$g" "$l" >> "/out/logs/$l.log" 2>&1
    (cd /out/source && python3 -I -m zipfile -c "$l.zip" "$l.gpkg")
    echo "$t $l"
  done
done

# 1:5.000 base: outline of the IGM study area (union of the CA polygons).
A=limite_area_estudio_pto_ayora
python3 -I /scripts/study_area.py \
  /data/C_TEMATICA/SINTESIS/BDD/EVAL_TIERRA_PTO_AYORA.gdb CA_PTO_AYORA_A "/out/source/$A.gpkg" \
  "$A" "Área de estudio Puerto Ayora"
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -lco RFC7946=YES -lco WRITE_NAME=NO "/out/geojson/$A.geojson" "/out/source/$A.gpkg"
ogrinfo -ro -so "/out/source/$A.gpkg" "$A" > "/out/logs/$A.ogrinfo" 2>&1
(cd /out/source && python3 -I -m zipfile -c "$A.zip" "$A.gpkg")
echo "derivada $A"

# Display rasters from the DTM (10 m, -2,27 to 853,72 m): the Geoportal draws
# tiles without an elevation stretch, so the Float32 DTM itself would render saturated.
cd /data/MDT
gdal_calc.py --quiet --overwrite -A dtm_pto_ayora.tif --type=Byte --NoDataValue=0 \
  --calc="clip(1 + (A + 2.3) * 254.0 / 856.1, 1, 255)" \
  --co COMPRESS=DEFLATE --co TILED=YES \
  --outfile=/out/rasters/dtm_pto_ayora_elevacion_gris.tif
gdaldem color-relief -q -alpha -co COMPRESS=DEFLATE -co TILED=YES \
  dtm_pto_ayora.tif /scripts/elevacion_color.txt \
  /out/rasters/dtm_pto_ayora_elevacion_color.tif
echo "derivada rasters"
