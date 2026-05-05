import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getAuthenticatedDrive, getOrCreateFolder, uploadFile } from "@/lib/drive-pg";
import { createEvidence } from "@/services-pg/evidenceService";
import { getAssignedUsers, getPlanById } from "@/services-pg/planService";
import { getUserById } from "@/services/userService";
import { adminDb } from "@/lib/firebase-admin";
import { PlanItem } from "@/types";
import { createNotifications } from "@/services-pg/notificationService";
import { ensureItemDriveFolder, ensurePlanDriveFolder } from "@/services-pg/driveService";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function getMonthlyFolderName(activityMonth: string): string {
  const [year, month] = activityMonth.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return activityMonth;
  return `${MONTHS_ES[month - 1]}${year}`;
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
    if (!planId) return errorResponse("projectId is required");

    if (file.size > MAX_FILE_SIZE) {
      return errorResponse("File size exceeds 10MB limit");
    }

    const plan = await getPlanById(planId);
    if (!plan) return errorResponse("Proyecto no encontrado", 404);
    if (plan.adminId !== session.user.adminId) {
      return errorResponse("Unauthorized", 403);
    }

    const uploader = await getUserById(session.user.id);
    const uploaderName = uploader?.name || session.user.name || "Unknown";

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const drive = await getAuthenticatedDrive(session.user.adminId);

    let planItem: PlanItem | null = null;
    let subsystemName = "Sin proceso";

    if (planItemId) {
      const itemDoc = await adminDb.collection("pg_projectItems").doc(planItemId).get();
      if (itemDoc.exists) {
        planItem = itemDoc.data() as PlanItem;
        subsystemName = planItem.subplan || subsystemName;
      }
    } else {
      const firstItemSnap = await adminDb
        .collection("pg_projectItems")
        .where("planId", "==", planId)
        .limit(1)
        .get();

      if (!firstItemSnap.empty) {
        subsystemName = (firstItemSnap.docs[0].data() as PlanItem).subplan || subsystemName;
      }
    }

    const planFolderId = await ensurePlanDriveFolder(
      session.user.adminId,
      plan.title,
      subsystemName,
      plan.driveFolderId
    );

    if (plan.driveFolderId !== planFolderId) {
      await adminDb.collection("pg_projects").doc(planId).update({ driveFolderId: planFolderId });
    }

    let targetFolderId: string = planFolderId;
    let planItemName: string | undefined;

    if (planItem) {
      planItemName = planItem.item;
      const itemFolderId = await ensureItemDriveFolder(
        session.user.adminId,
        planItem.item,
        planFolderId,
        planItem.driveFolderId
      );

      if (planItem.driveFolderId !== itemFolderId) {
        await adminDb.collection("pg_projectItems").doc(planItem.id).update({ driveFolderId: itemFolderId });
        planItem.driveFolderId = itemFolderId;
      }

      targetFolderId = itemFolderId;

      if (activityMonth) {
        const periodName = getMonthlyFolderName(activityMonth);
        targetFolderId = await getOrCreateFolder(drive, periodName, itemFolderId);
      }
    }

    const { fileId, fileUrl } = await uploadFile(
      drive,
      buffer,
      file.name,
      file.type || "application/octet-stream",
      targetFolderId
    );

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

    if (session.user.role === "REPORTER") {
      try {
        const assignedUserIds = await getAssignedUsers(planId);
        const assignedUsers = await Promise.all(
          assignedUserIds.map((userId) => getUserById(userId))
        );
        const viewerIds = assignedUsers
          .filter((user): user is NonNullable<typeof user> => Boolean(user))
          .filter((user) => user.role === "VIEWER")
          .map((user) => user.id);

        const recipientIds = Array.from(new Set([plan.adminId, ...viewerIds]));

        if (recipientIds.length > 0) {
          await createNotifications(
            recipientIds.map((recipientId) => ({
              userId: recipientId,
              adminId: session.user.adminId,
              type: "evidence_submitted" as const,
              title: "Nueva evidencia subida",
              message: planItemName
                ? `${uploaderName} subió "${file.name}" en ${planItemName}.`
                : `${uploaderName} subió "${file.name}".`,
              planId,
              ...(planItemId ? { planItemId } : {}),
              evidenceId: evidence.id,
              metadata: {
                fileName: file.name,
                driveUrl: fileUrl,
                ...(planItemName ? { planItemName } : {}),
                ...(activityMonth ? { activityMonth } : {}),
              },
            }))
          );
        }
      } catch (notificationError) {
        console.error("[upload] Failed to create evidence notifications:", notificationError);
      }
    }

    return NextResponse.json(evidence, { status: 201 });
  } catch (error: unknown) {
    console.error("Upload error:", error);
    return errorResponse((error as Error).message || "Upload failed", 500);
  }
}
