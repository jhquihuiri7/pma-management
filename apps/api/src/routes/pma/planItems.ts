import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import {
  createPlanItem,
  getPlanItems,
  getPlanItemById,
  updatePlanItem,
  updatePlanItemObservation,
  deletePlanItem,
  assignReporterToItem,
  unassignReporterFromItem,
  bulkCreatePlanItems,
  type PlanItemCreateInput,
} from "../../modules/pma/planItemsModule.js";
import { getPlanById, canUserAccessPlan } from "../../modules/pma/plansModule.js";

const itemBase = z.object({
  item: z.string().min(1),
  subplan: z.string().min(1),
  direccion: z.string().optional(),
  environmental_activity: z.string().optional(),
  identified_environmental_impact: z.string().optional(),
  proposed_measure: z.string().optional(),
  indicator: z.string().optional(),
  verification_method: z.string().optional(),
  periodicity: z.string().optional(),
  budget: z.number().nonnegative().optional(),
  report_per: z.enum(["6 meses", "1 año", "2 años"]),
  observation: z.string().optional(),
});

const itemUpdate = itemBase.partial();
const bulkSchema = z.object({ items: z.array(itemBase).min(1) });
const observationSchema = z.object({ observation: z.string() });
const assignSchema = z.object({
  userId: z.string().uuid(),
  category: z.enum(["Responsable", "Colaborador"]),
});

async function assertPlanOwnership(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  return plan;
}

export async function pmaPlanItemsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => {
    const { planId } = req.params as { planId: string };
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getPlanItems(planId);
  });

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = itemBase.parse(req.body) as PlanItemCreateInput;
    const row = await createPlanItem(planId, body);
    reply.status(201);
    return row;
  });

  app.post("/bulk", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const { items } = bulkSchema.parse(req.body);
    const rows = await bulkCreatePlanItems(planId, items as PlanItemCreateInput[]);
    reply.status(201);
    return rows;
  });

  app.patch("/:itemId", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId, itemId } = req.params as { planId: string; itemId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = itemUpdate.parse(req.body);
    return updatePlanItem(itemId, planId, body);
  });

  app.patch("/:itemId/observation", async (req) => {
    const { planId, itemId } = req.params as { planId: string; itemId: string };
    const body = observationSchema.parse(req.body);
    // Reporters can update observation; admins of the plan too.
    const u = req.user!;
    if (u.role === "ADMIN") {
      await assertPlanOwnership(planId, u.adminId);
    } else {
      // For non-admins, verify the user is actually assigned to this plan/item
      // (plan- or item-level). Confirming the item exists is not enough.
      const item = await getPlanItemById(itemId);
      if (!item || item.planId !== planId) throw NotFound();
      if (!(await canUserAccessPlan(planId, u))) throw Forbidden("No tienes acceso a este plan");
    }
    await updatePlanItemObservation(itemId, planId, body.observation);
    return { ok: true };
  });

  app.delete("/:itemId", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId, itemId } = req.params as { planId: string; itemId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    await deletePlanItem(itemId, planId);
    return { ok: true };
  });

  app.post("/:itemId/assign", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId, itemId } = req.params as { planId: string; itemId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = assignSchema.parse(req.body);
    await assignReporterToItem(itemId, body.userId, body.category);
    return { ok: true };
  });

  app.delete("/:itemId/assign", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId, itemId } = req.params as { planId: string; itemId: string };
    const { userId } = req.body as { userId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    await unassignReporterFromItem(itemId, userId);
    return { ok: true };
  });
}
