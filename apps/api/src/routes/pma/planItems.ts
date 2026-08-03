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
const REPORT_PER_VALUES = ["6 meses", "1 año", "2 años"] as const;
const planParamsSchema = z.object({ planId: z.string().uuid() });
const itemParamsSchema = planParamsSchema.extend({ itemId: z.string().uuid() });

// The edit form round-trips these values straight from the stored row, so any
// legacy padding in the database ("DOSPPSVR " from an early Excel import) came
// back verbatim and a bare enum rejected every update. Trim before matching.
// A plain `.or(z.literal(""))` union reports only "Invalid input"; the explicit
// refinement names the accepted values instead.
const direccionField = z.string().trim().refine(
  (value): value is (typeof DIRECCION_VALUES)[number] | "" =>
    value === "" || (DIRECCION_VALUES as readonly string[]).includes(value),
  { message: `Debe ser una de: ${DIRECCION_VALUES.join(", ")} (o vacío)` },
);
const periodicityField = z.string().trim().pipe(z.enum(PERIODICITY_VALUES));
const reportPerField = z.string().trim().pipe(z.enum(REPORT_PER_VALUES));

// Exported for the regression tests: both production bugs these schemas now
// guard against were payload-shape bugs, invisible from the route handlers.
export const itemBase = z.object({
  item: z.string().trim().min(1).max(2_000),
  subplan: z.string().trim().min(1).max(300),
  direccion: direccionField.optional(),
  environmental_activity: z.string().max(10_000).optional(),
  identified_environmental_impact: z.string().max(10_000).optional(),
  proposed_measure: z.string().max(10_000).optional(),
  indicator: z.string().max(5_000).optional(),
  verification_method: z.string().max(5_000).optional(),
  periodicity: periodicityField,
  budget: z.number().finite().nonnegative().max(999_999_999_999.99).optional(),
  // Optional because report_per belongs to the plan, not to the item: an item
  // that omits it adopts the plan's value. Requiring it here forced every
  // client to already know the plan's period, and the item form — which has no
  // control for it — always guessed "6 meses", making the first item of any
  // other plan impossible to create. An explicit value is still validated
  // against the plan.
  report_per: reportPerField.optional(),
  observation: z.string().max(10_000).optional(),
}).strict();

export const itemUpdate = itemBase.partial().refine(
  (body) => Object.keys(body).length > 0,
  "Debes enviar al menos un campo",
);
const bulkSchema = z.object({ items: z.array(itemBase).min(1).max(1_000) }).strict();
const observationSchema = z.object({ observation: z.string().max(10_000) }).strict();
const assignDireccionSchema = z.object({
  direccion: z.string().trim().pipe(z.enum(DIRECCION_VALUES)),
  userId: z.string().uuid(),
  category: z.enum(["Responsable", "Colaborador"]),
}).strict();
const unassignDireccionSchema = z.object({
  direccion: z.string().trim().pipe(z.enum(DIRECCION_VALUES)),
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
    const body = itemBase.parse(req.body);
    const row = await createPlanItem(planId, body, req.user!.sub);
    reply.status(201);
    return row;
  });

  app.post("/bulk", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req, reply) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanAccess(planId, req.user!);
    const { items } = bulkSchema.parse(req.body);
    // The plan's report_per is applied inside the module's locked read instead
    // of from a plan loaded here, so it cannot go stale between the two.
    const rows = await bulkCreatePlanItems(planId, items, req.user!.sub);
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
