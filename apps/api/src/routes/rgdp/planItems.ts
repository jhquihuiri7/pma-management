import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest, Forbidden, HttpError, NotFound } from "../../lib/errors.js";
import {
  createPlanItem, getPlanItems, getPlanItemById, updatePlanItem,
  updatePlanItemObservation, deletePlanItem,
  assignReporterToDireccion, unassignReporterFromDireccion,
  bulkCreatePlanItems, type RgdpPlanItemCreateInput,
} from "../../modules/rgdp/planItemsModule.js";
import { getPlanById, canUserAccessPlan } from "../../modules/rgdp/plansModule.js";
import {
  findRgdtCatalogMatch,
  loadRgdtWasteCatalog,
} from "../../modules/rgdp/wasteCatalogModule.js";
import { toCanonicalRgdpPlanItemInput } from "../../modules/rgdp/wasteItemContract.js";

const reportPeriodSchema = z.enum(["6 meses", "1 año", "2 años"]);
const planParamsSchema = z.object({ planId: z.string().uuid() });
const itemParamsSchema = planParamsSchema.extend({ itemId: z.string().uuid() });
const legacyItemBase = z.object({
  item: z.string().trim().min(1).max(2_000),
  subplan: z.string().trim().min(1).max(300),
  direccion: z.string().trim().max(500).optional(),
  environmental_activity: z.string().max(10_000).optional(),
  identified_environmental_impact: z.string().max(10_000).optional(),
  proposed_measure: z.string().max(10_000).optional(),
  indicator: z.string().max(5_000).optional(),
  verification_method: z.string().max(5_000).optional(),
  periodicity: z.string().max(300).optional(),
  budget: z.number().finite().nonnegative().max(999_999_999_999.99).optional(),
  report_per: reportPeriodSchema,
  observation: z.string().max(10_000).optional(),
});

const wasteItemBase = z.object({
  wasteCode: z.string().trim().min(1).max(100),
  wasteName: z.string().trim().min(1).max(5_000),
  wasteDescription: z.string().trim().max(10_000).optional(),
  crtib: z.string().trim().min(1).max(100),
  annualGenerationKg: z.number().finite().nonnegative().max(99_999_999_999.999),
  generationOrigin: z.string().trim().min(1).max(500),
  selfManagement: z.boolean().default(false),
  observation: z.string().trim().max(10_000).optional(),
});

const legacyBulkItem = legacyItemBase.extend({ report_per: reportPeriodSchema.optional() });
const itemCreate = z.union([wasteItemBase.strict(), legacyBulkItem.strict()]);
const bulkItem = z.union([wasteItemBase.strict(), legacyBulkItem.strict()]);
const bulkSchema = z.object({ items: z.array(bulkItem).min(1).max(1_000) }).strict();
const itemUpdate = legacyItemBase
  .omit({ report_per: true })
  .partial()
  .merge(wasteItemBase.partial())
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");
const assignDireccionSchema = z.object({ direccion: z.string().trim().min(1).max(500), userId: z.string().uuid(), category: z.enum(["Responsable", "Colaborador"]) }).strict();
const unassignDireccionSchema = z.object({ direccion: z.string().trim().min(1).max(500), userId: z.string().uuid() }).strict();

async function assertPlanOwnership(planId: string, _adminId: string) {
  const plan = await getPlanById(planId);
  if (!plan) throw NotFound("Plan not found");
  return plan;
}

function hasWasteFields(value: Record<string, unknown>): boolean {
  return [
    "wasteCode",
    "wasteName",
    "wasteDescription",
    "crtib",
    "annualGenerationKg",
    "generationOrigin",
    "selfManagement",
  ].some((field) => value[field] !== undefined);
}

async function validateCatalogWaste(input: z.infer<typeof wasteItemBase>) {
  const catalog = await loadRgdtWasteCatalog();
  if (catalog.length === 0) throw new HttpError(503, "El catálogo RGDT no está disponible");
  const match = findRgdtCatalogMatch(catalog, {
    codigo: input.wasteCode,
    descripcion: input.wasteName,
    crtib: input.crtib,
  });
  if (!match) throw BadRequest("Código, nombre y CRTIB no coinciden con el catálogo RGDT");
  return {
    ...input,
    wasteCode: match.codigo,
    wasteName: match.descripcion,
    crtib: match.crtib,
  };
}

