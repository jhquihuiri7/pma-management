import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest } from "../../lib/errors.js";
import {
  createEvidence,
  getEvidencesByPlan,
  getEvidencesByReporter,
  updateEvidenceValidation,
  deleteEvidence,
} from "../../modules/pma/evidencesModule.js";

const validationSchema = z.object({
  status: z.enum(["valid", "invalid", "pending"]),
  comment: z.string().optional(),
});

const queryListSchema = z.object({
  planId: z.string().uuid().optional(),
  mine: z.coerce.boolean().optional(),
});

const deleteQuerySchema = z.object({
  id: z.string().uuid(),
});

export async function pmaEvidencesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => {
    const q = queryListSchema.parse(req.query);
    if (q.planId) return getEvidencesByPlan(q.planId);
    if (q.mine) return getEvidencesByReporter(req.user!.sub);
    return [];
  });

  app.post("/", uploadPmaEvidence);

  app.delete("/", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = deleteQuerySchema.parse(req.query);
    await deleteEvidence(id, req.user!.adminId);
    return { ok: true };
  });

  app.put("/:id/validation", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = validationSchema.parse(req.body);
    const u = req.user!;
    return updateEvidenceValidation(id, body.status, u.adminId, u.sub, body.comment);
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    await deleteEvidence(id, req.user!.adminId);
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
