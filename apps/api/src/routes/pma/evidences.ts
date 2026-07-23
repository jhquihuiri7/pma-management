import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
// Taken from the pg enum rather than @pma/types: that package ships raw
// TypeScript (its `main` is src/index.ts), so a value import survives
// compilation and crashes the production build on an unknown ".ts" extension.
// Only `import type` is safe from it. This also pins validation to the column.
import { evidenceTypeEnum } from "../../db/schema/enums.js";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import {
  createEvidence,
  getEvidencesByPlan,
  getEvidencesByReporter,
  getEvidencesForUser,
  getEvidenceById,
  updateEvidenceValidation,
  updateEvidenceDetails,
  deleteEvidence,
  canUserAccessEvidence,
  canUserUploadEvidence,
} from "../../modules/pma/evidencesModule.js";
import { canUserAccessPlan } from "../../modules/pma/plansModule.js";

const validationSchema = z.object({
  status: z.enum(["valid", "invalid", "pending"]),
  comment: z.string().max(10_000).optional(),
}).strict().superRefine((body, context) => {
  if (body.status === "invalid" && !body.comment?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["comment"], message: "El motivo de rechazo es obligatorio" });
  }
});

const legacyValidationSchema = z.object({
  validationStatus: z.enum(["valid", "invalid", "pending"]),
  validationComment: z.string().max(10_000).optional(),
}).strict().superRefine((body, context) => {
  if (body.validationStatus === "invalid" && !body.validationComment?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["validationComment"], message: "El motivo de rechazo es obligatorio" });
  }
});

// activityMonth is not editable: it is part of the storage path's period folder.
const detailsUpdateSchema = z.object({
  description: z.string().max(10_000).optional(),
  evidenceType: z.enum(evidenceTypeEnum.enumValues).optional(),
}).strict().refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: "Debes enviar al menos un campo para actualizar" }
);

const queryListSchema = z.object({
  planId: z.string().uuid().optional(),
  mine: z.preprocess(
    (value) => value === undefined ? undefined : value === true || value === "true" || value === "1",
    z.boolean().optional()
  ),
}).strict();

const evidenceIdQuerySchema = z.object({
  id: z.string().uuid(),
}).strict();

const deleteQuerySchema = z.object({
  id: z.string().uuid(),
}).strict();

const evidenceParamsSchema = z.object({ id: z.string().uuid() }).strict();

const optionalMultipartUuid = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().uuid().optional()
);

const uploadFieldsSchema = z.object({
  planId: z.string().uuid(),
  planItemId: optionalMultipartUuid,
  description: z.string().max(10_000).default(""),
  evidenceType: z.enum(evidenceTypeEnum.enumValues),
  activityMonth: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()
  ),
}).strict();

// The UI advertises a 10 MB evidence limit. Applying it here keeps the
// contract honest and bounds the memory used by `toBuffer()` under concurrency.
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