export async function rgdpPlanItemsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));

  app.get("/", async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    if (!(await canUserAccessPlan(planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
    return getPlanItems(planId, req.user!.role === "REPORTER" ? req.user!.sub : undefined);
  });

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { planId } = planParamsSchema.parse(req.params);
    const plan = await assertPlanOwnership(planId, req.user!.adminId);
    const body = itemCreate.parse(req.body);
    const input: RgdpPlanItemCreateInput = hasWasteFields(body)
      ? toCanonicalRgdpPlanItemInput(
          await validateCatalogWaste(wasteItemBase.parse(body)),
          plan.report_per
        )
      : { ...(body as RgdpPlanItemCreateInput), report_per: plan.report_per };
    const row = await createPlanItem(planId, input, req.user!.sub);
    reply.status(201);
    return row;
  });

  app.post("/bulk", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { planId } = planParamsSchema.parse(req.params);
    const plan = await assertPlanOwnership(planId, req.user!.adminId);
    const { items } = bulkSchema.parse(req.body);
    const normalized: RgdpPlanItemCreateInput[] = [];
    for (const item of items) {
      if (hasWasteFields(item)) {
        normalized.push(
          toCanonicalRgdpPlanItemInput(
            await validateCatalogWaste(wasteItemBase.parse(item)),
            plan.report_per
          )
        );
      } else {
        const legacyItem = item as z.infer<typeof legacyBulkItem>;
        normalized.push({
          ...legacyItem,
          report_per: plan.report_per,
        });
      }
    }
    const rows = await bulkCreatePlanItems(planId, normalized, req.user!.sub);
    reply.status(201);
    return { created: rows.length, failed: [], items: rows };
  });

  app.patch("/:itemId", { preHandler: requireRole("ADMIN", "REPORTER") }, async (req) => {
    const { planId, itemId } = itemParamsSchema.parse(req.params);
    const user = req.user!;
    if (user.role === "REPORTER") {
      const { observation } = z.object({ observation: z.string().max(10_000) }).strict().parse(req.body);
      return updatePlanItemObservation(itemId, planId, observation, user.sub);
    }

    const plan = await assertPlanOwnership(planId, user.adminId);
    const body = itemUpdate.parse(req.body);
    if (!hasWasteFields(body)) return updatePlanItem(itemId, planId, body, user.sub);

    const existing = await getPlanItemById(itemId);
    if (!existing || existing.planId !== planId) throw NotFound("Plan item not found");
    const merged = wasteItemBase.parse({
      wasteCode: body.wasteCode ?? existing.wasteCode,
      wasteName: body.wasteName ?? existing.wasteName,
      wasteDescription: body.wasteDescription ?? existing.wasteDescription ?? undefined,
      crtib: body.crtib ?? existing.crtib,
      annualGenerationKg:
        body.annualGenerationKg ??
        (existing.annualGenerationKg == null ? undefined : Number(existing.annualGenerationKg)),
      generationOrigin: body.generationOrigin ?? existing.generationOrigin,
      selfManagement: body.selfManagement ?? existing.selfManagement,
      observation: body.observation ?? existing.observation ?? undefined,
    });
    const normalized = toCanonicalRgdpPlanItemInput(
      await validateCatalogWaste(merged),
      plan.report_per
    );
    return updatePlanItem(itemId, planId, normalized, user.sub);
  });

  app.delete("/:itemId", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId, itemId } = itemParamsSchema.parse(req.params);
    await assertPlanOwnership(planId, req.user!.adminId);
    const deleted = await deletePlanItem(itemId, planId, req.user!.sub);
    return { ok: true, deleted };
  });

  // Assign / unassign a reporter to every item that shares a "direccion".
  app.post("/assign-direccion", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = assignDireccionSchema.parse(req.body);
    const assignment = await assignReporterToDireccion(
      planId,
      body.direccion,
      body.userId,
      body.category,
      req.user!.sub,
    );
    return { ok: true, assignment };
  });

  app.delete("/assign-direccion", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    await assertPlanOwnership(planId, req.user!.adminId);
    const body = unassignDireccionSchema.parse(req.body);
    const assignment = await unassignReporterFromDireccion(
      planId,
      body.direccion,
      body.userId,
      req.user!.sub,
    );
    return { ok: true, assignment };
  });
}
