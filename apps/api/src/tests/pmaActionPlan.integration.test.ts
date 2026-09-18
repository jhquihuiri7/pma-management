import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "../db/client.js";
import { pmaActionPlanActivations, pmaPlanAssignments, pmaPlans } from "../db/schema/pma.js";
import { userApps, users } from "../db/schema/shared.js";
import { getActionPlan, setActionPlanActive } from "../modules/pma/actionPlanModule.js";

/**
 * What the Plan de Acción feature is actually for cannot be observed without a
 * database: that the flag and the row that justifies it move together, that a
 * deactivation appends instead of erasing the activation it closed, and that
 * asking for the state the plan is already in is refused rather than quietly
 * accepted with a motive attached to a transition that never happened.
 *
 * Skipped without DATABASE_URL. `getDb()` is called inside the test body, never
 * at module scope, so importing this file on a machine with no database does
 * not throw before the skip is evaluated.
 */

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { statusCode?: number }).statusCode
    : undefined;
}

function rejectsWith(status: number) {
  return (error: unknown) => {
    assert.equal(statusOf(error), status, `esperaba ${status}, llegó ${statusOf(error)}`);
    return true;
  };
}

test(
  "the Plan de Acción flag and the history that justifies it move as one",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const pool = getPool();
    const ids = {
      admin: randomUUID(),
      viewer: randomUUID(),
      outsider: randomUUID(),
      plan: randomUUID(),
    };
    const admin = {
      sub: ids.admin,
      role: "ADMIN" as const,
      email: `ap-admin-${ids.admin}@example.invalid`,
    };
    const viewer = {
      sub: ids.viewer,
      role: "VIEWER" as const,
      email: `ap-viewer-${ids.viewer}@example.invalid`,
    };
    const outsider = {
      sub: ids.outsider,
      role: "VIEWER" as const,
      email: `ap-out-${ids.outsider}@example.invalid`,
    };

    try {
      await db.insert(users).values([
        { id: ids.admin, email: admin.email, name: "Administradora", role: "ADMIN" },
        { id: ids.viewer, email: viewer.email, name: "Supervisora", role: "VIEWER" },
        { id: ids.outsider, email: outsider.email, name: "Ajena", role: "VIEWER" },
      ]);
      await db
        .insert(userApps)
        .values([ids.admin, ids.viewer, ids.outsider].map((userId) => ({ userId, appKey: "pma" as const })));
      await db.insert(pmaPlans).values({
        id: ids.plan,
        createdBy: ids.admin,
        title: "Plan de prueba plan de acción",
        reportPer: "6 meses",
        startDate: "2026-01-01",
      });
      // Plan-level access, which is what `canUserAccessPlan` requires of a VIEWER.
      await db
        .insert(pmaPlanAssignments)
        .values({ planId: ids.plan, userId: ids.viewer, explicitAccess: true });

      // The column defaults carry a new plan: vigente, and with no Plan de
      // Acción open.
      const [fresh] = await db.select().from(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      assert.equal(fresh.estado, "Vigente");
      assert.equal(fresh.actionPlanActive, false);

      const empty = await getActionPlan(ids.plan, admin);
      assert.deepEqual(empty, { planId: ids.plan, active: false, activations: [] });

      // --- activation -----------------------------------------------------
      const opened = await setActionPlanActive(
        { planId: ids.plan, active: true, reason: "Incumplimiento del periodo ene-jun 2026" },
        admin,
      );
      assert.equal(opened.ok, true);
      assert.equal(opened.active, true);
      assert.equal(opened.activation.active, true);
      assert.equal(opened.activation.planId, ids.plan);
      assert.equal(opened.activation.reason, "Incumplimiento del periodo ene-jun 2026");
      assert.equal(opened.activation.actorId, ids.admin);
      // Name from the locked user row, address from the token claim.
      assert.equal(opened.activation.actorName, "Administradora");
      assert.equal(opened.activation.actorEmail, admin.email);
      assert.ok(!Number.isNaN(Date.parse(opened.activation.createdAt)));

      const [afterOpen] = await db.select().from(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      assert.equal(afterOpen.actionPlanActive, true, "el flag es la cabeza denormalizada de la historia");

      // --- requesting the state it is already in ---------------------------
      await assert.rejects(
        () => setActionPlanActive({ planId: ids.plan, active: true, reason: "Otra vez" }, admin),
        rejectsWith(409),
      );
      assert.equal(
        (await getActionPlan(ids.plan, admin)).activations.length,
        1,
        "un 409 no deja rastro: el motivo describiría una transición que no ocurrió",
      );

      // --- deactivation appends, it never rewrites -------------------------
      const closed = await setActionPlanActive(
        { planId: ids.plan, active: false, reason: "Cerrado tras el informe de cumplimiento" },
        viewer,
      );
      assert.equal(closed.active, false);
      assert.equal(closed.activation.active, false);
      assert.equal(closed.activation.actorName, "Supervisora");
      assert.equal(closed.activation.actorEmail, viewer.email);
      assert.notEqual(closed.activation.id, opened.activation.id);

      const history = await getActionPlan(ids.plan, admin);
      assert.equal(history.active, false);
      assert.equal(history.activations.length, 2);
      // Newest first.
      assert.deepEqual(history.activations.map((a) => a.active), [false, true]);
      // The row that turned it on is byte-for-byte what it was: a closed cycle
      // still says who opened it and why.
      assert.deepEqual(history.activations[1], opened.activation);

      // --- object-level access --------------------------------------------
      await assert.rejects(() => getActionPlan(ids.plan, outsider), rejectsWith(403));
      await assert.rejects(
        () =>
          setActionPlanActive(
            { planId: ids.plan, active: true, reason: "No debería poder" },
            outsider,
          ),
        rejectsWith(403),
      );
      // The refused write left both the flag and the history untouched.
      const [afterRefusal] = await db.select().from(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      assert.equal(afterRefusal.actionPlanActive, false);
      const rows = await db
        .select()
        .from(pmaActionPlanActivations)
        .where(eq(pmaActionPlanActivations.planId, ids.plan));
      assert.equal(rows.length, 2);

      // A missing plan is a 404 on both sides, not a 500 from a null row.
      await assert.rejects(() => getActionPlan(randomUUID(), admin), rejectsWith(404));
      await assert.rejects(
        () => setActionPlanActive({ planId: randomUUID(), active: true, reason: "M" }, admin),
        rejectsWith(404),
      );
    } finally {
      await db.delete(pmaActionPlanActivations).where(eq(pmaActionPlanActivations.planId, ids.plan));
      await db.delete(pmaPlanAssignments).where(eq(pmaPlanAssignments.planId, ids.plan));
      await db.delete(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      for (const userId of [ids.admin, ids.viewer, ids.outsider]) {
        await db.delete(userApps).where(eq(userApps.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
      await pool.end();
    }
  },
);

test(
  "a REPORTER never reaches the activation history",
  { skip: !process.env.DATABASE_URL },
  async () => {
    // The route's `requireRole("ADMIN", "VIEWER")` hook is the first line, but
    // the module repeats the check against the freshly locked role, so a token
    // issued before a demotion cannot write either.
    const db = getDb();
    const pool = getPool();
    const ids = { admin: randomUUID(), reporter: randomUUID(), plan: randomUUID() };
    const reporter = {
      sub: ids.reporter,
      role: "REPORTER" as const,
      email: `ap-rep-${ids.reporter}@example.invalid`,
    };

    try {
      await db.insert(users).values([
        { id: ids.admin, email: `ap-a2-${ids.admin}@example.invalid`, name: "Admin", role: "ADMIN" },
        { id: ids.reporter, email: reporter.email, name: "Reportero", role: "REPORTER" },
      ]);
      await db
        .insert(userApps)
        .values([ids.admin, ids.reporter].map((userId) => ({ userId, appKey: "pma" as const })));
      await db.insert(pmaPlans).values({
        id: ids.plan,
        createdBy: ids.admin,
        title: "Plan sin reporteros",
        reportPer: "6 meses",
        startDate: "2026-01-01",
      });

      await assert.rejects(
        () =>
          setActionPlanActive(
            { planId: ids.plan, active: true, reason: "Un reportero no abre planes de acción" },
            reporter,
          ),
        rejectsWith(403),
      );
      const rows = await db
        .select()
        .from(pmaActionPlanActivations)
        .where(eq(pmaActionPlanActivations.planId, ids.plan));
      assert.equal(rows.length, 0);
    } finally {
      await db.delete(pmaActionPlanActivations).where(eq(pmaActionPlanActivations.planId, ids.plan));
      await db.delete(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      for (const userId of [ids.admin, ids.reporter]) {
        await db.delete(userApps).where(eq(userApps.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
      await pool.end();
    }
  },
);