export async function pmaEvidencesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => {
    const q = queryListSchema.parse(req.query);
    if (q.planId) {
      if (!(await canUserAccessPlan(q.planId, req.user!))) throw Forbidden("No tienes acceso a este plan");
      const evidences = await getEvidencesByPlan(q.planId);
      const allowed = await Promise.all(evidences.map((evidence) => canUserAccessEvidence(evidence, req.user!)));
      return evidences.filter((_, index) => allowed[index]);
    }
    if (q.mine) return getEvidencesByReporter(req.user!.sub);
    return getEvidencesForUser(req.user!);
  });

  app.post("/", { preHandler: requireRole("ADMIN", "REPORTER", "VIEWER") }, uploadPmaEvidence);

  // Deletion is scoped by canUserAccessEvidence: ADMINs delete any evidence,
  // REPORTERs their own uploads, and VIEWERs evidence within their assigned plans.
  app.delete("/", { preHandler: requireRole("ADMIN", "REPORTER", "VIEWER") }, async (req) => {
    const { id } = deleteQuerySchema.parse(req.query);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(evidence, u, "delete"))) throw Forbidden("No tienes acceso a esta evidencia");
    await deleteEvidence(id, u.sub);
    return { ok: true };
  });

  app.patch("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = evidenceIdQuerySchema.parse(req.query);
    const body = legacyValidationSchema.parse(req.body);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(evidence, u, "validate"))) throw Forbidden("No tienes acceso a esta evidencia");
    return updateEvidenceValidation(id, body.validationStatus, u.adminId, u.sub, body.validationComment);
  });

  app.put("/:id/validation", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req) => {
    const { id } = evidenceParamsSchema.parse(req.params);
    const body = validationSchema.parse(req.body);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    // ADMINs pass through; non-admins (e.g. VIEWER) must be assigned to the plan.
    if (!(await canUserAccessEvidence(evidence, u, "validate"))) throw Forbidden("No tienes acceso a esta evidencia");
    return updateEvidenceValidation(id, body.status, u.adminId, u.sub, body.comment);
  });

  // Editing metadata is scoped like deletion: ADMINs any evidence, REPORTERs
  // their own uploads, VIEWERs evidence within their assigned plans.
  app.patch("/:id", { preHandler: requireRole("ADMIN", "REPORTER", "VIEWER") }, async (req) => {
    const { id } = evidenceParamsSchema.parse(req.params);
    const body = detailsUpdateSchema.parse(req.body);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(evidence, u, "edit"))) {
      throw Forbidden("No tienes acceso a esta evidencia");
    }
    return updateEvidenceDetails(id, u.sub, body);
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN", "REPORTER", "VIEWER") }, async (req) => {
    const { id } = evidenceParamsSchema.parse(req.params);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(evidence, u, "delete"))) throw Forbidden("No tienes acceso a esta evidencia");
    await deleteEvidence(id, u.sub);
    return { ok: true };
  });
}

export async function uploadPmaEvidence(req: FastifyRequest, reply: FastifyReply) {
  const u = req.user!;
  // Defense in depth for future aliases that reuse this exported handler.
  // Reject before parsing multipart so disallowed callers cannot consume the
  // upload memory budget.
  if (u.role !== "ADMIN" && u.role !== "REPORTER" && u.role !== "VIEWER") {
    throw Forbidden("No tienes permiso para subir evidencias");
  }
  const data = await req.file({
    limits: {
      fileSize: EVIDENCE_MAX_BYTES,
      files: 1,
      // planId, planItemId, description, evidenceType, activityMonth (+ the file).
      fields: 5,
      parts: 6,
      fieldSize: 20_000,
    },
  });
  if (!data) throw BadRequest("file required (multipart/form-data)");
  const buf = await data.toBuffer();
  if (buf.byteLength === 0) throw BadRequest("El archivo de evidencia está vacío");
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(data.fields)) {
    if (Array.isArray(v)) throw BadRequest(`El campo multipart ${k} está duplicado`);
    const f = v as { type?: string; value?: unknown; valueTruncated?: boolean } | undefined;
    if (!f || f.type !== "field") continue;
    if (f.valueTruncated) throw BadRequest(`El campo multipart ${k} excede el tamaño permitido`);
    if (typeof f.value !== "string") throw BadRequest(`El campo multipart ${k} debe ser texto`);
    fields[k] = f.value;
  }
  const parsed = uploadFieldsSchema.parse(fields);
  z.string().trim().min(1).max(255).parse(data.filename);
  if (!(await canUserUploadEvidence(parsed.planId, parsed.planItemId, u))) {
    throw Forbidden("No tienes acceso al plan o ítem solicitado");
  }
  const ev = await createEvidence(u.adminId, {
    planId: parsed.planId,
    planItemId: parsed.planItemId,
    uploadedBy: u.sub,
    uploaderName: u.name,
    fileName: data.filename,
    description: parsed.description,
    evidenceType: parsed.evidenceType,
    activityMonth: parsed.activityMonth,
    data: buf,
    contentType: data.mimetype,
  });
  reply.status(201);
  return ev;
}
