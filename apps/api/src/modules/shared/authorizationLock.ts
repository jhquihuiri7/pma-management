import { sql, type SQLWrapper } from "drizzle-orm";

type AdvisoryLockTransaction = {
  execute: (query: SQLWrapper | string) => PromiseLike<unknown>;
};

/**
 * One transaction-scoped lock protects the authorization invariant shared by
 * user lifecycle mutations and PMA/RGDP assignment writers. The application
 * is small enough that correctness is more valuable than per-user lock
 * sharding, and a single key also makes cross-subsystem role changes atomic.
 *
 * Lock order for every writer is:
 *   authorization -> plan/direction -> database rows.
 *
 * User revocation and role changes only need the first lock. Keeping this
 * order prevents a direction assignment from validating an old app/role,
 * waiting while that access is revoked, and then recreating the grant.
 */
export const AUTHORIZATION_MUTATION_LOCK = 9_042_026;

export async function lockAuthorizationMutations(
  tx: AdvisoryLockTransaction,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${AUTHORIZATION_MUTATION_LOCK})`,
  );
}
