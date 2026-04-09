import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import {
  createPlan,
  getPlansByAdmin,
  getPlansForReporter,
  getPlansForViewer,
} from "@/services/planService";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  let plans;
  if (session.user.role === "ADMIN") {
    plans = await getPlansByAdmin(session.user.adminId);
  } else if (session.user.role === "VIEWER") {
    plans = await getPlansForViewer(session.user.id);
  } else {
    plans = await getPlansForReporter(session.user.id);
  }

  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const body = await req.json();
  const { title, description } = body;

  if (!title) {
    return errorResponse("Title is required");
  }

  try {
    const plan = await createPlan(
      session.user.adminId,
      title,
      description || ""
    );
    return NextResponse.json(plan, { status: 201 });
  } catch (error: any) {
    return errorResponse(error.message);
  }
}
