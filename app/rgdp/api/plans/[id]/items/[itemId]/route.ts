import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils-rgdp";
import { getPlanById } from "@/services-rgdp/planService";
import { deletePlanItem, updatePlanItem, updatePlanItemObservation } from "@/services-rgdp/planItemService";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  const body = await req.json();

  try {
    if ("observation" in body && Object.keys(body).length === 1) {
      await updatePlanItemObservation(params.itemId, params.id, body.observation ?? "");
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { observation: _obs, ...fields } = body;
      await updatePlanItem(params.itemId, params.id, fields);
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  try {
    await deletePlanItem(params.itemId, params.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
