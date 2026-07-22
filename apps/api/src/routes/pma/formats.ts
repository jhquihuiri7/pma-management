import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import {
  uploadFormat,
  listFormats,
  deleteFormat,
} from "../../modules/pma/formatsModule.js";
import { readFormatUpload } from "../../modules/shared/formatContract.js";

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

export async function pmaFormatsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/", async (req) => listFormats(req.user!.adminId));

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const upload = await readFormatUpload(req);
    const row = await uploadFormat({
      actorId: req.user!.sub,
      ...upload,
    });
    reply.status(201);
    return row;
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const deleted = await deleteFormat(id, req.user!.sub);
    return { ok: true, deleted };
  });
}
