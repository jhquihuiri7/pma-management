import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import { userApps, users } from "../db/schema/shared.js";
import {
  pmaEvidences,
  pmaItemAssignments,
  pmaNotifications,
  pmaPlanAssignments,
  pmaPlanItems,
  pmaPlans,
} from "../db/schema/pma.js";
import {
  rgdpEvidences,
  rgdpItemAssignments,
  rgdpNotifications,
  rgdpPlanAssignments,
  rgdpPlanItems,
  rgdpPlans,
} from "../db/schema/rgdp.js";
import {
  assignUserToApp,
  deleteManagedUser,
  updateManagedUser,
} from "../modules/shared/usersModule.js";

const expiresAt = () => new Date(Date.now() + 60_000);

test(
  "app revocation and role transitions discard stale subsystem authorization state",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    const adminId = randomUUID();
    const appRevocationUserId = randomUUID();
    const roleChangeUserId = randomUUID();
    const pmaPlanIds = [randomUUID(), randomUUID()];
    const pmaItemIds = [randomUUID(), randomUUID()];
    const rgdpPlanIds = [randomUUID(), randomUUID()];
    const rgdpItemIds = [randomUUID(), randomUUID()];

    try {
      await db.insert(users).values({
        id: adminId,
        email: `access-admin-${adminId}@example.invalid`,
        name: "Access lifecycle admin",
        role: "ADMIN",
      });
      await t.test("removing PMA/RGDP preserves evidence but cannot restore old access when an app is re-added", async () => {
        await db.insert(users).values({
          id: appRevocationUserId,
          email: `app-revocation-${appRevocationUserId}@example.invalid`,
          name: "App revocation test",
          role: "REPORTER",
        });
        await db.insert(userApps).values([
          { userId: appRevocationUserId, appKey: "pma" },
          { userId: appRevocationUserId, appKey: "rgdp" },
        ]);

        await db.insert(pmaPlans).values({
          id: pmaPlanIds[0],
          title: "PMA revoke",
          reportPer: "1 año",
        });
        await db.insert(pmaPlanItems).values({
          id: pmaItemIds[0],
          planId: pmaPlanIds[0],
          item: "PMA-1",
          subplan: "PMA",
          reportPer: "1 año",
        });
        await db.insert(pmaPlanAssignments).values({
          planId: pmaPlanIds[0],
          userId: appRevocationUserId,
          explicitAccess: true,
        });
        await db.insert(pmaItemAssignments).values({
          planItemId: pmaItemIds[0],
          userId: appRevocationUserId,
          category: "Responsable",
        });
        const pmaEvidenceId = randomUUID();
        await db.insert(pmaEvidences).values({
          id: pmaEvidenceId,
          planId: pmaPlanIds[0],
          planItemId: pmaItemIds[0],
          uploadedBy: appRevocationUserId,
          uploaderName: "App revocation test",
          fileName: "historical-pma.pdf",
          storagePath: `PMA/test/${pmaEvidenceId}/historical-pma.pdf`,
          validationStatus: "valid",
          validatedBy: appRevocationUserId,
          validatedAt: new Date(),
        });
        await db.insert(pmaNotifications).values({
          userId: appRevocationUserId,
          type: "evidence_approved",
          title: "PMA notification",
          message: "Old PMA grant",
          planId: pmaPlanIds[0],
          planItemId: pmaItemIds[0],
          evidenceId: pmaEvidenceId,
          expiresAt: expiresAt(),
        });

        await db.insert(rgdpPlans).values({
          id: rgdpPlanIds[0],
          title: "RGDP retained",
          reportPer: "1 año",
        });
        await db.insert(rgdpPlanItems).values({
          id: rgdpItemIds[0],
          planId: rgdpPlanIds[0],
          item: "RGDP-1",
          subplan: "RGDP",
          reportPer: "1 año",
        });
        await db.insert(rgdpPlanAssignments).values({
          planId: rgdpPlanIds[0],
          userId: appRevocationUserId,
          explicitAccess: true,
        });
        await db.insert(rgdpItemAssignments).values({
          planItemId: rgdpItemIds[0],
          userId: appRevocationUserId,
          category: "Responsable",
        });
        const rgdpEvidenceId = randomUUID();
        await db.insert(rgdpEvidences).values({
          id: rgdpEvidenceId,
          planId: rgdpPlanIds[0],
          planItemId: rgdpItemIds[0],
          uploadedBy: appRevocationUserId,
          uploaderName: "App revocation test",
          fileName: "retained-rgdp.pdf",
          storagePath: `RGDP/test/${rgdpEvidenceId}/retained-rgdp.pdf`,
          validationStatus: "valid",
          validatedBy: appRevocationUserId,
          validatedAt: new Date(),
        });
        await db.insert(rgdpNotifications).values({
          userId: appRevocationUserId,
          type: "evidence_approved",
          title: "RGDP notification",
          message: "Retained RGDP state",
          planId: rgdpPlanIds[0],
          planItemId: rgdpItemIds[0],
          evidenceId: rgdpEvidenceId,
          expiresAt: expiresAt(),
        });

        const result = await deleteManagedUser(appRevocationUserId, "pma", adminId);
        assert.deepEqual(result, {
          ok: true,
          userId: appRevocationUserId,
          appKey: "pma",
          accountDeleted: false,
        });

        assert.equal(
          (await db.select().from(pmaPlanAssignments).where(eq(pmaPlanAssignments.userId, appRevocationUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(pmaItemAssignments).where(eq(pmaItemAssignments.userId, appRevocationUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(pmaNotifications).where(eq(pmaNotifications.userId, appRevocationUserId))).length,
          0,
        );
        const [historicalPmaEvidence] = await db
          .select()
          .from(pmaEvidences)
          .where(eq(pmaEvidences.id, pmaEvidenceId));
        assert.equal(historicalPmaEvidence.fileName, "historical-pma.pdf");
        assert.equal(historicalPmaEvidence.uploadedBy, null);
        assert.equal(historicalPmaEvidence.validatedBy, null);

        assert.equal(
          (await db.select().from(rgdpPlanAssignments).where(eq(rgdpPlanAssignments.userId, appRevocationUserId))).length,
          1,
        );
        assert.equal(
          (await db.select().from(rgdpItemAssignments).where(eq(rgdpItemAssignments.userId, appRevocationUserId))).length,
          1,
        );
        assert.equal(
          (await db.select().from(rgdpNotifications).where(eq(rgdpNotifications.userId, appRevocationUserId))).length,
          1,
        );
        const [retainedRgdpEvidence] = await db
          .select()
          .from(rgdpEvidences)
          .where(eq(rgdpEvidences.id, rgdpEvidenceId));
        assert.equal(retainedRgdpEvidence.uploadedBy, appRevocationUserId);
        assert.equal(retainedRgdpEvidence.validatedBy, appRevocationUserId);

        await assignUserToApp(appRevocationUserId, "pma", adminId);
        assert.equal(
          (await db.select().from(pmaPlanAssignments).where(eq(pmaPlanAssignments.userId, appRevocationUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(pmaItemAssignments).where(eq(pmaItemAssignments.userId, appRevocationUserId))).length,
          0,
        );

        const rgdpResult = await deleteManagedUser(appRevocationUserId, "rgdp", adminId);
        assert.deepEqual(rgdpResult, {
          ok: true,
          userId: appRevocationUserId,
          appKey: "rgdp",
          accountDeleted: false,
        });
        assert.equal(
          (await db.select().from(rgdpPlanAssignments).where(eq(rgdpPlanAssignments.userId, appRevocationUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(rgdpItemAssignments).where(eq(rgdpItemAssignments.userId, appRevocationUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(rgdpNotifications).where(eq(rgdpNotifications.userId, appRevocationUserId))).length,
          0,
        );
        const [historicalRgdpEvidence] = await db
          .select()
          .from(rgdpEvidences)
          .where(eq(rgdpEvidences.id, rgdpEvidenceId));
        assert.equal(historicalRgdpEvidence.fileName, "retained-rgdp.pdf");
        assert.equal(historicalRgdpEvidence.uploadedBy, null);
        assert.equal(historicalRgdpEvidence.validatedBy, null);

        await assignUserToApp(appRevocationUserId, "rgdp", adminId);
        assert.equal(
          (await db.select().from(rgdpPlanAssignments).where(eq(rgdpPlanAssignments.userId, appRevocationUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(rgdpItemAssignments).where(eq(rgdpItemAssignments.userId, appRevocationUserId))).length,
          0,
        );
      });

      await t.test("every role transition clears PMA/RGDP grants without changing app memberships", async () => {
        await db.insert(users).values({
          id: roleChangeUserId,
          email: `role-transition-${roleChangeUserId}@example.invalid`,
          name: "Role transition test",
          role: "REPORTER",
        });
        await db.insert(userApps).values([
          { userId: roleChangeUserId, appKey: "pma" },
          { userId: roleChangeUserId, appKey: "rgdp" },
          { userId: roleChangeUserId, appKey: "geo" },
        ]);
        await db.insert(pmaPlans).values({
          id: pmaPlanIds[1],
          title: "PMA role",
          reportPer: "1 año",
        });
        await db.insert(pmaPlanItems).values({
          id: pmaItemIds[1],
          planId: pmaPlanIds[1],
          item: "PMA-2",
          subplan: "PMA",
          reportPer: "1 año",
        });
        await db.insert(rgdpPlans).values({
          id: rgdpPlanIds[1],
          title: "RGDP role",
          reportPer: "1 año",
        });
        await db.insert(rgdpPlanItems).values({
          id: rgdpItemIds[1],
          planId: rgdpPlanIds[1],
          item: "RGDP-2",
          subplan: "RGDP",
          reportPer: "1 año",
        });

        const assignBothSubsystems = async () => {
          await db.insert(pmaPlanAssignments).values({
            planId: pmaPlanIds[1],
            userId: roleChangeUserId,
            explicitAccess: true,
          });
          await db.insert(pmaItemAssignments).values({
            planItemId: pmaItemIds[1],
            userId: roleChangeUserId,
            category: "Responsable",
          });
          await db.insert(rgdpPlanAssignments).values({
            planId: rgdpPlanIds[1],
            userId: roleChangeUserId,
            explicitAccess: true,
          });
          await db.insert(rgdpItemAssignments).values({
            planItemId: rgdpItemIds[1],
            userId: roleChangeUserId,
            category: "Responsable",
          });
        };

        await assignBothSubsystems();
        await updateManagedUser(roleChangeUserId, { name: "Name-only update" }, adminId);
        assert.equal(
          (await db.select().from(pmaPlanAssignments).where(eq(pmaPlanAssignments.userId, roleChangeUserId))).length,
          1,
        );
        assert.equal(
          (await db.select().from(rgdpItemAssignments).where(eq(rgdpItemAssignments.userId, roleChangeUserId))).length,
          1,
        );

        await updateManagedUser(roleChangeUserId, { role: "VIEWER" }, adminId);
        assert.equal(
          (await db.select().from(pmaPlanAssignments).where(eq(pmaPlanAssignments.userId, roleChangeUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(pmaItemAssignments).where(eq(pmaItemAssignments.userId, roleChangeUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(rgdpPlanAssignments).where(eq(rgdpPlanAssignments.userId, roleChangeUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(rgdpItemAssignments).where(eq(rgdpItemAssignments.userId, roleChangeUserId))).length,
          0,
        );

        await assignBothSubsystems();
        await updateManagedUser(roleChangeUserId, { role: "ADMIN" }, adminId);
        assert.equal(
          (await db.select().from(pmaPlanAssignments).where(eq(pmaPlanAssignments.userId, roleChangeUserId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(rgdpItemAssignments).where(eq(rgdpItemAssignments.userId, roleChangeUserId))).length,
          0,
        );
        const apps = await db.select().from(userApps).where(eq(userApps.userId, roleChangeUserId));
        assert.deepEqual(new Set(apps.map(({ appKey }) => appKey)), new Set(["pma", "rgdp", "geo"]));
      });
    } finally {
      for (const planId of pmaPlanIds) {
        await db.delete(pmaPlans).where(eq(pmaPlans.id, planId));
      }
      for (const planId of rgdpPlanIds) {
        await db.delete(rgdpPlans).where(eq(rgdpPlans.id, planId));
      }
      await db.delete(users).where(eq(users.id, appRevocationUserId));
      await db.delete(users).where(eq(users.id, roleChangeUserId));
      await db.delete(users).where(eq(users.id, adminId));
      await closeDb();
    }
  },
);
