import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils-rgdp";
import { assignUserToPlan, unassignUserFromPlan } from "@/services-rgdp/planService";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const { userId } = await req.json();
  if (!userId) return errorResponse("userId is required");

  try {
    const assignment = await assignUserToPlan(
      userId,
      params.id,
      session.user.adminId
    );
    return NextResponse.json(assignment, { status: 201 });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const { userId } = await req.json();
  if (!userId) return errorResponse("userId is required");

  try {
    await unassignUserFromPlan(userId, params.id, session.user.adminId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
