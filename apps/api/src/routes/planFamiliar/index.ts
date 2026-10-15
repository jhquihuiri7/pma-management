import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import { enforceAuthRateLimit } from "../../auth/rateLimit.js";
import { getDb } from "../../db/client.js";
import { familyEmergencyPlans } from "../../db/schema/planFamiliar.js";
import { env } from "../../lib/env.js";
import { Conflict, Forbidden, NotFound } from "../../lib/errors.js";
import {
  familyEmergencyDownloadTokenSchema,
  familyEmergencyPlanSchema,
  familyPlanListQuerySchema,
  type FamilyPlanListQuery,
} from "../../modules/planFamiliar/model.js";
import { createFamilyPlanPdf } from "../../modules/planFamiliar/pdf.js";
import { persistDurableFileAndRecord } from "../../modules/shared/durableFilePersistence.js";
import { buildFamilyPlanPdfPath, getStorage } from "../../storage/index.js";

const CONSENT_VERSION = "2026-10-v2";
const DAY_MS = 24 * 60 * 60 * 1_000;
const protectedAccess = [authenticate, requireApp("plan_familiar")];
const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameDigest(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function acceptedOrigins(): Set<string> {
  const configured = new URL(env.FRONTEND_ORIGIN);
  const values = new Set([configured.origin]);
  if (env.NODE_ENV === "development") {
    const alternate = configured.hostname === "localhost" ? "127.0.0.1" : "localhost";
    values.add(`${configured.protocol}//${alternate}${configured.port ? `:${configured.port}` : ""}`);
  }
  return values;
}

function assertPublicWriteOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin || !acceptedOrigins().has(origin)) {
    throw Forbidden("Origen no autorizado");
  }
}

function sourceHash(request: FastifyRequest): string {
  return digest(`${env.JWT_ACCESS_SECRET}:family-plan:${request.ip}`);
}

function queryConditions(query: FamilyPlanListQuery): SQL[] {
  const conditions: SQL[] = [eq(familyEmergencyPlans.status, "active")];
  if (query.island) conditions.push(eq(familyEmergencyPlans.island, query.island));
  if (query.search) {
    const term = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(
      ilike(familyEmergencyPlans.family, term),
      ilike(familyEmergencyPlans.sector, term),
      sql`${familyEmergencyPlans.id}::text ilike ${term}`,
    )!);
  }
  if (query.from) conditions.push(gte(familyEmergencyPlans.createdAt, new Date(`${query.from}T00:00:00-06:00`)));
  if (query.to) conditions.push(lte(familyEmergencyPlans.createdAt, new Date(`${query.to}T23:59:59.999-06:00`)));
  return conditions;
}

function contentDisposition(id: string): string {
  return `attachment; filename="Plan_Familiar_${id.slice(0, 8).toUpperCase()}.pdf"`;
}

