import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { geoMaps } from "../../db/schema/geo.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { deleteMapStorage } from "./layersModule.js";

export type GeoMapInput = {
  title: string;
  description?: string;
  categoryId: string;
  arcgisUrl?: string;
  layers?: unknown[];
  center?: [number, number];
  zoom?: number;
  tags?: string[];
};

export async function createMap(_adminId: string, userId: string, input: GeoMapInput) {
  const [row] = await getDb()
    .insert(geoMaps)
    .values({
      title: input.title,
      description: input.description ?? "",
      categoryId: input.categoryId,
      arcgisUrl: input.arcgisUrl ?? null,
      layers: (input.layers ?? []) as any,
      centerLat: input.center?.[0] ?? -1.8,
      centerLng: input.center?.[1] ?? -78.2,
      zoom: input.zoom ?? 7,
      tags: (input.tags ?? null) as any,
      createdBy: userId,
    })
    .returning();
  return rowToApi(row);
}

export async function listMaps(_adminId?: string) {
  const rows = await getDb()
    .select()
    .from(geoMaps)
    .orderBy(desc(geoMaps.createdAt));
  return rows.map(rowToApi);
}

export async function getMapById(id: string, _adminId?: string) {
  const rows = await getDb().select().from(geoMaps).where(eq(geoMaps.id, id)).limit(1);
  if (rows.length === 0) throw NotFound("Map not found");
  return rowToApi(rows[0]);
}

export async function updateMap(id: string, _adminId: string, updates: Partial<GeoMapInput>) {
  const rows = await getDb().select().from(geoMaps).where(eq(geoMaps.id, id)).limit(1);
  if (rows.length === 0) throw NotFound("Map not found");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.description !== undefined) set.description = updates.description;
  if (updates.categoryId !== undefined) set.categoryId = updates.categoryId;
  if (updates.arcgisUrl !== undefined) set.arcgisUrl = updates.arcgisUrl;
  if (updates.layers !== undefined) set.layers = updates.layers;
  if (updates.center !== undefined) {
    set.centerLat = updates.center[0];
    set.centerLng = updates.center[1];
  }
  if (updates.zoom !== undefined) set.zoom = updates.zoom;
  if (updates.tags !== undefined) set.tags = updates.tags;
  const [row] = await getDb().update(geoMaps).set(set).where(eq(geoMaps.id, id)).returning();
  return rowToApi(row);
}

/** Lightweight viewport save — usable by any geo user (no ADMIN required). */
export async function updateMapViewport(id: string, center: [number, number], zoom: number) {
  const rows = await getDb().select({ id: geoMaps.id }).from(geoMaps).where(eq(geoMaps.id, id)).limit(1);
  if (rows.length === 0) throw NotFound("Map not found");
  const [row] = await getDb()
    .update(geoMaps)
    .set({ centerLat: center[0], centerLng: center[1], zoom, updatedAt: new Date() })
    .where(eq(geoMaps.id, id))
    .returning();
  return rowToApi(row);
}

export async function deleteMap(id: string, _adminId?: string) {
  const rows = await getDb().select().from(geoMaps).where(eq(geoMaps.id, id)).limit(1);
  if (rows.length === 0) throw NotFound("Map not found");
  // Layer rows cascade via FK; remove their NAS files explicitly.
  await deleteMapStorage(id);
  await getDb().delete(geoMaps).where(eq(geoMaps.id, id));
}

function rowToApi(row: typeof geoMaps.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categoryId: row.categoryId,
    arcgisUrl: row.arcgisUrl,
    layers: row.layers,
    center: [row.centerLat, row.centerLng] as [number, number],
    zoom: row.zoom,
    tags: row.tags,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
