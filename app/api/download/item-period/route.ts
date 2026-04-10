import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getAuthSession, unauthorizedResponse, errorResponse } from "@/lib/api-utils";
import { adminDb } from "@/lib/firebase-admin";
import { getAuthenticatedDrive } from "@/lib/drive";
import { getPlanById } from "@/services/planService";
import { Evidence, PlanItem } from "@/types";

function getBlockSize(report_per: string | undefined): number {
  const s = (report_per ?? "").toLowerCase();
  if (s.startsWith("2")) return 24;
  if (s.startsWith("1")) return 12;
  return 6; // "6 meses" or any unknown value
}

function getPeriodMonthKeys(periodStart: string, blockSize: number): string[] {
  const [year, month] = periodStart.split("-").map(Number);
  const keys: string[] = [];
  for (let i = 0; i < blockSize; i++) {
    const d = new Date(year, month - 1 + i, 1);
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return keys;
}

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const planItemId = searchParams.get("planItemId");
  const periodStart = searchParams.get("periodStart"); // YYYY-MM
  const planId = searchParams.get("planId");

  if (!planItemId || !periodStart || !planId) {
    return errorResponse("planItemId, periodStart y planId son requeridos");
  }

  // Verify plan access
  const plan = await getPlanById(planId);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) {
    return errorResponse("No autorizado", 403);
  }

  // Get the plan item to know its report_per
  const itemDoc = await adminDb.collection("planItems").doc(planItemId).get();
  if (!itemDoc.exists) return errorResponse("Ítem no encontrado", 404);
  const planItem = itemDoc.data() as PlanItem;
  if (planItem.planId !== planId) return errorResponse("No autorizado", 403);

  // Compute which months belong to this period
  const blockSize = getBlockSize(planItem.report_per);
  const monthKeys = getPeriodMonthKeys(periodStart, blockSize);
  const monthKeySet = new Set(monthKeys);

  // Fetch evidences for this item within the period
  const evidenceSnap = await adminDb
    .collection("evidences")
    .where("planId", "==", planId)
    .where("planItemId", "==", planItemId)
    .get();

  const periodEvidences = evidenceSnap.docs
    .map((d) => d.data() as Evidence)
    .filter((e) => e.activityMonth && monthKeySet.has(e.activityMonth));

  if (periodEvidences.length === 0) {
    return errorResponse("No hay archivos para este período", 404);
  }

  // Authenticate Drive with admin credentials
  const drive = await getAuthenticatedDrive(plan.adminId);

  // Build ZIP in memory
  const zip = new JSZip();
  const fileNameCount: Record<string, number> = {};

  await Promise.all(
    periodEvidences.map(async (evidence) => {
      try {
        const res = await drive.files.get(
          { fileId: evidence.driveFileId, alt: "media" },
          { responseType: "arraybuffer" }
        );

        const data = res.data as ArrayBuffer;

        // Deduplicate file names within the zip
        let safeName = evidence.fileName;
        if (fileNameCount[safeName] !== undefined) {
          fileNameCount[safeName]++;
          const dotIdx = safeName.lastIndexOf(".");
          if (dotIdx !== -1) {
            safeName = `${safeName.slice(0, dotIdx)}_${fileNameCount[safeName]}${safeName.slice(dotIdx)}`;
          } else {
            safeName = `${safeName}_${fileNameCount[safeName]}`;
          }
        } else {
          fileNameCount[safeName] = 0;
        }

        zip.file(safeName, Buffer.from(data));
      } catch (err) {
        console.error(`Failed to download file ${evidence.driveFileId}:`, err);
        // Skip files that can't be downloaded
      }
    })
  );

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  const safeItemName = planItem.item.replace(/[^a-zA-Z0-9_\-\u00C0-\u024F]/g, "_");
  const fileName = `${safeItemName}_${periodStart}.zip`;

  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(zipBuffer.byteLength),
    },
  });
}
