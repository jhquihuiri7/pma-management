import { and, eq, asc, desc } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzip as gzipCallback, gunzip as gunzipCallback } from "node:zlib";
import type { Feature, FeatureCollection } from "geojson";
import type { GeoLayerAttributeSchema } from "@pma/types/geo";
import { getDb } from "../../db/client.js";
import { geoMaps, geoMapLayers, geoLayerRevisions } from "../../db/schema/geo.js";
import { BadRequest, HttpError, NotFound } from "../../lib/errors.js";
import {
  getStorage,
  buildGeoMapDir,
  buildGeoLayerDataPath,
  buildGeoLayerSourcePath,
  buildGeoLayerRevisionPath,
} from "../../storage/index.js";
import { enqueueStorageDirectoryCleanup } from "../shared/storageCleanup.js";
import { beginDurableStorageIntent } from "../shared/durableFilePersistence.js";
import { lockAndAssertGeoAdmin, lockAndAssertGeoEditor, lockAndAssertGeoFeatureEditor } from "./authorization.js";
import {
  assertValidAttributeSchema,
  bboxForFeatures,
  inferAttributeSchema,
  validateAndBuildFeature,
} from "./featureValidation.js";

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);
const VECTOR_MAX_FILE_BYTES = 50 * 1024 * 1024;

export type CreateLayerInput = {
  name: string;
  geometryType: string;
  crs?: string;
  featureCount?: number;
  bbox?: number[] | null;
  sourceFormat?: string;
  /** Normalized GeoJSON bytes (required) — what the map renders. */
  data: Buffer;
  /** Original upload bytes (.zip/.shp), optional. */
  source?: { data: Buffer; ext: string } | null;
  style: unknown;
  visible?: boolean;
  zIndex?: number;
};

export type UpdateLayerInput = {
  name?: string;
  style?: unknown;
  visible?: boolean;
  zIndex?: number;
};

export type AppendFeatureInput = {
  expectedRevision: number;
  clientFeatureId: string;
  properties: Record<string, unknown>;
  geometry: unknown;
  reason?: string;
};

async function assertMap(mapId: string, db: any = getDb()) {
  const rows = await db.select({ id: geoMaps.id }).from(geoMaps).where(eq(geoMaps.id, mapId)).limit(1);
  if (rows.length === 0) throw NotFound("Map not found");
}

export async function listLayers(mapId: string) {
  const rows = await getDb()
    .select()
    .from(geoMapLayers)
    .where(eq(geoMapLayers.mapId, mapId))
    .orderBy(asc(geoMapLayers.zIndex), asc(geoMapLayers.createdAt));
  return rows.map(rowToApi);
}

export async function createLayer(mapId: string, actorId: string, input: CreateLayerInput) {
  await assertMap(mapId);
  const storage = getStorage();

  // Generate the identifier before touching either persistence system. This
  // makes every path unique and lets us write the complete catalog row in one
  // INSERT (there is never a visible row with dataPath="").
  const layerId = randomUUID();
  const dataPath = buildGeoLayerDataPath(mapId, layerId);
  const sourcePath = input.source
    ? buildGeoLayerSourcePath(mapId, layerId, input.source.ext)
    : null;
  const layerDirectory = `${buildGeoMapDir(mapId)}/layers/${layerId}`;
  const compressedData = await gzip(input.data);
  const intent = await beginDurableStorageIntent({
    path: layerDirectory,
    reason: `geo:layer:${layerId}`,
    isDirectory: true,
    storage,
    db: getDb(),
  });

  try {
    // Store GeoJSON gzip-compressed (served with Content-Encoding: gzip).
    await storage.upload({ path: dataPath, data: compressedData, contentType: "application/gzip" });
    if (input.source && sourcePath) {
      await storage.upload({ path: sourcePath, data: input.source.data });
    }

    const row = await intent.finalize(async (tx) => {
      // The map can disappear while compression/storage is in progress. Check
      // it again after the current actor has been locked and revalidated.
      await assertMap(mapId, tx);
      const [persisted] = await tx
        .insert(geoMapLayers)
        .values({
          id: layerId,
          mapId,
          name: input.name,
          geometryType: input.geometryType,
          crs: input.crs ?? "EPSG:4326",
          featureCount: input.featureCount ?? 0,
          bbox: (input.bbox ?? null) as unknown as object,
          sourceFormat: input.sourceFormat ?? "geojson",
          dataPath,
          sourcePath,
          sizeBytes: input.data.byteLength,
          style: input.style as object,
          visible: input.visible ?? true,
          zIndex: input.zIndex ?? 0,
          createdBy: actorId,
        })
        .returning();
      if (!persisted) throw new Error("Geo layer insert returned no row");
      await tx.insert(geoLayerRevisions).values({
        layerId,
        revision: 1,
        dataPath,
        featureCount: input.featureCount ?? 0,
        bbox: (input.bbox ?? null) as unknown as object,
        sizeBytes: input.data.byteLength,
        checksum: createHash("sha256").update(compressedData).digest("hex"),
        action: "snapshot",
        createdBy: actorId,
      });
      return persisted;
    }, {
      beforeIntentLock: (tx) => lockAndAssertGeoEditor(tx, actorId).then(() => undefined),
    });

    return rowToApi(row);
  } catch (err) {
    // Storage is staged before the single DB insert. If either side fails, the
    // whole UUID-owned directory is compensation-safe and cannot contain files
    // belonging to another layer.
    try {
      await intent.compensate();
    } catch (cleanupError) {
      throw new AggregateError([err, cleanupError], "Layer persistence and cleanup both failed");
    }
    throw err;
  }
}

