import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessTokenClaims } from "../../auth/jwt.js";
import { getDb } from "../../db/client.js";
import { geoMapLayers, geoMaps, geoRasterLayers, geoWorkspaceProjects } from "../../db/schema/geo.js";
import { BadRequest, Conflict, HttpError, NotFound } from "../../lib/errors.js";
import { env } from "../../lib/env.js";
import { assertReaderCanReadMap, canReadMapId, type GeoReader } from "./access.js";
import { readyFgbRevisions, requestFgb } from "./layerArtifacts.js";
import {
  buildProject,
  checkProjectText,
  extractCatalogRefs,
  layerRefsForStorage,
  legacyFromProject,
  resolveProject,
  RUSTGIS_VERSION,
  type LayerStyleLike,
  type Notice,
  type RasterEntry,
  type ResolveState,
  type VectorEntry,
} from "./rustgisProject.js";

/**
 * Workspace projects (geo_workspace_projects): saved RustGIS documents that are
 * re-checked against the catalog every time they are opened.
 */

type Actor = Pick<AccessTokenClaims, "sub" | "role" | "apps">;

const rasterVersionSql = sql<string>`floor(extract(epoch from ${geoRasterLayers.processedAt}) * 1000)::bigint`;

async function readableMaps(reader: GeoReader, mapIds: Iterable<string>): Promise<Set<string>> {
  const readable = new Set<string>();
  for (const id of new Set(mapIds)) {
    if (await canReadMapId(reader, id)) readable.add(id);
  }
  return readable;
}

/** Current catalog state of the layers a project refers to, as `reader` sees it. */
export async function loadResolveState(reader: GeoReader, refs: Array<{ kind: "vector" | "raster"; id: string }>): Promise<ResolveState> {
  const db = getDb();
  const vectorIds = [...new Set(refs.filter((r) => r.kind === "vector").map((r) => r.id))];
  const rasterIds = [...new Set(refs.filter((r) => r.kind === "raster").map((r) => r.id))];
  const vectors = new Map<string, { readable: boolean; name: string; revision: number; fgbReady: Set<number> }>();
  const rasters = new Map<string, { readable: boolean; name: string; version: number; bandCount: number | null; hasAlpha: boolean }>();
  if (vectorIds.length > 0) {
    const rows = await db
      .select({ id: geoMapLayers.id, mapId: geoMapLayers.mapId, name: geoMapLayers.name, revision: geoMapLayers.dataRevision })
      .from(geoMapLayers)
      .where(inArray(geoMapLayers.id, vectorIds));
    const readable = await readableMaps(reader, rows.map((r) => r.mapId));
    const ready = await readyFgbRevisions(rows.map((r) => r.id));
    for (const row of rows) {
      const fgbReady = ready.get(row.id) ?? new Set<number>();
      vectors.set(row.id, { readable: readable.has(row.mapId), name: row.name, revision: row.revision, fgbReady });
      if (readable.has(row.mapId) && !fgbReady.has(row.revision)) {
        await requestFgb(row.id, row.revision).catch((error) => console.warn("[geo] could not request FlatGeobuf", error));
      }
    }
  }
  if (rasterIds.length > 0) {
    const rows = await db
      .select({
        id: geoRasterLayers.id,
        mapId: geoRasterLayers.mapId,
        name: geoRasterLayers.name,
        status: geoRasterLayers.status,
        bandCount: geoRasterLayers.bandCount,
        hasAlpha: geoRasterLayers.hasAlpha,
        version: rasterVersionSql,
      })
      .from(geoRasterLayers)
      .where(inArray(geoRasterLayers.id, rasterIds));
    const readable = await readableMaps(reader, rows.map((r) => r.mapId));
    for (const row of rows) {
      rasters.set(row.id, {
        readable: readable.has(row.mapId) && row.status === "processed" && row.version != null,
        name: row.name,
        version: Number(row.version),
        bandCount: row.bandCount,
        hasAlpha: row.hasAlpha,
      });
    }
  }
  return { vectors, rasters };
}

// ── Opening a Map of the geoportal ─────────────────────────────────────────

