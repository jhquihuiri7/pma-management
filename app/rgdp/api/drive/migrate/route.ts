import { NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { adminDb } from "@/lib/firebase-admin";
import { Plan, PlanItem } from "@/types";
import { ensureItemDriveFolder, ensurePlanDriveFolder } from "@/services-rgdp/driveService";

interface MigrationPlanResult {
  planId: string;
  planTitle: string;
  subsystem: string;
  updatedPlanFolder: boolean;
  migratedItems: number;
}

export async function POST() {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  try {
    const plansSnap = await adminDb
      .collection("rgdp_projects")
      .where("adminId", "==", session.user.adminId)
      .get();

    const results: MigrationPlanResult[] = [];
    const errors: { planId: string; error: string }[] = [];

    for (const planDoc of plansSnap.docs) {
      const plan = planDoc.data() as Plan;
      const planId = plan.id || planDoc.id;

      try {
        const itemsSnap = await adminDb
          .collection("rgdp_projectItems")
          .where("planId", "==", planId)
          .get();

        const items = itemsSnap.docs.map((doc) => doc.data() as PlanItem);
        const subsystem = items[0]?.subplan || "Sin proceso";

        const planFolderId = await ensurePlanDriveFolder(
          session.user.adminId,
          plan.title,
          subsystem,
          plan.driveFolderId
        );

        if (plan.driveFolderId !== planFolderId) {
          await planDoc.ref.update({ driveFolderId: planFolderId });
        }

        let migratedItems = 0;
        for (const itemDoc of itemsSnap.docs) {
          const item = itemDoc.data() as PlanItem;
          const itemFolderId = await ensureItemDriveFolder(
            session.user.adminId,
            item.item,
            planFolderId,
            item.driveFolderId
          );

          if (item.driveFolderId !== itemFolderId) {
            await itemDoc.ref.update({ driveFolderId: itemFolderId });
            migratedItems += 1;
          }
        }

        results.push({
          planId,
          planTitle: plan.title,
          subsystem,
          updatedPlanFolder: plan.driveFolderId !== planFolderId,
          migratedItems,
        });
      } catch (planError) {
        errors.push({
          planId,
          error: (planError as Error).message,
        });
      }
    }

    return NextResponse.json({
      totalPlans: plansSnap.size,
      migratedPlans: results.length,
      failedPlans: errors.length,
      results,
      errors,
    });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