export async function updateLayer(
  mapId: string,
  layerId: string,
  actorId: string,
  updates: UpdateLayerInput,
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.style !== undefined) set.style = updates.style;
  if (updates.visible !== undefined) set.visible = updates.visible;
  if (updates.zIndex !== undefined) set.zIndex = updates.zIndex;
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoEditor(tx, actorId);
    const [row] = await tx
      .update(geoMapLayers)
      .set(set)
      .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId)))
      .returning();
    if (!row) throw NotFound("Layer not found");
    return rowToApi(row);
  });
}

export async function getLayerCaptureSchema(mapId: string, layerId: string) {
  const layer = await findLayer(mapId, layerId);
  if (layer.attributeSchema) {
    return {
      schema: layer.attributeSchema as unknown as GeoLayerAttributeSchema,
      schemaVersion: layer.schemaVersion,
      manualEntryEnabled: layer.manualEntryEnabled,
      inferred: false,
    };
  }
  const collection = await readFeatureCollection(layer.dataPath);
  return {
    schema: inferAttributeSchema(collection),
    schemaVersion: layer.schemaVersion,
    manualEntryEnabled: false,
    inferred: true,
  };
}

export async function updateLayerCaptureSchema(
  mapId: string,
  layerId: string,
  actorId: string,
  schema: GeoLayerAttributeSchema,
  manualEntryEnabled: boolean,
) {
  const validated = assertValidAttributeSchema(schema);
  return getDb().transaction(async (tx) => {
    await lockAndAssertGeoAdmin(tx, actorId);
    const [row] = await tx
      .update(geoMapLayers)
      .set({
        attributeSchema: validated as unknown as object,
        schemaVersion: 1,
        manualEntryEnabled,
        updatedAt: new Date(),
      })
      .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId)))
      .returning();
    if (!row) throw NotFound("Layer not found");
    return rowToApi(row);
  });
}

