import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import {
  createManagedUser, resendInvitation, deleteManagedUser, listManagedUsersForAdmin,
} from "../../modules/shared/usersModule.js";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["REPORTER", "VIEWER"]),
  unit: z.string().optional(),
  position: z.string().optional(),
});

export async function pglpUsersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pglp"));
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/", async (req) => listManagedUsersForAdmin(req.user!.adminId, "pglp"));

  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    reply.status(201);
    return createManagedUser({ adminId: req.user!.adminId, ...body, app: "pglp" });
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
