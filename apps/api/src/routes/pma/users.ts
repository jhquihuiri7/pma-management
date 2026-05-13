import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import {
  createManagedUser,
  resendInvitation,
  deleteManagedUser,
  listManagedUsersForAdmin,
} from "../../modules/shared/usersModule.js";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["REPORTER", "VIEWER"]),
  unit: z.string().optional(),
  position: z.string().optional(),
});

export async function pmaUsersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/", async (req) => {
    return listManagedUsersForAdmin(req.user!.adminId, "pma");
  });

  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const created = await createManagedUser({
      adminId: req.user!.adminId,
      name: body.name,
      email: body.email,
      role: body.role,
      unit: body.unit,
      position: body.position,
      app: "pma",
    });
    reply.status(201);
    return created;
  });

  app.post("/:id/resend-invitation", async (req) => {
    const { id } = req.params as { id: string };
    await resendInvitation(id, req.user!.adminId, "pma");
    return { ok: true };
  });

  app.delete("/:id", async (req) => {
    const { id } = req.params as { id: string };
    await deleteManagedUser(id, req.user!.adminId, "pma");
    return { ok: true };
  });
}