export async function appendFeature(
  mapId: string,
  layerId: string,
  actorId: string,
  input: AppendFeatureInput,
) {
  const layer = await findLayer(mapId, layerId);
  const duplicate = await getDb()
    .select({ revision: geoLayerRevisions.revision })
    .from(geoLayerRevisions)
    .where(and(eq(geoLayerRevisions.layerId, layerId), eq(geoLayerRevisions.featureId, input.clientFeatureId)))
    .limit(1);
  if (duplicate.length > 0) return existingFeatureReceipt(layer, input.clientFeatureId);
  if (!layer.manualEntryEnabled || !layer.attributeSchema) {
    throw new HttpError(409, "La captura manual no está configurada para esta capa.");
  }
  if (input.expectedRevision !== layer.dataRevision) {
    throw new HttpError(409, "La capa cambió desde que fue cargada. Actualiza los datos e intenta nuevamente.");
  }

  const collection = await readFeatureCollection(layer.dataPath);
  const schema = assertValidAttributeSchema(layer.attributeSchema as unknown as GeoLayerAttributeSchema);
  const feature = validateAndBuildFeature({
    featureId: input.clientFeatureId,
    properties: input.properties,
    geometry: input.geometry,
    geometryType: assertGeometryType(layer.geometryType),
    schema,
    existingFeatures: collection.features,
  });
  const nextCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: [...collection.features, feature],
  };
  const serialized = Buffer.from(JSON.stringify(nextCollection), "utf8");
  if (serialized.byteLength > VECTOR_MAX_FILE_BYTES) {
    throw new HttpError(413, "La nueva revisión supera el límite de 50 MB para una capa vectorial.");
  }
  const bbox = bboxForFeatures(nextCollection.features);
  const compressed = await gzip(serialized);
  const nextRevision = layer.dataRevision + 1;
  const dataPath = buildGeoLayerRevisionPath(mapId, layerId, nextRevision, randomUUID());
  const checksum = createHash("sha256").update(compressed).digest("hex");
  const storage = getStorage();
  const intent = await beginDurableStorageIntent({
    path: dataPath,
    reason: `geo:layer-revision:${layerId}:${nextRevision}`,
    storage,
    db: getDb(),
  });

  try {
    await storage.upload({ path: dataPath, data: compressed, contentType: "application/gzip" });
    const persisted = await intent.finalize(async (tx) => {
      const [locked] = await tx
        .select()
        .from(geoMapLayers)
        .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId)))
        .limit(1)
        .for("update");
      if (!locked) throw NotFound("Layer not found");
      if (!locked.manualEntryEnabled || !locked.attributeSchema) throw new HttpError(409, "La captura manual fue desactivada.");
      if (locked.dataRevision !== input.expectedRevision || locked.dataPath !== layer.dataPath) {
        throw new HttpError(409, "Otra persona actualizó la capa. Recarga e intenta nuevamente.");
      }
      const now = new Date();
      await tx.insert(geoLayerRevisions).values({
        layerId,
        revision: nextRevision,
        dataPath,
        featureCount: nextCollection.features.length,
        bbox: bbox as unknown as object,
        sizeBytes: serialized.byteLength,
        checksum,
        action: "append",
        featureId: input.clientFeatureId,
        featureSnapshot: feature as unknown as object,
        changeReason: input.reason?.trim() || null,
        createdBy: actorId,
        createdAt: now,
      });
      const [updated] = await tx
        .update(geoMapLayers)
        .set({
          dataPath,
          dataRevision: nextRevision,
          featureCount: nextCollection.features.length,
          bbox: bbox as unknown as object,
          sizeBytes: serialized.byteLength,
          updatedAt: now,
        })
        .where(eq(geoMapLayers.id, layerId))
        .returning();
      if (!updated) throw NotFound("Layer not found");
      return { row: updated, updatedAt: now };
    }, {
      beforeIntentLock: (tx) => lockAndAssertGeoFeatureEditor(tx, actorId).then(() => undefined),
    });
    return {
      persisted: true as const,
      feature,
      revision: nextRevision,
      featureCount: persisted.row.featureCount,
      bbox,
      sizeBytes: persisted.row.sizeBytes,
      updatedAt: persisted.updatedAt.toISOString(),
    };
  } catch (error) {
    try { await intent.compensate(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Layer revision and cleanup both failed"); }
    throw error;
  }
}

export async function listLayerRevisions(mapId: string, layerId: string) {
  await findLayer(mapId, layerId);
  const rows = await getDb()
    .select({
      id: geoLayerRevisions.id,
      revision: geoLayerRevisions.revision,
      featureCount: geoLayerRevisions.featureCount,
      bbox: geoLayerRevisions.bbox,
      sizeBytes: geoLayerRevisions.sizeBytes,
      checksum: geoLayerRevisions.checksum,
      action: geoLayerRevisions.action,
      featureId: geoLayerRevisions.featureId,
      changeReason: geoLayerRevisions.changeReason,
      createdBy: geoLayerRevisions.createdBy,
      createdAt: geoLayerRevisions.createdAt,
    })
    .from(geoLayerRevisions)
    .where(eq(geoLayerRevisions.layerId, layerId))
    .orderBy(desc(geoLayerRevisions.revision));
  return rows;
}

export async function deleteLayer(mapId: string, layerId: string, actorId: string) {
  await getDb().transaction(async (tx) => {
    await lockAndAssertGeoAdmin(tx, actorId);
    const rows = await tx
      .select({ id: geoMapLayers.id })
      .from(geoMapLayers)
      .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId)))
      .limit(1)
      .for("update");
    if (rows.length === 0) throw NotFound("Layer not found");
    await enqueueStorageDirectoryCleanup(
      tx,
      `${buildGeoMapDir(mapId)}/layers/${layerId}`,
      `geo:layer:${layerId}`,
    );
    const deleted = await tx
      .delete(geoMapLayers)
      .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId)))
      .returning({ id: geoMapLayers.id });
    if (deleted.length !== 1) throw NotFound("Layer not found");
  });
}

