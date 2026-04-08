import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import {
  getEvidencesByPlan,
  getEvidencesByReporter,
  deleteEvidence,
} from "@/services/evidenceService";

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const planId = searchParams.get("planId");

  let evidences;
  if (planId) {
    evidences = await getEvidencesByPlan(planId);
  } else if (session.user.role === "REPORTER") {
    evidences = await getEvidencesByReporter(session.user.id);
  } else {
    return errorResponse("planId query parameter is required for admin");
  }

  return NextResponse.json(evidences);
}

export async function DELETE(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const { searchParams } = new URL(req.url);
  const evidenceId = searchParams.get("id");
  if (!evidenceId) return errorResponse("Evidence id is required");

  try {
    await deleteEvidence(evidenceId, session.user.adminId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error.message);
  }
}
