import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb, getPool } from "../db/client.js";
import { geoMaps } from "../db/schema/geo.js";
import { userApps, users } from "../db/schema/shared.js";
import { updateMapViewport } from "../modules/geo/mapsModule.js";
import { AUTHORIZATION_MUTATION_LOCK } from "../modules/shared/authorizationLock.js";
import { deleteManagedUser } from "../modules/shared/usersModule.js";

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type Outcome = { ok: true } | { ok: false; error: unknown };

function outcome(promise: Promise<unknown>): Promise<Outcome> {
  return promise.then(
    () => ({ ok: true as const }),
    (error) => ({ ok: false as const, error }),
  );
}

async function waitUntilAuthorizationLockIsHeld(): Promise<void> {
  const probe = await getPool().connect();
  try {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await probe.query<{ acquired: boolean }>(
        "select pg_try_advisory_xact_lock($1) as acquired",
        [AUTHORIZATION_MUTATION_LOCK],
      );
      if (!result.rows[0]?.acquired) return;
      await pause(10);
    }
    throw new Error("The revocation never acquired the authorization lock");
  } finally {
    probe.release();
  }
}

test(
  "GEO writes cannot commit after the actor's app access is revoked",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const adminId = randomUUID();
    const actorId = randomUUID();
    const mapId = randomUUID();
    const blocker = await getPool().connect();
    let blockerOpen = false;
    let revocationPromise: Promise<Outcome> | undefined;
    let writePromise: Promise<Outcome> | undefined;

    try {
      await db.insert(users).values([
        { id: adminId, email: `${adminId}@example.invalid`, name: "GEO admin", role: "ADMIN" },
        { id: actorId, email: `${actorId}@example.invalid`, name: "GEO viewer", role: "VIEWER" },
      ]);
      await db.insert(userApps).values({ userId: actorId, appKey: "geo" });
      await db.insert(geoMaps).values({
        id: mapId,
        title: "GEO authorization race",
        categoryId: "test",
        layers: [],
        centerLat: -0.9,
        centerLng: -89.6,
        zoom: 7,
        createdBy: actorId,
      });

      // Hold a SHARE lock so the revocation owns the advisory lock but cannot
      // yet delete the actor. The viewport write must wait behind that lock and
      // re-read authorization only after revocation commits.
      await blocker.query("begin");
      blockerOpen = true;
      await blocker.query("select id from users where id = $1 for share", [actorId]);
      revocationPromise = outcome(deleteManagedUser(actorId, "geo", adminId));
      await waitUntilAuthorizationLockIsHeld();

      writePromise = outcome(updateMapViewport(mapId, actorId, [1, 2], 12));
      const stateBeforeRelease = await Promise.race([
        writePromise.then(() => "settled" as const),
        pause(300).then(() => "pending" as const),
      ]);
      assert.equal(stateBeforeRelease, "pending");

      await blocker.query("commit");
      blockerOpen = false;
      const [revocation, write] = await Promise.all([revocationPromise, writePromise]);
      assert.equal(revocation.ok, true);
      assert.equal(write.ok, false);
      if (write.ok) assert.fail("revoked actor unexpectedly committed a GEO write");
      assert.equal(httpStatus(write.error), 403);

      const [map] = await db.select().from(geoMaps).where(eq(geoMaps.id, mapId));
      assert.deepEqual([map.centerLat, map.centerLng], [-0.9, -89.6]);
      assert.equal(map.zoom, 7);
    } finally {
      if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
      blocker.release();
      await Promise.allSettled([revocationPromise, writePromise].filter(Boolean) as Promise<Outcome>[]);
      await db.delete(geoMaps).where(eq(geoMaps.id, mapId));
      await db.delete(users).where(eq(users.id, actorId));
      await db.delete(users).where(eq(users.id, adminId));
      await closeDb();
    }
  },
);

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  return typeof error.statusCode === "number" ? error.statusCode : undefined;
}
