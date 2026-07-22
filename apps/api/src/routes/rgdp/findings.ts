import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import { createFinding, getFindingsByPlan, updateFinding, deleteFinding } from "../../modules/rgdp/findingsModule.js";
import { getPlanById, canUserAccessPlan } from "../../modules/rgdp/plansModule.js";

const findingFieldsSchema = z.object({
  component: z.enum(["LEGAL", "OPERACIONAL", "AMBIENTAL"]),
  nudosCriticos: z.string().trim().min(1, "Nudos críticos es obligatorio").max(20_000),
  alarmas: z.string().trim().min(1, "Alarmas es obligatorio").max(20_000),
  riesgos: z.string().trim().min(1, "Riesgos es obligatorio").max(20_000),
  propuestasSolucion: z.string().trim().min(1, "Propuestas de solución es obligatorio").max(20_000),
}).strict();
const findingSchema = findingFieldsSchema.extend({ planId: z.string().uuid() }).strict();
const findingUpdate = findingFieldsSchema;
const planQuery = z.object({ planId: z.string().uuid() }).strict();
const idParams = z.object({ id: z.string().uuid() }).strict();

async function assertPlanOwnership(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
}

export async function rgdpFindingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));

  app.get("/", async (req) => {
    const { planId } = planQuery.parse(req.query);
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getFindingsByPlan(planId);
  });

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const body = findingSchema.parse(req.body);
    const u = req.user!;
    await assertPlanOwnership(body.planId, u.adminId);
    reply.status(201);
    return createFinding(body.planId, u.sub, body);
  });

  app.put("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = findingUpdate.parse(req.body);
    const { planId } = planQuery.parse(req.query);
    await assertPlanOwnership(planId, req.user!.adminId);
    return updateFinding(id, planId, body, req.user!.sub);
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParams.parse(req.params);
    const { planId } = planQuery.parse(req.query);
    await assertPlanOwnership(planId, req.user!.adminId);
    const deleted = await deleteFinding(id, planId, req.user!.sub);
    return { ok: true, deleted };
  });
}
