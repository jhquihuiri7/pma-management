import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { getDb, getPool } from "../db/client.js";
import { userApps, users } from "../db/schema/shared.js";
import {
  rgdpItemAssignments,
  rgdpMonthlyGenerations,
  rgdpPlanAssignments,
  rgdpPlanItems,
  rgdpPlans,
} from "../db/schema/rgdp.js";
import {
  createPlanItem,
  isReporterAssignedToItem,
  updatePlanItem,
  updatePlanItemObservation,
} from "../modules/rgdp/planItemsModule.js";
import { updatePlan } from "../modules/rgdp/plansModule.js";
import {
  bulkSetGenerations,
  setGeneration,
} from "../modules/rgdp/monthlyGenerationsModule.js";

test(
  "RGDP monthly and observation mutations enforce exact assignment and annual atomicity",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const userId = randomUUID();
    const adminId = randomUUID();
    const planId = randomUUID();
    const assignedItemId = randomUUID();
    const siblingItemId = randomUUID();

    try {
      await db.insert(users).values([
        {
          id: userId,
          email: `rgdp-monthly-${userId}@example.invalid`,
          name: "RGDP monthly test",
          role: "REPORTER",
        },
        {
          id: adminId,
          email: `rgdp-monthly-admin-${adminId}@example.invalid`,
          name: "RGDP monthly admin",
          role: "ADMIN",
        },
      ]);
      await db.insert(userApps).values({ userId, appKey: "rgdp" });
      await db.insert(rgdpPlans).values({
        id: planId,
        title: "RGDP monthly contract",
        reportPer: "1 año",
        startDate: "2026-01-01",
      });
      await db.insert(rgdpPlanItems).values([
        {
          id: assignedItemId,
          planId,
          item: "NE-01",
          subplan: "RGDT",
          direccion: "Origen A",
          periodicity: "Mensual",
          reportPer: "1 año",
          annualGenerationKg: "10.000",
        },
        {
          id: siblingItemId,
          planId,
          item: "NE-02",
          subplan: "RGDT",
          periodicity: "Mensual",
          reportPer: "1 año",
          annualGenerationKg: "100.000",
        },
      ]);
      await db.insert(rgdpItemAssignments).values({
        planItemId: assignedItemId,
        userId,
        category: "Responsable",
      });

      assert.equal(await isReporterAssignedToItem(planId, assignedItemId, userId), true);
      assert.equal(await isReporterAssignedToItem(planId, siblingItemId, userId), false);

      // Creating another item in the same direction inherits the direction's
      // reporter union and persists only a derived plan-level grant.
      const inherited = await createPlanItem(planId, {
        item: "NE-03",
        subplan: "RGDT",
        direccion: "Origen A",
        periodicity: "Mensual",
        budget: 25.5,
        report_per: "1 año",
        annualGenerationKg: 50,
        generationOrigin: "Origen A",
        selfManagement: true,
      }, adminId);
      assert.equal(await isReporterAssignedToItem(planId, inherited.id, userId), true);
      const [derivedGrant] = await db
        .select()
        .from(rgdpPlanAssignments)
        .where(
          and(
            eq(rgdpPlanAssignments.planId, planId),
            eq(rgdpPlanAssignments.userId, userId)
          )
        );
      assert.equal(derivedGrant?.explicitAccess, false);

      // A sparse PATCH preserves omitted numeric/boolean/direction fields.
      const sparsePatch = await updatePlanItem(inherited.id, planId, {
        observation: "Parche parcial",
      }, adminId);
      assert.equal(sparsePatch.direccion, "Origen A");
      assert.equal(sparsePatch.budget, 25.5);
      assert.equal(sparsePatch.selfManagement, true);

      // Emptying the direction clears inherited item access atomically. The
      // derived plan grant remains because the reporter still owns NE-01.
      const cleared = await updatePlanItem(inherited.id, planId, { direccion: "" }, adminId);
      assert.equal(cleared.direccion, undefined);
      assert.equal(await isReporterAssignedToItem(planId, inherited.id, userId), false);
      const remainingGrant = await db
        .select()
        .from(rgdpPlanAssignments)
        .where(
          and(
            eq(rgdpPlanAssignments.planId, planId),
            eq(rgdpPlanAssignments.userId, userId)
          )
        );
      assert.equal(remainingGrant.length, 1);

      await assert.rejects(
        createPlanItem(planId, {
          item: "Período inválido",
          subplan: "RGDT",
          report_per: "6 meses",
        }, adminId),
        /report_per no coincide/
      );

      const saved = await setGeneration(
        planId,
        { planItemId: assignedItemId, periodKey: "2026-01", generationKg: 6 },
        userId
      );
      assert.equal(saved.generationKg, 6);
      await assert.rejects(
        setGeneration(
          planId,
          { planItemId: siblingItemId, periodKey: "2026-01", generationKg: 1 },
          userId
        ),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          error.statusCode === 403
      );
      await assert.rejects(
        setGeneration(
          planId,
          { planItemId: assignedItemId, periodKey: "2026-02", generationKg: 5 },
          userId
        ),
        /supera la generación anual/
      );
      const rejectedMonth = await db
        .select()
        .from(rgdpMonthlyGenerations)
        .where(
          and(
            eq(rgdpMonthlyGenerations.planItemId, assignedItemId),
            eq(rgdpMonthlyGenerations.periodKey, "2026-02")
          )
        );
      assert.equal(rejectedMonth.length, 0);

      const replacement = await setGeneration(
        planId,
        { planItemId: assignedItemId, periodKey: "2026-01", generationKg: 9.5 },
        userId
      );
      assert.equal(replacement.generationKg, 9.5);

      // Bulk validation must evaluate the requested final state, not reject a
      // valid redistribution because the increase happens before the decrease.
      await setGeneration(
        planId,
        { planItemId: siblingItemId, periodKey: "2026-01", generationKg: 0 },
        adminId,
      );
      await setGeneration(
        planId,
        { planItemId: siblingItemId, periodKey: "2026-02", generationKg: 100 },
        adminId,
      );
      const redistributed = await bulkSetGenerations(planId, [
        { planItemId: siblingItemId, periodKey: "2026-01", generationKg: 100 },
        { planItemId: siblingItemId, periodKey: "2026-02", generationKg: 0 },
      ], adminId);
      assert.deepEqual(redistributed.map((record) => record.generationKg), [100, 0]);

      await bulkSetGenerations(planId, [
        { planItemId: siblingItemId, periodKey: "2026-01", generationKg: 0 },
        { planItemId: siblingItemId, periodKey: "2026-02", generationKg: 100 },
      ], adminId);
      const reversedInput = await bulkSetGenerations(planId, [
        { planItemId: siblingItemId, periodKey: "2026-02", generationKg: 0 },
        { planItemId: siblingItemId, periodKey: "2026-01", generationKg: 100 },
      ], adminId);
      assert.deepEqual(reversedInput.map((record) => record.generationKg), [0, 100]);

      const observed = await updatePlanItemObservation(
        assignedItemId,
        planId,
        "Observación confirmada",
        userId
      );
      assert.equal(observed.observation, "Observación confirmada");
      await assert.rejects(
        updatePlanItemObservation(siblingItemId, planId, "No autorizada", userId),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          error.statusCode === 403
      );

      // Removing the reporter's final direction assignment also removes the
      // derived (false) plan grant, without touching explicit grants.
      await updatePlanItem(assignedItemId, planId, { direccion: "" }, adminId);
      assert.equal(await isReporterAssignedToItem(planId, assignedItemId, userId), false);
      const orphanGrant = await db
        .select()
        .from(rgdpPlanAssignments)
        .where(
          and(
            eq(rgdpPlanAssignments.planId, planId),
            eq(rgdpPlanAssignments.userId, userId)
          )
        );
      assert.equal(orphanGrant.length, 0);

      // The plan owns report_per; changing it cascades to every existing item
      // in the same transaction and the public response remains snake_case.
      const changedPlan = await updatePlan(planId, adminId, { reportPer: "2 años" });
      assert.equal(changedPlan.report_per, "2 años");
      const synchronizedItems = await db
        .select({ reportPer: rgdpPlanItems.reportPer })
        .from(rgdpPlanItems)
        .where(eq(rgdpPlanItems.planId, planId));
      assert.ok(synchronizedItems.length >= 3);
      assert.ok(synchronizedItems.every((item) => item.reportPer === "2 años"));
    } finally {
      await db.delete(rgdpPlans).where(eq(rgdpPlans.id, planId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, adminId));
      await getPool().end();
    }
  }
);
