import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getPlanById, updatePlan, getAssignedUsers, deletePlan } from "@/services-rgdp/planService";
import { getEvidencesByPlan } from "@/services-rgdp/evidenceService";
import { PlanReporte, PlanTipo } from "@/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Proyecto no encontrado", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  const [evidences, assignedUsers] = await Promise.all([
    getEvidencesByPlan(params.id),
    getAssignedUsers(params.id),
  ]);

  return NextResponse.json({ plan, evidences, assignedUsers });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const body = await req.json();
  const {
    title,
    description,
    report_per,
    tipo,
    start_date,
    visualization_url,
    location,
    ciiu,
    zoneType,
    coordinateFormat,
    geographicArea,
    implantationArea,
  } = body;

  if (!title) return errorResponse("Title is required");

  try {
    const plan = await updatePlan(params.id, session.user.adminId, {
      title,
      description,
      report_per: report_per as PlanReporte,
      tipo: tipo as PlanTipo | undefined,
      start_date,
      visualization_url,
      location,
      ciiu,
      zoneType,
      coordinateFormat,
      geographicArea,
      implantationArea,
    });
    return NextResponse.json(plan);
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
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
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}

