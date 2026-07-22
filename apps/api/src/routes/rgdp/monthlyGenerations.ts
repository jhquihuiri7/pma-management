import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { getPlanById, canUserAccessPlan } from "../../modules/rgdp/plansModule.js";
import {
  getGenerations,
  setGeneration,
  bulkSetGenerations,
} from "../../modules/rgdp/monthlyGenerationsModule.js";

const entrySchema = z.object({
  planItemId: z.string().uuid(),
  periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  generationKg: z.number().finite().nonnegative().max(99_999_999_999.999),
}).strict();
const bulkSchema = z.object({
  entries: z.array(entrySchema).min(1).max(1_000),
}).strict().superRefine(({ entries }, context) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    const key = `${entry.planItemId}:${entry.periodKey}`;
    if (seen.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entries", index],
        message: "No se puede repetir el mismo ítem y período",
      });
    }
    seen.add(key);
  });
});
const planParamsSchema = z.object({ planId: z.string().uuid() }).strict();

async function assertPlanOwnership(planId: string, _adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
}

export async function rgdpMonthlyGenerationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));

  app.get("/", async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getGenerations(planId, req.user!.role === "REPORTER" ? req.user!.sub : undefined);
  });

  app.post("/", { preHandler: requireRole("ADMIN", "REPORTER") }, async (req, reply) => {
    const { planId } = planParamsSchema.parse(req.params);
    const user = req.user!;
    if (user.role === "ADMIN") await assertPlanOwnership(planId, user.adminId);
    const body = entrySchema.parse(req.body);
    const record = await setGeneration(
      planId,
      body,
      user.sub,
    );
    reply.status(201);
    return record;
  });

  app.put("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = bulkSchema.parse(req.body);
    const records = await bulkSetGenerations(planId, body.entries, req.user!.sub);
    return { updated: records.length, records };
  });
}
