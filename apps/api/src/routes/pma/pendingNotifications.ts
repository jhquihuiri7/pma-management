import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  getPendingByReporter,
  sendPendingNotifications,
} from "../../modules/pma/pendingNotificationsModule.js";

const planParamsSchema = z.object({ planId: z.string().uuid() }).strict();

const listQuerySchema = z
  .object({ periodKey: z.string().trim().min(1).max(100).optional() })
  .strict();

const sendSchema = z
  .object({
    periodKey: z.string().trim().min(1).max(100),
    reporterIds: z.array(z.string().uuid()).min(1).max(200),
    ccUserIds: z.array(z.string().uuid()).max(50).default([]),
    subject: z.string().trim().min(1).max(MAX_SUBJECT_LENGTH),
    // The operator writes this; an empty message is allowed — the table and the
    // link are the point of the email.
    body: z.string().max(MAX_BODY_LENGTH).default(""),
  })
  .strict();

export async function pmaPendingNotificationsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));
  // Chasing reporters is a plan-management action. A REPORTER must not be able
  // to enumerate their colleagues' overdue work, let alone email them.
  app.addHook("preHandler", requireRole("ADMIN", "VIEWER"));

  app.get("/", async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    const { periodKey } = listQuerySchema.parse(req.query);
    return getPendingByReporter(planId, periodKey, req.user!);
  });

  app.post("/", async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    const body = sendSchema.parse(req.body);
    return sendPendingNotifications({ planId, ...body }, req.user!);
  });
}
