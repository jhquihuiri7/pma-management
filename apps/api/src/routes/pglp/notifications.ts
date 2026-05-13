import type { FastifyInstance } from "fastify";
import { authenticate, requireApp } from "../../auth/middleware.js";
import { getNotificationsForUser, markNotificationAsRead } from "../../modules/pglp/notificationsModule.js";

export async function pglpNotificationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pglp"));

  app.get("/", async (req) => {
    const u = req.user!;
    return getNotificationsForUser(u.sub, u.adminId);
  });

  app.post("/:id/read", async (req) => {
    const { id } = req.params as { id: string };
    const u = req.user!;
    await markNotificationAsRead(id, u.sub, u.adminId);
    return { ok: true };
  });
}
