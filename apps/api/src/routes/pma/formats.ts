import type { FastifyInstance } from "fastify";
import { BadRequest } from "../../lib/errors.js";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import {
  uploadFormat,
  listFormats,
  deleteFormat,
} from "../../modules/pma/formatsModule.js";

export async function pmaFormatsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => listFormats(req.user!.adminId));

  app.post("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw BadRequest("file required");
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(file.fields)) {
      const f: any = v;
      if (f && typeof f === "object" && "value" in f) fields[k] = f.value as string;
    }
    if (!fields.functionality || !fields.functionalityLabel)
      throw BadRequest("functionality and functionalityLabel required");
    const buf = await file.toBuffer();
    const row = await uploadFormat({
      adminId: req.user!.adminId,
      functionality: "descargar_anexos",
      functionalityLabel: fields.functionalityLabel,
      fileName: file.filename,
      data: buf,
      contentType: file.mimetype,
    });
    reply.status(201);
    return row;
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    await deleteFormat(id, req.user!.adminId);
    return { ok: true };
  });
}
