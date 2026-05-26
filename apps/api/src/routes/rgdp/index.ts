import type { FastifyInstance } from "fastify";
import { rgdpPlansRoutes } from "./plans.js";
import { rgdpPlanItemsRoutes } from "./planItems.js";
import { rgdpEvidencesRoutes, uploadRgdpEvidence } from "./evidences.js";
import { rgdpFindingsRoutes } from "./findings.js";
import { rgdpPeriodComplianceRoutes } from "./periodCompliance.js";
import { rgdpMonthlyGenerationsRoutes } from "./monthlyGenerations.js";
import { rgdpNotificationsRoutes } from "./notifications.js";
import { rgdpFormatsRoutes } from "./formats.js";
import { rgdpUsersRoutes } from "./users.js";
import { authenticate, requireApp } from "../../auth/middleware.js";

export async function rgdpRoutes(app: FastifyInstance) {
  app.post("/upload", { preHandler: [authenticate, requireApp("rgdp")] }, uploadRgdpEvidence);
  await app.register(rgdpPlansRoutes, { prefix: "/plans" });
  await app.register(rgdpPlanItemsRoutes, { prefix: "/plans/:planId/items" });
  await app.register(rgdpPeriodComplianceRoutes, { prefix: "/plans/:planId/period-compliance" });
  await app.register(rgdpMonthlyGenerationsRoutes, { prefix: "/plans/:planId/monthly-generation" });
  await app.register(rgdpEvidencesRoutes, { prefix: "/evidences" });
  await app.register(rgdpFindingsRoutes, { prefix: "/findings" });
  await app.register(rgdpNotificationsRoutes, { prefix: "/notifications" });
  await app.register(rgdpFormatsRoutes, { prefix: "/formats" });
  await app.register(rgdpUsersRoutes, { prefix: "/users" });
}
