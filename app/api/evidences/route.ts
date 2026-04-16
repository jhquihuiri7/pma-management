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
  updateEvidenceValidation,
} from "@/services/evidenceService";
import { EvidenceValidationStatus } from "@/types";
import { createNotifications } from "@/services/notificationService";

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

export async function PATCH(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const { searchParams } = new URL(req.url);
  const evidenceId = searchParams.get("id");
  if (!evidenceId) return errorResponse("Evidence id is required");

  const body = await req.json();
  const status = body.validationStatus as EvidenceValidationStatus;
  const validationComment =
    typeof body.validationComment === "string" ? body.validationComment.trim() : "";

  if (!["pending", "valid", "invalid"].includes(status)) {
    return errorResponse("Invalid validation status");
  }
  if (status === "invalid" && !validationComment) {
    return errorResponse("Validation comment is required when rejecting evidence");
  }

  try {
    const { evidence, previousStatus } = await updateEvidenceValidation(
      evidenceId,
      status,
      session.user.adminId,
      {
        validationComment,
        validatedBy: session.user.id,
      }
    );

    if (status !== previousStatus && (status === "valid" || status === "invalid")) {
      try {
        await createNotifications([
          {
            userId: evidence.uploadedBy,
            adminId: session.user.adminId,
            type: status === "valid" ? "evidence_approved" : "evidence_rejected",
            title: status === "valid" ? "Evidencia aprobada" : "Evidencia rechazada",
            message:
              status === "valid"
                ? `Tu evidencia "${evidence.fileName}" fue aprobada.`
                : `Tu evidencia "${evidence.fileName}" fue rechazada. Motivo: ${validationComment}`,
            planId: evidence.planId,
            ...(evidence.planItemId ? { planItemId: evidence.planItemId } : {}),
            evidenceId: evidence.id,
            metadata: {
              fileName: evidence.fileName,
              ...(evidence.driveUrl ? { driveUrl: evidence.driveUrl } : {}),
              ...(status === "invalid" ? { validationComment } : {}),
            },
          },
        ]);
      } catch (notificationError) {
        console.error("[evidences.patch] Failed to create validation notifications:", notificationError);
      }
    }

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
  const evidenceId = searchParams.get("id");
  if (!evidenceId) return errorResponse("Evidence id is required");

  try {
    await deleteEvidence(evidenceId, session.user.adminId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
