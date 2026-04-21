import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { assignReporterToItem, unassignReporterFromItem } from "@/services/planItemService";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const { userId, category } = await req.json();
  if (!userId) return errorResponse("userId is required");
  if (!category || !["Responsable", "Colaborador"].includes(category))
    return errorResponse("category must be Responsable or Colaborador");

  try {
    await assignReporterToItem(params.itemId, userId, category);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message, 500);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const { userId } = await req.json();
  if (!userId) return errorResponse("userId is required");

  try {
    await unassignReporterFromItem(params.itemId, userId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message, 500);
  }
}
