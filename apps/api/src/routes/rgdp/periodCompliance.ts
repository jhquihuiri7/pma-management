import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { getPlanById, canUserAccessPlan } from "../../modules/rgdp/plansModule.js";
import { getCompliance, bulkSetCompliance } from "../../modules/rgdp/periodComplianceModule.js";

const entrySchema = z.object({
  planItemId: z.string().uuid(),
  periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  status: z.enum(["C", "NC+", "NC-", "N/A"]),
}).strict();
const bulkSchema = z.object({ entries: z.array(entrySchema).min(1).max(5_000) }).strict();
const planParamsSchema = z.object({ planId: z.string().uuid() }).strict();

async function assertPlanOwnership(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
}

export async function rgdpPeriodComplianceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));

  app.get("/", async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getCompliance(planId, req.user!.role === "REPORTER" ? req.user!.sub : undefined);
  });

  app.put("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = bulkSchema.parse(req.body);
    const updated = await bulkSetCompliance(planId, body.entries, req.user!.sub);
    return { ok: true, updated };
  });
}