export async function openMapProject(reader: Actor, mapId: string, origin: string) {
  await assertReaderCanReadMap(reader, mapId);
  const db = getDb();
  const [map] = await db
    .select({ id: geoMaps.id, title: geoMaps.title, centerLat: geoMaps.centerLat, centerLng: geoMaps.centerLng, zoom: geoMaps.zoom })
    .from(geoMaps)
    .where(eq(geoMaps.id, mapId))
    .limit(1);
  if (!map) throw NotFound("Map not found");
  const vectorRows = await db
    .select({
      id: geoMapLayers.id,
      name: geoMapLayers.name,
      geometryType: geoMapLayers.geometryType,
      visible: geoMapLayers.visible,
      zIndex: geoMapLayers.zIndex,
      style: geoMapLayers.style,
      revision: geoMapLayers.dataRevision,
    })
    .from(geoMapLayers)
    .where(eq(geoMapLayers.mapId, mapId));
  const rasterRows = await db
    .select({
      id: geoRasterLayers.id,
      name: geoRasterLayers.name,
      visible: geoRasterLayers.visible,
      zIndex: geoRasterLayers.zIndex,
      opacity: geoRasterLayers.opacity,
      bandCount: geoRasterLayers.bandCount,
      hasAlpha: geoRasterLayers.hasAlpha,
      version: rasterVersionSql,
    })
    .from(geoRasterLayers)
    .where(and(eq(geoRasterLayers.mapId, mapId), eq(geoRasterLayers.status, "processed")));
  const ready = await readyFgbRevisions(vectorRows.map((r) => r.id));
  const vectors: VectorEntry[] = [];
  for (const row of vectorRows) {
    const fgbReady = ready.get(row.id) ?? new Set<number>();
    if (!fgbReady.has(row.revision)) {
      await requestFgb(row.id, row.revision).catch((error) => console.warn("[geo] could not request FlatGeobuf", error));
    }
    vectors.push({
      id: row.id,
      name: row.name,
      geometryType: row.geometryType,
      visible: row.visible,
      zIndex: row.zIndex,
      style: (row.style ?? null) as LayerStyleLike | null,
      revision: row.revision,
      fgbReady,
    });
  }
  const rasters: RasterEntry[] = rasterRows
    .filter((r) => r.version != null)
    .map((r) => ({
      id: r.id,
      name: r.name,
      visible: r.visible,
      zIndex: r.zIndex,
      opacity: r.opacity,
      bandCount: r.bandCount,
      hasAlpha: r.hasAlpha,
      version: Number(r.version),
    }));
  const { project, notices } = buildProject({
    title: map.title,
    center: [map.centerLat, map.centerLng],
    zoom: map.zoom,
    vectors,
    rasters,
    origin,
  });
  return { title: map.title, sourceMapId: map.id, project: JSON.stringify(project), notices };
}

// ── Saved projects ─────────────────────────────────────────────────────────

