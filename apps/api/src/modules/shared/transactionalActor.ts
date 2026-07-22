import { and, eq } from "drizzle-orm";
import type { AccessTokenClaims } from "../../auth/jwt.js";
import { users, userApps } from "../../db/schema/shared.js";
import { Forbidden } from "../../lib/errors.js";
import { lockAuthorizationMutations } from "./authorizationLock.js";

type AppKey = AccessTokenClaims["apps"][number];
type Role = AccessTokenClaims["role"];

/**
 * Establish the authoritative actor at the start of a write transaction.
 * The global authorization lock is always acquired before the user row, and
 * callers must acquire evidence/plan/item locks only after this helper.
 *
 * ADMIN access is implicit, matching `requireApp`; every other role needs an
 * extant user_apps row. Returning the database role (instead of trusting the
 * JWT snapshot) lets callers repeat object-level authorization in the same
 * transaction that performs the write.
 */
async function lockAndAssertRole(
  tx: any,
  userId: string,
  allowedRoles: readonly Role[],
): Promise<{ id: string; name: string; role: Role }> {
  await lockAuthorizationMutations(tx);
  const [actor] = await tx
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("share");
  if (!actor) throw Forbidden("El usuario ya no está activo");
  if (!allowedRoles.includes(actor.role as Role)) {
    throw Forbidden("El rol del usuario ya no permite esta operación");
  }

  return { id: actor.id, name: actor.name, role: actor.role as Role };
}

/** Global user administration has no subsystem app requirement. */
export async function lockAndAssertGlobalAdmin(
  tx: any,
  userId: string,
): Promise<{ id: string; name: string; role: "ADMIN" }> {
  const actor = await lockAndAssertRole(tx, userId, ["ADMIN"]);
  return { ...actor, role: "ADMIN" };
}

export async function lockAndAssertActor(
  tx: any,
  userId: string,
  appKey: AppKey,
  allowedRoles: readonly Role[],
): Promise<{ id: string; name: string; role: Role }> {
  const actor = await lockAndAssertRole(tx, userId, allowedRoles);

  if (actor.role !== "ADMIN") {
    const [appGrant] = await tx
      .select({ userId: userApps.userId })
      .from(userApps)
      .where(and(eq(userApps.userId, actor.id), eq(userApps.appKey, appKey)))
      .limit(1);
    if (!appGrant) {
      throw Forbidden(`El usuario ya no tiene acceso a ${appKey.toUpperCase()}`);
    }
  }

  return { id: actor.id, name: actor.name, role: actor.role as Role };
}
