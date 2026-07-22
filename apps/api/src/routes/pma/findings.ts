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
import { getPlanById, canUserAccessPlan } from "../../modules/pma/plansModule.js";

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
const findingIdQuery = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid().optional(),
}).strict();

async function assertPlanAccess(
  planId: string,
  user: { sub: string; role: "ADMIN" | "REPORTER" | "VIEWER" }
) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  // ADMINs pass through; non-admins (e.g. VIEWER) must be assigned to the plan.
  if (!(await canUserAccessPlan(planId, user))) throw Forbidden("No tienes acceso a este plan");
}

export async function pmaFindingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { planId } = planQuery.parse(req.query);
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getFindingsByPlan(planId);
  });

  app.post("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req, reply) => {
    const body = findingSchema.parse(req.body);
    const u = req.user!;
    await assertPlanAccess(body.planId, u);
    const row = await createFinding(body.planId, u.sub, body);
    reply.status(201);
    return row;
  });

  // Compatibility for older web builds that sent PATCH /findings?id=...
  app.patch("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id, planId: queryPlanId } = findingIdQuery.parse(req.query);
    const body = findingSchema.parse(req.body);
    if (queryPlanId && queryPlanId !== body.planId) {
      throw BadRequest("planId de query y body no coinciden");
    }
    const planId = queryPlanId ?? body.planId;
    await assertPlanAccess(planId, req.user!);
    return updateFinding(id, planId, findingUpdate.parse(body), req.user!.sub);
  });

  // Compatibility for older web builds that sent DELETE /findings?id=...
  app.delete("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id, planId } = findingIdQuery.parse(req.query);
    if (!planId) throw BadRequest("planId required");
    await assertPlanAccess(planId, req.user!);
    await deleteFinding(id, planId, req.user!.sub);
    return { ok: true };
  });

  app.put("/:id", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = findingUpdate.parse(req.body);
    const { planId } = planQuery.parse(req.query);
    await assertPlanAccess(planId, req.user!);
    return updateFinding(id, planId, body, req.user!.sub);
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = idParams.parse(req.params);
    const { planId } = planQuery.parse(req.query);
    await assertPlanAccess(planId, req.user!);
    await deleteFinding(id, planId, req.user!.sub);
    return { ok: true };
  });
}
