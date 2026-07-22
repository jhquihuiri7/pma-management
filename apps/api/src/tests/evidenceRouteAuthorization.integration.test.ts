import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { inArray } from "drizzle-orm";
import { signAccessToken } from "../auth/jwt.js";
import { registerErrorHandler } from "../auth/middleware.js";
import { closeDb, getDb } from "../db/client.js";
import {
  pmaEvidences,
  pmaItemAssignments,
  pmaPlanItems,
  pmaPlans,
} from "../db/schema/pma.js";
import {
  rgdpEvidences,
  rgdpItemAssignments,
  rgdpPlanItems,
  rgdpPlans,
} from "../db/schema/rgdp.js";
import { userApps, users } from "../db/schema/shared.js";
import { pmaRoutes } from "../routes/pma/index.js";
import { rgdpRoutes } from "../routes/rgdp/index.js";

test(
  "reporter ZIPs exclude foreign evidence and RGDP upload routes reject viewers before multipart parsing",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const db = getDb();
    const reporterId = randomUUID();
    const viewerId = randomUUID();
    const otherReporterId = randomUUID();
    const pmaPlanId = randomUUID();
    const pmaItemId = randomUUID();
    const rgdpPlanId = randomUUID();
    const rgdpItemId = randomUUID();
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(multipart);
    await app.register(pmaRoutes, { prefix: "/pma" });
    await app.register(rgdpRoutes, { prefix: "/rgdp" });

    try {
      await db.insert(users).values([
        {
          id: reporterId,
          email: `route-reporter-${reporterId}@example.invalid`,
          name: "Route reporter",
          role: "REPORTER",
        },
        {
          id: viewerId,
          email: `route-viewer-${viewerId}@example.invalid`,
          name: "Route viewer",
          role: "VIEWER",
        },
        {
          id: otherReporterId,
          email: `route-other-${otherReporterId}@example.invalid`,
          name: "Other reporter",
          role: "REPORTER",
        },
      ]);
      await db.insert(userApps).values([
        { userId: reporterId, appKey: "pma" },
        { userId: reporterId, appKey: "rgdp" },
        { userId: viewerId, appKey: "pma" },
        { userId: viewerId, appKey: "rgdp" },
      ]);

      await db.insert(pmaPlans).values({
        id: pmaPlanId,
        title: "PMA ZIP ownership",
        reportPer: "1 año",
        startDate: "2026-01-01",
      });
      await db.insert(pmaPlanItems).values({
        id: pmaItemId,
        planId: pmaPlanId,
        item: "PMA item",
        subplan: "PMA",
        periodicity: "Mensual",
        reportPer: "1 año",
      });
      await db.insert(pmaItemAssignments).values({
        planItemId: pmaItemId,
        userId: reporterId,
        category: "Responsable",
      });
      await db.insert(pmaEvidences).values({
        planId: pmaPlanId,
        planItemId: pmaItemId,
        uploadedBy: otherReporterId,
        uploaderName: "Other reporter",
        fileName: "foreign-pma.pdf",
        storagePath: `PMA/test/${randomUUID()}/foreign-pma.pdf`,
        activityMonth: "2026-01",
      });

      await db.insert(rgdpPlans).values({
        id: rgdpPlanId,
        title: "RGDP ZIP ownership",
        reportPer: "1 año",
        startDate: "2026-01-01",
      });
      await db.insert(rgdpPlanItems).values({
        id: rgdpItemId,
        planId: rgdpPlanId,
        item: "RGDP item",
        subplan: "RGDP",
        periodicity: "Mensual",
        reportPer: "1 año",
      });
      await db.insert(rgdpItemAssignments).values({
        planItemId: rgdpItemId,
        userId: reporterId,
        category: "Responsable",
      });
      await db.insert(rgdpEvidences).values({
        planId: rgdpPlanId,
        planItemId: rgdpItemId,
        uploadedBy: otherReporterId,
        uploaderName: "Other reporter",
        fileName: "foreign-rgdp.pdf",
        storagePath: `RGDP/test/${randomUUID()}/foreign-rgdp.pdf`,
        activityMonth: "2026-01",
      });

      const reporterToken = await signAccessToken({
        sub: reporterId,
        adminId: reporterId,
        email: `route-reporter-${reporterId}@example.invalid`,
        name: "Route reporter",
        role: "REPORTER",
        apps: ["pma", "rgdp"],
      });
      const viewerToken = await signAccessToken({
        sub: viewerId,
        adminId: viewerId,
        email: `route-viewer-${viewerId}@example.invalid`,
        name: "Route viewer",
        role: "VIEWER",
        apps: ["pma", "rgdp"],
      });

      const pmaZip = await app.inject({
        method: "GET",
        url: `/pma/download/item-period?planId=${pmaPlanId}&planItemId=${pmaItemId}&periodStart=2026-01`,
        headers: { authorization: `Bearer ${reporterToken}` },
      });
      assert.equal(pmaZip.statusCode, 404);

      const rgdpZip = await app.inject({
        method: "GET",
        url: `/rgdp/download/item-period?planId=${rgdpPlanId}&planItemId=${rgdpItemId}&periodStart=2026-01`,
        headers: { authorization: `Bearer ${reporterToken}` },
      });
      assert.equal(rgdpZip.statusCode, 404);

      for (const url of ["/pma/upload", "/pma/evidences/", "/rgdp/upload", "/rgdp/evidences/"]) {
        const response = await app.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${viewerToken}` },
        });
        assert.equal(response.statusCode, 403, `${url} must reject VIEWER before reading multipart data`);
      }
    } finally {
      await app.close();
      await db.delete(pmaPlans).where(inArray(pmaPlans.id, [pmaPlanId]));
      await db.delete(rgdpPlans).where(inArray(rgdpPlans.id, [rgdpPlanId]));
      await db.delete(users).where(inArray(users.id, [reporterId, viewerId, otherReporterId]));
      await closeDb();
    }
  }
);
