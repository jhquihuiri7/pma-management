import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { geoLayerVisualizations, geoMapLayers } from "../../db/schema/geo.js";
import { BadRequest, NotFound } from "../../lib/errors.js";
import { lockAndAssertGeoEditor } from "./authorization.js";

export interface VisualizationInput {
  type: string;
  title: string;
  position: number;
  bindings: unknown[];
  options: Record<string, unknown>;
  version: 1;
}

async function assertLayer(mapId: string, layerId: string, db: any, lock = false): Promise<void> {
  let query = db.select({ id: geoMapLayers.id }).from(geoMapLayers)
    .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId))).limit(1);
  if (lock) query = query.for("update");
  const rows = await query;
  if (!rows.length) throw NotFound("Layer not found");
}

export async function listVisualizations(mapId: string, layerId: string) {
  await assertLayer(mapId, layerId, getDb());
  const rows = await getDb().select().from(geoLayerVisualizations)
    .where(and(eq(geoLayerVisualizations.mapId, mapId), eq(geoLayerVisualizations.layerId, layerId)))
    .orderBy(asc(geoLayerVisualizations.position), asc(geoLayerVisualizations.createdAt));
  return rows.map(rowToApi);
}

export async function createVisualization(mapId: string, layerId: string, actorId: string, input: VisualizationInput) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    await assertLayer(mapId, layerId, tx, true);
    const existing = await tx.select({ id: geoLayerVisualizations.id }).from(geoLayerVisualizations)
      .where(and(eq(geoLayerVisualizations.mapId, mapId), eq(geoLayerVisualizations.layerId, layerId)));
    if (existing.length >= 20) throw BadRequest("La capa alcanzó el límite de 20 visualizaciones");
    const [row] = await tx.insert(geoLayerVisualizations).values({
      mapId,
      layerId,
      type: input.type,
      title: input.title,
      position: input.position,
      config: { bindings: input.bindings, options: input.options },
      version: input.version,
      createdBy: actorId,
    }).returning();
    if (!row) throw new Error("Visualization insert returned no row");
    return rowToApi(row);
  });
}

export async function updateVisualization(
  mapId: string,
  layerId: string,
  visualizationId: string,
  actorId: string,
  input: Partial<VisualizationInput>,
) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    await assertLayer(mapId, layerId, tx, true);
    const current = await tx.select().from(geoLayerVisualizations).where(and(
      eq(geoLayerVisualizations.id, visualizationId),
      eq(geoLayerVisualizations.mapId, mapId),
      eq(geoLayerVisualizations.layerId, layerId),
    )).limit(1).for("update");
    if (!current.length) throw NotFound("Visualization not found");
    const previousConfig = current[0].config as { bindings?: unknown[]; options?: Record<string, unknown> };
    const [row] = await tx.update(geoLayerVisualizations).set({
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.version !== undefined ? { version: input.version } : {}),
      ...(input.bindings !== undefined || input.options !== undefined ? {
        config: {
          bindings: input.bindings ?? previousConfig.bindings ?? [],
          options: input.options ?? previousConfig.options ?? {},
        },
      } : {}),
      updatedAt: new Date(),
    }).where(eq(geoLayerVisualizations.id, visualizationId)).returning();
    if (!row) throw NotFound("Visualization not found");
    return rowToApi(row);
  });
}

export async function deleteVisualization(mapId: string, layerId: string, visualizationId: string, actorId: string) {
  await getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    await assertLayer(mapId, layerId, tx, true);
    const rows = await tx.delete(geoLayerVisualizations).where(and(
      eq(geoLayerVisualizations.id, visualizationId),
      eq(geoLayerVisualizations.mapId, mapId),
      eq(geoLayerVisualizations.layerId, layerId),
    )).returning({ id: geoLayerVisualizations.id });
    if (!rows.length) throw NotFound("Visualization not found");
  });
}

export async function reorderVisualizations(mapId: string, layerId: string, actorId: string, ids: string[]) {
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    await assertLayer(mapId, layerId, tx, true);
    const existing = await tx.select({ id: geoLayerVisualizations.id }).from(geoLayerVisualizations)
      .where(and(eq(geoLayerVisualizations.mapId, mapId), eq(geoLayerVisualizations.layerId, layerId))).for("update");
    const expected = new Set(existing.map((row) => row.id));
    if (ids.length !== expected.size || ids.some((id) => !expected.has(id)) || new Set(ids).size !== ids.length) {
      throw BadRequest("El orden no contiene exactamente las visualizaciones de la capa");
    }
    if (ids.length) {
      for (const [position, id] of ids.entries()) {
        await tx.update(geoLayerVisualizations)
          .set({ position, updatedAt: new Date() })
          .where(eq(geoLayerVisualizations.id, id));
      }
    }
    const rows = await tx.select().from(geoLayerVisualizations)
      .where(and(eq(geoLayerVisualizations.mapId, mapId), eq(geoLayerVisualizations.layerId, layerId)))
      .orderBy(asc(geoLayerVisualizations.position));
    return rows.map(rowToApi);
  });
}

function rowToApi(row: typeof geoLayerVisualizations.$inferSelect) {
  const config = row.config as { bindings?: unknown[]; options?: Record<string, unknown> };
  return {
    id: row.id,
    mapId: row.mapId,
    layerId: row.layerId,
    type: row.type,
    title: row.title,
    position: row.position,
    bindings: config.bindings ?? [],
    options: config.options ?? {},
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
