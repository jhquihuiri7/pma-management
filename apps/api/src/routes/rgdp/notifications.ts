import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireApp } from "../../auth/middleware.js";
import { getNotificationsForUser, markNotificationAsRead } from "../../modules/rgdp/notificationsModule.js";

const idParams = z.object({ id: z.string().uuid() }).strict();

export async function rgdpNotificationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));

  app.get("/", async (req) => {
    const u = req.user!;
    return getNotificationsForUser(u.sub, u.adminId);
  });

  app.post("/:id/read", async (req) => {
    const { id } = idParams.parse(req.params);
    const u = req.user!;
    await markNotificationAsRead(id, u.sub, u.adminId);
    return { ok: true };
  });
}
