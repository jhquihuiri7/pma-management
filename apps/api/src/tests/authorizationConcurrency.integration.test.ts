import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, getDb, getPool } from "../db/client.js";
import { storageCleanupJobs, userApps, users } from "../db/schema/shared.js";
import {
  pmaEvidences,
  pmaItemAssignments,
  pmaPlanAssignments,
  pmaPlanItems,
  pmaPlans,
} from "../db/schema/pma.js";
import {
  rgdpEvidences,
  rgdpItemAssignments,
  rgdpMonthlyGenerations,
  rgdpPlanAssignments,
  rgdpPlanItems,
  rgdpPlans,
} from "../db/schema/rgdp.js";
import { AUTHORIZATION_MUTATION_LOCK } from "../modules/shared/authorizationLock.js";
import {
  assignUserToApp,
  createUserGlobal,
  deleteManagedUser,
  updateManagedUser,
} from "../modules/shared/usersModule.js";
import {
  assignReporterToDireccion as assignPmaReporterToDireccion,
} from "../modules/pma/planItemsModule.js";
import { updatePlan as updatePmaPlan } from "../modules/pma/plansModule.js";
import { assignUserToPlan as assignRgdpUserToPlan } from "../modules/rgdp/plansModule.js";
import {
  deleteEvidence as deletePmaEvidence,
  updateEvidenceValidation as updatePmaEvidenceValidation,
} from "../modules/pma/evidencesModule.js";
import {
  updateEvidenceValidation as updateRgdpEvidenceValidation,
} from "../modules/rgdp/evidencesModule.js";
import { setGeneration } from "../modules/rgdp/monthlyGenerationsModule.js";

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type Outcome<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

function outcome<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
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
    throw new Error("The concurrent user mutation never acquired the authorization lock");
  } finally {
    probe.release();
  }
}

/**
 * Hold a SHARE row lock: it blocks usersModule's FOR UPDATE while remaining
 * compatible with the FK KEY SHARE lock taken by a buggy assignment/evidence
 * write. This makes the pre-fix interleaving deterministic rather than timing
 * dependent.
 */
async function raceAfterUserMutationHasStarted(
  userId: string,
  mutateUser: () => Promise<unknown>,
  protectedWrite: () => Promise<unknown>,
): Promise<{ mutation: Outcome; write: Outcome; stateBeforeRelease: "pending" | "settled" }> {
  const blocker = await getPool().connect();
  let rowLockOpen = false;
  let mutationPromise: Promise<Outcome> | undefined;
  let writePromise: Promise<Outcome> | undefined;
  try {
    await blocker.query("begin");
    rowLockOpen = true;
    await blocker.query("select id from users where id = $1 for share", [userId]);

    mutationPromise = outcome(Promise.resolve().then(mutateUser));
    await waitUntilAuthorizationLockIsHeld();

    writePromise = outcome(Promise.resolve().then(protectedWrite));
    const stateBeforeRelease = await Promise.race([
      writePromise.then(() => "settled" as const),
      pause(300).then(() => "pending" as const),
    ]);

    await blocker.query("commit");
    rowLockOpen = false;
    const [mutation, write] = await Promise.all([mutationPromise, writePromise]);
    return { mutation, write, stateBeforeRelease };
  } finally {
    if (rowLockOpen) await blocker.query("rollback").catch(() => undefined);
    blocker.release();
    // Never leave a pool transaction running if an assertion/setup error
    // interrupted the deterministic race orchestration.
    await Promise.allSettled([mutationPromise, writePromise].filter(Boolean) as Promise<Outcome>[]);
  }
}

