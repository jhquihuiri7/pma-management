import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "../db/client.js";
import { userApps, users } from "../db/schema/shared.js";
import {
  pmaEvidences,
  pmaItemAssignments,
  pmaPendingNotificationLog,
  pmaPlanAssignments,
  pmaPlanItems,
  pmaPlans,
} from "../db/schema/pma.js";
import {
  getPendingByReporter,
  sendPendingNotifications,
} from "../modules/pma/pendingNotificationsModule.js";
import { getPlanCalendar, getPeriodKey, monthKeyOf } from "../modules/pma/planSchedule.js";

/**
 * The plan starts 13 months ago so at least three six-month periods exist and
 * the one in progress is not the first — that is where the period chips, the
 * per-period counters and the deadline-to-period mapping can all go wrong.
 */
function planStartMonths(back: number): { startDate: string; monthKey: (offset: number) => string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Galapagos",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const originIndex = year * 12 + month - 1 - back;
  return {
    startDate: `${monthKeyOf(originIndex)}-01`,
    monthKey: (offset: number) => monthKeyOf(originIndex + offset),
  };
}

test(
  "pending notifications are computed server-side, per reporter, and every attempt is audited",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const pool = getPool();
    const ids = {
      admin: randomUUID(),
      reporterA: randomUUID(),
      reporterB: randomUUID(),
      ccUser: randomUUID(),
      outsider: randomUUID(),
      plan: randomUUID(),
      itemMensual: randomUUID(),
      itemSemestral: randomUUID(),
      itemUnattended: randomUUID(),
      itemUnicaVez: randomUUID(),
    };
    const { startDate, monthKey } = planStartMonths(13);

    try {
      await db.insert(users).values([
        { id: ids.admin, email: `pending-admin-${ids.admin}@example.invalid`, name: "Admin", role: "ADMIN" },
        { id: ids.reporterA, email: `pending-a-${ids.reporterA}@example.invalid`, name: "Reportero A", role: "REPORTER" },
        { id: ids.reporterB, email: `pending-b-${ids.reporterB}@example.invalid`, name: "Reportero B", role: "REPORTER" },
        { id: ids.ccUser, email: `pending-cc-${ids.ccUser}@example.invalid`, name: "Copia", role: "VIEWER" },
        { id: ids.outsider, email: `pending-out-${ids.outsider}@example.invalid`, name: "Ajeno", role: "VIEWER" },
      ]);
      await db.insert(userApps).values(
        [ids.admin, ids.reporterA, ids.reporterB, ids.ccUser, ids.outsider].map((userId) => ({
          userId,
          appKey: "pma" as const,
        }))
      );

      await db.insert(pmaPlans).values({
        id: ids.plan,
        createdBy: ids.admin,
        title: "Plan de prueba pendientes",
        reportPer: "6 meses",
        startDate,
      });

      await db.insert(pmaPlanItems).values([
        {
          id: ids.itemMensual,
          planId: ids.plan,
          item: "PPM-03",
          subplan: "Plan de Prevencion y Mitigacion de Impactos",
          direccion: "DOSPPSVR",
          proposedMeasure: "Humedecimiento de vías internas.",
          periodicity: "Mensual",
          reportPer: "6 meses",
        },
        {
          id: ids.itemSemestral,
          planId: ids.plan,
          item: "PMS-05",
          subplan: "Plan de Monitoreo y Seguimiento",
          direccion: "DGTAR",
          proposedMeasure: "Monitoreo de ruido ambiental.",
          periodicity: "Semestral",
          reportPer: "6 meses",
        },
        {
          // Nobody is assigned: it can never be notified to anyone.
          id: ids.itemUnattended,
          planId: ids.plan,
          item: "PMD-09",
          subplan: "Plan de Manejo de Desechos",
          direccion: "DAF",
          proposedMeasure: "Item sin reportero asignado.",
          periodicity: "Mensual",
          reportPer: "6 meses",
        },
        {
          // Due "al finalizar la operación": never overdue mid-plan.
          id: ids.itemUnicaVez,
          planId: ids.plan,
          item: "PCA-01",
          subplan: "Plan de Cierre y Abandono",
          direccion: "DAF",
          proposedMeasure: "Entrega final del área.",
          periodicity: "Unica vez",
          reportPer: "6 meses",
        },
      ]);

      await db.insert(pmaItemAssignments).values([
        { planItemId: ids.itemMensual, userId: ids.reporterA, category: "Responsable" },
        { planItemId: ids.itemSemestral, userId: ids.reporterA, category: "Colaborador" },
        { planItemId: ids.itemSemestral, userId: ids.reporterB, category: "Responsable" },
        { planItemId: ids.itemUnicaVez, userId: ids.reporterB, category: "Responsable" },
      ]);

      const calendar = getPlanCalendar({ startDate, createdAt: new Date(), reportPer: "6 meses" });
      const firstPeriod = getPeriodKey(calendar, 0);

      // Period 0 spans offsets 0..5. Clear two of the mensual occurrences and
      // leave the rest pending, one per pending status.
      await db.insert(pmaEvidences).values([
        {
          planId: ids.plan, planItemId: ids.itemMensual, uploadedBy: ids.reporterA,
          uploaderName: "Reportero A", fileName: "ok.pdf", storagePath: `t/${randomUUID()}`,
          validationStatus: "valid", activityMonth: monthKey(0),
        },
        {
          planId: ids.plan, planItemId: ids.itemMensual, uploadedBy: ids.reporterA,
          uploaderName: "Reportero A", fileName: "rechazada.pdf", storagePath: `t/${randomUUID()}`,
          validationStatus: "invalid", activityMonth: monthKey(1),
        },
        {
          planId: ids.plan, planItemId: ids.itemMensual, uploadedBy: ids.reporterA,
          uploaderName: "Reportero A", fileName: "en-revision.pdf", storagePath: `t/${randomUUID()}`,
          validationStatus: "pending", activityMonth: monthKey(2),
        },
        // The semestral occurrence of period 0 is approved, so it must vanish
        // from both reporters' lists for that period.
        {
          planId: ids.plan, planItemId: ids.itemSemestral, uploadedBy: ids.reporterB,
          uploaderName: "Reportero B", fileName: "semestral-ok.pdf", storagePath: `t/${randomUUID()}`,
          validationStatus: "valid", activityMonth: monthKey(5),
        },
      ]);

      const admin = { sub: ids.admin, role: "ADMIN" as const, email: "admin@example.invalid" };
      const firstView = await getPendingByReporter(ids.plan, firstPeriod, admin);

      assert.equal(firstView.periodKey, firstPeriod);
      assert.ok(firstView.periods.length >= 3, "a 13-month-old plan has at least three periods");

      const groupA = firstView.reporters.find((r) => r.reporterId === ids.reporterA);
      const groupB = firstView.reporters.find((r) => r.reporterId === ids.reporterB);
      assert.ok(groupA, "reporter A owes activities in the first period");

      // Mensual: 6 occurrences, one approved => 5 pending. Semestral approved.
      assert.equal(groupA.activities.length, 5);
      assert.deepEqual(
        groupA.activities.map((activity) => activity.status).sort(),
        ["Pendiente de revisión", "Rechazado", "Sin entregar", "Sin entregar", "Sin entregar"]
      );
      assert.ok(
        groupA.activities.every((activity) => activity.itemCode === "PPM-03"),
        "the approved semestral occurrence must not be listed"
      );
      assert.equal(groupA.direccion, "DOSPPSVR");
      // B only had the semestral (approved) and the "Unica vez" (never due).
      assert.equal(groupB, undefined, "a reporter with nothing pending is not listed");

      // Chip counters and the group list must agree: one criterion, one source.
      const firstCount = firstView.periods.find((p) => p.key === firstPeriod)?.pending;
      assert.equal(firstCount, 5, "the unattended item's occurrences are not chased");

      // The period in progress: the semestral occurrence is now pending for both
      // reporters assigned to that item.
      const currentPeriod = getPeriodKey(calendar, calendar.currentBlockIndex);
      const currentView = await getPendingByReporter(ids.plan, currentPeriod, admin);
      const currentB = currentView.reporters.find((r) => r.reporterId === ids.reporterB);
      assert.ok(currentB, "reporter B owes the semestral measure of the period in progress");
      assert.deepEqual(currentB.activities.map((a) => a.itemCode), ["PMS-05"]);
      assert.ok(
        currentView.reporters.every((reporter) =>
          reporter.activities.every((activity) => activity.itemCode !== "PCA-01")
        ),
        '"Unica vez" is never pending in a six-month report'
      );

      // Omitting the period resolves to the one in progress.
      const defaultView = await getPendingByReporter(ids.plan, undefined, admin);
      assert.equal(defaultView.periodKey, currentPeriod);

      // A period that does not belong to the plan is refused, not answered zero.
      await assert.rejects(
        () => getPendingByReporter(ids.plan, "ene-jun 1999", admin),
        (error: unknown) =>
          typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 400
      );

      // Object-level authorization: an unassigned VIEWER cannot read the plan.
      await assert.rejects(
        () =>
          getPendingByReporter(ids.plan, firstPeriod, {
            sub: ids.outsider,
            role: "VIEWER",
            email: "out@example.invalid",
          }),
        (error: unknown) =>
          typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 403
      );

      // Selecting a reporter who owes nothing in the period is refused rather
      // than silently emailing them an empty table.
      await assert.rejects(
        () =>
          sendPendingNotifications(
            {
              planId: ids.plan,
              periodKey: firstPeriod,
              reporterIds: [ids.reporterB],
              ccUserIds: [],
              subject: "Pendientes",
              body: "",
            },
            admin
          ),
        (error: unknown) =>
          typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 400
      );

      // No SMTP_HOST is configured in the test environment, so every delivery
      // fails. The batch must still resolve, report 0 of 1, and audit the
      // attempt — the partial-failure contract the dialog depends on.
      assert.equal(process.env.SMTP_HOST, undefined, "this test asserts the unconfigured-SMTP path");
      const result = await sendPendingNotifications(
        {
          planId: ids.plan,
          periodKey: firstPeriod,
          reporterIds: [ids.reporterA],
          ccUserIds: [ids.ccUser],
          subject: "Actividades pendientes",
          body: "Por favor cargar las evidencias.",
        },
        admin
      );

      assert.equal(result.total, 1);
      assert.equal(result.sent, 0);
      assert.equal(result.activities, 5);
      assert.equal(result.ccCount, 1);
      assert.equal(result.failures.length, 1);
      assert.equal(result.failures[0].reporterId, ids.reporterA);

      const auditRows = await db
        .select()
        .from(pmaPendingNotificationLog)
        .where(eq(pmaPendingNotificationLog.planId, ids.plan));
      assert.equal(auditRows.length, 1);
      assert.equal(auditRows[0].delivered, false);
      assert.equal(auditRows[0].reporterId, ids.reporterA);
      assert.equal(auditRows[0].activityCount, 5);
      assert.equal(auditRows[0].periodKey, firstPeriod);
      assert.equal(auditRows[0].sentBy, ids.admin);
      assert.deepEqual(auditRows[0].ccEmails, [`pending-cc-${ids.ccUser}@example.invalid`]);
      assert.ok(auditRows[0].errorMessage, "a failed delivery records why");

      // A CC id that is not a real user is rejected before anything is sent.
      await assert.rejects(
        () =>
          sendPendingNotifications(
            {
              planId: ids.plan,
              periodKey: firstPeriod,
              reporterIds: [ids.reporterA],
              ccUserIds: [randomUUID()],
              subject: "Pendientes",
              body: "",
            },
            admin
          ),
        (error: unknown) =>
          typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 400
      );
    } finally {
      await db.delete(pmaPendingNotificationLog).where(eq(pmaPendingNotificationLog.planId, ids.plan));
      await db.delete(pmaPlanAssignments).where(eq(pmaPlanAssignments.planId, ids.plan));
      await db.delete(pmaPlans).where(eq(pmaPlans.id, ids.plan));
      for (const userId of [ids.admin, ids.reporterA, ids.reporterB, ids.ccUser, ids.outsider]) {
        await db.delete(userApps).where(eq(userApps.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
      await pool.end();
    }
  }
);
