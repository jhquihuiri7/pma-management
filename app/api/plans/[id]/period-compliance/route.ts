import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getPlanById } from "@/services/planService";
import { adminDb } from "@/lib/firebase-admin";
import { PeriodCompliance, PeriodComplianceStatus } from "@/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const plan = await getPlanById(params.id);
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  const snapshot = await adminDb
    .collection("pma_periodCompliance")
    .where("planId", "==", params.id)
    .get();

  const records = snapshot.docs.map((doc) => doc.data() as PeriodCompliance);
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
  if (!plan) return errorResponse("Plan not found", 404);
  if (plan.adminId !== session.user.adminId) return forbiddenResponse();

  const body = await req.json();
  const { planItemId, periodKey, status } = body as {
    planItemId: string;
    periodKey: string;
    status: PeriodComplianceStatus;
  };

  if (!planItemId || !periodKey || !status) {
    return errorResponse("Missing fields: planItemId, periodKey, status");
  }

  const validStatuses: PeriodComplianceStatus[] = ["C", "NC+", "NC-", "N/A"];
  if (!validStatuses.includes(status)) {
    return errorResponse("Invalid status value");
  }

  const existing = await adminDb
    .collection("pma_periodCompliance")
    .where("planId", "==", params.id)
    .where("planItemId", "==", planItemId)
    .where("periodKey", "==", periodKey)
    .limit(1)
    .get();

  const now = new Date().toISOString();

  if (!existing.empty) {
    await existing.docs[0].ref.update({ status, updatedAt: now });
    return NextResponse.json({ id: existing.docs[0].id, planId: params.id, planItemId, periodKey, status, updatedAt: now });
  }

  const ref = adminDb.collection("pma_periodCompliance").doc();
  const record: PeriodCompliance = {
    id: ref.id,
    planId: params.id,
    planItemId,
    periodKey,
    status,
    updatedAt: now,
  };
  await ref.set(record);
  return NextResponse.json(record, { status: 201 });
}
