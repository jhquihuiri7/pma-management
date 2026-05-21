import type { FastifyInstance } from "fastify";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import {
  assignUserToApp,
  deleteManagedUser,
  resendInvitation,
  listManagedUsersForAdmin,
} from "../../modules/shared/usersModule.js";

export async function pglpUsersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pglp"));
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/", async (req) => {
    return listManagedUsersForAdmin(req.user!.adminId, "pglp");
  });

  app.post("/:id/assign", async (req, reply) => {
    const { id } = req.params as { id: string };
    await assignUserToApp(id, req.user!.adminId, "pglp");
    reply.status(201);
    return { ok: true };
  });

  app.post("/:id/resend-invitation", async (req) => {
    const { id } = req.params as { id: string };
    await resendInvitation(id, req.user!.adminId, "pglp");
    return { ok: true };
  });

  app.delete("/:id", async (req) => {
    const { id } = req.params as { id: string };
    await deleteManagedUser(id, req.user!.adminId, "pglp");
    return { ok: true };
  });
}
