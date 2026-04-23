import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  forbiddenResponse,
  getAuthSession,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { getPlanById, isUserAssignedToPlan } from "@/services/planService";
import {
  createFinding,
  deleteFinding,
  getFindingsByPlan,
  updateFinding,
} from "@/services/findingService";
import { FindingComponent } from "@/types";

const COMPONENT_OPTIONS: FindingComponent[] = [
  "LEGAL",
  "OPERACIONAL",
  "AMBIENTAL",
];

function isValidComponent(value: string): value is FindingComponent {
  return COMPONENT_OPTIONS.includes(value as FindingComponent);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const planId = searchParams.get("planId");
  if (!planId) return errorResponse("planId query parameter is required");

  const plan = await getPlanById(planId);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  if (session.user.role === "VIEWER") {
    const assigned = await isUserAssignedToPlan(session.user.id, planId);
    if (!assigned) return forbiddenResponse();
  }

  const findings = await getFindingsByPlan(planId);
  return NextResponse.json(findings);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const body = await req.json();
  const {
    planId,
    component,
    nudosCriticos,
    alarmas,
    riesgos,
    propuestasSolucion,
  } = body;

  if (!isNonEmptyString(planId)) return errorResponse("planId is required");
  if (!isValidComponent(component)) return errorResponse("Invalid component");
  if (
    !isNonEmptyString(nudosCriticos) ||
    !isNonEmptyString(alarmas) ||
    !isNonEmptyString(riesgos) ||
    !isNonEmptyString(propuestasSolucion)
  ) {
    return errorResponse("All fields are required");
  }

  const plan = await getPlanById(planId);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  try {
    const finding = await createFinding(planId, {
      component,
      nudosCriticos: nudosCriticos.trim(),
      alarmas: alarmas.trim(),
      riesgos: riesgos.trim(),
      propuestasSolucion: propuestasSolucion.trim(),
      createdByName: session.user.name || "Desconocido",
    });
    return NextResponse.json(finding, { status: 201 });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const { searchParams } = new URL(req.url);
  const findingId = searchParams.get("id");
  if (!findingId) return errorResponse("Finding id is required");

  const body = await req.json();
  const { planId, component, nudosCriticos, alarmas, riesgos, propuestasSolucion } = body;

  if (!isNonEmptyString(planId)) return errorResponse("planId is required");
  if (!isValidComponent(component)) return errorResponse("Invalid component");
  if (
    !isNonEmptyString(nudosCriticos) ||
    !isNonEmptyString(alarmas) ||
    !isNonEmptyString(riesgos) ||
    !isNonEmptyString(propuestasSolucion)
  ) {
    return errorResponse("All fields are required");
  }

  const plan = await getPlanById(planId);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  try {
    await updateFinding(findingId, planId, {
      component,
      nudosCriticos: nudosCriticos.trim(),
      alarmas: alarmas.trim(),
      riesgos: riesgos.trim(),
      propuestasSolucion: propuestasSolucion.trim(),
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const { searchParams } = new URL(req.url);
  const findingId = searchParams.get("id");
  const planId = searchParams.get("planId");
  if (!findingId) return errorResponse("Finding id is required");
  if (!planId) return errorResponse("planId query parameter is required");

  const plan = await getPlanById(planId);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  try {
    await deleteFinding(findingId, planId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
