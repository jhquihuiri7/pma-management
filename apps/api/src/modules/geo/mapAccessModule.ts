import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema/shared.js";
import { geoMapAccess, geoMaps } from "../../db/schema/geo.js";
import { BadRequest, NotFound } from "../../lib/errors.js";
import { lockAndAssertGeoAdmin } from "./authorization.js";
import { normalizeVisibility, type GeoVisibility } from "./access.js";

/** Visibility of a map and, when restricted, who besides ADMIN and its creator may read it. */
export async function getMapAccess(mapId: string) {
  const db = getDb();
  const [map] = await db
    .select({ id: geoMaps.id, visibility: geoMaps.visibility, createdBy: geoMaps.createdBy })
    .from(geoMaps)
    .where(eq(geoMaps.id, mapId))
    .limit(1);
  if (!map) throw NotFound("Map not found");
  const granted = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(geoMapAccess)
    .innerJoin(users, eq(users.id, geoMapAccess.userId))
    .where(eq(geoMapAccess.mapId, mapId))
    .orderBy(asc(users.name));
  return { mapId: map.id, visibility: normalizeVisibility(map.visibility), createdBy: map.createdBy, users: granted };
}

/** Sets the visibility; with `userIds`, replaces the list of users of a restricted map. */
export async function setMapAccess(mapId: string, actorId: string, visibility: GeoVisibility, userIds?: string[]) {
  await getDb().transaction(async (tx) => {
    await lockAndAssertGeoAdmin(tx, actorId);
    const [map] = await tx.select({ id: geoMaps.id }).from(geoMaps).where(eq(geoMaps.id, mapId)).limit(1).for("update");
    if (!map) throw NotFound("Map not found");
    await tx.update(geoMaps).set({ visibility, updatedAt: new Date() }).where(eq(geoMaps.id, mapId));
    if (userIds) {
      const unique = [...new Set(userIds)];
      if (unique.length > 0) {
        const found = await tx.select({ id: users.id }).from(users).where(inArray(users.id, unique));
        if (found.length !== unique.length) throw BadRequest("Alguno de los usuarios no existe");
      }
      await tx.delete(geoMapAccess).where(eq(geoMapAccess.mapId, mapId));
      if (unique.length > 0) {
        await tx.insert(geoMapAccess).values(unique.map((userId) => ({ mapId, userId })));
      }
    }
  });
  return getMapAccess(mapId);
}

/** Restricted maps a user was granted. */
export async function listGrantedMapIds(userId: string): Promise<Set<string>> {
  const rows = await getDb().select({ mapId: geoMapAccess.mapId }).from(geoMapAccess).where(eq(geoMapAccess.userId, userId));
  return new Set(rows.map((r) => r.mapId));
}
