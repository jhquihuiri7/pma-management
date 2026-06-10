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

  // Listing is needed by VIEWERs to assign reporters/viewers to plans and items.
  // Managing users (assign-to-app, invitations, deletion) stays ADMIN-only.
  app.get("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async () => {
    return listManagedUsers("pma");
  });

  app.post("/:id/assign", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await assignUserToApp(id, "pma");
    reply.status(201);
    return { ok: true };
  });

  app.post("/:id/resend-invitation", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    await resendInvitation(id, "pma");
    return { ok: true };
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    await deleteManagedUser(id, "pma");
    return { ok: true };
  });
}
