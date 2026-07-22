import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import {
  createPlan, getPlansByAdmin, getPlansForReporter, getPlansForViewer,
  getPlanById, updatePlan, deletePlan, getAssignedUserIds, canUserAccessPlan,
  assignUserToPlan, unassignUserFromPlan,
} from "../../modules/rgdp/plansModule.js";
import { canUserAccessEvidence, getEvidencesByPlan } from "../../modules/rgdp/evidencesModule.js";
import { getReporterAssignedItemIds } from "../../modules/rgdp/planItemsModule.js";

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  .refine(isRealDate, "Fecha inválida");
const httpUrlSchema = z
  .string()
  .trim()
  .max(2_048)
  .url()
  .refine(isHttpUrl, "Solo se permiten URLs HTTP(S)");
const ciiuEntrySchema = z.object({
  code: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(5_000),
}).strict();
const ciiuSchema = z.object({
  principal: ciiuEntrySchema,
  complementary1: ciiuEntrySchema.optional(),
  complementary2: ciiuEntrySchema.optional(),
}).strict().refine((value) => {
  const codes = [value.principal.code, value.complementary1?.code, value.complementary2?.code]
    .filter((code): code is string => Boolean(code));
  return new Set(codes).size === codes.length;
}, "No se pueden repetir códigos CIIU");
const locationSchema = z.object({
  province: z.string().trim().min(1).max(200),
  canton: z.string().trim().min(1).max(200),
  parish: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(2_000).optional(),
}).strict();
const areaSchema = z.object({
  fileName: z.string().trim().min(1).max(255).optional(),
  pointsCount: z.number().int().nonnegative().max(10_000_000),
  areaM2: z.number().finite().nonnegative(),
  areaHa: z.number().finite().nonnegative(),
}).strict();

const planCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().min(25).max(2_500).optional(),
  report_per: z.enum(["6 meses", "1 año", "2 años"]).default("6 meses"),
  tipo: z.preprocess(emptyToUndefined, z.enum(["Licencia", "Registro Ambiental", "N/A"]).optional()),
  fase: z.preprocess(emptyToUndefined, z.enum(["Planificación", "Construcción", "Operación", "Cierre"]).optional()),
  enfoque: z.preprocess(
    emptyToUndefined,
    z.enum(["Prevenir impactos", "Controlar impactos", "Monitorear y optimizar", "Restaurar el ambiente"]).optional()
  ),
  start_date: z.preprocess(emptyToUndefined, dateOnlySchema.optional()),
  visualization_url: z.preprocess(emptyToUndefined, httpUrlSchema.optional()),
  location: locationSchema.optional(),
  ciiu: ciiuSchema.optional(),
  zoneType: z.enum(["Urbana", "Rural", "Maritima", "Fluvial"]).optional(),
  coordinateFormat: z.string().trim().min(1).max(200).optional(),
  geographicArea: areaSchema.optional(),
  implantationArea: areaSchema.optional(),
}).strict();
const planUpdateSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(2_500).optional(),
  report_per: z.enum(["6 meses", "1 año", "2 años"]).optional(),
  tipo: z.preprocess(emptyToNull, z.enum(["Licencia", "Registro Ambiental", "N/A"]).nullable().optional()),
  fase: z.preprocess(emptyToNull, z.enum(["Planificación", "Construcción", "Operación", "Cierre"]).nullable().optional()),
  enfoque: z.preprocess(
    emptyToNull,
    z.enum(["Prevenir impactos", "Controlar impactos", "Monitorear y optimizar", "Restaurar el ambiente"]).nullable().optional()
  ),
  start_date: z.preprocess(emptyToNull, dateOnlySchema.nullable().optional()),
  visualization_url: z.preprocess(emptyToNull, httpUrlSchema.nullable().optional()),
  location: locationSchema.nullable().optional(),
  ciiu: ciiuSchema.nullable().optional(),
  zoneType: z.enum(["Urbana", "Rural", "Maritima", "Fluvial"]).nullable().optional(),
  coordinateFormat: z.preprocess(
    emptyToNull,
    z.string().trim().min(1).max(200).nullable().optional()
  ),
  geographicArea: areaSchema.nullable().optional(),
  implantationArea: areaSchema.nullable().optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");
const assignSchema = z.object({ userId: z.string().uuid() }).strict();
const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

export async function rgdpPlansRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));

  app.get("/", async (req) => {
    const u = req.user!;
    if (u.role === "ADMIN") return getPlansByAdmin(u.adminId);
    if (u.role === "VIEWER") return getPlansForViewer(u.sub);
    return getPlansForReporter(u.sub);
  });

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const body = planCreateSchema.parse(req.body);
    const u = req.user!;
    const plan = await createPlan(u.sub, {
      title: body.title, description: body.description, reportPer: body.report_per,
      tipo: body.tipo, fase: body.fase, enfoque: body.enfoque,
      startDate: body.start_date, visualizationUrl: body.visualization_url,
      location: body.location, ciiu: body.ciiu, zoneType: body.zoneType,
      coordinateFormat: body.coordinateFormat,
      geographicArea: body.geographicArea, implantationArea: body.implantationArea,
    });
    reply.status(201);
    return plan;
  });

  app.get("/:id", async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const u = req.user!;
    if (!(await canUserAccessPlan(id, u))) throw Forbidden("No tienes acceso a este plan");
    const plan = await getPlanById(id);
    if (!plan) throw NotFound("Plan not found");
    const [allEvidences, allAssignedUsers, reporterItemIds] = await Promise.all([
      getEvidencesByPlan(id),
      getAssignedUserIds(id),
      u.role === "REPORTER" ? getReporterAssignedItemIds(id, u.sub) : Promise.resolve([]),
    ]);
    const allowedItemIds = new Set(reporterItemIds);
    const evidences = u.role === "REPORTER"
      ? (await Promise.all(allEvidences.map(async (evidence) => ({
          evidence,
          allowed: Boolean(
            evidence.planItemId &&
            allowedItemIds.has(evidence.planItemId) &&
            await canUserAccessEvidence(evidence, u)
          ),
        })))).filter((entry) => entry.allowed).map((entry) => entry.evidence)
      : allEvidences;
    const assignedUsers = u.role === "REPORTER" ? [] : allAssignedUsers;
    return { plan, evidences, assignedUsers };
  });

  app.put("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = planUpdateSchema.parse(req.body);
    return updatePlan(id, req.user!.sub, {
      title: body.title, description: body.description, reportPer: body.report_per,
      tipo: body.tipo, fase: body.fase, enfoque: body.enfoque,
      startDate: body.start_date, visualizationUrl: body.visualization_url,
      location: body.location, ciiu: body.ciiu, zoneType: body.zoneType,
      coordinateFormat: body.coordinateFormat,
      geographicArea: body.geographicArea, implantationArea: body.implantationArea,
    });
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const deleted = await deletePlan(id, req.user!.sub);
    return { ok: true, deleted };
  });

  app.post("/:id/assign", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const { userId } = assignSchema.parse(req.body);
    const assignment = await assignUserToPlan(id, userId, req.user!.sub);
    return { ok: true, assignment };
  });

  app.delete("/:id/assign", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const { userId } = assignSchema.parse(req.body);
    const assignment = await unassignUserFromPlan(id, userId, req.user!.sub);
    return { ok: true, assignment };
  });
}

function isRealDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function emptyToNull(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
