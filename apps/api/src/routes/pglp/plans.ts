import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, requireApp } from "../../auth/middleware.js";
import { BadRequest, Unauthorized } from "../../lib/errors.js";
import {
  createPlan, getPlansByAdmin, getPlansForReporter, getPlansForViewer,
  getPlanById, updatePlan, deletePlan,
} from "../../modules/pglp/plansModule.js";

const planCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  report_per: z.enum(["6 meses", "1 año", "2 años"]).default("6 meses"),
  tipo: z.enum(["Licencia", "Registro Ambiental", "N/A"]).optional(),
  fase: z.enum(["Planificación", "Construcción", "Operación", "Cierre"]).optional(),
  enfoque: z.enum(["Prevenir impactos", "Controlar impactos", "Monitorear y optimizar", "Restaurar el ambiente"]).optional(),
  start_date: z.string().optional(),
  visualization_url: z.string().optional(),
  location: z.unknown().optional(),
  ciiu: z.unknown().optional(),
  zoneType: z.enum(["Urbana", "Rural", "Maritima", "Fluvial"]).optional(),
  coordinateFormat: z.string().optional(),
  geographicArea: z.unknown().optional(),
  implantationArea: z.unknown().optional(),
});
const planUpdateSchema = planCreateSchema.partial();

export async function pglpPlansRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pglp"));

  app.get("/", async (req) => {
    const u = req.user!;
    if (u.role === "ADMIN") return getPlansByAdmin(u.adminId);
    if (u.role === "VIEWER") return getPlansForViewer(u.sub);
    return getPlansForReporter(u.sub);
  });

  app.post("/", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const body = planCreateSchema.parse(req.body);
    const u = req.user!;
    const plan = await createPlan(u.adminId, {
      title: body.title, description: body.description, reportPer: body.report_per,
      tipo: body.tipo, fase: body.fase, enfoque: body.enfoque,
      startDate: body.start_date, visualizationUrl: body.visualization_url,
      location: body.location, ciiu: body.ciiu, zoneType: body.zoneType,
      coordinateFormat: body.coordinateFormat,
      geographicArea: body.geographicArea, implantationArea: body.implantationArea,
    });
    reply.status(201);
    return plan;
  });

  app.get("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const plan = await getPlanById(id);
    if (!plan) throw BadRequest("Plan not found");
    const u = req.user!;
    if (u.role === "ADMIN" && plan.adminId !== u.adminId) throw Unauthorized();
    return plan;
  });

  app.put("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = planUpdateSchema.parse(req.body);
    return updatePlan(id, req.user!.adminId, {
      title: body.title, description: body.description, reportPer: body.report_per,
      tipo: body.tipo, fase: body.fase, enfoque: body.enfoque,
      startDate: body.start_date, visualizationUrl: body.visualization_url,
      location: body.location, ciiu: body.ciiu, zoneType: body.zoneType,
      coordinateFormat: body.coordinateFormat,
      geographicArea: body.geographicArea, implantationArea: body.implantationArea,
    });
  });

  app.delete("/:id", { preHandler: requireRole("ADMIN") }, async (req) => {
    const { id } = req.params as { id: string };
    await deletePlan(id, req.user!.adminId);
    return { ok: true };
  });
}
