import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../auth/middleware.js";
import {
  createUserGlobal,
  assignUserToApp,
  deleteManagedUser,
  deleteUserGlobal,
  resendInvitationGlobal,
  listManagedUsers,
  updateManagedUser,
  type AppKey,
} from "../modules/shared/usersModule.js";
import { NotFound } from "../lib/errors.js";

const VALID_APPS: AppKey[] = ["pma", "rgdp", "geo", "previene"];
const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const appParamsSchema = z.object({
  id: z.string().uuid(),
  appKey: z.enum(["pma", "rgdp", "geo", "previene"]),
}).strict();

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email(),
  role: z.enum(["ADMIN", "REPORTER", "VIEWER"]),
  unit: z.string().trim().max(200).optional(),
  position: z.string().trim().max(200).optional(),
  apps: z.array(z.enum(["pma", "rgdp", "geo", "previene"])).max(4).optional(),
}).strict();

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  unit: z.string().trim().max(200).nullable().optional(),
  position: z.string().trim().max(200).nullable().optional(),
  role: z.enum(["ADMIN", "REPORTER", "VIEWER"]).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "Se requiere al menos un cambio");

const assignAppSchema = z.object({
  appKey: z.enum(["pma", "rgdp", "geo", "previene"]),
}).strict();

export async function usersRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireRole("ADMIN"));

  app.get("/", async () => {
    return listManagedUsers();
  });

  app.post("/", async (req, reply) => {
    const body = createSchema.parse(req.body);
    reply.status(201);
    return createUserGlobal(req.user!.sub, {
      name: body.name,
      email: body.email,
      role: body.role,
      unit: body.unit,
      position: body.position,
      apps: body.apps,
    });
  });

  app.put("/:id", async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = updateSchema.parse(req.body);
    return updateManagedUser(id, body, req.user!.sub);
  });

  app.delete("/:id", async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return deleteUserGlobal(id, req.user!.sub);
  });

  app.post("/:id/resend-invitation", async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return resendInvitationGlobal(id, req.user!.sub);
  });

  app.post("/:id/apps", async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const body = assignAppSchema.parse(req.body);
    const result = await assignUserToApp(id, body.appKey, req.user!.sub);
    reply.status(201);
    return result;
  });

  app.delete("/:id/apps/:appKey", async (req) => {
    const { id, appKey } = appParamsSchema.parse(req.params);
    if (!VALID_APPS.includes(appKey as AppKey))
      throw NotFound("Aplicación no válida");
    return deleteManagedUser(id, appKey as AppKey, req.user!.sub);
  });
}
