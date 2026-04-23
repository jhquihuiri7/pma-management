import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getPlanById, isUserAssignedToPlan } from "@/services-rgdp/planService";
import { createPlanItem, getPlanItems } from "@/services-rgdp/planItemService";
import { ensureItemDriveFolder, ensurePlanDriveFolder } from "@/services-rgdp/driveService";
import { adminDb } from "@/lib/firebase-admin";
import { findRgdtCatalogMatch, loadRgdtWasteCatalog } from "@/lib/rgdtWasteCatalog";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Proyecto no encontrado", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  if (session.user.role === "VIEWER") {
    const assigned = await isUserAssignedToPlan(session.user.id, params.id);
    if (!assigned) return forbiddenResponse();
  }

  const items = await getPlanItems(params.id);
  return NextResponse.json(items);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Proyecto no encontrado", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  const body = await req.json();
  const wasteCode = String(body?.wasteCode ?? "").trim();
  const wasteName = String(body?.wasteName ?? "").trim();
  const wasteDescription = String(body?.wasteDescription ?? "").trim();
  const crtib = String(body?.crtib ?? "").trim();
  const annualGenerationKg = Number(body?.annualGenerationKg);
  const generationOrigin = String(body?.generationOrigin ?? "").trim();
  const selfManagement = Boolean(body?.selfManagement);

  if (!wasteCode || !wasteName || !crtib || !generationOrigin) {
    return errorResponse("Código, Nombre, CRTIB y Origen de la generación son obligatorios");
  }
  if (!Number.isFinite(annualGenerationKg) || annualGenerationKg < 0) {
    return errorResponse("Generación anual (kg) debe ser un número válido");
  }

  const catalog = loadRgdtWasteCatalog();
  if (catalog.length === 0) {
    return errorResponse("No se encontró catálogo RGDT en public/data/rgdt-residuos.xlsx|xls|csv");
  }

  const match = findRgdtCatalogMatch(catalog, {
    codigo: wasteCode,
    descripcion: wasteName,
    crtib,
  });
  if (!match) {
    return errorResponse("Código, Nombre y CRTIB no coinciden con el catálogo RGDT");
  }

  const itemLabel = `${wasteCode} - ${wasteName}`;
  const rgdtSubplan = "RGDT";

  try {
    const newItem = await createPlanItem(params.id, {
      // Legacy fields retained for compatibility with existing RGDP flows.
      item: itemLabel,
      subplan: rgdtSubplan,
      direccion: generationOrigin,
      environmental_activity: wasteName,
      identified_environmental_impact: wasteDescription || "-",
      proposed_measure: wasteDescription || "-",
      indicator: crtib,
      verification_method: generationOrigin,
      periodicity: "Mensual",
      budget: 0,
      wasteCode,
      wasteName,
      wasteDescription,
      crtib,
      annualGenerationKg,
      generationOrigin,
      selfManagement,
      report_per: plan.report_per || "6 meses",
    });

    try {
      const planFolderId = await ensurePlanDriveFolder(
        session.user.adminId,
        plan.title,
        rgdtSubplan,
        plan.driveFolderId
      );

      if (plan.driveFolderId !== planFolderId) {
        await adminDb.collection("rgdp_projects").doc(params.id).update({ driveFolderId: planFolderId });
      }

      const itemFolderId = await ensureItemDriveFolder(
        session.user.adminId,
        itemLabel,
        planFolderId,
        newItem.driveFolderId
      );

      if (newItem.driveFolderId !== itemFolderId) {
        await adminDb.collection("rgdp_projectItems").doc(newItem.id).update({ driveFolderId: itemFolderId });
        newItem.driveFolderId = itemFolderId;
      }
    } catch (driveErr) {
      console.error("Drive folder creation for item failed:", driveErr);
    }

    return NextResponse.json(newItem, { status: 201 });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
