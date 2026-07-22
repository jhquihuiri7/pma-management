import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authenticate, requireApp } from "../../auth/middleware.js";
import { getDb } from "../../db/client.js";
import { rgdpEvidences, rgdpPlanItems, rgdpPlans } from "../../db/schema/rgdp.js";
import { Forbidden, NotFound, HttpError } from "../../lib/errors.js";
import { createZipStream, type ZipStreamEntry } from "../../lib/zip.js";
import { canUserAccessPlan } from "../../modules/rgdp/plansModule.js";
import { isReporterAssignedToItem } from "../../modules/rgdp/planItemsModule.js";
import { getStorage } from "../../storage/index.js";
import { assertRgdpActivityMonth } from "../../lib/activityMonth.js";

const itemPeriodQuery = z.object({
  planId: z.string().uuid(),
  planItemId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
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
    if (req.user!.role === "REPORTER" && !(await isReporterAssignedToItem(
      query.planId,
      query.planItemId,
      req.user!.sub,
    ))) {
      throw Forbidden("No tienes acceso a este ítem");
    }

    const db = getDb();
    const itemRows = await db
      .select({
        item: rgdpPlanItems,
        planStartDate: rgdpPlans.startDate,
        planCreatedAt: rgdpPlans.createdAt,
      })
      .from(rgdpPlanItems)
      .innerJoin(rgdpPlans, eq(rgdpPlans.id, rgdpPlanItems.planId))
      .where(and(eq(rgdpPlanItems.id, query.planItemId), eq(rgdpPlanItems.planId, query.planId)))
      .limit(1);
    const itemResult = itemRows[0];
    if (!itemResult) throw NotFound("Item not found");
    const item = itemResult.item;
    assertRgdpActivityMonth({
      activityMonth: query.periodStart,
      startDate: itemResult.planStartDate,
      createdAt: itemResult.planCreatedAt,
      periodicity: item.periodicity,
    });

    const evidences = await db
      .select()
      .from(rgdpEvidences)
      .where(
        and(
          eq(rgdpEvidences.planId, query.planId),
          eq(rgdpEvidences.planItemId, query.planItemId),
          eq(rgdpEvidences.activityMonth, query.periodStart),
          // Keep bulk downloads aligned with list/storage authorization:
          // REPORTERs may only retrieve evidence that they uploaded.
          req.user!.role === "REPORTER"
            ? eq(rgdpEvidences.uploadedBy, req.user!.sub)
            : undefined
        )
      );

    if (evidences.length === 0) throw NotFound("No hay archivos para descargar");

    const storage = getStorage();
    const usedNames = new Map<string, number>();
    const entries: ZipStreamEntry[] = [];
    let totalBytes = 0;
    for (const evidence of evidences) {
      try {
        const stat = await storage.stat(evidence.storagePath);
        totalBytes += stat.size;
        if (totalBytes > 1024 * 1024 * 1024) {
          throw new HttpError(413, "La descarga supera el límite de 1 GB; reduce el periodo solicitado.");
        }
        entries.push({
          name: uniqueZipName(evidence.fileName, usedNames),
          size: stat.size,
          modifiedAt: stat.modifiedAt ?? evidence.createdAt,
          open: () => storage.stream(evidence.storagePath),
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          throw new HttpError(424, `No se puede completar la descarga: falta el archivo de evidencia ${evidence.id}.`);
        }
        throw new HttpError(503, "El almacenamiento no está disponible para completar la descarga.");
      }
    }

    const filename = `evidencias-${query.periodStart}-${item.id}.zip`;
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(createZipStream(entries));
  });
}