function projectSummary(row: typeof geoWorkspaceProjects.$inferSelect) {
  const refs = Array.isArray(row.layerRefs) ? row.layerRefs : [];
  return {
    id: row.id,
    title: row.title,
    sourceMapId: row.sourceMapId,
    revision: row.revision,
    sizeBytes: row.sizeBytes,
    layerCount: refs.length,
    rustgisVersion: row.rustgisVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type ProjectSummary = ReturnType<typeof projectSummary>;

async function loadOwnedRow(actor: Actor, id: string) {
  const [row] = await getDb().select().from(geoWorkspaceProjects).where(eq(geoWorkspaceProjects.id, id)).limit(1);
  if (!row || (row.ownerId !== actor.sub && actor.role !== "ADMIN")) throw NotFound("Proyecto no encontrado");
  return row;
}

export async function listProjects(actor: Actor): Promise<ProjectSummary[]> {
  const rows = await getDb()
    .select()
    .from(geoWorkspaceProjects)
    .where(eq(geoWorkspaceProjects.ownerId, actor.sub))
    .orderBy(desc(geoWorkspaceProjects.updatedAt))
    .limit(500);
  return rows.map(projectSummary);
}

function prepareText(text: string) {
  try {
    const checked = checkProjectText(text, env.GEO_WORKSPACE_MAX_PROJECT_BYTES);
    const refs = layerRefsForStorage(extractCatalogRefs(checked.project));
    return { checked, refs };
  } catch (error) {
    if (error instanceof RangeError) throw new HttpError(413, error.message);
    throw BadRequest(error instanceof Error ? error.message : "Proyecto inválido");
  }
}

export async function createProject(actor: Actor, input: { title: string; project: string; sourceMapId?: string | null }) {
  const { checked, refs } = prepareText(input.project);
  if (input.sourceMapId) await assertReaderCanReadMap(actor, input.sourceMapId);
  const [row] = await getDb()
    .insert(geoWorkspaceProjects)
    .values({
      title: input.title,
      ownerId: actor.sub,
      sourceMapId: input.sourceMapId ?? null,
      rustgisProject: input.project,
      layerRefs: refs,
      rustgisVersion: RUSTGIS_VERSION,
      sizeBytes: checked.bytes,
    })
    .returning();
  if (!row) throw new Error("Project insert returned no row");
  return projectSummary(row);
}

export async function updateProject(
  actor: Actor,
  id: string,
  input: { title?: string; project?: string; baseRevision: number },
) {
  const current = await loadOwnedRow(actor, id);
  const set: Partial<typeof geoWorkspaceProjects.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) set.title = input.title;
  if (input.project !== undefined) {
    const { checked, refs } = prepareText(input.project);
    set.rustgisProject = input.project;
    set.layerRefs = refs;
    set.sizeBytes = checked.bytes;
    set.rustgisVersion = RUSTGIS_VERSION;
  }
  const [row] = await getDb()
    .update(geoWorkspaceProjects)
    .set({ ...set, revision: sql`${geoWorkspaceProjects.revision} + 1` })
    .where(and(eq(geoWorkspaceProjects.id, current.id), eq(geoWorkspaceProjects.revision, input.baseRevision)))
    .returning();
  if (!row) throw Conflict("El proyecto cambió desde que lo abriste. Guárdalo como copia o vuelve a abrirlo.");
  return projectSummary(row);
}

export async function deleteProject(actor: Actor, id: string) {
  const row = await loadOwnedRow(actor, id);
  await getDb().delete(geoWorkspaceProjects).where(eq(geoWorkspaceProjects.id, row.id));
}

export async function openSavedProject(actor: Actor, id: string, origin: string) {
  const row = await loadOwnedRow(actor, id);
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.rustgisProject);
  } catch {
    throw new HttpError(422, "El proyecto guardado está dañado");
  }
  const refs = extractCatalogRefs(parsed);
  const state = await loadResolveState(actor, refs);
  const { project, notices } = resolveProject(parsed, state, origin);
  return { ...projectSummary(row), project: JSON.stringify(project), notices };
}

// ── The old Workspace's files (sigtar-workspace v1/v2) ──────────────────────

const legacyLayerSchema = z.object({
  kind: z.enum(["vector", "raster"]),
  source: z.object({ mapId: z.string().uuid(), layerId: z.string().uuid() }).strict(),
  presentation: z
    .object({
      name: z.string().trim().min(1).max(200),
      visible: z.boolean(),
      zIndex: z.number().int().min(-10_000).max(10_000),
      opacity: z.number().min(0).max(1).optional(),
      style: z.record(z.unknown()).optional(),
      visualizations: z.array(z.unknown()).optional(),
    })
    .strict(),
}).strict();

export const legacyDocumentSchema = z.object({
  schema: z.literal("sigtar-workspace"),
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string(),
  view: z
    .object({
      center: z.tuple([z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180)]),
      zoom: z.number().int().min(0).max(22),
      basemap: z.string().max(20),
    })
    .strict(),
  layers: z.array(legacyLayerSchema).max(1_000),
}).strict();

