import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { getPlanById, canUserAccessPlan } from "../../modules/pma/plansModule.js";
import {
  getCompliance,
  bulkSetCompliance,
  setCompliance,
} from "../../modules/pma/periodComplianceModule.js";

const entrySchema = z.object({
  planItemId: z.string().uuid(),
  periodKey: z.string().min(1),
  status: z.enum(["C", "NC+", "NC-", "N/A"]),
});

const bulkSchema = z.object({ entries: z.array(entrySchema).min(1) });

async function assertPlanOwnership(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
}

export async function pmaPeriodComplianceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => {
    const { planId } = req.params as { planId: string };
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getCompliance(planId);
  });

  app.put("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId } = req.params as { planId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = bulkSchema.parse(req.body);
    await bulkSetCompliance(body.entries);
    return { ok: true };
  });

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId } = req.params as { planId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = entrySchema.parse(req.body);
    await setCompliance(body.planItemId, body.periodKey, body.status);
    return {
      id: `${body.planItemId}:${body.periodKey}`,
      planId,
      ...body,
      updatedAt: new Date().toISOString(),
    };
  });
}
