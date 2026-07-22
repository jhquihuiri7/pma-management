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
  assignReporterToDireccion,
  unassignReporterFromDireccion,
  bulkCreatePlanItems,
  isReporterAssignedToItem,
  type PlanItemCreateInput,
} from "../../modules/pma/planItemsModule.js";
import { getPlanById, canUserAccessPlan } from "../../modules/pma/plansModule.js";

// Canonical "direcciones" — kept in sync with the frontend selector
// (apps/web/lib/planItemConstants.ts). Free-text values are rejected; an empty
// string is allowed for items that have no direccion assigned.
const DIRECCION_VALUES = ["DAF", "DGTAR", "DOSPPSVR", "DOSPPSVR / DGTAR", "OPC"] as const;
const PERIODICITY_VALUES = [
  "Al finalizar la etapa de operacion", "Anual", "Bimensual", "Bianual", "Diaria",
  "En caso de suceder", "Mensual", "Permanente", "Semanal", "Semestral",
  "Trianual", "Trimestral", "Cuatrimestral", "Unica vez",
] as const;
const planParamsSchema = z.object({ planId: z.string().uuid() });
const itemParamsSchema = planParamsSchema.extend({ itemId: z.string().uuid() });

const itemBase = z.object({
  item: z.string().trim().min(1).max(2_000),
  subplan: z.string().trim().min(1).max(300),
  direccion: z.enum(DIRECCION_VALUES).or(z.literal("")).optional(),
  environmental_activity: z.string().max(10_000).optional(),
  identified_environmental_impact: z.string().max(10_000).optional(),
  proposed_measure: z.string().max(10_000).optional(),
  indicator: z.string().max(5_000).optional(),
  verification_method: z.string().max(5_000).optional(),
  periodicity: z.enum(PERIODICITY_VALUES),
  budget: z.number().finite().nonnegative().max(999_999_999_999.99).optional(),
  report_per: z.enum(["6 meses", "1 año", "2 años"]),
  observation: z.string().max(10_000).optional(),
}).strict();

const itemUpdate = itemBase.partial().refine(
  (body) => Object.keys(body).length > 0,
  "Debes enviar al menos un campo",
);
const bulkItem = itemBase.extend({
  report_per: z.enum(["6 meses", "1 año", "2 años"]).optional(),
}).strict();
const bulkSchema = z.object({ items: z.array(bulkItem).min(1).max(1_000) }).strict();
const observationSchema = z.object({ observation: z.string().max(10_000) }).strict();
const assignDireccionSchema = z.object({
  direccion: z.enum(DIRECCION_VALUES),
  userId: z.string().uuid(),
  category: z.enum(["Responsable", "Colaborador"]),
}).strict();
const unassignDireccionSchema = z.object({
  direccion: z.enum(DIRECCION_VALUES),
  userId: z.string().uuid(),
}).strict();

async function assertPlanAccess(
  planId: string,
  user: { sub: string; role: "ADMIN" | "REPORTER" | "VIEWER" }
) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  // ADMINs pass through; non-admins (e.g. VIEWER) must be assigned to the plan.
  if (!(await canUserAccessPlan(planId, user))) throw Forbidden("No tienes acceso a este plan");
  return plan;
}

export async function pmaPlanItemsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getPlanItems(planId, req.user!.role === "REPORTER" ? req.user!.sub : undefined);
  });

  app.post("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req, reply) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanAccess(planId, req.user!);
    const body = itemBase.parse(req.body) as PlanItemCreateInput;
    const row = await createPlanItem(planId, body, req.user!.sub);
    reply.status(201);
    return row;
  });

  app.post("/bulk", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req, reply) => {
    const { planId } = planParamsSchema.parse(req.params);
    const plan = await assertPlanAccess(planId, req.user!);
    const { items } = bulkSchema.parse(req.body);
    const normalized = items.map((item) => ({
      ...item,
      report_per: item.report_per ?? plan.report_per,
    })) as PlanItemCreateInput[];
    const rows = await bulkCreatePlanItems(planId, normalized, req.user!.sub);
    reply.status(201);
    return { created: rows.length, failed: [], items: rows };
  });

  app.patch("/:itemId", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { planId, itemId } = itemParamsSchema.parse(req.params);
    await assertPlanAccess(planId, req.user!);
    const body = itemUpdate.parse(req.body);
    return updatePlanItem(itemId, planId, body, req.user!.sub);
  });

  app.patch("/:itemId/observation", async (req) => {
    const { planId, itemId } = itemParamsSchema.parse(req.params);
    const body = observationSchema.parse(req.body);
    const u = req.user!;
    // Confirm the item belongs to the plan (existence alone is not enough),
    // then check plan access — admins pass through, others must be assigned.
    const item = await getPlanItemById(itemId);
    if (!item || item.planId !== planId) throw NotFound();
    await assertPlanAccess(planId, u);
    if (u.role === "REPORTER" && !(await isReporterAssignedToItem(u.sub, itemId, planId))) {
      throw Forbidden("No tienes acceso a este ítem");
    }
    await updatePlanItemObservation(itemId, planId, body.observation, u.sub);
    return { ok: true, id: itemId };
  });

  app.delete("/:itemId", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { planId, itemId } = itemParamsSchema.parse(req.params);
    await assertPlanAccess(planId, req.user!);
    await deletePlanItem(itemId, planId, req.user!.sub);
    return { ok: true, id: itemId };
  });

  // Assign / unassign a reporter to every item that shares a "direccion".
  app.post("/assign-direccion", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanAccess(planId, req.user!);
    const body = assignDireccionSchema.parse(req.body);
    const assignment = await assignReporterToDireccion(
      planId,
      body.direccion,
      body.userId,
      body.category,
      req.user!.sub,
    );
    return { ok: true, ...assignment };
  });

  app.delete("/assign-direccion", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanAccess(planId, req.user!);
    const body = unassignDireccionSchema.parse(req.body);
    const assignment = await unassignReporterFromDireccion(
      planId,
      body.direccion,
      body.userId,
      req.user!.sub,
    );
    return { ok: true, ...assignment };
  });
}
