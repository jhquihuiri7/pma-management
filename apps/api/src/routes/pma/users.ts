import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import {
  assignUserToApp,
  deleteManagedUser,
  resendInvitation,
  listManagedUsers,
} from "../../modules/shared/usersModule.js";

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

export async function pmaUsersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  // Listing is needed by VIEWERs to assign reporters/viewers to plans and items.
  // Managing users (assign-to-app, invitations, deletion) stays ADMIN-only.
  app.get("/", { preHandler: requireRole("ADMIN", "VIEWER") }, async () => {
    return listManagedUsers("pma");
  });

  app.post("/:id/assign", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const result = await assignUserToApp(id, "pma", req.user!.sub);
    reply.status(201);
    return result;
  });

  app.post("/:id/resend-invitation", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return resendInvitation(id, "pma", req.user!.sub);
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return deleteManagedUser(id, "pma", req.user!.sub);
  });
}
