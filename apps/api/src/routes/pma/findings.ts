import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import {
  createFinding,
  getFindingsByPlan,
  updateFinding,
  deleteFinding,
} from "../../modules/pma/findingsModule.js";
import { getPlanById } from "../../modules/pma/plansModule.js";

const findingSchema = z.object({
  planId: z.string().uuid(),
  component: z.enum(["LEGAL", "OPERACIONAL", "AMBIENTAL"]),
  nudosCriticos: z.string().default(""),
  alarmas: z.string().default(""),
  riesgos: z.string().default(""),
  propuestasSolucion: z.string().default(""),
});

const findingUpdate = findingSchema.omit({ planId: true });

async function assertPlanOwnership(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  if (plan.adminId !== adminId) throw Forbidden();
}

export async function pmaFindingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => {
    const planId = (req.query as any).planId as string | undefined;
    if (!planId) throw BadRequest("planId required");
    return getFindingsByPlan(planId);
  });

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const body = findingSchema.parse(req.body);
    const u = req.user!;
    await assertPlanOwnership(body.planId, u.adminId);
    const row = await createFinding(body.planId, u.sub, u.name, body);
    reply.status(201);
    return row;
  });

  app.put("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = findingUpdate.parse(req.body);
    const planId = (req.query as any).planId as string | undefined;
    if (!planId) throw BadRequest("planId required");
    await assertPlanOwnership(planId, req.user!.adminId);
    return updateFinding(id, planId, body);
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    const planId = (req.query as any).planId as string | undefined;
    if (!planId) throw BadRequest("planId required");
    await assertPlanOwnership(planId, req.user!.adminId);
    await deleteFinding(id, planId);
    return { ok: true };
  });
}
