import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { authenticate, requireApp } from "../auth/middleware.js";
import { getDb } from "../db/client.js";
import { pmaFormats } from "../db/schema/pma.js";
import { rgdpFormats } from "../db/schema/rgdp.js";
import { getStorage } from "../storage/index.js";
import { NotFound } from "../lib/errors.js";
import {
  canUserAccessEvidence as canUserAccessPmaEvidence,
  getEvidenceByStoragePath as getPmaEvidenceByStoragePath,
} from "../modules/pma/evidencesModule.js";
import {
  canUserAccessEvidence as canUserAccessRgdpEvidence,
  getEvidenceByStoragePath as getRgdpEvidenceByStoragePath,
} from "../modules/rgdp/evidencesModule.js";
import { extname } from "node:path";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".zip": "application/zip",
};

function parseStoragePath(path: string): { path: string; root: string } | null {
  const clean = path.replace(/^[/\\]+/, "");
  const segments = clean.split(/[\\/]+/);
  if (segments.length < 2 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return { path: segments.join("/"), root: segments[0] };
}

async function assertProtectedObjectAccess(req: Parameters<typeof authenticate>[0], path: string, root: string) {
  await authenticate(req, {} as any);
  const user = req.user!;

  if (root === "GEO") {
    // Public geo rendering is served by the object-aware layer/tile endpoints.
    // The generic storage proxy can expose originals and sidecars, so it still
    // requires an authenticated user with GEO access.
    await requireApp("geo")(req);
    return;
  }

  if (root === "PMA") {
    await requireApp("pma")(req);
    const evidence = await getPmaEvidenceByStoragePath(path);
    if (evidence) {
      if (!(await canUserAccessPmaEvidence(evidence, user))) throw NotFound("File not found");
      return;
    }
    const format = await getDb().select({ id: pmaFormats.id }).from(pmaFormats).where(eq(pmaFormats.storagePath, path)).limit(1);
    if (format.length > 0) return;
    throw NotFound("File not found");
  }

  if (root === "RGDP") {
    await requireApp("rgdp")(req);
    const evidence = await getRgdpEvidenceByStoragePath(path);
    if (evidence) {
      if (!(await canUserAccessRgdpEvidence(evidence, user))) throw NotFound("File not found");
      return;
    }
    const format = await getDb().select({ id: rgdpFormats.id }).from(rgdpFormats).where(eq(rgdpFormats.storagePath, path)).limit(1);
    if (format.length > 0) return;
    throw NotFound("File not found");
  }

  // Legacy format paths used `{adminId}/{subsystem}/_formats/...`. Keep those
  // registered rows readable while still requiring the correct application.
  const legacyPmaFormat = await getDb().select({ id: pmaFormats.id }).from(pmaFormats).where(eq(pmaFormats.storagePath, path)).limit(1);
  if (legacyPmaFormat.length > 0) {
    await requireApp("pma")(req);
    return;
  }
  const legacyRgdpFormat = await getDb().select({ id: rgdpFormats.id }).from(rgdpFormats).where(eq(rgdpFormats.storagePath, path)).limit(1);
  if (legacyRgdpFormat.length > 0) {
    await requireApp("rgdp")(req);
    return;
  }
  throw NotFound("File not found");
}

export async function storageRoutes(app: FastifyInstance) {
  // GET /storage/*  (path after /storage/ is the storage-relative path)
  app.get("/*", async (req, reply) => {
    const requestedPath = (req.params as any)["*"] as string;
    const parsed = requestedPath ? parseStoragePath(requestedPath) : null;
    if (!parsed) throw NotFound();
    const { path, root } = parsed;
    // Public map rendering has dedicated object-aware endpoints. The generic
    // file proxy always requires authentication and subsystem authorization.
    await assertProtectedObjectAccess(req, path, root);
    const storage = getStorage();
    if (!(await storage.exists(path))) throw NotFound("File not found");
    const ext = extname(path).toLowerCase();
    const mime = MIME[ext] ?? "application/octet-stream";
    reply.header("Content-Type", mime);
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    const stream = await storage.stream(path);
    return reply.send(stream);
  });
}
