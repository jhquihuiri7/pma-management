import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { getPlanById } from "../../modules/pglp/plansModule.js";
import { getCompliance, bulkSetCompliance } from "../../modules/pglp/periodComplianceModule.js";

const entrySchema = z.object({
  planItemId: z.string().uuid(),
  periodKey: z.string().min(1),
  status: z.enum(["C", "NC+", "NC-", "N/A"]),
});
const bulkSchema = z.object({ entries: z.array(entrySchema).min(1) });

async function assertPlanOwnership(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  if (plan.adminId !== adminId) throw Forbidden();
}

export async function pglpPeriodComplianceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pglp"));

  app.get("/", async (req) => getCompliance((req.params as any).planId));

  app.put("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId } = req.params as { planId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = bulkSchema.parse(req.body);
    await bulkSetCompliance(body.entries);
    return { ok: true };
  });
}
