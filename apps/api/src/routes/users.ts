import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../auth/middleware.js";
import {
  createUserGlobal,
  assignUserToApp,
  deleteManagedUser,
  deleteUserGlobal,
  resendInvitationGlobal,
  listManagedUsersForAdmin,
  updateManagedUser,
  type AppKey,
} from "../modules/shared/usersModule.js";
import { NotFound } from "../lib/errors.js";

const VALID_APPS: AppKey[] = ["pma", "rgdp", "geo"];

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["REPORTER", "VIEWER"]),
  unit: z.string().optional(),
  position: z.string().optional(),
  apps: z.array(z.enum(["pma", "rgdp", "geo"])).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  unit: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
});

const assignAppSchema = z.object({
  appKey: z.enum(["pma", "rgdp", "geo"]),
});

export async function usersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/", async (req) => {
    return listManagedUsersForAdmin(req.user!.adminId);
  });

  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    reply.status(201);
    return createUserGlobal({
      adminId: req.user!.adminId,
      name: body.name,
      email: body.email,
      role: body.role,
      unit: body.unit,
      position: body.position,
      apps: body.apps,
    });
  });

  app.put("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    await updateManagedUser(id, req.user!.adminId, body);
    return { ok: true };
  });

  app.delete("/:id", async (req) => {
    const { id } = req.params as { id: string };
    await deleteUserGlobal(id, req.user!.adminId);
    return { ok: true };
  });

  app.post("/:id/resend-invitation", async (req) => {
    const { id } = req.params as { id: string };
    await resendInvitationGlobal(id, req.user!.adminId);
    return { ok: true };
  });

  app.post("/:id/apps", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = assignAppSchema.parse(req.body);
    await assignUserToApp(id, req.user!.adminId, body.appKey);
    reply.status(201);
    return { ok: true };
  });

  app.delete("/:id/apps/:appKey", async (req) => {
    const { id, appKey } = req.params as { id: string; appKey: string };
    if (!VALID_APPS.includes(appKey as AppKey))
      throw NotFound("Aplicación no válida");
    await deleteManagedUser(id, req.user!.adminId, appKey as AppKey);
    return { ok: true };
  });
}
