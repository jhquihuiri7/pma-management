import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getPlanById, isUserAssignedToPlan } from "@/services/planService";
import { createPlanItem, getPlanItems } from "@/services/planItemService";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  // VIEWER must be assigned to the plan
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
    type,
    subplan,
    environmental_activity,
    identified_environmental_impact,
    proposed_measure,
    indicator,
    verification_method,
    periodicity,
    start_date,
    budget,
    report_per,
  } = body;

  if (
    !item ||
    !type ||
    !subplan ||
    !environmental_activity ||
    !identified_environmental_impact ||
    !proposed_measure ||
    !indicator ||
    !verification_method ||
    !periodicity ||
    !start_date ||
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
        type,
        subplan,
        environmental_activity,
        identified_environmental_impact,
        proposed_measure,
        indicator,
        verification_method,
        periodicity,
        start_date,
        budget: Number(budget),
        report_per: report_per || "6 meses",
      }
    );
    return NextResponse.json(newItem, { status: 201 });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
