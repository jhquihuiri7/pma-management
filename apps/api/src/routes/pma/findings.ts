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

const findingSchema = z.object({
  planId: z.string().uuid(),
  component: z.enum(["LEGAL", "OPERACIONAL", "AMBIENTAL"]),
  nudosCriticos: z.string().default(""),
  alarmas: z.string().default(""),
  riesgos: z.string().default(""),
  propuestasSolucion: z.string().default(""),
});

const findingUpdate = findingSchema.omit({ planId: true });
const findingIdQuery = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid().optional(),
});

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

  app.get("/", async (req) => {
    const planId = (req.query as any).planId as string | undefined;
    if (!planId) throw BadRequest("planId required");
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getFindingsByPlan(planId);
  });

  app.post("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req, reply) => {
    const body = findingSchema.parse(req.body);
    const u = req.user!;
    await assertPlanAccess(body.planId, u);
    const row = await createFinding(body.planId, u.sub, u.name, body);
    reply.status(201);
    return row;
  });

  // Compatibility for older web builds that sent PATCH /findings?id=...
  app.patch("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id, planId: queryPlanId } = findingIdQuery.parse(req.query);
    const body = findingSchema.parse(req.body);
    const planId = queryPlanId ?? body.planId;
    await assertPlanAccess(planId, req.user!);
    return updateFinding(id, planId, body);
  });

  // Compatibility for older web builds that sent DELETE /findings?id=...
  app.delete("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id, planId } = findingIdQuery.parse(req.query);
    if (!planId) throw BadRequest("planId required");
    await assertPlanAccess(planId, req.user!);
    await deleteFinding(id, planId);
    return { ok: true };
  });

  app.put("/:id", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = findingUpdate.parse(req.body);
    const planId = (req.query as any).planId as string | undefined;
    if (!planId) throw BadRequest("planId required");
    await assertPlanAccess(planId, req.user!);
    return updateFinding(id, planId, body);
  });

  // Deleting findings is ADMIN-only.
  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    const planId = (req.query as any).planId as string | undefined;
    if (!planId) throw BadRequest("planId required");
    await assertPlanAccess(planId, req.user!);
    await deleteFinding(id, planId);
    return { ok: true };
  });
}
