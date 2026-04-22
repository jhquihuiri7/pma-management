import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getPlanById, isUserAssignedToPlan } from "@/services/planService";
import { createPlanItem, getPlanItems } from "@/services/planItemService";
import { ensureItemDriveFolder, ensurePlanDriveFolder } from "@/services/driveService";
import { adminDb } from "@/lib/firebase-admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  if (session.user.role === "VIEWER") {
    const assigned = await isUserAssignedToPlan(session.user.id, params.id);
    if (!assigned) return forbiddenResponse();
  }

  const items = await getPlanItems(params.id);
  return NextResponse.json(items);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  const body = await req.json();
  const {
    item,
    subplan,
    direccion,
    environmental_activity,
    identified_environmental_impact,
    proposed_measure,
    indicator,
    verification_method,
    periodicity,
    budget,
  } = body;

  if (
    !item ||
    !subplan ||
    !direccion ||
    !environmental_activity ||
    !identified_environmental_impact ||
    !proposed_measure ||
    !indicator ||
    !verification_method ||
    !periodicity ||
    budget === undefined ||
    budget === null ||
    budget === ""
  ) {
    return errorResponse("All fields are required");
  }

  try {
    const newItem = await createPlanItem(
      params.id,
      {
        item,
        subplan,
        direccion,
        environmental_activity,
        identified_environmental_impact,
        proposed_measure,
        indicator,
        verification_method,
        periodicity,
        budget: Number(budget),
        report_per: plan.report_per || "6 meses",
      }
    );

    try {
      const planFolderId = await ensurePlanDriveFolder(
        session.user.adminId,
        plan.title,
        subplan,
        plan.driveFolderId
      );

      if (plan.driveFolderId !== planFolderId) {
        await adminDb.collection("pma_plans").doc(params.id).update({ driveFolderId: planFolderId });
      }

      const itemFolderId = await ensureItemDriveFolder(
        session.user.adminId,
        item,
        planFolderId,
        newItem.driveFolderId
      );

      if (newItem.driveFolderId !== itemFolderId) {
        await adminDb.collection("pma_planItems").doc(newItem.id).update({ driveFolderId: itemFolderId });
        newItem.driveFolderId = itemFolderId;
      }
    } catch (driveErr) {
      console.error("Drive folder creation for item failed:", driveErr);
    }

    return NextResponse.json(newItem, { status: 201 });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
