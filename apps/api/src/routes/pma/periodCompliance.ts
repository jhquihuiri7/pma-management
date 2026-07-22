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
  periodKey: z.string().trim().min(1).max(100),
  status: z.enum(["C", "NC+", "NC-", "N/A"]),
}).strict();

const bulkSchema = z.object({ entries: z.array(entrySchema).min(1).max(5_000) }).strict();
const planParamsSchema = z.object({ planId: z.string().uuid() }).strict();

async function assertPlanAccess(
  planId: string,
  user: { sub: string; role: "ADMIN" | "REPORTER" | "VIEWER" }
) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  // ADMINs pass through; non-admins (e.g. VIEWER) must be assigned to the plan.
  if (!(await canUserAccessPlan(planId, user))) throw Forbidden("No tienes acceso a este plan");
}

export async function pmaPeriodComplianceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getCompliance(planId, req.user!.role === "REPORTER" ? req.user!.sub : undefined);
  });

  app.put("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanAccess(planId, req.user!);
    const body = bulkSchema.parse(req.body);
    const updated = await bulkSetCompliance(planId, body.entries, req.user!.sub);
    return { ok: true, updated };
  });

  app.post("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanAccess(planId, req.user!);
    const body = entrySchema.parse(req.body);
    return setCompliance(planId, body.planItemId, body.periodKey, body.status, req.user!.sub);
  });
}