export async function importLegacyProject(actor: Actor, input: { title: string; document: unknown; origin: string }) {
  const parsed = legacyDocumentSchema.safeParse(input.document);
  if (!parsed.success) throw BadRequest("El archivo no es un Workspace de SIGTAR válido", parsed.error.flatten());
  const doc = parsed.data;
  const db = getDb();
  const vectorRefs = doc.layers.filter((l) => l.kind === "vector");
  const rasterRefs = doc.layers.filter((l) => l.kind === "raster");
  const notices: Notice[] = [];
  const vectors: VectorEntry[] = [];
  const rasters: RasterEntry[] = [];
  if (vectorRefs.length > 0) {
    const rows = await db
      .select({ id: geoMapLayers.id, mapId: geoMapLayers.mapId, geometryType: geoMapLayers.geometryType, revision: geoMapLayers.dataRevision })
      .from(geoMapLayers)
      .where(inArray(geoMapLayers.id, vectorRefs.map((l) => l.source.layerId)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const readable = await readableMaps(actor, rows.map((r) => r.mapId));
    const ready = await readyFgbRevisions(rows.map((r) => r.id));
    for (const ref of vectorRefs) {
      const row = byId.get(ref.source.layerId);
      if (!row || row.mapId !== ref.source.mapId || !readable.has(row.mapId)) {
        notices.push({ kind: "unavailable", name: ref.presentation.name });
        continue;
      }
      const fgbReady = ready.get(row.id) ?? new Set<number>();
      if (!fgbReady.has(row.revision)) await requestFgb(row.id, row.revision).catch(() => undefined);
      vectors.push({
        id: row.id,
        name: ref.presentation.name,
        geometryType: row.geometryType,
        visible: ref.presentation.visible,
        zIndex: ref.presentation.zIndex,
        style: (ref.presentation.style ?? null) as LayerStyleLike | null,
        revision: row.revision,
        fgbReady,
      });
    }
  }
  if (rasterRefs.length > 0) {
    const rows = await db
      .select({
        id: geoRasterLayers.id,
        mapId: geoRasterLayers.mapId,
        status: geoRasterLayers.status,
        bandCount: geoRasterLayers.bandCount,
        hasAlpha: geoRasterLayers.hasAlpha,
        version: rasterVersionSql,
      })
      .from(geoRasterLayers)
      .where(inArray(geoRasterLayers.id, rasterRefs.map((l) => l.source.layerId)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const readable = await readableMaps(actor, rows.map((r) => r.mapId));
    for (const ref of rasterRefs) {
      const row = byId.get(ref.source.layerId);
      if (!row || row.mapId !== ref.source.mapId || !readable.has(row.mapId) || row.status !== "processed" || row.version == null) {
        notices.push({ kind: "unavailable", name: ref.presentation.name });
        continue;
      }
      rasters.push({
        id: row.id,
        name: ref.presentation.name,
        visible: ref.presentation.visible,
        zIndex: ref.presentation.zIndex,
        opacity: ref.presentation.opacity ?? 1,
        bandCount: row.bandCount,
        hasAlpha: row.hasAlpha,
        version: Number(row.version),
      });
    }
  }
  const built = buildProject({
    title: input.title,
    center: doc.view.center,
    zoom: doc.view.zoom,
    basemap: doc.view.basemap,
    vectors,
    rasters,
    origin: input.origin,
  });
  const text = JSON.stringify(built.project);
  const summary = await createProject(actor, { title: input.title, project: text });
  return { ...summary, project: text, notices: [...notices, ...built.notices] };
}

export async function exportLegacyProject(actor: Actor, id: string) {
  const row = await loadOwnedRow(actor, id);
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.rustgisProject);
  } catch {
    throw new HttpError(422, "El proyecto guardado está dañado");
  }
  const refs = extractCatalogRefs(parsed);
  const db = getDb();
  const vectorIds = [...new Set(refs.filter((r) => r.kind === "vector").map((r) => r.id))];
  const rasterIds = [...new Set(refs.filter((r) => r.kind === "raster").map((r) => r.id))];
  const vectorRows = vectorIds.length
    ? await db
        .select({ id: geoMapLayers.id, mapId: geoMapLayers.mapId, geometryType: geoMapLayers.geometryType, style: geoMapLayers.style })
        .from(geoMapLayers)
        .where(inArray(geoMapLayers.id, vectorIds))
    : [];
  const rasterRows = rasterIds.length
    ? await db.select({ id: geoRasterLayers.id, mapId: geoRasterLayers.mapId }).from(geoRasterLayers).where(inArray(geoRasterLayers.id, rasterIds))
    : [];
  const readable = await readableMaps(actor, [...vectorRows.map((r) => r.mapId), ...rasterRows.map((r) => r.mapId)]);
  const vectors = new Map(
    vectorRows
      .filter((r) => readable.has(r.mapId))
      .map((r) => [r.id, { mapId: r.mapId, geometryType: r.geometryType, style: (r.style ?? null) as LayerStyleLike | null }]),
  );
  const rasters = new Map(rasterRows.filter((r) => readable.has(r.mapId)).map((r) => [r.id, { mapId: r.mapId }]));
  return { title: row.title, document: legacyFromProject(parsed, { vectors, rasters }) };
}
