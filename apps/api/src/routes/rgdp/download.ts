import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authenticate, requireApp } from "../../auth/middleware.js";
import { getDb } from "../../db/client.js";
import { rgdpEvidences, rgdpPlanItems } from "../../db/schema/rgdp.js";
import { Forbidden, NotFound } from "../../lib/errors.js";
import { createZip } from "../../lib/zip.js";
import { canUserAccessPlan } from "../../modules/rgdp/plansModule.js";
import { getStorage } from "../../storage/index.js";

const itemPeriodQuery = z.object({
  planId: z.string().uuid(),
  planItemId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}$/),
});

function sanitizeZipName(fileName: string): string {
  return fileName.trim().replace(/[\\/\0]/g, "-") || "archivo";
}

function uniqueZipName(fileName: string, used: Map<string, number>): string {
  const safe = sanitizeZipName(fileName);
  const count = used.get(safe) ?? 0;
  used.set(safe, count + 1);
  if (count === 0) return safe;

  const dot = safe.lastIndexOf(".");
  if (dot > 0) return `${safe.slice(0, dot)}-${count + 1}${safe.slice(dot)}`;
  return `${safe}-${count + 1}`;
}

export async function rgdpDownloadRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("rgdp"));

  app.get("/item-period", async (req, reply) => {
    const query = itemPeriodQuery.parse(req.query);
    if (!(await canUserAccessPlan(query.planId, req.user!))) {
      throw Forbidden("No tienes acceso a este plan");
    }

    const db = getDb();
    const itemRows = await db
      .select()
      .from(rgdpPlanItems)
      .where(and(eq(rgdpPlanItems.id, query.planItemId), eq(rgdpPlanItems.planId, query.planId)))
      .limit(1);
    const item = itemRows[0];
    if (!item) throw NotFound("Item not found");

    const evidences = await db
      .select()
      .from(rgdpEvidences)
      .where(
        and(
          eq(rgdpEvidences.planId, query.planId),
          eq(rgdpEvidences.planItemId, query.planItemId),
          eq(rgdpEvidences.activityMonth, query.periodStart)
        )
      );

    if (evidences.length === 0) throw NotFound("No hay archivos para descargar");

    const storage = getStorage();
    const usedNames = new Map<string, number>();
    const entries = [];
    for (const evidence of evidences) {
      try {
        entries.push({
          name: uniqueZipName(evidence.fileName, usedNames),
          data: await storage.download(evidence.storagePath),
          modifiedAt: evidence.createdAt,
        });
      } catch {
        // Skip missing files; if every file is gone, return a clear 404 below.
      }
    }

    if (entries.length === 0) throw NotFound("No se encontraron archivos en storage");

    const zip = createZip(entries);
    const filename = `evidencias-${query.periodStart}-${item.id}.zip`;
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(zip);
  });
}
