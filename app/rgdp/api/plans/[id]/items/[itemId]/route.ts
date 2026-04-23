import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getPlanById } from "@/services-rgdp/planService";
import { deletePlanItem, updatePlanItem, updatePlanItemObservation } from "@/services-rgdp/planItemService";
import { findRgdtCatalogMatch, loadRgdtWasteCatalog } from "@/lib/rgdtWasteCatalog";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Proyecto no encontrado", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  const body = await req.json();

  try {
    if ("observation" in body && Object.keys(body).length === 1) {
      await updatePlanItemObservation(params.itemId, params.id, body.observation ?? "");
    } else {
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

      await updatePlanItem(params.itemId, params.id, {
        item: `${wasteCode} - ${wasteName}`,
        subplan: "RGDT",
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
      });
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Proyecto no encontrado", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  try {
    await deletePlanItem(params.itemId, params.id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
