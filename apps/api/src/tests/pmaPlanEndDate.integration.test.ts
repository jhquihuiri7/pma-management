import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import {
  pmaEvidences,
  pmaPeriodCompliance,
  pmaPlanItems,
  pmaPlans,
} from "../db/schema/pma.js";
import { userApps, users } from "../db/schema/shared.js";
import { updatePlan } from "../modules/pma/plansModule.js";
import { getPlanCalendar, getPlanPeriods } from "../modules/pma/planSchedule.js";

/**
 * What the end date is *for* cannot be observed without a database: that
 * declaring one refuses to strand work already recorded past it, that the
 * refusal counts only what the plan currently shows, and that the round trip
 * Vigente → Vencida → Vigente leaves the column empty again rather than
 * carrying a stale date back into a live calendar.
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

test(
  "an end date refuses to hide work recorded past it, and clears on the way back",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const ids = {
      admin: randomUUID(),
      plan: randomUUID(),
      item: randomUUID(),
      evidence: randomUUID(),
    };
    const START = "2024-03-01";
    const END = "2025-06-10";

    // Blocks of six months from March 2024. The period that *contains* the end
    // date stays visible; everything starting after it does not.
    const schedule = { startDate: START, createdAt: new Date(`${START}T00:00:00Z`), reportPer: "6 meses" };
    const visibleAfterEnd = getPlanPeriods(getPlanCalendar({ ...schedule, endDate: END }))
      .map((period) => period.key);
    const strandedKey = getPlanPeriods(getPlanCalendar(schedule))
      .map((period) => period.key)
      .find((key) => !visibleAfterEnd.includes(key));
    assert.ok(strandedKey, "el plan de prueba debe tener al menos un periodo posterior al fin");

    try {
      await db.insert(users).values({
        id: ids.admin,
        email: `ed-admin-${ids.admin}@example.invalid`,
        name: "Administradora",
        role: "ADMIN",
      });
      await db.insert(userApps).values({ userId: ids.admin, appKey: "pma" });
      await db.insert(pmaPlans).values({
        id: ids.plan,
        createdBy: ids.admin,
        title: "Plan de prueba fecha de fin",
        reportPer: "6 meses",
        startDate: START,
      });
      await db.insert(pmaPlanItems).values({
        id: ids.item,
        planId: ids.plan,
        item: "Ítem de prueba",
        subplan: "Subplan de prueba",
        periodicity: "Mensual",
        reportPer: "6 meses",
      });

      // Trabajo registrado después de la fecha de fin que se va a proponer.
      await db.insert(pmaEvidences).values({
        id: ids.evidence,
        planId: ids.plan,
        planItemId: ids.item,
        uploadedBy: ids.admin,
        uploaderName: "Administradora",
        fileName: "posterior.pdf",
        storagePath: `pma/${ids.plan}/posterior.pdf`,
        activityMonth: "2026-01",
      });
      await db.insert(pmaPeriodCompliance).values({
        planItemId: ids.item,
        periodKey: strandedKey,
        status: "C",
      });

      // --- el rechazo -----------------------------------------------------
      const refused = await updatePlan(ids.plan, ids.admin, { estado: "Vencida", endDate: END })
        .then(() => null, (error: unknown) => error);
      assert.ok(refused, "fijar el fin sobre trabajo posterior debe rechazarse");
      assert.equal(statusOf(refused), 400);
      assert.match(messageOf(refused), /1 evidencia/, "debe nombrar la evidencia que se ocultaría");
      assert.match(messageOf(refused), /1 calificación/, "debe nombrar la calificación que se ocultaría");

      const [untouched] = await db.select().from(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      assert.equal(untouched.estado, "Vigente", "el rechazo no deja el estado a medias");
      assert.equal(untouched.endDate, null);

      // --- una vez retirado ese trabajo -----------------------------------
      await db.delete(pmaEvidences).where(eq(pmaEvidences.id, ids.evidence));
      await db.delete(pmaPeriodCompliance).where(eq(pmaPeriodCompliance.planItemId, ids.item));

      const expired = await updatePlan(ids.plan, ids.admin, { estado: "Vencida", endDate: END });
      assert.equal(expired.estado, "Vencida");
      assert.equal(expired.end_date, END, "la API serializa la fecha como date-only");

      const [stored] = await db.select().from(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      const periods = getPlanPeriods(getPlanCalendar({
        startDate: stored.startDate,
        createdAt: stored.createdAt,
        reportPer: stored.reportPer,
        endDate: stored.endDate,
      })).map((period) => period.key);
      assert.deepEqual(periods, visibleAfterEnd, "el cronograma se detiene en la vigencia");
      assert.ok(!periods.includes(strandedKey));

      // --- de vuelta a Vigente --------------------------------------------
      const revived = await updatePlan(ids.plan, ids.admin, { estado: "Vigente" });
      assert.equal(revived.estado, "Vigente");
      assert.equal(revived.end_date, null, "volver a Vigente vacía la fecha de fin");

      // --- y no se puede vencer sin fecha ---------------------------------
      const naked = await updatePlan(ids.plan, ids.admin, { estado: "Vencida" })
        .then(() => null, (error: unknown) => error);
      assert.equal(statusOf(naked), 400);
      assert.match(messageOf(naked), /debes indicar la fecha de fin/);

      const [final] = await db.select().from(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      assert.equal(final.estado, "Vigente");
      assert.equal(final.endDate, null);
    } finally {
      await db.delete(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      await db.delete(users).where(eq(users.id, ids.admin));
      // `closeDb` rather than `getPool().end()`: it clears the cached pool so a
      // second test added to this file recreates one instead of inheriting a
      // closed handle and failing on its first query.
      await closeDb();
    }
  },
);
