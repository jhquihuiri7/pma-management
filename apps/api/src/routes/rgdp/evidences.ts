import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import {
  createEvidence, getEvidencesByPlan, getEvidencesByReporter, getEvidencesForUser,
  getEvidenceById, updateEvidenceValidation, deleteEvidence,
  canUserAccessEvidence, canUserUploadEvidence,
} from "../../modules/rgdp/evidencesModule.js";
import { canUserAccessPlan } from "../../modules/rgdp/plansModule.js";

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
  activityMonth: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()
  ),
}).strict();

// The UI advertises a 10 MB evidence limit. Applying it here keeps the
// contract honest and bounds the memory used by `toBuffer()` under concurrency.
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

export async function rgdpEvidencesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));

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

  app.post("/", { preHandler: requireRole("ADMIN", "REPORTER") }, uploadRgdpEvidence);

  app.delete("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = deleteQuerySchema.parse(req.query);
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(evidence, req.user!, "delete"))) throw Forbidden("No tienes acceso a esta evidencia");
    const deleted = await deleteEvidence(id, req.user!.sub);
    return { ok: true, deleted };
  });

  app.patch("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = evidenceIdQuerySchema.parse(req.query);
    const body = legacyValidationSchema.parse(req.body);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(evidence, u, "validate"))) throw Forbidden("No tienes acceso a esta evidencia");
    return updateEvidenceValidation(id, body.validationStatus, u.adminId, u.sub, body.validationComment);
  });

  app.put("/:id/validation", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = evidenceParamsSchema.parse(req.params);
    const body = validationSchema.parse(req.body);
    const u = req.user!;
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(evidence, u, "validate"))) throw Forbidden("No tienes acceso a esta evidencia");
    return updateEvidenceValidation(id, body.status, u.adminId, u.sub, body.comment);
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = evidenceParamsSchema.parse(req.params);
    const evidence = await getEvidenceById(id);
    if (!evidence) throw NotFound("Evidence not found");
    if (!(await canUserAccessEvidence(evidence, req.user!, "delete"))) throw Forbidden("No tienes acceso a esta evidencia");
    const deleted = await deleteEvidence(id, req.user!.sub);
    return { ok: true, deleted };
  });
}

export async function uploadRgdpEvidence(req: FastifyRequest, reply: FastifyReply) {
  const u = req.user!;
  // Defense in depth for aliases or future registrations of this exported
  // handler: reject disallowed roles before parsing/buffering multipart data.
  if (u.role !== "ADMIN" && u.role !== "REPORTER") {
    throw Forbidden("Solo administradores y reporteros pueden subir evidencias");
  }
  const data = await req.file({
    limits: {
      fileSize: EVIDENCE_MAX_BYTES,
      files: 1,
      fields: 4,
      parts: 5,
      fieldSize: 20_000,
    },
  });
  if (!data) throw BadRequest("file required");
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
    activityMonth: parsed.activityMonth,
    data: buf,
    contentType: data.mimetype,
  });
  reply.status(201);
  return ev;
}
