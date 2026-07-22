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

const planCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).optional(),
  report_per: z.enum(["6 meses", "1 año", "2 años"]).default("6 meses"),
  tipo: z.preprocess(emptyToUndefined, z.enum(["Licencia", "Registro Ambiental", "N/A"]).optional()),
  fase: z.preprocess(emptyToUndefined, z.enum(["Planificación", "Construcción", "Operación", "Cierre"]).optional()),
  enfoque: z.preprocess(
    emptyToUndefined,
    z.enum(["Prevenir impactos", "Controlar impactos", "Monitorear y optimizar", "Restaurar el ambiente"]).optional(),
  ),
  start_date: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine(isRealDate, "Fecha inválida").optional(),
  ),
  visualization_url: z.preprocess(
    emptyToUndefined,
    z.string().url().refine(isHttpUrl, "Solo se permiten URLs HTTP(S)").optional(),
  ),
});

const planUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20_000).optional(),
  report_per: z.enum(["6 meses", "1 año", "2 años"]).optional(),
  tipo: z.preprocess(emptyToNull, z.enum(["Licencia", "Registro Ambiental", "N/A"]).nullable().optional()),
  fase: z.preprocess(emptyToNull, z.enum(["Planificación", "Construcción", "Operación", "Cierre"]).nullable().optional()),
  enfoque: z.preprocess(
    emptyToNull,
    z.enum(["Prevenir impactos", "Controlar impactos", "Monitorear y optimizar", "Restaurar el ambiente"]).nullable().optional(),
  ),
  start_date: z.preprocess(
    emptyToNull,
    z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine(isRealDate, "Fecha inválida").nullable().optional(),
  ),
  visualization_url: z.preprocess(
    emptyToNull,
    z.string().url().refine(isHttpUrl, "Solo se permiten URLs HTTP(S)").nullable().optional(),
  ),
}).refine((body) => Object.keys(body).length > 0, "Debes enviar al menos un campo");

const assignSchema = z.object({
  userId: z.string().uuid(),
});
const idParamsSchema = z.object({ id: z.string().uuid() });

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
    const body = planUpdateSchema.parse(req.body);
    const u = req.user!;
    // ADMINs pass through; non-admins (e.g. VIEWER) must be assigned to the plan.
    if (!(await canUserAccessPlan(id, u))) throw Forbidden("No tienes acceso a este plan");
    return updatePlan(id, u.sub, {
      title: body.title,
      description: body.description,
      reportPer: body.report_per,
      tipo: body.tipo,
      fase: body.fase,
      enfoque: body.enfoque,
      startDate: body.start_date,
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
