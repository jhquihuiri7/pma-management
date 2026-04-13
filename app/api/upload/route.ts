import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getAuthenticatedDrive, getOrCreateFolder, uploadFile } from "@/lib/drive";
import { createEvidence } from "@/services/evidenceService";
import { getPlanById } from "@/services/planService";
import { getUserById } from "@/services/userService";
import { adminDb } from "@/lib/firebase-admin";
import { PlanItem } from "@/types";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function getBlockSize(reportPer: string | undefined): number {
  const s = (reportPer ?? "").toLowerCase();
  if (s.startsWith("2")) return 24;
  if (s.startsWith("1")) return 12;
  return 6;
}

function getPeriodFolderName(
  activityMonth: string,
  startDate: string,
  reportPer: string | undefined
): string {
  const blockSize = getBlockSize(reportPer);
  const startYear = new Date(startDate).getFullYear();
  const blockOrigin = new Date(startYear, 0, 1);

  const [year, month] = activityMonth.split("-").map(Number);
  const targetDate = new Date(year, month - 1, 1);

  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  for (let blockIndex = 0; blockIndex < 200; blockIndex++) {
    const blockStart = new Date(
      blockOrigin.getFullYear(),
      blockOrigin.getMonth() + blockIndex * blockSize,
      1
    );
    const nextBlockStart = new Date(
      blockOrigin.getFullYear(),
      blockOrigin.getMonth() + (blockIndex + 1) * blockSize,
      1
    );

    if (targetDate >= blockStart && targetDate < nextBlockStart) {
      const blockEndMonth = new Date(
        blockOrigin.getFullYear(),
        blockOrigin.getMonth() + (blockIndex + 1) * blockSize - 1,
        1
      );
      return `${MONTHS[blockStart.getMonth()]}${blockStart.getFullYear()}-${MONTHS[blockEndMonth.getMonth()]}${blockEndMonth.getFullYear()}`;
    }
  }

  return activityMonth; // fallback
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const planId = formData.get("planId") as string | null;
    const planItemId = (formData.get("planItemId") as string) || undefined;
    const activityMonth = (formData.get("activityMonth") as string) || undefined;
    const description = (formData.get("description") as string) || "";

    if (!file) return errorResponse("File is required");
    if (!planId) return errorResponse("planId is required");

    if (file.size > MAX_FILE_SIZE) {
      return errorResponse("File size exceeds 10MB limit");
    }

    const plan = await getPlanById(planId);
    if (!plan) return errorResponse("Plan not found", 404);
    if (plan.adminId !== session.user.adminId) {
      return errorResponse("Unauthorized", 403);
    }

    const uploader = await getUserById(session.user.id);
    const uploaderName = uploader?.name || session.user.name || "Unknown";

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // ── Resolve Drive folder ────────────────────────────────────────────────
    const adminDoc = await adminDb.collection("admins").doc(session.user.adminId).get();
    const rootFolderId = adminDoc.exists
      ? (adminDoc.data()!.driveRootFolderId as string | undefined)
      : undefined;

    if (!rootFolderId) {
      return errorResponse("Google Drive no está configurado", 500);
    }

    const drive = await getAuthenticatedDrive(session.user.adminId);

    // Ensure plan folder exists
    let planFolderId = plan.driveFolderId;
    if (!planFolderId) {
      planFolderId = await getOrCreateFolder(drive, plan.title, rootFolderId);
      await adminDb.collection("plans").doc(planId).update({ driveFolderId: planFolderId });
    }

    let targetFolderId: string = planFolderId;

    // If uploading for a specific item, resolve: period subfolder → item folder
    if (planItemId) {
      const itemDoc = await adminDb.collection("planItems").doc(planItemId).get();
      if (itemDoc.exists) {
        const planItem = itemDoc.data() as PlanItem;

        // Create/get period subfolder inside plan folder
        let periodFolderId: string = planFolderId;
        if (activityMonth) {
          const periodName = getPeriodFolderName(
            activityMonth,
            planItem.start_date,
            planItem.report_per
          );
          periodFolderId = await getOrCreateFolder(drive, periodName, planFolderId);
        }

        // Ensure item folder exists inside period folder
        targetFolderId = await getOrCreateFolder(drive, planItem.item, periodFolderId);
      }
    }

    // Upload to Google Drive
    const { fileId, fileUrl } = await uploadFile(
      drive,
      buffer,
      file.name,
      file.type || "application/octet-stream",
      targetFolderId
    );

    // Create evidence record in Firestore
    const evidence = await createEvidence(
      planId,
      session.user.id,
      uploaderName,
      file.name,
      fileId,
      fileUrl,
      description,
      planItemId,
      activityMonth
    );

    return NextResponse.json(evidence, { status: 201 });
  } catch (error: unknown) {
    console.error("Upload error:", error);
    return errorResponse((error as Error).message || "Upload failed", 500);
  }
}
