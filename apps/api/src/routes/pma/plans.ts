import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest, Forbidden } from "../../lib/errors.js";
import {
  createPlan,
  getPlansByAdmin,
  getPlansForReporter,
  getPlansForViewer,
  getPlanById,
  updatePlan,
  deletePlan,
  getAssignedUserIds,
  canUserAccessPlan,
  assignUserToPlan,
  unassignUserFromPlan,
} from "../../modules/pma/plansModule.js";
import { canUserAccessEvidence, getEvidencesByPlan } from "../../modules/pma/evidencesModule.js";
import { getFindingsByPlan } from "../../modules/pma/findingsModule.js";

export const planCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).optional(),
  report_per: z.enum(["6 meses", "1 año", "2 años"]).default("6 meses"),
  tipo: z.preprocess(emptyToUndefined, z.enum(["Licencia", "Registro Ambiental", "N/A"]).optional()),
  fase: z.preprocess(emptyToUndefined, z.enum(["Planificación", "Construcción", "Operación", "Cierre"]).optional()),
  enfoque: z.preprocess(
    emptyToUndefined,
    z.enum(["Prevenir impactos", "Controlar impactos", "Monitorear y optimizar", "Restaurar el ambiente"]).optional(),
  ),
  // Required, and immutable afterwards (see assertScheduleFieldsNotEdited): it
  // is the origin of the whole schedule, so leaving it out would anchor the plan
  // to its creation timestamp with no way to correct it later.
  start_date: z.preprocess(
    emptyToUndefined,
    z
      .string({ required_error: "La fecha de inicio es obligatoria: define el cronograma del plan y no se puede cambiar después de crearlo" })
      .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
      .refine(isRealDate, "Fecha inválida"),
  ),
  visualization_url: z.preprocess(
    emptyToUndefined,
    z.string().url().refine(isHttpUrl, "Solo se permiten URLs HTTP(S)").optional(),
  ),
});

export const planUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20_000).optional(),
  tipo: z.preprocess(emptyToNull, z.enum(["Licencia", "Registro Ambiental", "N/A"]).nullable().optional()),
  fase: z.preprocess(emptyToNull, z.enum(["Planificación", "Construcción", "Operación", "Cierre"]).nullable().optional()),
  enfoque: z.preprocess(
    emptyToNull,
    z.enum(["Prevenir impactos", "Controlar impactos", "Monitorear y optimizar", "Restaurar el ambiente"]).nullable().optional(),
  ),
  // `start_date` is absent on purpose. It is the origin of every derived
  // schedule — reporting-period blocks, item evidence ranges, deadline months
  // and the months that accept an upload — so moving it after creation
  // silently reshapes the plan's calendar and strands the compliance rows keyed
  // to the old grid. It is set once, at creation.
  visualization_url: z.preprocess(
    emptyToNull,
    z.string().url().refine(isHttpUrl, "Solo se permiten URLs HTTP(S)").nullable().optional(),
  ),
}).refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");

const assignSchema = z.object({
  userId: z.string().uuid(),
});
const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Refuse an attempt to edit either field that defines a plan's schedule grid.
 *
 * `start_date` is the origin of that grid and `report_per` its block width.
 * Between them they determine the reporting-period keys stored in
 * `pma_period_compliance`, every item's evidence ranges and deadline months,
 * which months accept an upload, and — through `getActivityPeriodFolder` — the
 * storage folder each evidence file is written to. Moving either one after
 * creation reshapes the grid underneath rows and files already laid out on the
 * old one: compliance rows strand on blocks that no longer exist, and new
 * evidence lands in folders that no longer match the old.
 *
 * `planUpdateSchema` no longer declares either field, and Zod strips unknown
 * keys without a word — which would leave a caller believing the change was
 * stored. Naming the refusal is the point.
 *
 * Exported so the refusal is testable without standing up auth and a database.
 */
const IMMUTABLE_SCHEDULE_FIELDS: Record<string, string> = {
  start_date: "La fecha de inicio",
  report_per: "El periodo de reporte",
};

export function assertScheduleFieldsNotEdited(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const offending = Object.keys(IMMUTABLE_SCHEDULE_FIELDS).filter((field) => field in body);
  if (offending.length === 0) return;
  const names = offending.map((field) => IMMUTABLE_SCHEDULE_FIELDS[field]).join(" y ");
  throw BadRequest(
    `${names} no se puede modificar después de crear el plan: define el cronograma, los periodos de reporte, los meses límite de todos los ítems y la carpeta donde se archivan las evidencias`,
  );
}

export async function pmaPlansRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

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
      title: body.title,
      description: body.description,
      reportPer: body.report_per,
      tipo: body.tipo,
      fase: body.fase,
      enfoque: body.enfoque,
      startDate: body.start_date,
      visualizationUrl: body.visualization_url,
    });
    reply.status(201);
    return plan;
  });

  app.get("/:id", async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const u = req.user!;
    if (!(await canUserAccessPlan(id, u))) throw Forbidden("No tienes acceso a este plan");
    const plan = await getPlanById(id);
    if (!plan) throw BadRequest("Plan not found");
    const [allEvidences, allFindings, allAssignedUsers] = await Promise.all([
      getEvidencesByPlan(id),
      getFindingsByPlan(id),
      getAssignedUserIds(id),
    ]);
    const evidences = u.role === "REPORTER"
      ? (await Promise.all(allEvidences.map(async (evidence) => ({
        evidence,
        allowed: await canUserAccessEvidence(evidence, u),
      })))).filter((entry) => entry.allowed).map((entry) => entry.evidence)
      : allEvidences;
    const findings = u.role === "REPORTER" ? [] : allFindings;
    const assignedUsers = u.role === "REPORTER" ? [] : allAssignedUsers;
    return { plan, evidences, findings, assignedUsers };
  });

  app.put("/:id", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    assertScheduleFieldsNotEdited(req.body);
    const body = planUpdateSchema.parse(req.body);
    const u = req.user!;
    // ADMINs pass through; non-admins (e.g. VIEWER) must be assigned to the plan.
    if (!(await canUserAccessPlan(id, u))) throw Forbidden("No tienes acceso a este plan");
    return updatePlan(id, u.sub, {
      title: body.title,
      description: body.description,
      tipo: body.tipo,
      fase: body.fase,
      enfoque: body.enfoque,
      visualizationUrl: body.visualization_url,
    });
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const u = req.user!;
    await deletePlan(id, u.sub);
    return { ok: true };
  });

  app.post("/:id/assign", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = assignSchema.parse(req.body);
    const u = req.user!;
    if (!(await canUserAccessPlan(id, u))) throw Forbidden("No tienes acceso a este plan");
    await assignUserToPlan(id, body.userId, u.sub);
    return { ok: true };
  });

  app.delete("/:id/assign", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = assignSchema.parse(req.body);
    const u = req.user!;
    if (!(await canUserAccessPlan(id, u))) throw Forbidden("No tienes acceso a este plan");
    await unassignUserFromPlan(id, body.userId, u.sub);
    return { ok: true };
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
