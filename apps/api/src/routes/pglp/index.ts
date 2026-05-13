import type { FastifyInstance } from "fastify";
import { pglpPlansRoutes } from "./plans.js";
import { pglpPlanItemsRoutes } from "./planItems.js";
import { pglpEvidencesRoutes } from "./evidences.js";
import { pglpFindingsRoutes } from "./findings.js";
import { pglpPeriodComplianceRoutes } from "./periodCompliance.js";
import { pglpMonthlyGenerationsRoutes } from "./monthlyGenerations.js";
import { pglpNotificationsRoutes } from "./notifications.js";
import { pglpFormatsRoutes } from "./formats.js";
import { pglpUsersRoutes } from "./users.js";

export async function pglpRoutes(app: FastifyInstance) {
  await app.register(pglpPlansRoutes, { prefix: "/plans" });
  await app.register(pglpPlanItemsRoutes, { prefix: "/plans/:planId/items" });
  await app.register(pglpPeriodComplianceRoutes, { prefix: "/plans/:planId/period-compliance" });
  await app.register(pglpMonthlyGenerationsRoutes, { prefix: "/plans/:planId/monthly-generation" });
  await app.register(pglpEvidencesRoutes, { prefix: "/evidences" });
  await app.register(pglpFindingsRoutes, { prefix: "/findings" });
  await app.register(pglpNotificationsRoutes, { prefix: "/notifications" });
  await app.register(pglpFormatsRoutes, { prefix: "/formats" });
  await app.register(pglpUsersRoutes, { prefix: "/users" });
}
