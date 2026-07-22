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

export async function rgdpUsersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/", async () => {
    return listManagedUsers("rgdp");
  });

  app.post("/:id/assign", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const result = await assignUserToApp(id, "rgdp", req.user!.sub);
    reply.status(201);
    return result;
  });

  app.post("/:id/resend-invitation", async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return resendInvitation(id, "rgdp", req.user!.sub);
  });

  app.delete("/:id", async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return deleteManagedUser(id, "rgdp", req.user!.sub);
  });
}