async function sendPdf(path: string, id: string, reply: FastifyReply) {
  const storage = getStorage();
  if (!(await storage.exists(path))) throw NotFound("La copia PDF no está disponible");
  reply.header("Content-Type", "application/pdf");
  reply.header("Content-Disposition", contentDisposition(id));
  reply.header("Cache-Control", "private, no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  return reply.send(await storage.stream(path));
}

function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function planFamiliarRoutes(app: FastifyInstance) {
  app.post("/public/plans", { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    assertPublicWriteOrigin(request);
    const envelope = familyEmergencyDownloadTokenSchema.parse(request.body);
    const { downloadToken, ...candidate } = envelope;
    const plan = familyEmergencyPlanSchema.parse(candidate);
    const db = getDb();
    const downloadHash = digest(downloadToken);

    const [existing] = await db
      .select()
      .from(familyEmergencyPlans)
      .where(eq(familyEmergencyPlans.submissionId, plan.submissionId))
      .limit(1);
    if (existing) {
      if (sameDigest(existing.downloadHash, downloadHash) && isDeepStrictEqual(existing.planJson, plan)) {
        return { id: existing.id, code: existing.id.slice(0, 8).toUpperCase(), createdAt: existing.createdAt.toISOString() };
      }
      throw Conflict("Este envío ya fue registrado; inicien un plan nuevo para modificarlo");
    }

    await enforceAuthRateLimit({
      request,
      reply,
      scope: "family-plan-submit",
      subject: plan.submissionId,
      limit: 2,
      originLimit: 20,
      windowMs: DAY_MS,
    });

    // The canonical form creates this UUID when the family starts the plan;
    // keeping it as the record id preserves its receipt and retry semantics.
    const id = plan.submissionId;
    const createdAt = new Date();
    const pdfStoragePath = buildFamilyPlanPdfPath(id);
    const pdf = await createFamilyPlanPdf(plan, id, createdAt);

    try {
      await persistDurableFileAndRecord({
        path: pdfStoragePath,
        data: pdf,
        contentType: "application/pdf",
        reason: `family-plan:${id}`,
        persist: async (tx) => {
          await tx.insert(familyEmergencyPlans).values({
            id,
            submissionId: plan.submissionId,
            downloadHash,
            family: plan.family,
            island: plan.island,
            sector: plan.sector,
            phone: plan.phone,
            membersCount: plan.members.length,
            latitude: plan.location?.lat ?? null,
            longitude: plan.location?.lng ?? null,
            planJson: plan,
            pdfStoragePath,
            sourceHash: sourceHash(request),
            consentVersion: CONSENT_VERSION,
            schemaVersion: 1,
            status: "active",
            createdAt,
            updatedAt: createdAt,
          });
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        const [raced] = await db
          .select()
          .from(familyEmergencyPlans)
          .where(eq(familyEmergencyPlans.submissionId, plan.submissionId))
          .limit(1);
        if (raced && sameDigest(raced.downloadHash, downloadHash) && isDeepStrictEqual(raced.planJson, plan)) {
          return { id: raced.id, code: raced.id.slice(0, 8).toUpperCase(), createdAt: raced.createdAt.toISOString() };
        }
      }
      throw error;
    }

    request.log.info({ planId: id, island: plan.island }, "family plan registered");
    reply.status(201);
    return { id, code: id.slice(0, 8).toUpperCase(), createdAt: createdAt.toISOString() };
  });

  app.get("/public/plans/:id/pdf", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const authorization = request.headers.authorization;
    if (!authorization || !/^Bearer [0-9a-f-]{36}$/i.test(authorization)) {
      throw Forbidden("Token de descarga requerido");
    }
    const token = authorization.slice("Bearer ".length);
    const [row] = await getDb()
      .select({ downloadHash: familyEmergencyPlans.downloadHash, path: familyEmergencyPlans.pdfStoragePath })
      .from(familyEmergencyPlans)
      .where(and(eq(familyEmergencyPlans.id, id), eq(familyEmergencyPlans.status, "active")))
      .limit(1);
    if (!row) throw NotFound("Plan no disponible");
    if (!sameDigest(row.downloadHash, digest(token))) throw Forbidden("Token de descarga inválido");
    return sendPdf(row.path, id, reply);
  });

  app.get("/plans", { preHandler: protectedAccess }, async (request) => {
    const query = familyPlanListQuerySchema.parse(request.query);
    const where = and(...queryConditions(query));
    const db = getDb();
    const [rows, [totals]] = await Promise.all([
      db.select({
        id: familyEmergencyPlans.id,
        createdAt: familyEmergencyPlans.createdAt,
        family: familyEmergencyPlans.family,
        island: familyEmergencyPlans.island,
        sector: familyEmergencyPlans.sector,
        phone: familyEmergencyPlans.phone,
        membersCount: familyEmergencyPlans.membersCount,
      }).from(familyEmergencyPlans).where(where).orderBy(desc(familyEmergencyPlans.createdAt))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize),
      db.select({
        total: sql<number>`count(*)::int`,
        people: sql<number>`coalesce(sum(${familyEmergencyPlans.membersCount}), 0)::int`,
      }).from(familyEmergencyPlans).where(where),
    ]);
    return {
      rows: rows.map((row) => ({ ...row, code: row.id.slice(0, 8).toUpperCase(), createdAt: row.createdAt.toISOString() })),
      total: Number(totals?.total ?? 0),
      people: Number(totals?.people ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  app.get("/stats", { preHandler: protectedAccess }, async (request) => {
    const query = familyPlanListQuerySchema.parse(request.query);
    const where = and(...queryConditions(query));
    const db = getDb();
    const [[totals], byIsland] = await Promise.all([
      db.select({
        total: sql<number>`count(*)::int`,
        people: sql<number>`coalesce(sum(${familyEmergencyPlans.membersCount}), 0)::int`,
      }).from(familyEmergencyPlans).where(where),
      db.select({ island: familyEmergencyPlans.island, total: sql<number>`count(*)::int` })
        .from(familyEmergencyPlans).where(where).groupBy(familyEmergencyPlans.island)
        .orderBy(familyEmergencyPlans.island),
    ]);
    return {
      total: Number(totals?.total ?? 0),
      people: Number(totals?.people ?? 0),
      byIsland: byIsland.map((row) => ({ island: row.island, total: Number(row.total) })),
    };
  });

  app.get("/plans/:id", { preHandler: protectedAccess }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const [row] = await getDb().select({
      id: familyEmergencyPlans.id,
      createdAt: familyEmergencyPlans.createdAt,
      plan: familyEmergencyPlans.planJson,
    }).from(familyEmergencyPlans).where(and(
      eq(familyEmergencyPlans.id, id),
      eq(familyEmergencyPlans.status, "active"),
    )).limit(1);
    if (!row) throw NotFound("Plan no encontrado");
    return { ...row, code: row.id.slice(0, 8).toUpperCase(), createdAt: row.createdAt.toISOString() };
  });

  app.get("/plans/:id/pdf", { preHandler: protectedAccess }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const [row] = await getDb().select({ path: familyEmergencyPlans.pdfStoragePath })
      .from(familyEmergencyPlans).where(and(
        eq(familyEmergencyPlans.id, id),
        eq(familyEmergencyPlans.status, "active"),
      )).limit(1);
    if (!row) throw NotFound("Plan no encontrado");
    request.log.info({ planId: id }, "family plan PDF downloaded");
    return sendPdf(row.path, id, reply);
  });

  app.get("/export.csv", {
    preHandler: [...protectedAccess, requireRole("ADMIN")],
  }, async (request, reply) => {
    const query = familyPlanListQuerySchema.parse(request.query);
    const rows = await getDb().select({
      id: familyEmergencyPlans.id,
      createdAt: familyEmergencyPlans.createdAt,
      family: familyEmergencyPlans.family,
      island: familyEmergencyPlans.island,
      sector: familyEmergencyPlans.sector,
      phone: familyEmergencyPlans.phone,
      membersCount: familyEmergencyPlans.membersCount,
    }).from(familyEmergencyPlans).where(and(...queryConditions(query)))
      .orderBy(desc(familyEmergencyPlans.createdAt));
    const lines = [
      ["Código", "Fecha", "Familia", "Isla", "Sector", "Teléfono", "Integrantes"],
      ...rows.map((row) => [row.id.slice(0, 8).toUpperCase(), row.createdAt.toISOString(), row.family, row.island, row.sector, row.phone, row.membersCount]),
    ];
    request.log.info({ exportedRows: rows.length }, "family plans exported");
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="Planes_Familiares.csv"');
    reply.header("Cache-Control", "private, no-store");
    return `\ufeff${lines.map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
  });
}
