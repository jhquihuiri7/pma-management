import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getPlanById } from "@/services-pg/planService";
import { createPlanItem } from "@/services-pg/planItemService";
import { PlanItem } from "@/types";
import { ensureItemDriveFolder, ensurePlanDriveFolder } from "@/services-pg/driveService";
import { adminDb } from "@/lib/firebase-admin";

interface BulkItemInput {
  item: string;
  subplan: string;
  direccion: string;
  environmental_activity: string;
  identified_environmental_impact: string;
  proposed_measure: string;
  indicator: string;
  verification_method: string;
  periodicity: string;
  budget: number;
  observation?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Proyecto no encontrado", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  const body = await req.json();
  const items: BulkItemInput[] = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) return errorResponse("No items provided");

  const reportPer = plan.report_per || "6 meses";

  const created: PlanItem[] = [];
  const failed: { index: number; error: string }[] = [];

  let planFolderId = plan.driveFolderId;
  try {
    const subsystemName = items[0]?.subplan || "Sin proceso";
    planFolderId = await ensurePlanDriveFolder(
      session.user.adminId,
      plan.title,
      subsystemName,
      plan.driveFolderId
    );

    if (plan.driveFolderId !== planFolderId) {
      await adminDb.collection("pg_projects").doc(params.id).update({ driveFolderId: planFolderId });
    }
  } catch (driveErr) {
    console.error("Drive folder creation for bulk plan failed:", driveErr);
  }

  for (let i = 0; i < items.length; i++) {
    const input = items[i];
    try {
      const newItem = await createPlanItem(params.id, {
        item: input.item,
        subplan: input.subplan,
        direccion: input.direccion,
        environmental_activity: input.environmental_activity,
        identified_environmental_impact: input.identified_environmental_impact,
        proposed_measure: input.proposed_measure,
        indicator: input.indicator,
        verification_method: input.verification_method,
        periodicity: input.periodicity,
        budget: Number(input.budget) || 0,
        report_per: reportPer,
        ...(input.observation ? { observation: input.observation } : {}),
      });

      if (planFolderId) {
        try {
          const itemFolderId = await ensureItemDriveFolder(
            session.user.adminId,
            input.item,
            planFolderId,
            newItem.driveFolderId
          );

          if (newItem.driveFolderId !== itemFolderId) {
            await adminDb.collection("pg_projectItems").doc(newItem.id).update({ driveFolderId: itemFolderId });
            newItem.driveFolderId = itemFolderId;
          }
        } catch (itemDriveErr) {
          console.error(`Drive folder creation failed for bulk item index ${i}:`, itemDriveErr);
        }
      }

      created.push(newItem);
    } catch (err) {
      failed.push({ index: i, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    created: created.length,
    items: created,
    failed,
  });
}
