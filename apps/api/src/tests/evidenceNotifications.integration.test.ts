import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { getDb, getPool } from "../db/client.js";
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
  createEvidence as createPmaEvidence,
  getEvidencesForUser as getPmaEvidencesForUser,
  updateEvidenceValidation as validatePmaEvidence,
} from "../modules/pma/evidencesModule.js";
import { markNotificationAsRead as markPmaNotificationAsRead } from "../modules/pma/notificationsModule.js";
import {
  createEvidence as createRgdpEvidence,
  getEvidencesForUser as getRgdpEvidencesForUser,
  updateEvidenceValidation as validateRgdpEvidence,
} from "../modules/rgdp/evidencesModule.js";
import { markNotificationAsRead as markRgdpNotificationAsRead } from "../modules/rgdp/notificationsModule.js";

test(
  "evidence notifications are transactional, access-scoped, self-excluding and idempotent",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const pool = getPool();
    const ids = {
      pmaUploader: randomUUID(),
      rgdpUploader: randomUUID(),
      pmaViewer: randomUUID(),
      rgdpViewer: randomUUID(),
      derivedViewer: randomUUID(),
      wrongAppViewer: randomUUID(),
      explicitReporter: randomUUID(),
      adminA: randomUUID(),
      adminB: randomUUID(),
      pmaPlan: randomUUID(),
      rgdpPlan: randomUUID(),
      pmaItem: randomUUID(),
      rgdpItem: randomUUID(),
      pmaUploaderItem: randomUUID(),
      rgdpUploaderItem: randomUUID(),
      pmaItemEvidence: randomUUID(),
      rgdpItemEvidence: randomUUID(),
    };
    const triggerSuffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const triggerFunction = `test_fail_evidence_notification_${triggerSuffix}`;
    const pmaTrigger = `test_fail_pma_notification_${triggerSuffix}`;
    const rgdpTrigger = `test_fail_rgdp_notification_${triggerSuffix}`;
    const activityMonth = currentBusinessMonth();

    try {
      await db.insert(users).values([
        testUser(ids.pmaUploader, "PMA uploader", "REPORTER"),
        testUser(ids.rgdpUploader, "RGDP uploader", "REPORTER"),
        testUser(ids.pmaViewer, "PMA explicit viewer", "VIEWER"),
        testUser(ids.rgdpViewer, "RGDP explicit viewer", "VIEWER"),
        testUser(ids.derivedViewer, "Derived viewer", "VIEWER"),
        testUser(ids.wrongAppViewer, "Wrong app viewer", "VIEWER"),
        testUser(ids.explicitReporter, "Explicit reporter", "REPORTER"),
        testUser(ids.adminA, "Implicit admin A", "ADMIN"),
        testUser(ids.adminB, "Implicit admin B", "ADMIN"),
      ]);
      await db.insert(userApps).values([
        { userId: ids.pmaUploader, appKey: "pma" },
        { userId: ids.rgdpUploader, appKey: "rgdp" },
        { userId: ids.pmaViewer, appKey: "pma" },
        { userId: ids.rgdpViewer, appKey: "rgdp" },
        { userId: ids.derivedViewer, appKey: "pma" },
        { userId: ids.derivedViewer, appKey: "rgdp" },
        { userId: ids.wrongAppViewer, appKey: "rgdp" },
        { userId: ids.explicitReporter, appKey: "pma" },
        { userId: ids.explicitReporter, appKey: "rgdp" },
        { userId: ids.adminB, appKey: "pma" },
        { userId: ids.adminB, appKey: "rgdp" },
      ]);
      await db.insert(pmaPlans).values({
        id: ids.pmaPlan,
        title: "PMA evidence notification test",
        reportPer: "1 año",
      });
      await db.insert(rgdpPlans).values({
        id: ids.rgdpPlan,
        title: "RGDP evidence notification test",
        reportPer: "1 año",
      });
      await db.insert(pmaPlanItems).values({
        id: ids.pmaItem,
        planId: ids.pmaPlan,
        item: "PMA exact item",
        subplan: "PMA",
        periodicity: "Mensual",
        reportPer: "1 año",
      });
      await db.insert(pmaPlanItems).values({
        id: ids.pmaUploaderItem,
        planId: ids.pmaPlan,
        item: "PMA uploader item",
        subplan: "PMA",
        periodicity: "Mensual",
        reportPer: "1 año",
      });
      await db.insert(rgdpPlanItems).values({
        id: ids.rgdpItem,
        planId: ids.rgdpPlan,
        item: "RGDP exact item",
        subplan: "RGDP",
        periodicity: "Mensual",
        reportPer: "1 año",
      });
      await db.insert(rgdpPlanItems).values({
        id: ids.rgdpUploaderItem,
        planId: ids.rgdpPlan,
        item: "RGDP uploader item",
        subplan: "RGDP",
        periodicity: "Mensual",
        reportPer: "1 año",
      });
      await db.insert(pmaItemAssignments).values({
        planItemId: ids.pmaItem,
        userId: ids.derivedViewer,
        category: "Responsable",
      });
      await db.insert(rgdpItemAssignments).values({
        planItemId: ids.rgdpItem,
        userId: ids.derivedViewer,
        category: "Responsable",
      });
      await db.insert(pmaItemAssignments).values({
        planItemId: ids.pmaUploaderItem,
        userId: ids.pmaUploader,
        category: "Responsable",
      });
      await db.insert(rgdpItemAssignments).values({
        planItemId: ids.rgdpUploaderItem,
        userId: ids.rgdpUploader,
        category: "Responsable",
      });
      await db.insert(pmaPlanAssignments).values([
        { planId: ids.pmaPlan, userId: ids.pmaUploader, explicitAccess: true },
        { planId: ids.pmaPlan, userId: ids.pmaViewer, explicitAccess: true },
        { planId: ids.pmaPlan, userId: ids.derivedViewer, explicitAccess: false },
        { planId: ids.pmaPlan, userId: ids.wrongAppViewer, explicitAccess: true },
        { planId: ids.pmaPlan, userId: ids.explicitReporter, explicitAccess: true },
        { planId: ids.pmaPlan, userId: ids.adminB, explicitAccess: true },
      ]);
      await db.insert(rgdpPlanAssignments).values([
        { planId: ids.rgdpPlan, userId: ids.rgdpUploader, explicitAccess: true },
        { planId: ids.rgdpPlan, userId: ids.rgdpViewer, explicitAccess: true },
        { planId: ids.rgdpPlan, userId: ids.derivedViewer, explicitAccess: false },
        { planId: ids.rgdpPlan, userId: ids.pmaViewer, explicitAccess: true },
        { planId: ids.rgdpPlan, userId: ids.explicitReporter, explicitAccess: true },
        { planId: ids.rgdpPlan, userId: ids.adminB, explicitAccess: true },
      ]);

      const pmaEvidence = await createPmaEvidence(ids.adminA, {
        planId: ids.pmaPlan,
        planItemId: ids.pmaUploaderItem,
        activityMonth,
        uploadedBy: ids.pmaUploader,
        uploaderName: "PMA uploader",
        fileName: "pma-evidence.pdf",
        evidenceType: "Informe",
        data: Buffer.from("pma evidence"),
        contentType: "application/pdf",
      });
      const rgdpEvidence = await createRgdpEvidence(ids.adminA, {
        planId: ids.rgdpPlan,
        planItemId: ids.rgdpUploaderItem,
        activityMonth,
        uploadedBy: ids.rgdpUploader,
        uploaderName: "RGDP uploader",
        fileName: "rgdp-evidence.pdf",
        data: Buffer.from("rgdp evidence"),
        contentType: "application/pdf",
      });
      await db.insert(pmaEvidences).values({
        id: ids.pmaItemEvidence,
        planId: ids.pmaPlan,
        planItemId: ids.pmaItem,
        uploadedBy: ids.adminB,
        uploaderName: "Implicit admin B",
        fileName: "pma-item-evidence.pdf",
        evidenceType: "Otros",
        storagePath: `PMA/test/${ids.pmaItemEvidence}/file.pdf`,
      });
      await db.insert(rgdpEvidences).values({
        id: ids.rgdpItemEvidence,
        planId: ids.rgdpPlan,
        planItemId: ids.rgdpItem,
        uploadedBy: ids.adminB,
        uploaderName: "Implicit admin B",
        fileName: "rgdp-item-evidence.pdf",
        storagePath: `RGDP/test/${ids.rgdpItemEvidence}/file.pdf`,
      });

      const [pmaAdminList, pmaReporterList, pmaExplicitViewerList, pmaExactItemViewerList] = await Promise.all([
        getPmaEvidencesForUser({ sub: ids.adminA, role: "ADMIN" }),
        getPmaEvidencesForUser({ sub: ids.pmaUploader, role: "REPORTER" }),
        getPmaEvidencesForUser({ sub: ids.pmaViewer, role: "VIEWER" }),
        getPmaEvidencesForUser({ sub: ids.derivedViewer, role: "VIEWER" }),
      ]);
      assertEvidenceVisibility(pmaAdminList, [pmaEvidence.id, ids.pmaItemEvidence], []);
      assertEvidenceVisibility(pmaReporterList, [pmaEvidence.id], [ids.pmaItemEvidence]);
      assertEvidenceVisibility(pmaExplicitViewerList, [pmaEvidence.id, ids.pmaItemEvidence], []);
      assertEvidenceVisibility(pmaExactItemViewerList, [ids.pmaItemEvidence], [pmaEvidence.id]);

      const [rgdpAdminList, rgdpReporterList, rgdpExplicitViewerList, rgdpExactItemViewerList] = await Promise.all([
        getRgdpEvidencesForUser({ sub: ids.adminA, role: "ADMIN" }),
        getRgdpEvidencesForUser({ sub: ids.rgdpUploader, role: "REPORTER" }),
        getRgdpEvidencesForUser({ sub: ids.rgdpViewer, role: "VIEWER" }),
        getRgdpEvidencesForUser({ sub: ids.derivedViewer, role: "VIEWER" }),
      ]);
      assertEvidenceVisibility(rgdpAdminList, [rgdpEvidence.id, ids.rgdpItemEvidence], []);
      assertEvidenceVisibility(rgdpReporterList, [rgdpEvidence.id], [ids.rgdpItemEvidence]);
      assertEvidenceVisibility(rgdpExplicitViewerList, [rgdpEvidence.id, ids.rgdpItemEvidence], []);
      assertEvidenceVisibility(rgdpExactItemViewerList, [ids.rgdpItemEvidence], [rgdpEvidence.id]);

      await assertSubmittedRecipients({
        table: "pma",
        evidenceId: pmaEvidence.id,
        expectedViewerId: ids.pmaViewer,
        adminIds: [ids.adminA, ids.adminB],
        excludedIds: [
          ids.pmaUploader,
          ids.derivedViewer,
          ids.wrongAppViewer,
          ids.explicitReporter,
        ],
      });
      await assertSubmittedRecipients({
        table: "rgdp",
        evidenceId: rgdpEvidence.id,
        expectedViewerId: ids.rgdpViewer,
        adminIds: [ids.adminA, ids.adminB],
        excludedIds: [
          ids.rgdpUploader,
          ids.derivedViewer,
          ids.pmaViewer,
          ids.explicitReporter,
        ],
      });

      await Promise.all([
        validatePmaEvidence(pmaEvidence.id, "valid", ids.adminA, ids.adminA),
        validatePmaEvidence(pmaEvidence.id, "valid", ids.adminA, ids.adminA),
      ]);
      let pmaApproved = await db
        .select()
        .from(pmaNotifications)
        .where(and(
          eq(pmaNotifications.evidenceId, pmaEvidence.id),
          eq(pmaNotifications.userId, ids.pmaUploader),
          eq(pmaNotifications.type, "evidence_approved")
        ));
      assert.equal(pmaApproved.length, 1, "concurrent approval emitted one uploader notification");
      await markPmaNotificationAsRead(pmaApproved[0].id, ids.pmaUploader);
      await assert.rejects(
        markPmaNotificationAsRead(pmaApproved[0].id, ids.adminA),
        isHttpError(403)
      );

      await validatePmaEvidence(pmaEvidence.id, "pending", ids.adminA, ids.adminA);
      await validatePmaEvidence(pmaEvidence.id, "valid", ids.adminA, ids.adminA);
      pmaApproved = await db
        .select()
        .from(pmaNotifications)
        .where(and(
          eq(pmaNotifications.evidenceId, pmaEvidence.id),
          eq(pmaNotifications.userId, ids.pmaUploader),
          eq(pmaNotifications.type, "evidence_approved")
        ));
      assert.equal(pmaApproved.length, 1, "a repeated outcome refreshes instead of duplicating");
      assert.equal(pmaApproved[0].readAt, null, "a repeated outcome reactivates the notification");

      await validatePmaEvidence(pmaEvidence.id, "invalid", ids.adminA, ids.adminA, "Rejected");
      let pmaRejected = await db
        .select()
        .from(pmaNotifications)
        .where(and(
          eq(pmaNotifications.evidenceId, pmaEvidence.id),
          eq(pmaNotifications.userId, ids.pmaUploader),
          eq(pmaNotifications.type, "evidence_rejected")
        ));
      assert.equal(pmaRejected.length, 1);
      await markPmaNotificationAsRead(pmaRejected[0].id, ids.pmaUploader);
      await validatePmaEvidence(pmaEvidence.id, "pending", ids.adminA, ids.adminA);
      await assert.rejects(
        validatePmaEvidence(pmaEvidence.id, "invalid", ids.pmaUploader, ids.pmaUploader, "Self"),
        isHttpError(403),
      );
      pmaRejected = await db
        .select()
        .from(pmaNotifications)
        .where(and(
          eq(pmaNotifications.evidenceId, pmaEvidence.id),
          eq(pmaNotifications.userId, ids.pmaUploader),
          eq(pmaNotifications.type, "evidence_rejected")
        ));
      assert.equal(pmaRejected.length, 1);
      assert.ok(pmaRejected[0].readAt, "an unauthorized self-validation did not refresh a notification");

      await Promise.all([
        validateRgdpEvidence(rgdpEvidence.id, "invalid", ids.adminA, ids.adminA, "Rejected"),
        validateRgdpEvidence(rgdpEvidence.id, "invalid", ids.adminA, ids.adminA, "Rejected"),
      ]);
      let rgdpRejected = await db
        .select()
        .from(rgdpNotifications)
        .where(and(
          eq(rgdpNotifications.evidenceId, rgdpEvidence.id),
          eq(rgdpNotifications.userId, ids.rgdpUploader),
          eq(rgdpNotifications.type, "evidence_rejected")
        ));
      assert.equal(rgdpRejected.length, 1, "concurrent rejection emitted one uploader notification");
      await markRgdpNotificationAsRead(rgdpRejected[0].id, ids.rgdpUploader);
      await validateRgdpEvidence(rgdpEvidence.id, "pending", ids.adminA, ids.adminA);
      await validateRgdpEvidence(rgdpEvidence.id, "invalid", ids.adminA, ids.adminA, "Rejected again");
      rgdpRejected = await db
        .select()
        .from(rgdpNotifications)
        .where(and(
          eq(rgdpNotifications.evidenceId, rgdpEvidence.id),
          eq(rgdpNotifications.userId, ids.rgdpUploader),
          eq(rgdpNotifications.type, "evidence_rejected")
        ));
      assert.equal(rgdpRejected.length, 1);
      assert.equal(rgdpRejected[0].readAt, null);
      await validateRgdpEvidence(rgdpEvidence.id, "pending", ids.adminA, ids.adminA);
      await assert.rejects(
        validateRgdpEvidence(rgdpEvidence.id, "valid", ids.rgdpUploader, ids.rgdpUploader),
        isHttpError(403),
      );
      const selfApproved = await db
        .select()
        .from(rgdpNotifications)
        .where(and(
          eq(rgdpNotifications.evidenceId, rgdpEvidence.id),
          eq(rgdpNotifications.userId, ids.rgdpUploader),
          eq(rgdpNotifications.type, "evidence_approved")
        ));
      assert.equal(selfApproved.length, 0);

      const atomicPmaValidation = await createPmaEvidence(ids.adminA, {
        planId: ids.pmaPlan,
        planItemId: ids.pmaUploaderItem,
        activityMonth,
        uploadedBy: ids.pmaUploader,
        uploaderName: "PMA uploader",
        fileName: "atomic-validation-pma.pdf",
        evidenceType: "Informe",
        data: Buffer.from("atomic pma validation"),
      });
      const atomicRgdpValidation = await createRgdpEvidence(ids.adminA, {
        planId: ids.rgdpPlan,
        planItemId: ids.rgdpUploaderItem,
        activityMonth,
        uploadedBy: ids.rgdpUploader,
        uploaderName: "RGDP uploader",
        fileName: "atomic-validation-rgdp.pdf",
        data: Buffer.from("atomic rgdp validation"),
      });

      await pool.query(`
        CREATE FUNCTION "${triggerFunction}"() RETURNS trigger AS $body$
        BEGIN
          IF (
            NEW."type"::text = 'evidence_submitted'
            AND NEW."metadata"->>'fileName' IN ('atomic-create-pma.pdf', 'atomic-create-rgdp.pdf')
          ) OR (
            NEW."type"::text IN ('evidence_approved', 'evidence_rejected')
            AND NEW."metadata"->>'fileName' IN ('atomic-validation-pma.pdf', 'atomic-validation-rgdp.pdf')
          ) THEN
            RAISE EXCEPTION 'forced evidence notification failure';
          END IF;
          RETURN NEW;
        END;
        $body$ LANGUAGE plpgsql
      `);
      await pool.query(`
        CREATE TRIGGER "${pmaTrigger}"
        BEFORE INSERT OR UPDATE ON "pma_notifications"
        FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"()
      `);
      await pool.query(`
        CREATE TRIGGER "${rgdpTrigger}"
        BEFORE INSERT OR UPDATE ON "rgdp_notifications"
        FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"()
      `);

      await assert.rejects(
        createPmaEvidence(ids.adminA, {
          planId: ids.pmaPlan,
          planItemId: ids.pmaUploaderItem,
          activityMonth,
          uploadedBy: ids.pmaUploader,
          uploaderName: "PMA uploader",
          fileName: "atomic-create-pma.pdf",
          evidenceType: "Informe",
          data: Buffer.from("must roll back"),
        }),
        /forced evidence notification failure/
      );
      await assert.rejects(
        createRgdpEvidence(ids.adminA, {
          planId: ids.rgdpPlan,
          planItemId: ids.rgdpUploaderItem,
          activityMonth,
          uploadedBy: ids.rgdpUploader,
          uploaderName: "RGDP uploader",
          fileName: "atomic-create-rgdp.pdf",
          data: Buffer.from("must roll back"),
        }),
        /forced evidence notification failure/
      );
      assert.equal((await db.select().from(pmaEvidences).where(eq(pmaEvidences.fileName, "atomic-create-pma.pdf"))).length, 0);
      assert.equal((await db.select().from(rgdpEvidences).where(eq(rgdpEvidences.fileName, "atomic-create-rgdp.pdf"))).length, 0);

      await assert.rejects(
        validatePmaEvidence(atomicPmaValidation.id, "valid", ids.adminA, ids.adminA),
        /forced evidence notification failure/
      );
      await assert.rejects(
        validateRgdpEvidence(atomicRgdpValidation.id, "invalid", ids.adminA, ids.adminA, "Rejected"),
        /forced evidence notification failure/
      );
      const [pmaAfterFailedValidation] = await db
        .select({ status: pmaEvidences.validationStatus })
        .from(pmaEvidences)
        .where(eq(pmaEvidences.id, atomicPmaValidation.id));
      const [rgdpAfterFailedValidation] = await db
        .select({ status: rgdpEvidences.validationStatus })
        .from(rgdpEvidences)
        .where(eq(rgdpEvidences.id, atomicRgdpValidation.id));
      assert.equal(pmaAfterFailedValidation.status, "pending");
      assert.equal(rgdpAfterFailedValidation.status, "pending");
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${pmaTrigger}" ON "pma_notifications"`);
      await pool.query(`DROP TRIGGER IF EXISTS "${rgdpTrigger}" ON "rgdp_notifications"`);
      await pool.query(`DROP FUNCTION IF EXISTS "${triggerFunction}"()`);
      await db.delete(pmaPlans).where(eq(pmaPlans.id, ids.pmaPlan));
      await db.delete(rgdpPlans).where(eq(rgdpPlans.id, ids.rgdpPlan));
      for (const userId of [
        ids.pmaUploader,
        ids.rgdpUploader,
        ids.pmaViewer,
        ids.rgdpViewer,
        ids.derivedViewer,
        ids.wrongAppViewer,
        ids.explicitReporter,
        ids.adminA,
        ids.adminB,
      ]) {
        await db.delete(users).where(eq(users.id, userId));
      }
      await pool.end();
    }

    async function assertSubmittedRecipients(args: {
      table: "pma" | "rgdp";
      evidenceId: string;
      expectedViewerId: string;
      adminIds: string[];
      excludedIds: string[];
    }) {
      const rows = args.table === "pma"
        ? await db.select().from(pmaNotifications).where(and(
          eq(pmaNotifications.evidenceId, args.evidenceId),
          eq(pmaNotifications.type, "evidence_submitted")
        ))
        : await db.select().from(rgdpNotifications).where(and(
          eq(rgdpNotifications.evidenceId, args.evidenceId),
          eq(rgdpNotifications.type, "evidence_submitted")
        ));
      const recipients = rows.map((row) => row.userId);
      assert.equal(recipients.filter((id) => id === args.expectedViewerId).length, 1);
      for (const adminId of args.adminIds) {
        assert.equal(recipients.filter((id) => id === adminId).length, 1);
      }
      for (const excludedId of args.excludedIds) {
        assert.equal(recipients.includes(excludedId), false, `excluded recipient ${excludedId}`);
      }
    }
  }
);

function testUser(id: string, name: string, role: "ADMIN" | "VIEWER" | "REPORTER") {
  return {
    id,
    email: `evidence-notification-${id}@example.invalid`,
    name,
    role,
  };
}

function currentBusinessMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Galapagos",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Could not determine the current business month");
  return `${year}-${month}`;
}

function isHttpError(statusCode: number) {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === statusCode;
}

function assertEvidenceVisibility(
  evidences: Array<{ id: string }>,
  includedIds: string[],
  excludedIds: string[]
) {
  const visibleIds = new Set(evidences.map((evidence) => evidence.id));
  for (const id of includedIds) assert.equal(visibleIds.has(id), true, `expected evidence ${id}`);
  for (const id of excludedIds) assert.equal(visibleIds.has(id), false, `unexpected evidence ${id}`);
}
