import { lockAndAssertActor } from "../shared/transactionalActor.js";

/** Mirrors the geoEditor preHandler using current database state. */
export async function lockAndAssertGeoEditor(tx: any, actorId: string) {
  return lockAndAssertActor(tx, actorId, "geo", ["ADMIN", "REPORTER", "VIEWER"]);
}

/** Field observations mutate authoritative data, so VIEWER is deliberately excluded. */
export async function lockAndAssertGeoFeatureEditor(tx: any, actorId: string) {
  return lockAndAssertActor(tx, actorId, "geo", ["ADMIN", "REPORTER"]);
}

/** Mirrors the adminOnly preHandler using current database state. */
export async function lockAndAssertGeoAdmin(tx: any, actorId: string) {
  return lockAndAssertActor(tx, actorId, "geo", ["ADMIN"]);
}
