import type { FastifyInstance } from "fastify";
import { pmaPlansRoutes } from "./plans.js";
import { pmaPlanItemsRoutes } from "./planItems.js";
import { pmaEvidencesRoutes } from "./evidences.js";
import { pmaFindingsRoutes } from "./findings.js";
import { pmaPeriodComplianceRoutes } from "./periodCompliance.js";
import { pmaNotificationsRoutes } from "./notifications.js";
import { pmaFormatsRoutes } from "./formats.js";
import { pmaUsersRoutes } from "./users.js";

export async function pmaRoutes(app: FastifyInstance) {
  await app.register(pmaPlansRoutes, { prefix: "/plans" });
  await app.register(pmaPlanItemsRoutes, { prefix: "/plans/:planId/items" });
  await app.register(pmaPeriodComplianceRoutes, { prefix: "/plans/:planId/period-compliance" });
  await app.register(pmaEvidencesRoutes, { prefix: "/evidences" });
  await app.register(pmaFindingsRoutes, { prefix: "/findings" });
  await app.register(pmaNotificationsRoutes, { prefix: "/notifications" });
  await app.register(pmaFormatsRoutes, { prefix: "/formats" });
  await app.register(pmaUsersRoutes, { prefix: "/users" });
}
