"""Outline of the IGM study area: union of one layer's polygons, kept as a line.

    python3 -I study_area.py <gdb> <layer> <out.gpkg>

Works in the source CRS (WGS 84 / UTM 17S, as delivered), so area_ha matches the
690,53 ha printed on the IGM map sheets.
"""
import sys
from osgeo import ogr, osr

ogr.UseExceptions()
gdb, layer_name, out_path = sys.argv[1:4]

ds = ogr.Open(gdb)  # keep a reference: the layer is invalid once ds is freed
src = ds.GetLayerByName(layer_name)
parts = ogr.Geometry(ogr.wkbMultiPolygon)
for feature in src:
    geom = feature.GetGeometryRef().Clone()
    geom.FlattenTo2D()
    geom = ogr.ForceToMultiPolygon(geom)
    for i in range(geom.GetGeometryCount()):
        parts.AddGeometry(geom.GetGeometryRef(i))
union = parts.UnionCascaded()
area_ha = round(union.GetArea() / 10_000, 2)
boundary = ogr.ForceToMultiLineString(union.Boundary())

srs = osr.SpatialReference()
srs.ImportFromEPSG(32717)
out_ds = ogr.GetDriverByName("GPKG").CreateDataSource(out_path)
out = out_ds.CreateLayer("limite_area_estudio_pto_baquerizo_moreno", srs, ogr.wkbMultiLineString)
for name, kind in (("nombre", ogr.OFTString), ("area_ha", ogr.OFTReal), ("escala", ogr.OFTInteger), ("fuente", ogr.OFTString)):
    out.CreateField(ogr.FieldDefn(name, kind))
feature = ogr.Feature(out.GetLayerDefn())
feature.SetField("nombre", "Área de estudio Puerto Baquerizo Moreno")
feature.SetField("area_ha", area_ha)
feature.SetField("escala", 5000)
feature.SetField("fuente", f"IGM 2025; contorno de la unión de {layer_name}")
feature.SetGeometry(boundary)
out.CreateFeature(feature)
out_ds = None
print(f"área de estudio: {area_ha} ha, {union.GetGeometryCount() if union.GetGeometryType() == ogr.wkbMultiPolygon else 1} parte(s)")
