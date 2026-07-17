import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import {
  createEvidence,
  getEvidencesByPlan,
  getEvidencesByReporter,
  getEvidenceById,
  updateEvidenceValidation,
  deleteEvidence,
} from "../../modules/pma/evidencesModule.js";
import { canUserAccessPlan } from "../../modules/pma/plansModule.js";

const validationSchema = z.object({
  status: z.enum(["valid", "invalid", "pending"]),
  comment: z.string().optional(),
});

const legacyValidationSchema = z.object({
  validationStatus: z.enum(["valid", "invalid", "pending"]),
  validationComment: z.string().optional(),
});

const queryListSchema = z.object({
  planId: z.string().uuid().optional(),
  mine: z.coerce.boolean().optional(),
});

const evidenceIdQuerySchema = z.object({
  id: z.string().uuid(),
});

const deleteQuerySchema = z.object({
  id: z.string().uuid(),
});

export async function pmaEvidencesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => {
    const q = queryListSchema.parse(req.query);
    if (q.planId) {
      if (!(await canUserAccessPlan(q.planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
      return getEvidencesByPlan(q.planId);
    }
    if (q.mine) return getEvidencesByReporter(req.user!.sub);
    return [];
  });

  app.post("/", uploadPmaEvidence);

  // Any role (ADMIN/VIEWER/REPORTER) may delete an evidence on a plan they can access.
  app.delete("/", async (req) => {
    const { id } = deleteQuerySchema.parse(req.query);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessPlan(evidence.planId, u))) throw Forbidden("No tienes acceso a este plan");
    await deleteEvidence(id, u.adminId);
    return { ok: true };
  });

  app.patch("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = evidenceIdQuerySchema.parse(req.query);
    const body = legacyValidationSchema.parse(req.body);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessPlan(evidence.planId, u))) throw Forbidden("No tienes acceso a este plan");
    return updateEvidenceValidation(id, body.validationStatus, u.adminId, u.sub, body.validationComment);
  });

  app.put("/:id/validation", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = validationSchema.parse(req.body);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    // ADMINs pass through; non-admins (e.g. VIEWER) must be assigned to the plan.
    if (!(await canUserAccessPlan(evidence.planId, u))) throw Forbidden("No tienes acceso a este plan");
    return updateEvidenceValidation(id, body.status, u.adminId, u.sub, body.comment);
  });

  // Any role (ADMIN/VIEWER/REPORTER) may delete an evidence on a plan they can access.
  app.delete("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessPlan(evidence.planId, u))) throw Forbidden("No tienes acceso a este plan");
    await deleteEvidence(id, u.adminId);
    return { ok: true };
  });
}

export async function uploadPmaEvidence(req: FastifyRequest, reply: FastifyReply) {
  const u = req.user!;
  const data = await req.file();
  if (!data) throw BadRequest("file required (multipart/form-data)");
  const buf = await data.toBuffer();
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.fields)) {
    const f: any = v;
    if (f && typeof f === "object" && "value" in f) fields[k] = f.value as string;
  }
  if (!fields.planId) throw BadRequest("planId required");
  // Anyone (ADMIN/REPORTER/VIEWER) may upload, but only to a plan they can access.
  if (!(await canUserAccessPlan(fields.planId, u))) throw Forbidden("No tienes acceso a este plan");
  const ev = await createEvidence(u.adminId, {
    planId: fields.planId,
    planItemId: fields.planItemId || undefined,
    uploadedBy: u.sub,
    uploaderName: u.name,
    fileName: data.filename,
    description: fields.description ?? "",
    activityMonth: fields.activityMonth || undefined,
    data: buf,
    contentType: data.mimetype,
  });
  reply.status(201);
  return ev;
}
