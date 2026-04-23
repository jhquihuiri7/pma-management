import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { adminDb } from "@/lib/firebase-admin";
import { getPlanById, isUserAssignedToPlan } from "@/services-rgdp/planService";
import { createNotifications } from "@/services-rgdp/notificationService";
import { PlanItem } from "@/types";

type MonthlyGenerationRecord = {
  id: string;
  planId: string;
  planItemId: string;
  periodKey: string; // YYYY-MM
  generationKg: number;
  updatedAt: string;
};

function isValidPeriodKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

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

  const snapshot = await adminDb
    .collection("rgdp_project_monthly_generation")
    .where("planId", "==", params.id)
    .get();

  const records = snapshot.docs.map((doc) => doc.data() as MonthlyGenerationRecord);
  return NextResponse.json(records);
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
  const planItemId = String(body?.planItemId ?? "").trim();
  const periodKey = String(body?.periodKey ?? "").trim();
  const generationKg = Number(body?.generationKg);

  if (!planItemId || !periodKey || !Number.isFinite(generationKg) || generationKg < 0) {
    return errorResponse("Campos inválidos: planItemId, periodKey (YYYY-MM), generationKg >= 0");
  }
  if (!isValidPeriodKey(periodKey)) {
    return errorResponse("periodKey debe tener formato YYYY-MM");
  }

  const generationCollection = adminDb.collection("rgdp_project_monthly_generation");
  const recordId = `${planItemId}_${periodKey}`;
  const recordRef = generationCollection.doc(recordId);
  const itemRef = adminDb.collection("rgdp_projectItems").doc(planItemId);

  const thresholds = [50, 75, 90, 95, 100];
  let crossedThresholds: number[] = [];
  let updatedRecord: MonthlyGenerationRecord | null = null;
  let currentTotal = 0;
  let annualLimit = 0;
  let itemLabel = planItemId;

  try {
    await adminDb.runTransaction(async (tx) => {
      const itemDoc = await tx.get(itemRef);
      if (!itemDoc.exists) throw new Error("Ítem no encontrado");

      const item = itemDoc.data() as PlanItem;
      if (item.planId !== params.id) throw new Error("Ítem no pertenece al proyecto");

      itemLabel = item.wasteCode
        ? `${item.wasteCode} - ${item.wasteName ?? item.environmental_activity}`
        : item.item;

      annualLimit = Number(item.annualGenerationKg ?? 0);
      if (!Number.isFinite(annualLimit) || annualLimit < 0) {
        throw new Error("El ítem no tiene un valor anual válido para generación");
      }

      const allForItemQuery = generationCollection
        .where("planId", "==", params.id)
        .where("planItemId", "==", planItemId);
      const allForItemSnap = await tx.get(allForItemQuery);

      const existingRecordDoc = await tx.get(recordRef);
      const previousValue = existingRecordDoc.exists
        ? Number((existingRecordDoc.data() as MonthlyGenerationRecord).generationKg ?? 0)
        : 0;

      const previousTotal = allForItemSnap.docs.reduce((sum, doc) => {
        const value = Number((doc.data() as MonthlyGenerationRecord).generationKg ?? 0);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);

      currentTotal = previousTotal - previousValue + generationKg;
      if (currentTotal > annualLimit + 1e-9) {
        throw new Error(
          `La suma mensual (${currentTotal.toFixed(2)} kg) supera la generación anual declarada (${annualLimit.toFixed(2)} kg)`
        );
      }

      const prevPct = annualLimit > 0 ? (previousTotal / annualLimit) * 100 : 0;
      const newPct = annualLimit > 0 ? (currentTotal / annualLimit) * 100 : 0;
      crossedThresholds = thresholds.filter((t) => prevPct < t && newPct >= t);

      const now = new Date().toISOString();
      updatedRecord = {
        id: recordId,
        planId: params.id,
        planItemId,
        periodKey,
        generationKg,
        updatedAt: now,
      };

      tx.set(recordRef, updatedRecord, { merge: true });
    });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }

  if (updatedRecord && crossedThresholds.length > 0) {
    const assignmentSnap = await adminDb
      .collection("rgdp_project_assignments")
      .where("planId", "==", params.id)
      .get();

    const recipientIds = new Set<string>([
      plan.adminId,
      ...assignmentSnap.docs.map((d) => String(d.data().userId ?? "")),
    ]);
    recipientIds.delete("");

    const notifications = Array.from(recipientIds).flatMap((userId) =>
      crossedThresholds.map((threshold) => ({
        userId,
        adminId: plan.adminId,
        type: "generation_threshold_reached" as const,
        title: `Generación ${threshold}% alcanzada`,
        message: `${itemLabel} alcanzó ${threshold}% (${currentTotal.toFixed(2)} / ${annualLimit.toFixed(2)} kg)`,
        planId: params.id,
        planItemId,
        metadata: {
          threshold: String(threshold),
          currentTotalKg: currentTotal.toFixed(2),
          annualLimitKg: annualLimit.toFixed(2),
          periodKey,
        },
      }))
    );

    if (notifications.length > 0) {
      await createNotifications(notifications);
    }
  }

  return NextResponse.json(updatedRecord ?? { success: true });
}
