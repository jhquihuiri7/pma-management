import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AccessTokenClaims } from "../../auth/jwt.js";
import { optionalAuthenticate } from "../../auth/middleware.js";
import { getDb } from "../../db/client.js";
import { geoMapAccess, geoMaps } from "../../db/schema/geo.js";
import { NotFound } from "../../lib/errors.js";

/**
 * Who may read a geo map (and therefore its layers, rasters, tiles and data).
 * One rule for the public geoportal routes, the Workspace catalog, its data
 * routes and saved projects (docs/plan-integracion-rustgis.md §3.4):
 *
 *   public      anyone, with or without a session (today's behaviour)
 *   internal    signed-in users with the geo app (ADMIN implicitly)
 *   restricted  ADMIN, the map's creator and the users in geo_map_access
 *
 * A map the reader may not read answers 404, exactly like a missing one, so its
 * existence is never revealed.
 */
export const GEO_VISIBILITIES = ["public", "internal", "restricted"] as const;
export type GeoVisibility = (typeof GEO_VISIBILITIES)[number];
export type GeoReader = Pick<AccessTokenClaims, "sub" | "role" | "apps"> | null | undefined;

export interface MapAccessInfo {
  id: string;
  visibility: GeoVisibility;
  createdBy: string | null;
}

export function hasGeoApp(reader: GeoReader): boolean {
  return !!reader && (reader.role === "ADMIN" || reader.apps.includes("geo"));
}

/** SQL condition on geo_maps selecting the maps `reader` may read. */
export function readableMapsCondition(reader: GeoReader): SQL {
  if (reader?.role === "ADMIN") return sql`true`;
  if (!reader || !hasGeoApp(reader)) return eq(geoMaps.visibility, "public");
  return or(
    eq(geoMaps.visibility, "public"),
    eq(geoMaps.visibility, "internal"),
    and(
      eq(geoMaps.visibility, "restricted"),
      or(
        eq(geoMaps.createdBy, reader.sub),
        sql`exists (select 1 from ${geoMapAccess} where ${geoMapAccess.mapId} = ${geoMaps.id} and ${geoMapAccess.userId} = ${reader.sub})`,
      ),
    ),
  ) as SQL;
}

/** Pure decision, once the map's row and the reader's grant are known. */
export function canReadMap(reader: GeoReader, map: Pick<MapAccessInfo, "visibility" | "createdBy">, granted = false): boolean {
  if (map.visibility === "public") return true;
  if (!reader || !hasGeoApp(reader)) return false;
  if (reader.role === "ADMIN") return true;
  if (map.visibility === "internal") return true;
  return map.createdBy === reader.sub || granted;
}

// Tiles and range reads ask for the same map many times a second: its
// visibility is cached briefly in this process (a change applies within the TTL,
// and immediately here through invalidateMapAccess).
const ACCESS_TTL_MS = 30_000;
const accessCache = new Map<string, { info: MapAccessInfo | null; expiresAt: number }>();

export function invalidateMapAccess(mapId?: string): void {
  if (mapId) accessCache.delete(mapId);
  else accessCache.clear();
}

export async function getMapAccessInfo(mapId: string): Promise<MapAccessInfo | null> {
  const now = Date.now();
  const cached = accessCache.get(mapId);
  if (cached && cached.expiresAt > now) return cached.info;
  const [row] = await getDb()
    .select({ id: geoMaps.id, visibility: geoMaps.visibility, createdBy: geoMaps.createdBy })
    .from(geoMaps)
    .where(eq(geoMaps.id, mapId))
    .limit(1);
  const info: MapAccessInfo | null = row
    ? { id: row.id, visibility: normalizeVisibility(row.visibility), createdBy: row.createdBy }
    : null;
  if (accessCache.size > 5_000) accessCache.clear();
  accessCache.set(mapId, { info, expiresAt: now + ACCESS_TTL_MS });
  return info;
}

async function isGranted(mapId: string, userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ mapId: geoMapAccess.mapId })
    .from(geoMapAccess)
    .where(and(eq(geoMapAccess.mapId, mapId), eq(geoMapAccess.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** Whether `reader` may read `mapId` (false for a missing map). */
export async function canReadMapId(reader: GeoReader, mapId: string): Promise<boolean> {
  const info = await getMapAccessInfo(mapId);
  if (!info) return false;
  if (canReadMap(reader, info)) return true;
  if (info.visibility !== "restricted" || !reader || !hasGeoApp(reader)) return false;
  return isGranted(mapId, reader.sub);
}

/** Throws 404 unless the (already authenticated) reader may read the map. */
export async function assertReaderCanReadMap(reader: GeoReader, mapId: string): Promise<MapAccessInfo> {
  const info = await getMapAccessInfo(mapId);
  if (!info || !(await canReadMapId(reader, mapId))) throw NotFound("Map not found");
  return info;
}

/**
 * For the public geoportal routes: a public map is served without touching the
 * session (cheap, as before); any other one needs a reader allowed to see it.
 */
export async function assertPublicRouteCanReadMap(
  req: FastifyRequest,
  reply: FastifyReply,
  mapId: string,
): Promise<MapAccessInfo> {
  const info = await getMapAccessInfo(mapId);
  if (!info) throw NotFound("Map not found");
  if (info.visibility === "public") return info;
  await optionalAuthenticate(req, reply);
  if (!(await canReadMapId(req.user, mapId))) throw NotFound("Map not found");
  return info;
}

export function normalizeVisibility(value: string | null | undefined): GeoVisibility {
  return (GEO_VISIBILITIES as readonly string[]).includes(value ?? "") ? (value as GeoVisibility) : "public";
}
