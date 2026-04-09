import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import {
  getPlanById,
  updatePlan,
  deletePlan,
  getAssignedUsers,
  isUserAssignedToPlan,
} from "@/services/planService";
import { getEvidencesByPlan } from "@/services/evidenceService";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  // VIEWER must be assigned to the plan at plan level
  if (session.user.role === "VIEWER") {
    const assigned = await isUserAssignedToPlan(session.user.id, params.id);
    if (!assigned) return forbiddenResponse();
  }

  const [assignedUsers, evidences] = await Promise.all([
    getAssignedUsers(params.id),
    getEvidencesByPlan(params.id),
  ]);

  return NextResponse.json({ plan, assignedUsers, evidences });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const body = await req.json();

  try {
    const plan = await updatePlan(params.id, session.user.adminId, body);
    return NextResponse.json(plan);
  } catch (error: any) {
    return errorResponse(error.message);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  try {
    await deletePlan(params.id, session.user.adminId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error.message);
  }
}
