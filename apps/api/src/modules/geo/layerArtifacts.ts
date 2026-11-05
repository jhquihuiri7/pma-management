import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { geoLayerArtifacts, geoMapLayers } from "../../db/schema/geo.js";
import { buildGeoLayerDir } from "../../storage/index.js";
import { enqueueFlatGeobuf } from "../../jobs/boss.js";

/**
 * FlatGeobuf files derived from vector revisions (geo_layer_artifacts). The
 * worker builds them; the Workspace serves them by HTTP range. A revision is
 * immutable, so its FlatGeobuf is too: (layer, revision) names it for good.
 */

export const FGB = "fgb";

export function buildGeoLayerFgbPath(mapId: string, layerId: string, revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError("Invalid revision");
  return `${buildGeoLayerDir(mapId, layerId)}/artifacts/r${revision}.fgb`;
}

export type ArtifactStatus = "pending" | "ready" | "error";

/** After this long an errored build is tried again by the reconciler. */
const ERROR_RETRY_AFTER_MS = 6 * 60 * 60_000;

/**
 * Makes sure a FlatGeobuf build exists for the revision: inserts a pending row
 * when there is none and returns the current status. The caller enqueues the
 * job (enqueue is idempotent per layer revision).
 */
export async function claimFgb(layerId: string, revision: number): Promise<ArtifactStatus> {
  const db = getDb();
  await db
    .insert(geoLayerArtifacts)
    .values({ layerId, revision, kind: FGB, status: "pending" })
    .onConflictDoNothing();
  const [row] = await db
    .select({ status: geoLayerArtifacts.status, updatedAt: geoLayerArtifacts.updatedAt })
    .from(geoLayerArtifacts)
    .where(and(eq(geoLayerArtifacts.layerId, layerId), eq(geoLayerArtifacts.revision, revision), eq(geoLayerArtifacts.kind, FGB)))
    .limit(1);
  if (!row) return "pending";
  if (row.status === "error" && Date.now() - row.updatedAt.getTime() > ERROR_RETRY_AFTER_MS) {
    await db
      .update(geoLayerArtifacts)
      .set({ status: "pending", errorMessage: null, updatedAt: new Date() })
      .where(and(eq(geoLayerArtifacts.layerId, layerId), eq(geoLayerArtifacts.revision, revision), eq(geoLayerArtifacts.kind, FGB)));
    return "pending";
  }
  return row.status as ArtifactStatus;
}

/** Revisions with a ready FlatGeobuf, by layer. */
export async function readyFgbRevisions(layerIds: string[]): Promise<Map<string, Set<number>>> {
  const result = new Map<string, Set<number>>();
  if (layerIds.length === 0) return result;
  const rows = await getDb()
    .select({ layerId: geoLayerArtifacts.layerId, revision: geoLayerArtifacts.revision })
    .from(geoLayerArtifacts)
    .where(and(inArray(geoLayerArtifacts.layerId, layerIds), eq(geoLayerArtifacts.kind, FGB), eq(geoLayerArtifacts.status, "ready")));
  for (const row of rows) {
    const set = result.get(row.layerId) ?? new Set<number>();
    set.add(row.revision);
    result.set(row.layerId, set);
  }
  return result;
}

export async function getReadyFgb(layerId: string, revision: number): Promise<{ path: string; sizeBytes: number } | null> {
  const [row] = await getDb()
    .select({ path: geoLayerArtifacts.path, sizeBytes: geoLayerArtifacts.sizeBytes, status: geoLayerArtifacts.status })
    .from(geoLayerArtifacts)
    .where(and(eq(geoLayerArtifacts.layerId, layerId), eq(geoLayerArtifacts.revision, revision), eq(geoLayerArtifacts.kind, FGB)))
    .limit(1);
  if (!row || row.status !== "ready" || !row.path) return null;
  return { path: row.path, sizeBytes: row.sizeBytes ?? 0 };
}

export async function markFgbReady(layerId: string, revision: number, path: string, sizeBytes: number): Promise<void> {
  await getDb()
    .insert(geoLayerArtifacts)
    .values({ layerId, revision, kind: FGB, status: "ready", path, sizeBytes })
    .onConflictDoUpdate({
      target: [geoLayerArtifacts.layerId, geoLayerArtifacts.revision, geoLayerArtifacts.kind],
      set: { status: "ready", path, sizeBytes, errorMessage: null, updatedAt: new Date() },
    });
}

export async function markFgbError(layerId: string, revision: number, message: string): Promise<void> {
  await getDb()
    .insert(geoLayerArtifacts)
    .values({ layerId, revision, kind: FGB, status: "error", errorMessage: message.slice(0, 2000) })
    .onConflictDoUpdate({
      target: [geoLayerArtifacts.layerId, geoLayerArtifacts.revision, geoLayerArtifacts.kind],
      set: { status: "error", errorMessage: message.slice(0, 2000), updatedAt: new Date() },
    });
}

/**
 * Current revisions that still need a FlatGeobuf: no row yet, a row stuck in
 * pending (its job was lost), or an error old enough to try again. Drives the
 * worker's reconciler, which is also how the existing layers get theirs.
 */
export async function listFgbToBuild(limit: number): Promise<Array<{ layerId: string; revision: number }>> {
  const rows = await getDb().execute(sql`
    select l.id as layer_id, l.data_revision as revision
    from ${geoMapLayers} l
    left join ${geoLayerArtifacts} a
      on a.layer_id = l.id and a.revision = l.data_revision and a.kind = ${FGB}
    where a.id is null
       or (a.status = 'pending' and a.updated_at < now() - interval '30 minutes')
       or (a.status = 'error' and a.updated_at < now() - interval '6 hours')
    order by l.size_bytes asc
    limit ${limit}
  `);
  return (rows.rows as Array<{ layer_id: string; revision: number }>).map((r) => ({ layerId: r.layer_id, revision: Number(r.revision) }));
}

/** Rows of the revision the job is about: where its GeoJSON lives and which map owns it. */
export async function getRevisionSource(layerId: string, revision: number): Promise<{ mapId: string; dataPath: string } | null> {
  const rows = await getDb().execute(sql`
    select l.map_id, r.data_path
    from geo_layer_revisions r
    join ${geoMapLayers} l on l.id = r.layer_id
    where r.layer_id = ${layerId} and r.revision = ${revision}
    limit 1
  `);
  const row = rows.rows[0] as { map_id: string; data_path: string } | undefined;
  return row ? { mapId: row.map_id, dataPath: row.data_path } : null;
}

/** Touches a pending row so the reconciler doesn't re-enqueue a job that is running. */
export async function touchFgb(layerId: string, revision: number): Promise<void> {
  await getDb()
    .update(geoLayerArtifacts)
    .set({ updatedAt: new Date() })
    .where(and(eq(geoLayerArtifacts.layerId, layerId), eq(geoLayerArtifacts.revision, revision), eq(geoLayerArtifacts.kind, FGB)));
}

/**
 * Asks for the FlatGeobuf of a revision (best effort: the worker's reconciler
 * catches anything this misses). Returns the status before the request.
 */
export async function requestFgb(layerId: string, revision: number): Promise<ArtifactStatus> {
  const status = await claimFgb(layerId, revision);
  if (status === "pending") await enqueueFlatGeobuf({ layerId, revision });
  return status;
}
