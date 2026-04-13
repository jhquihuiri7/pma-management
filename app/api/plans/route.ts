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
import { createPlanDriveFolder } from "@/services/driveService";

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
  const { title, description, report_per, tipo } = body;

  if (!title) {
    return errorResponse("Title is required");
  }

  try {
    // Create Drive folder for this plan
    let driveFolderId: string | undefined;
    try {
      driveFolderId = await createPlanDriveFolder(session.user.adminId, title);
    } catch (driveErr) {
      console.error("Drive folder creation failed:", driveErr);
      // Continue without Drive folder — upload will fall back gracefully
    }

    const plan = await createPlan(
      session.user.adminId,
      title,
      description || "",
      report_per || "6 meses",
      driveFolderId,
      tipo
    );
    return NextResponse.json(plan, { status: 201 });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
