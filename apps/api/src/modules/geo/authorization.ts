import { lockAndAssertActor } from "../shared/transactionalActor.js";

/** Mirrors the geoEditor preHandler using current database state. */
export async function lockAndAssertGeoEditor(tx: any, actorId: string) {
  return lockAndAssertActor(tx, actorId, "geo", ["ADMIN", "REPORTER", "VIEWER"]);
}

/** Mirrors the adminOnly preHandler using current database state. */
export async function lockAndAssertGeoAdmin(tx: any, actorId: string) {
  return lockAndAssertActor(tx, actorId, "geo", ["ADMIN"]);
}
