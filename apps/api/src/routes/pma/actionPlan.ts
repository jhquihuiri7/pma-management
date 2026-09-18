import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import {
  MAX_REASON_LENGTH,
  getActionPlan,
  setActionPlanActive,
} from "../../modules/pma/actionPlanModule.js";

const planParamsSchema = z.object({ planId: z.string().uuid() }).strict();

/**
 * Exported for the same reason `plans.ts` exports its schemas and guards: both
 * routes sit behind `authenticate`, which rehydrates the user from the
 * database, so the body contract is otherwise unreachable from a test without a
 * live connection. The `.trim()` before `.min(1)` is load-bearing — reversed,
 * a whitespace-only motive passes the length check and is stored blank.
 */
export const toggleSchema = z
  .object({
    active: z.boolean(),
    // Demanded in both directions: the history is only worth reading if every
    // transition says why it happened, so a blank motive is rejected here
    // rather than stored as an empty string.
    reason: z
      .string()
      .trim()
      .min(1, "Debes escribir el motivo del cambio")
      .max(MAX_REASON_LENGTH),
  })
  .strict();

export async function pmaActionPlanRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));
  // The same pair that may edit a plan and register its hallazgos. A REPORTER
  // reports on activities; opening a Plan de Acción — and reading who opened
  // previous ones, and why — is plan management.
  app.addHook("preHandler", requireRole("ADMIN", "VIEWER"));

  app.get("/", async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    return getActionPlan(planId, req.user!);
  });

  app.post("/", async (req) => {
    const { planId } = planParamsSchema.parse(req.params);
    const body = toggleSchema.parse(req.body);
    return setActionPlanActive({ planId, ...body }, req.user!);
  });
}