test(
  "authorization writes serialize with app revocation and role transitions",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    const ids = {
      admin: randomUUID(),
      secondAdmin: randomUUID(),
      staleGlobalAdmin: randomUUID(),
      stalePmaAdmin: randomUUID(),
      appAssignmentTarget: randomUUID(),
      pmaPlanEditor: randomUUID(),
      pmaViewerActor: randomUUID(),
      pmaReporterTarget: randomUUID(),
      rgdpViewerTarget: randomUUID(),
      pmaValidator: randomUUID(),
      pmaUploader: randomUUID(),
      pmaDeleteActor: randomUUID(),
      rgdpValidator: randomUUID(),
      monthlyReporter: randomUUID(),
      pmaPlan: randomUUID(),
      pmaItem: randomUUID(),
      rgdpPlan: randomUUID(),
      rgdpItem: randomUUID(),
      pmaEvidence: randomUUID(),
      pmaDeleteEvidence: randomUUID(),
      rgdpEvidence: randomUUID(),
    };
    const cleanupPaths = [
      `tests/auth-race/${ids.pmaEvidence}.pdf`,
      `tests/auth-race/${ids.pmaDeleteEvidence}.pdf`,
      `tests/auth-race/${ids.rgdpEvidence}.pdf`,
    ];

    try {
      await db.insert(users).values([
        { id: ids.admin, email: `${ids.admin}@example.invalid`, name: "Admin", role: "ADMIN" },
        { id: ids.secondAdmin, email: `${ids.secondAdmin}@example.invalid`, name: "Admin 2", role: "ADMIN" },
        { id: ids.staleGlobalAdmin, email: `${ids.staleGlobalAdmin}@example.invalid`, name: "Stale global admin", role: "ADMIN" },
        { id: ids.stalePmaAdmin, email: `${ids.stalePmaAdmin}@example.invalid`, name: "Stale PMA admin", role: "ADMIN" },
        { id: ids.appAssignmentTarget, email: `${ids.appAssignmentTarget}@example.invalid`, name: "App assignment target", role: "VIEWER" },
        { id: ids.pmaPlanEditor, email: `${ids.pmaPlanEditor}@example.invalid`, name: "PMA plan editor", role: "VIEWER" },
        { id: ids.pmaViewerActor, email: `${ids.pmaViewerActor}@example.invalid`, name: "PMA viewer actor", role: "VIEWER" },
        { id: ids.pmaReporterTarget, email: `${ids.pmaReporterTarget}@example.invalid`, name: "PMA reporter target", role: "REPORTER" },
        { id: ids.rgdpViewerTarget, email: `${ids.rgdpViewerTarget}@example.invalid`, name: "RGDP viewer target", role: "VIEWER" },
        { id: ids.pmaValidator, email: `${ids.pmaValidator}@example.invalid`, name: "PMA validator", role: "VIEWER" },
        { id: ids.pmaUploader, email: `${ids.pmaUploader}@example.invalid`, name: "PMA uploader", role: "REPORTER" },
        { id: ids.pmaDeleteActor, email: `${ids.pmaDeleteActor}@example.invalid`, name: "PMA delete actor", role: "REPORTER" },
        { id: ids.rgdpValidator, email: `${ids.rgdpValidator}@example.invalid`, name: "RGDP validator", role: "ADMIN" },
        { id: ids.monthlyReporter, email: `${ids.monthlyReporter}@example.invalid`, name: "Monthly reporter", role: "REPORTER" },
      ]);
      await db.insert(userApps).values([
        { userId: ids.pmaViewerActor, appKey: "pma" },
        { userId: ids.pmaViewerActor, appKey: "geo" },
        { userId: ids.pmaReporterTarget, appKey: "pma" },
        { userId: ids.rgdpViewerTarget, appKey: "rgdp" },
        { userId: ids.pmaValidator, appKey: "pma" },
        { userId: ids.pmaValidator, appKey: "geo" },
        { userId: ids.pmaUploader, appKey: "pma" },
        { userId: ids.pmaDeleteActor, appKey: "pma" },
        { userId: ids.pmaDeleteActor, appKey: "geo" },
        { userId: ids.appAssignmentTarget, appKey: "geo" },
        { userId: ids.pmaPlanEditor, appKey: "pma" },
        { userId: ids.pmaPlanEditor, appKey: "geo" },
        { userId: ids.monthlyReporter, appKey: "rgdp" },
        { userId: ids.monthlyReporter, appKey: "geo" },
      ]);
      await db.insert(pmaPlans).values({
        id: ids.pmaPlan,
        title: "PMA authorization race",
        description: "Original description",
        reportPer: "1 año",
      });
      await db.insert(pmaPlanItems).values({
        id: ids.pmaItem,
        planId: ids.pmaPlan,
        item: "PMA race item",
        subplan: "PMA",
        direccion: "Dirección race",
        reportPer: "1 año",
      });
      await db.insert(pmaPlanAssignments).values([
        { planId: ids.pmaPlan, userId: ids.pmaViewerActor, explicitAccess: true },
        { planId: ids.pmaPlan, userId: ids.pmaValidator, explicitAccess: true },
        { planId: ids.pmaPlan, userId: ids.pmaPlanEditor, explicitAccess: true },
      ]);
      await db.insert(rgdpPlans).values({
        id: ids.rgdpPlan,
        title: "RGDP authorization race",
        reportPer: "1 año",
      });
      await db.insert(rgdpPlanItems).values({
        id: ids.rgdpItem,
        planId: ids.rgdpPlan,
        item: "RGDP race item",
        subplan: "RGDP",
        direccion: "Dirección race",
        reportPer: "1 año",
        annualGenerationKg: "100.000",
      });
      await db.insert(rgdpItemAssignments).values({
        planItemId: ids.rgdpItem,
        userId: ids.monthlyReporter,
        category: "Responsable",
      });
      await db.insert(pmaEvidences).values([
        {
          id: ids.pmaEvidence,
          planId: ids.pmaPlan,
          planItemId: ids.pmaItem,
          uploadedBy: ids.pmaUploader,
          uploaderName: "PMA uploader",
          fileName: "validation-race.pdf",
          storagePath: cleanupPaths[0],
        },
        {
          id: ids.pmaDeleteEvidence,
          planId: ids.pmaPlan,
          planItemId: ids.pmaItem,
          uploadedBy: ids.pmaDeleteActor,
          uploaderName: "PMA delete actor",
          fileName: "delete-race.pdf",
          storagePath: cleanupPaths[1],
        },
      ]);
      await db.insert(rgdpEvidences).values({
        id: ids.rgdpEvidence,
        planId: ids.rgdpPlan,
        planItemId: ids.rgdpItem,
        uploadedBy: ids.pmaUploader,
        uploaderName: "PMA uploader",
        fileName: "rgdp-validation-race.pdf",
        storagePath: cleanupPaths[2],
      });

      await t.test("a revoked PMA VIEWER actor cannot finish a direction assignment", async () => {
        const result = await raceAfterUserMutationHasStarted(
          ids.pmaViewerActor,
          () => deleteManagedUser(ids.pmaViewerActor, "pma", ids.admin),
          () => assignPmaReporterToDireccion(
            ids.pmaPlan,
            "Dirección race",
            ids.pmaReporterTarget,
            "Responsable",
            ids.pmaViewerActor,
          ),
        );
        assert.equal(result.stateBeforeRelease, "pending");
        assert.equal(result.mutation.ok, true);
        assert.equal(result.write.ok, false);
        assert.equal(
          (await db.select().from(pmaItemAssignments).where(eq(pmaItemAssignments.userId, ids.pmaReporterTarget))).length,
          0,
        );
      });

      await t.test("a revoked PMA VIEWER cannot finish an in-flight plan update", async () => {
        const result = await raceAfterUserMutationHasStarted(
          ids.pmaPlanEditor,
          () => deleteManagedUser(ids.pmaPlanEditor, "pma", ids.admin),
          () => updatePmaPlan(
            ids.pmaPlan,
            ids.pmaPlanEditor,
            { description: "Unauthorized concurrent update" },
          ),
        );
        assert.equal(result.stateBeforeRelease, "pending");
        assert.equal(result.mutation.ok, true);
        assert.equal(result.write.ok, false);
        if (!result.write.ok) {
          assert.equal(
            typeof result.write.error === "object" && result.write.error !== null
              ? (result.write.error as { statusCode?: unknown }).statusCode
              : undefined,
            403,
          );
        }
        const [plan] = await db.select().from(pmaPlans).where(eq(pmaPlans.id, ids.pmaPlan));
        assert.equal(plan.description, "Original description");
      });

      await t.test("a role transition cannot be followed by a stale RGDP plan grant", async () => {
        const result = await raceAfterUserMutationHasStarted(
          ids.rgdpViewerTarget,
          () => updateManagedUser(ids.rgdpViewerTarget, { role: "REPORTER" }, ids.admin),
          () => assignRgdpUserToPlan(ids.rgdpPlan, ids.rgdpViewerTarget, ids.admin),
        );
        assert.equal(result.stateBeforeRelease, "pending");
        assert.equal(result.mutation.ok, true);
        assert.equal(result.write.ok, false);
        assert.equal(
          (await db.select().from(rgdpPlanAssignments).where(eq(rgdpPlanAssignments.userId, ids.rgdpViewerTarget))).length,
          0,
        );
      });

      await t.test("PMA validation rechecks the VIEWER app and plan grant in its transaction", async () => {
        const result = await raceAfterUserMutationHasStarted(
          ids.pmaValidator,
          () => deleteManagedUser(ids.pmaValidator, "pma", ids.admin),
          () => updatePmaEvidenceValidation(ids.pmaEvidence, "valid", ids.pmaValidator, ids.pmaValidator),
        );
        assert.equal(result.stateBeforeRelease, "pending");
        assert.equal(result.mutation.ok, true);
        assert.equal(result.write.ok, false);
        const [evidence] = await db.select().from(pmaEvidences).where(eq(pmaEvidences.id, ids.pmaEvidence));
        assert.equal(evidence.validationStatus, "pending");
        assert.equal(evidence.validatedBy, null);
      });

      await t.test("RGDP validation cannot write validatedBy after an ADMIN demotion", async () => {
        const result = await raceAfterUserMutationHasStarted(
          ids.rgdpValidator,
          () => updateManagedUser(ids.rgdpValidator, { role: "VIEWER" }, ids.admin),
          () => updateRgdpEvidenceValidation(ids.rgdpEvidence, "valid", ids.rgdpValidator, ids.rgdpValidator),
        );
        assert.equal(result.stateBeforeRelease, "pending");
        assert.equal(result.mutation.ok, true);
        assert.equal(result.write.ok, false);
        const [evidence] = await db.select().from(rgdpEvidences).where(eq(rgdpEvidences.id, ids.rgdpEvidence));
        assert.equal(evidence.validationStatus, "pending");
        assert.equal(evidence.validatedBy, null);
      });

      await t.test("PMA evidence deletion cannot finish after reporter app revocation", async () => {
        const result = await raceAfterUserMutationHasStarted(
          ids.pmaDeleteActor,
          () => deleteManagedUser(ids.pmaDeleteActor, "pma", ids.admin),
          () => deletePmaEvidence(ids.pmaDeleteEvidence, ids.pmaDeleteActor),
        );
        assert.equal(result.stateBeforeRelease, "pending");
        assert.equal(result.mutation.ok, true);
        assert.equal(result.write.ok, false);
        assert.equal(
          (await db.select().from(pmaEvidences).where(eq(pmaEvidences.id, ids.pmaDeleteEvidence))).length,
          1,
        );
      });

      await t.test("a demoted global ADMIN cannot create a user after the lock wait", async () => {
        const createdEmail = `must-not-exist-${randomUUID()}@example.invalid`;
        const result = await raceAfterUserMutationHasStarted(
          ids.staleGlobalAdmin,
          () => updateManagedUser(ids.staleGlobalAdmin, { role: "VIEWER" }, ids.admin),
          () => createUserGlobal(ids.staleGlobalAdmin, {
            name: "Must not be created",
            email: createdEmail,
            role: "VIEWER",
          }),
        );
        assert.equal(result.stateBeforeRelease, "pending");
        assert.equal(result.mutation.ok, true);
        assert.equal(result.write.ok, false);
        assert.equal((await db.select().from(users).where(eq(users.email, createdEmail))).length, 0);
      });

      await t.test("a demoted subsystem ADMIN cannot grant PMA access", async () => {
        const result = await raceAfterUserMutationHasStarted(
          ids.stalePmaAdmin,
          () => updateManagedUser(ids.stalePmaAdmin, { role: "VIEWER" }, ids.admin),
          () => assignUserToApp(ids.appAssignmentTarget, "pma", ids.stalePmaAdmin),
        );
        assert.equal(result.stateBeforeRelease, "pending");
        assert.equal(result.mutation.ok, true);
        assert.equal(result.write.ok, false);
        const apps = await db.select().from(userApps).where(eq(userApps.userId, ids.appAssignmentTarget));
        assert.deepEqual(apps.map(({ appKey }) => appKey), ["geo"]);
      });

      await t.test("RGDP monthly generation rechecks reporter app and item assignment", async () => {
        const periodKey = new Date().toISOString().slice(0, 7);
        const result = await raceAfterUserMutationHasStarted(
          ids.monthlyReporter,
          () => deleteManagedUser(ids.monthlyReporter, "rgdp", ids.admin),
          () => setGeneration(
            ids.rgdpPlan,
            { planItemId: ids.rgdpItem, periodKey, generationKg: 1 },
            ids.monthlyReporter,
          ),
        );
        assert.equal(result.stateBeforeRelease, "pending");
        assert.equal(result.mutation.ok, true);
        assert.equal(result.write.ok, false);
        assert.equal(
          (await db
            .select()
            .from(rgdpMonthlyGenerations)
            .where(eq(rgdpMonthlyGenerations.planItemId, ids.rgdpItem))).length,
          0,
        );
      });
    } finally {
      await db.delete(pmaPlans).where(eq(pmaPlans.id, ids.pmaPlan));
      await db.delete(rgdpPlans).where(eq(rgdpPlans.id, ids.rgdpPlan));
      for (const storagePath of cleanupPaths) {
        await db.delete(storageCleanupJobs).where(eq(storageCleanupJobs.storagePath, storagePath));
      }
      for (const userId of [
        ids.admin,
        ids.secondAdmin,
        ids.staleGlobalAdmin,
        ids.stalePmaAdmin,
        ids.appAssignmentTarget,
        ids.pmaPlanEditor,
        ids.pmaViewerActor,
        ids.pmaReporterTarget,
        ids.rgdpViewerTarget,
        ids.pmaValidator,
        ids.pmaUploader,
        ids.pmaDeleteActor,
        ids.rgdpValidator,
        ids.monthlyReporter,
      ]) {
        await db.delete(users).where(eq(users.id, userId));
      }
      await closeDb();
    }
  },
);
