import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import {
  createPlanItem, getPlanItems, getPlanItemById, updatePlanItem,
  deletePlanItem, assignReporterToItem, unassignReporterFromItem,
  bulkCreatePlanItems, type PglpPlanItemCreateInput,
} from "../../modules/pglp/planItemsModule.js";
import { getPlanById } from "../../modules/pglp/plansModule.js";

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
  wasteCode: z.string().optional(),
  wasteName: z.string().optional(),
  wasteDescription: z.string().optional(),
  crtib: z.string().optional(),
  annualGenerationKg: z.number().nonnegative().optional(),
  generationOrigin: z.string().optional(),
  selfManagement: z.boolean().optional(),
});
const itemUpdate = itemBase.partial();
const bulkSchema = z.object({ items: z.array(itemBase).min(1) });
const assignSchema = z.object({ userId: z.string().uuid(), category: z.enum(["Responsable", "Colaborador"]) });

async function assertPlanOwnership(planId: string, adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  if (plan.adminId !== adminId) throw Forbidden();
}

export async function pglpPlanItemsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pglp"));

  app.get("/", async (req) => getPlanItems((req.params as any).planId));

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = itemBase.parse(req.body) as PglpPlanItemCreateInput;
    const row = await createPlanItem(planId, body);
    reply.status(201);
    return row;
  });

  app.post("/bulk", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { planId } = req.params as { planId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const { items } = bulkSchema.parse(req.body);
    reply.status(201);
    return bulkCreatePlanItems(planId, items as PglpPlanItemCreateInput[]);
  });

  app.put("/:itemId", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId, itemId } = req.params as { planId: string; itemId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = itemUpdate.parse(req.body);
    return updatePlanItem(itemId, planId, body);
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

  app.delete("/:itemId/assign/:userId", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId, itemId, userId } = req.params as { planId: string; itemId: string; userId: string };
    await assertPlanOwnership(planId, req.user!.adminId);
    await unassignReporterFromItem(itemId, userId);
    return { ok: true };
  });
}
