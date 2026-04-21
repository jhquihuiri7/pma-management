import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getAuthSession, unauthorizedResponse, errorResponse } from "@/lib/api-utils";
import { adminDb } from "@/lib/firebase-admin";
import { getAuthenticatedDrive } from "@/lib/drive";
import { getPlanById } from "@/services-rgdp/planService";
import { Evidence, Format, PlanItem } from "@/types";
import {
  buildPhotosTableDocx,
  fileExtension,
  isImageFile,
  isPdfFile,
  PhotoWithDescription,
} from "@/lib/wordUtils";

function getBlockSize(report_per: string | undefined): number {
  const s = (report_per ?? "").toLowerCase();
  if (s.startsWith("2")) return 24;
  if (s.startsWith("1")) return 12;
  return 6;
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
  if (!plan) return errorResponse("Proyecto no encontrado", 404);
  if (plan.adminId !== session.user.adminId) {
    return errorResponse("No autorizado", 403);
  }

  // Get the plan item to know its report_per
  const itemDoc = await adminDb.collection("rgdp_projectItems").doc(planItemId).get();
  if (!itemDoc.exists) return errorResponse("Ãtem no encontrado", 404);
  const planItem = itemDoc.data() as PlanItem;
  if (planItem.planId !== planId) return errorResponse("No autorizado", 403);

  // Compute which months belong to this period
  const blockSize = getBlockSize(planItem.report_per);
  const monthKeys = getPeriodMonthKeys(periodStart, blockSize);
  const monthKeySet = new Set(monthKeys);

  // Fetch evidences for this item within the period
  const evidenceSnap = await adminDb
    .collection("rgdp_evidences")
    .where("planId", "==", planId)
    .where("planItemId", "==", planItemId)
    .get();

  const periodEvidences = evidenceSnap.docs
    .map((d) => d.data() as Evidence)
    .filter((e) => e.activityMonth && monthKeySet.has(e.activityMonth));

  if (periodEvidences.length === 0) {
    return errorResponse("No hay archivos para este perÃ­odo", 404);
  }

  // Authenticate Drive with admin credentials
  const drive = await getAuthenticatedDrive(plan.adminId);

  // â”€â”€ Download all evidence files from Drive â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const downloadedFiles = await Promise.all(
    periodEvidences.map(async (evidence) => {
      try {
        const res = await drive.files.get(
          { fileId: evidence.driveFileId, alt: "media" },
          { responseType: "arraybuffer" }
        );
        return {
          fileName: evidence.fileName,
          buffer: Buffer.from(res.data as ArrayBuffer),
          description: evidence.description ?? "",
        };
      } catch (err) {
        console.error(`Failed to download file ${evidence.driveFileId}:`, err);
        return null;
      }
    })
  );

  // â”€â”€ Classify into PDFs and images â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const pdfFiles: Array<{ fileName: string; buffer: Buffer }> = [];
  const imageFiles: PhotoWithDescription[] = [];

  for (const file of downloadedFiles) {
    if (!file) continue;
    if (isPdfFile(file.fileName)) {
      pdfFiles.push(file);
    } else if (isImageFile(file.fileName)) {
      imageFiles.push({
        buffer: file.buffer,
        ext: fileExtension(file.fileName),
        name: file.fileName,
        description: file.description,
      });
    }
    // other types are ignored (per product requirement: only PDFs and images)
  }

  // â”€â”€ Build ZIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const zip = new JSZip();

  // Add PDFs (deduplicate names)
  const fileNameCount: Record<string, number> = {};
  for (const pdf of pdfFiles) {
    let safeName = pdf.fileName;
    if (fileNameCount[safeName] !== undefined) {
      fileNameCount[safeName]++;
      const dotIdx = safeName.lastIndexOf(".");
      safeName =
        dotIdx !== -1
          ? `${safeName.slice(0, dotIdx)}_${fileNameCount[safeName]}${safeName.slice(dotIdx)}`
          : `${safeName}_${fileNameCount[safeName]}`;
    } else {
      fileNameCount[safeName] = 0;
    }
    zip.file(safeName, pdf.buffer);
  }

  // Build Word document with photos table (if any)
  if (imageFiles.length > 0) {
    let templateBuffer: Buffer | undefined;

    // Check if admin has a format for "descargar_anexos"
    try {
      const formatSnap = await adminDb
        .collection("rgdp_formats")
        .where("adminId", "==", plan.adminId)
        .where("functionality", "==", "descargar_anexos")
        .limit(1)
        .get();

      if (!formatSnap.empty) {
        const fmt = formatSnap.docs[0].data() as Format;
        const templateRes = await drive.files.get(
          { fileId: fmt.driveFileId, alt: "media" },
          { responseType: "arraybuffer" }
        );
        templateBuffer = Buffer.from(templateRes.data as ArrayBuffer);
      }
    } catch (err) {
      // If format fetch fails, proceed without template
      console.error("Failed to fetch format template:", err);
    }

    try {
      const photosDocxBuffer = await buildPhotosTableDocx(imageFiles, templateBuffer, planItem.item);
      zip.file("document_fotografÃ­as.docx", photosDocxBuffer);
    } catch (err) {
      console.error("Failed to build photos table docx:", err);
      // Skip photos document if generation fails
    }
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  const safeItemName = planItem.item.replace(
    /[^a-zA-Z0-9_\-\u00C0-\u024F]/g,
    "_"
  );
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