export async function getLayerDataPath(mapId: string, layerId: string): Promise<string> {
  const rows = await getDb()
    .select({ mapId: geoMapLayers.mapId, dataPath: geoMapLayers.dataPath })
    .from(geoMapLayers)
    .where(eq(geoMapLayers.id, layerId))
    .limit(1);
  if (rows.length === 0 || rows[0].mapId !== mapId) throw NotFound("Layer not found");
  return rows[0].dataPath;
}

export async function getLayerRevisionDataPath(mapId: string, layerId: string, revision: number): Promise<string> {
  const layer = await findLayer(mapId, layerId);
  if (revision === layer.dataRevision) return layer.dataPath;
  const [row] = await getDb()
    .select({ dataPath: geoLayerRevisions.dataPath })
    .from(geoLayerRevisions)
    .where(and(eq(geoLayerRevisions.layerId, layerId), eq(geoLayerRevisions.revision, revision)))
    .limit(1);
  if (!row) throw NotFound("Layer revision not found");
  return row.dataPath;
}

async function findLayer(mapId: string, layerId: string) {
  const [row] = await getDb()
    .select()
    .from(geoMapLayers)
    .where(and(eq(geoMapLayers.id, layerId), eq(geoMapLayers.mapId, mapId)))
    .limit(1);
  if (!row) throw NotFound("Layer not found");
  return row;
}

async function readFeatureCollection(path: string): Promise<FeatureCollection> {
  const storage = getStorage();
  if (!(await storage.exists(path))) throw NotFound("Layer data not found");
  let parsed: unknown;
  try { parsed = JSON.parse((await gunzip(await storage.download(path))).toString("utf8")); }
  catch { throw BadRequest("La revisión vigente de la capa no contiene GeoJSON válido."); }
  if (!isRecord(parsed) || parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw BadRequest("La revisión vigente no es un FeatureCollection.");
  }
  return parsed as unknown as FeatureCollection;
}

async function existingFeatureReceipt(layer: typeof geoMapLayers.$inferSelect, featureId: string) {
  const collection = await readFeatureCollection(layer.dataPath);
  const feature = collection.features.find((candidate) => String(candidate.id) === featureId);
  if (!feature) throw new HttpError(409, "La solicitud ya fue registrada, pero la capa cambió posteriormente.");
  return {
    persisted: true as const,
    feature,
    revision: layer.dataRevision,
    featureCount: layer.featureCount,
    bbox: layer.bbox as number[],
    sizeBytes: layer.sizeBytes,
    updatedAt: layer.updatedAt.toISOString(),
  };
}

function assertGeometryType(value: string): "Point" | "LineString" | "Polygon" {
  if (value !== "Point" && value !== "LineString" && value !== "Polygon") throw BadRequest("Tipo de geometría de capa no soportado.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowToApi(row: typeof geoMapLayers.$inferSelect) {
  return {
    id: row.id,
    mapId: row.mapId,
    name: row.name,
    geometryType: row.geometryType,
    crs: row.crs,
    featureCount: row.featureCount,
    bbox: row.bbox,
    sourceFormat: row.sourceFormat,
    dataRevision: row.dataRevision,
    attributeSchema: row.attributeSchema,
    schemaVersion: row.schemaVersion,
    manualEntryEnabled: row.manualEntryEnabled,
    sizeBytes: row.sizeBytes,
    style: row.style,
    visible: row.visible,
    zIndex: row.zIndex,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
