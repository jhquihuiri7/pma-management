import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "../db/client.js";
import { storageCleanupJobs, userApps, users } from "../db/schema/shared.js";
import {
  pmaEvidences,
  pmaItemAssignments,
  pmaPeriodCompliance,
  pmaPlanAssignments,
  pmaPlanItems,
  pmaPlans,
} from "../db/schema/pma.js";
import {
  rgdpItemAssignments,
  rgdpPlanAssignments,
  rgdpPlanItems,
  rgdpPlans,
} from "../db/schema/rgdp.js";
import {
  canUserAccessEvidence as canAccessPmaEvidence,
  canUserUploadEvidence as canUploadPmaEvidence,
  deleteEvidence as deletePmaEvidence,
} from "../modules/pma/evidencesModule.js";
import {
  canUserAccessEvidence as canAccessRgdpEvidence,
  canUserUploadEvidence as canUploadRgdpEvidence,
} from "../modules/rgdp/evidencesModule.js";
import { bulkSetCompliance } from "../modules/pma/periodComplianceModule.js";
import { processPendingStorageCleanup } from "../modules/shared/storageCleanup.js";

test(
  "item-derived reporters cannot cross evidence objects or compliance plans",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const userId = randomUUID();
    const adminId = randomUUID();
    const pmaPlanId = randomUUID();
    const otherPmaPlanId = randomUUID();
    const pmaItemId = randomUUID();
    const siblingPmaItemId = randomUUID();
    const otherPmaItemId = randomUUID();
    const rgdpPlanId = randomUUID();
    const rgdpItemId = randomUUID();
    const siblingRgdpItemId = randomUUID();
    const actor = { sub: userId, role: "REPORTER" as const };

    try {
      await db.insert(users).values([
        {
          id: userId,
          email: `evidence-auth-${userId}@example.invalid`,
          name: "Evidence authorization test",
          role: "REPORTER",
        },
        {
          id: adminId,
          email: `evidence-auth-admin-${adminId}@example.invalid`,
          name: "Evidence authorization admin",
          role: "ADMIN",
        },
      ]);
      await db.insert(userApps).values([
        { userId, appKey: "pma" },
        { userId, appKey: "rgdp" },
      ]);
      await db.insert(pmaPlans).values([
        { id: pmaPlanId, title: "PMA A", reportPer: "1 año" },
        { id: otherPmaPlanId, title: "PMA B", reportPer: "1 año" },
      ]);
      await db.insert(pmaPlanItems).values([
        { id: pmaItemId, planId: pmaPlanId, item: "A1", subplan: "A", periodicity: "Mensual", reportPer: "1 año" },
        { id: siblingPmaItemId, planId: pmaPlanId, item: "A2", subplan: "A", periodicity: "Mensual", reportPer: "1 año" },
        { id: otherPmaItemId, planId: otherPmaPlanId, item: "B1", subplan: "B", periodicity: "Mensual", reportPer: "1 año" },
      ]);
      await db.insert(pmaItemAssignments).values({ planItemId: pmaItemId, userId, category: "Responsable" });
      await db.insert(pmaPlanAssignments).values({ planId: pmaPlanId, userId, explicitAccess: false });

      assert.equal(await canUploadPmaEvidence(pmaPlanId, pmaItemId, actor), true);
      assert.equal(await canUploadPmaEvidence(pmaPlanId, siblingPmaItemId, actor), false);
      assert.equal(await canUploadPmaEvidence(pmaPlanId, undefined, actor), false);
      assert.equal(
        await canAccessPmaEvidence({ planId: pmaPlanId, planItemId: siblingPmaItemId, uploadedBy: randomUUID() }, actor),
        false
      );
      assert.equal(
        await canAccessPmaEvidence({ planId: pmaPlanId, planItemId: siblingPmaItemId, uploadedBy: userId }, actor),
        true
      );

      await assert.rejects(
        bulkSetCompliance(pmaPlanId, [
          { planItemId: pmaItemId, periodKey: "2026-01", status: "C" },
          { planItemId: otherPmaItemId, periodKey: "2026-01", status: "NC-" },
        ], adminId),
        (error: unknown) => typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 400
      );
      const partialCompliance = await db
        .select()
        .from(pmaPeriodCompliance)
        .where(eq(pmaPeriodCompliance.planItemId, pmaItemId));
      assert.equal(partialCompliance.length, 0);

      const evidenceId = randomUUID();
      const evidencePath = `PMA/test/${evidenceId}/file.pdf`;
      await db.insert(pmaEvidences).values({
        id: evidenceId,
        planId: pmaPlanId,
        planItemId: pmaItemId,
        uploadedBy: userId,
        uploaderName: "Evidence authorization test",
        fileName: "file.pdf",
        evidenceType: "Otros",
        storagePath: evidencePath,
      });
      await deletePmaEvidence(evidenceId, userId);
      const queuedCleanup = await db
        .select()
        .from(storageCleanupJobs)
        .where(eq(storageCleanupJobs.storagePath, evidencePath));
      assert.equal(queuedCleanup.length, 1);
      await processPendingStorageCleanup();
      const drainedCleanup = await db
        .select()
        .from(storageCleanupJobs)
        .where(eq(storageCleanupJobs.storagePath, evidencePath));
      assert.equal(drainedCleanup.length, 0);

      await db.insert(rgdpPlans).values({ id: rgdpPlanId, title: "RGDP A", reportPer: "1 año" });
      await db.insert(rgdpPlanItems).values([
        { id: rgdpItemId, planId: rgdpPlanId, item: "R1", subplan: "R", periodicity: "Mensual", reportPer: "1 año" },
        { id: siblingRgdpItemId, planId: rgdpPlanId, item: "R2", subplan: "R", periodicity: "Mensual", reportPer: "1 año" },
      ]);
      await db.insert(rgdpItemAssignments).values({ planItemId: rgdpItemId, userId, category: "Responsable" });
      await db.insert(rgdpPlanAssignments).values({ planId: rgdpPlanId, userId, explicitAccess: false });
      assert.equal(await canUploadRgdpEvidence(rgdpPlanId, rgdpItemId, actor), true);
      assert.equal(
        await canUploadRgdpEvidence(rgdpPlanId, rgdpItemId, { sub: userId, role: "VIEWER" }),
        false
      );
      assert.equal(await canUploadRgdpEvidence(rgdpPlanId, siblingRgdpItemId, actor), false);
      assert.equal(
        await canAccessRgdpEvidence({ planId: rgdpPlanId, planItemId: siblingRgdpItemId, uploadedBy: randomUUID() }, actor),
        false
      );
    } finally {
      await db.delete(pmaPlans).where(eq(pmaPlans.id, pmaPlanId));
      await db.delete(pmaPlans).where(eq(pmaPlans.id, otherPmaPlanId));
      await db.delete(rgdpPlans).where(eq(rgdpPlans.id, rgdpPlanId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(users).where(eq(users.id, adminId));
      await getPool().end();
    }
  }
);
