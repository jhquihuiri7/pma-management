import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import {
  createMap, listMaps, getMapById, updateMap, deleteMap,
} from "../../modules/geo/mapsModule.js";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  categoryId: z.string().min(1),
  arcgisUrl: z.string().optional(),
  layers: z.array(z.unknown()).optional(),
  center: z.tuple([z.number(), z.number()]).optional(),
  zoom: z.number().int().min(0).max(22).optional(),
  tags: z.array(z.string()).optional(),
});
const updateSchema = createSchema.partial();

export async function geoRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("geo"));

  app.get("/maps", async (req) => listMaps(req.user!.adminId));

  app.get("/maps/:id", async (req) => {
    const { id } = req.params as { id: string };
    return getMapById(id, req.user!.adminId);
  });

  app.post("/maps", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    reply.status(201);
    return createMap(req.user!.adminId, req.user!.sub, body);
  });

  app.put("/maps/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    return updateMap(id, req.user!.adminId, body);
  });

  app.delete("/maps/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    await deleteMap(id, req.user!.adminId);
    return { ok: true };
  });
}
