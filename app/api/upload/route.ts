import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  errorResponse,
} from "@/lib/api-utils";
import { uploadEvidenceFile } from "@/services/driveService";
import { createEvidence } from "@/services/evidenceService";
import { getPlanById } from "@/services/planService";
import { getUserById } from "@/services/userService";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const planId = formData.get("planId") as string | null;
    const description = (formData.get("description") as string) || "";

    if (!file) return errorResponse("File is required");
    if (!planId) return errorResponse("planId is required");

    if (file.size > MAX_FILE_SIZE) {
      return errorResponse("File size exceeds 10MB limit");
    }

    // Verify plan exists and belongs to the user's admin
    const plan = await getPlanById(planId);
    if (!plan) return errorResponse("Plan not found", 404);
    if (plan.adminId !== session.user.adminId) {
      return errorResponse("Unauthorized", 403);
    }

    // Get uploader info
    const uploader = await getUserById(session.user.id);
    const uploaderName = uploader?.name || session.user.name || "Unknown";

    // Convert File to Buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Upload to Google Drive
    const { fileId, fileUrl } = await uploadEvidenceFile(
      buffer,
      file.name,
      file.type || "application/octet-stream",
      session.user.adminId,
      plan.title,
      uploaderName
    );

    // Create evidence record
    const evidence = await createEvidence(
      planId,
      session.user.id,
      uploaderName,
      file.name,
      fileId,
      fileUrl,
      description
    );

    return NextResponse.json(evidence, { status: 201 });
  } catch (error: any) {
    console.error("Upload error:", error);
    return errorResponse(error.message || "Upload failed", 500);
  }
}
