import { eq, desc } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { geoMaps } from "../../db/schema/geo.js";
import { NotFound } from "../../lib/errors.js";
import { buildGeoMapDir } from "../../storage/index.js";
import { enqueueStorageDirectoryCleanup } from "../shared/storageCleanup.js";
import { lockAndAssertGeoAdmin, lockAndAssertGeoEditor } from "./authorization.js";

export type GeoMapInput = {
  title: string;
  description?: string;
  categoryId: string;
  thematic?: string;
  layers?: unknown[];
  center?: [number, number];
  zoom?: number;
  tags?: string[];
};

export async function createMap(actorId: string, input: GeoMapInput) {
  return getDb().transaction(async (tx) => {
    const actor = await lockAndAssertGeoEditor(tx, actorId);
    const [row] = await tx
      .insert(geoMaps)
      .values({
        title: input.title,
        description: input.description ?? "",
        categoryId: input.categoryId,
        thematic: input.thematic ?? "",
        layers: (input.layers ?? []) as any,
        centerLat: input.center?.[0] ?? -1.8,
        centerLng: input.center?.[1] ?? -78.2,
        zoom: input.zoom ?? 7,
        tags: (input.tags ?? null) as any,
        createdBy: actor.id,
      })
      .returning();
    if (!row) throw new Error("Map insert returned no row");
    return rowToApi(row);
  });
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

export async function updateMap(id: string, actorId: string, updates: Partial<GeoMapInput>) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.description !== undefined) set.description = updates.description;
  if (updates.categoryId !== undefined) set.categoryId = updates.categoryId;
  if (updates.thematic !== undefined) set.thematic = updates.thematic;
  if (updates.layers !== undefined) set.layers = updates.layers;
  if (updates.center !== undefined) {
    set.centerLat = updates.center[0];
    set.centerLng = updates.center[1];
  }
  if (updates.zoom !== undefined) set.zoom = updates.zoom;
  if (updates.tags !== undefined) set.tags = updates.tags;
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    const [row] = await tx.update(geoMaps).set(set).where(eq(geoMaps.id, id)).returning();
    if (!row) throw NotFound("Map not found");
    return rowToApi(row);
  });
}

/** Lightweight viewport save — usable by any geo user (no ADMIN required). */
export async function updateMapViewport(
  id: string,
  actorId: string,
  center: [number, number],
  zoom: number,
) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    const [row] = await tx
      .update(geoMaps)
      .set({ centerLat: center[0], centerLng: center[1], zoom, updatedAt: new Date() })
      .where(eq(geoMaps.id, id))
      .returning();
    if (!row) throw NotFound("Map not found");
    return rowToApi(row);
  });
}

export async function deleteMap(id: string, actorId: string) {
  await getDb().transaction(async (tx) => {
    await lockAndAssertGeoAdmin(tx, actorId);
    const rows = await tx
      .select({ id: geoMaps.id })
      .from(geoMaps)
      .where(eq(geoMaps.id, id))
      .limit(1)
      .for("update");
    if (rows.length === 0) throw NotFound("Map not found");
    // The aggregate disappears atomically with a durable cleanup intent. NAS
    // deletion is retried by the worker and cannot leave a live half-map if it
    // is temporarily unavailable.
    await enqueueStorageDirectoryCleanup(tx, buildGeoMapDir(id), `geo:map:${id}`);
    const deleted = await tx.delete(geoMaps).where(eq(geoMaps.id, id)).returning({ id: geoMaps.id });
    if (deleted.length !== 1) throw NotFound("Map not found");
  });
}

function rowToApi(row: typeof geoMaps.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categoryId: row.categoryId,
    thematic: row.thematic,
    layers: row.layers,
    center: [row.centerLat, row.centerLng] as [number, number],
    zoom: row.zoom,
    tags: row.tags,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
