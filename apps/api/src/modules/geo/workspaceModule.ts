import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { GeoWorkspaceCatalogMap } from "@pma/types/geo";
import { getDb } from "../../db/client.js";
import { geoMapLayers, geoMaps, geoRasterLayers } from "../../db/schema/geo.js";

/**
 * Lightweight public catalog used by the temporary Workspace. Heavy vector
 * data and raster pixels keep flowing through their existing public routes.
 * Storage paths are deliberately never selected or returned here.
 */
export async function listWorkspaceCatalog(categoryId?: string): Promise<GeoWorkspaceCatalogMap[]> {
  const db = getDb();
  const maps = await db
    .select({
      id: geoMaps.id,
      title: geoMaps.title,
      categoryId: geoMaps.categoryId,
      thematic: geoMaps.thematic,
      createdAt: geoMaps.createdAt,
    })
    .from(geoMaps)
    .where(categoryId ? eq(geoMaps.categoryId, categoryId) : undefined)
    .orderBy(desc(geoMaps.createdAt));

  if (maps.length === 0) return [];
  const mapIds = maps.map((map) => map.id);

  const [vectors, rasters] = await Promise.all([
    db
      .select({
        id: geoMapLayers.id,
        mapId: geoMapLayers.mapId,
        name: geoMapLayers.name,
        geometryType: geoMapLayers.geometryType,
        crs: geoMapLayers.crs,
        featureCount: geoMapLayers.featureCount,
        bbox: geoMapLayers.bbox,
        style: geoMapLayers.style,
        zIndex: geoMapLayers.zIndex,
        createdAt: geoMapLayers.createdAt,
      })
      .from(geoMapLayers)
      .where(inArray(geoMapLayers.mapId, mapIds))
      .orderBy(asc(geoMapLayers.zIndex), asc(geoMapLayers.createdAt)),
    db
      .select({
        id: geoRasterLayers.id,
        mapId: geoRasterLayers.mapId,
        name: geoRasterLayers.name,
        bbox: geoRasterLayers.bbox,
        opacity: geoRasterLayers.opacity,
        zIndex: geoRasterLayers.zIndex,
        createdAt: geoRasterLayers.createdAt,
      })
      .from(geoRasterLayers)
      .where(and(
        inArray(geoRasterLayers.mapId, mapIds),
        eq(geoRasterLayers.status, "processed"),
      ))
      .orderBy(asc(geoRasterLayers.zIndex), asc(geoRasterLayers.createdAt)),
  ]);

  const vectorsByMap = new Map<string, typeof vectors>();
  for (const layer of vectors) {
    const current = vectorsByMap.get(layer.mapId) ?? [];
    current.push(layer);
    vectorsByMap.set(layer.mapId, current);
  }
  const rastersByMap = new Map<string, typeof rasters>();
  for (const layer of rasters) {
    const current = rastersByMap.get(layer.mapId) ?? [];
    current.push(layer);
    rastersByMap.set(layer.mapId, current);
  }

  return maps.map((map) => ({
    mapId: map.id,
    mapTitle: map.title,
    categoryId: map.categoryId,
    thematic: map.thematic,
    layers: [
      ...(vectorsByMap.get(map.id) ?? []).map((layer) => ({
        kind: "vector" as const,
        layerId: layer.id,
        name: layer.name,
        geometryType: layer.geometryType as "Point" | "LineString" | "Polygon",
        crs: layer.crs,
        featureCount: layer.featureCount,
        bbox: layer.bbox as number[] | null,
        style: layer.style as Record<string, unknown>,
      })),
      ...(rastersByMap.get(map.id) ?? []).map((layer) => ({
        kind: "raster" as const,
        layerId: layer.id,
        name: layer.name,
        bbox: layer.bbox as number[] | null,
        opacity: layer.opacity,
      })),
    ],
  })).filter((map) => map.layers.length > 0);
}
