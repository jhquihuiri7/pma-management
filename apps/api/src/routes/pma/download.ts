import type { FastifyInstance } from "fastify";
import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import { authenticate, requireApp } from "../../auth/middleware.js";
import { getDb } from "../../db/client.js";
import { pmaEvidences, pmaPlanItems } from "../../db/schema/pma.js";
import { BadRequest, Forbidden, NotFound } from "../../lib/errors.js";
import { createZip } from "../../lib/zip.js";
import { canUserAccessPlan } from "../../modules/pma/plansModule.js";
import { getStorage } from "../../storage/index.js";

const itemPeriodQuery = z.object({
  planId: z.string().uuid(),
  planItemId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}$/),
});

function getBlockSize(reportPer: string | undefined): number {
  const s = (reportPer ?? "").toLowerCase();
  if (s.startsWith("2")) return 24;
  if (s.startsWith("1")) return 12;
  return 6;
}

function addMonthsKey(periodStart: string, months: number): string {
  const [year, month] = periodStart.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) throw BadRequest("periodStart inválido");
  const date = new Date(year, month - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

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

export async function pmaDownloadRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("pma"));

  app.get("/item-period", async (req, reply) => {
    const query = itemPeriodQuery.parse(req.query);
    if (!(await canUserAccessPlan(query.planId, req.user!))) {
      throw Forbidden("No tienes acceso a este plan");
    }

    const db = getDb();
    const itemRows = await db
      .select()
      .from(pmaPlanItems)
      .where(and(eq(pmaPlanItems.id, query.planItemId), eq(pmaPlanItems.planId, query.planId)))
      .limit(1);
    const item = itemRows[0];
    if (!item) throw NotFound("Item not found");

    const periodEnd = addMonthsKey(query.periodStart, getBlockSize(item.reportPer));
    const evidences = await db
      .select()
      .from(pmaEvidences)
      .where(
        and(
          eq(pmaEvidences.planId, query.planId),
          eq(pmaEvidences.planItemId, query.planItemId),
          gte(pmaEvidences.activityMonth, query.periodStart),
          lt(pmaEvidences.activityMonth, periodEnd)
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
