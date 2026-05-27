import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { getPlanById, canUserAccessPlan } from "../../modules/rgdp/plansModule.js";
import { getGenerations, bulkSetGenerations } from "../../modules/rgdp/monthlyGenerationsModule.js";

const entrySchema = z.object({
  planItemId: z.string().uuid(),
  periodKey: z.string().min(1),
  generationKg: z.number().nonnegative(),
});
const bulkSchema = z.object({ entries: z.array(entrySchema).min(1) });

async function assertPlanOwnership(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
}

export async function rgdpMonthlyGenerationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));

  app.get("/", async (req) => {
    const planId = (req.params as any).planId as string;
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getGenerations(planId);
  });

  app.put("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId } = req.params as { planId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = bulkSchema.parse(req.body);
    await bulkSetGenerations(body.entries);
    return { ok: true };
  });
}
