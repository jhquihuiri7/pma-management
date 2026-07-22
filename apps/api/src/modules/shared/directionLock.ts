import { sql, type SQLWrapper } from "drizzle-orm";

export type DirectionSubsystem = "pma" | "rgdp";

type AdvisoryLockTransaction = {
  execute: (query: SQLWrapper | string) => PromiseLike<unknown>;
};

/**
 * Direction values are persisted and compared after trimming at the API
 * boundary. Reusing the same normalization for lock identities prevents two
 * textual representations of the same stored direction from using different
 * locks.
 */
export function normalizeDirection(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Every operation that needs more than one direction lock must acquire this
 * exact, deduplicated order. Default Array.sort() compares UTF-16 code units
 * and is independent from the host locale, so all API instances agree.
 */
export function canonicalDirectionLockOrder(
  directions: readonly (string | null | undefined)[]
): string[] {
  return Array.from(
    new Set(directions.map(normalizeDirection).filter((direction) => direction.length > 0))
  ).sort();
}

/**
 * Serialize direction-wide mutations for the lifetime of the surrounding
 * PostgreSQL transaction. The first advisory key isolates subsystem + plan;
 * the second isolates the normalized direction inside that plan.
 *
 * Call this before taking item row locks. Assignment operations take the same
 * lock, so reversing that order would permit a row-lock/advisory-lock deadlock.
 */
export async function lockPlanDirections(
  tx: AdvisoryLockTransaction,
  subsystem: DirectionSubsystem,
  planId: string,
  directions: readonly (string | null | undefined)[]
): Promise<void> {
  const namespace = `${subsystem}:plan:${planId}:direction`;
  for (const direction of canonicalDirectionLockOrder(directions)) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${namespace}), hashtext(${direction}))`
    );
  }
}
