import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { userApps, users } from "../../db/schema/shared.js";
import { BadRequest, NotFound } from "../../lib/errors.js";
import { lockAuthorizationMutations } from "./authorizationLock.js";

type AppKey = "pma" | "rgdp" | "geo" | "previene";
type AssignableRole = "REPORTER" | "VIEWER";

/** Validate the target of an assignment, not only the actor performing it. */
export async function assertAssignableUser(
  userId: string,
  appKey: AppKey,
  allowedRoles: readonly AssignableRole[],
  db: any = getDb(),
) {
  // This must be the first logical lock acquired by assignment writers. It is
  // transaction-scoped and re-entrant, so callers that already locked before a
  // direction lock can safely use this assertion as the final revalidation.
  await lockAuthorizationMutations(db);
  const [row] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .innerJoin(userApps, and(eq(userApps.userId, users.id), eq(userApps.appKey, appKey)))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw NotFound("El usuario no existe o no tiene acceso al subsistema");
  if (!allowedRoles.includes(row.role as AssignableRole)) {
    throw BadRequest(`El rol ${row.role} no es válido para esta asignación`);
  }
  return row;
}

/** Revalidate every inherited direction grant inside the writing transaction. */
export async function assertAssignableUsers(
  userIds: readonly string[],
  appKey: AppKey,
  allowedRoles: readonly AssignableRole[],
  db: any = getDb(),
): Promise<void> {
  for (const userId of new Set(userIds)) {
    await assertAssignableUser(userId, appKey, allowedRoles, db);
  }
}
