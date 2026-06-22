import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth/middleware.js";
import { getStorage } from "../storage/index.js";
import { NotFound } from "../lib/errors.js";
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

const PUBLIC_STORAGE_ROOTS = new Set(["PMA", "RGDP", "GEO"]);

function isPublicStoragePath(path: string): boolean {
  const clean = path.replace(/^[/\\]+/, "");
  const segments = clean.split(/[\\/]+/);
  if (segments.length < 2 || segments.some((segment) => segment === "..")) return false;
  return PUBLIC_STORAGE_ROOTS.has(segments[0]);
}

export async function storageRoutes(app: FastifyInstance) {
  // GET /storage/*  (path after /storage/ is the storage-relative path)
  app.get("/*", async (req, reply) => {
    const path = (req.params as any)["*"] as string;
    if (!path) throw NotFound();
    if (!isPublicStoragePath(path)) {
      await authenticate(req, reply);
    }
    const storage = getStorage();
    if (!(await storage.exists(path))) throw NotFound("File not found");
    const ext = extname(path).toLowerCase();
    const mime = MIME[ext] ?? "application/octet-stream";
    reply.header("Content-Type", mime);
    const stream = await storage.stream(path);
    return reply.send(stream);
  });
}
