import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { getPlanById } from "@/services/planService";
import { createPlanItem } from "@/services/planItemService";
import { PlanItem } from "@/types";

interface BulkItemInput {
  item: string;
  subplan: string;
  environmental_activity: string;
  identified_environmental_impact: string;
  proposed_measure: string;
  indicator: string;
  verification_method: string;
  periodicity: string;
  budget: number;
  observation?: string;
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
  const items: BulkItemInput[] = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) return errorResponse("No items provided");

  const reportPer = plan.report_per || "6 meses";

  const created: PlanItem[] = [];
  const failed: { index: number; error: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const input = items[i];
    try {
      const newItem = await createPlanItem(params.id, {
        item: input.item,
        subplan: input.subplan,
        environmental_activity: input.environmental_activity,
        identified_environmental_impact: input.identified_environmental_impact,
        proposed_measure: input.proposed_measure,
        indicator: input.indicator,
        verification_method: input.verification_method,
        periodicity: input.periodicity,
        budget: Number(input.budget) || 0,
        report_per: reportPer,
        ...(input.observation ? { observation: input.observation } : {}),
      });
      created.push(newItem);
    } catch (err) {
      failed.push({ index: i, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    created: created.length,
    items: created,
    failed,
  });
}
