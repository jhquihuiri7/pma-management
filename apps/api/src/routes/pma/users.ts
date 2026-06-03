import type { FastifyInstance } from "fastify";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import {
  assignUserToApp,
  deleteManagedUser,
  resendInvitation,
  listManagedUsers,
} from "../../modules/shared/usersModule.js";

export async function pmaUsersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/", async () => {
    return listManagedUsers("pma");
  });

  app.post("/:id/assign", async (req, reply) => {
    const { id } = req.params as { id: string };
    await assignUserToApp(id, "pma");
    reply.status(201);
    return { ok: true };
  });

  app.post("/:id/resend-invitation", async (req) => {
    const { id } = req.params as { id: string };
    await resendInvitation(id, "pma");
    return { ok: true };
  });

  app.delete("/:id", async (req) => {
    const { id } = req.params as { id: string };
    await deleteManagedUser(id, "pma");
    return { ok: true };
  });
}
