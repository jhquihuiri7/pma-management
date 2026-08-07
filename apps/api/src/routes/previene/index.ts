import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { z } from "zod";
import { authenticate, requireApp, requireRole } from "../../auth/middleware.js";
import { HttpError, NotFound } from "../../lib/errors.js";
import {
  listReports,
  listEventTypes,
  getPrevieneStatus,
  findMediaById,
  markMediaAvailability,
} from "../../modules/previene/reportsModule.js";
import { runPrevieneSync } from "../../modules/previene/syncModule.js";
import { openMediaStream, PrevieneApiError } from "../../modules/previene/client.js";

/**
 * Galápagos Previene routes.
 *
 * Everything here is session-gated: unlike the Geoportal, this module shows
 * citizen photos and precise GPS of emergencies, often on private property.
 * The browser reaches the reports API only through these routes, which is what
 * keeps the bearer key server-side and works around the upstream having no
 * CORS and listening on loopback.
 */

const listQuerySchema = z.object({
  desde: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  hasta: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  /** Comma-separated event type codes. */
  tipos: z.string().optional(),
  /** Comma-separated report kinds (EVENT, INCIDENT). */
  clases: z.string().optional(),
});

const mediaParamsSchema = z.object({ mediaId: z.string().uuid() });

function parseList(value: string | undefined): string[] | null {
  if (!value) return null;
  const items = value.split(",").map((v) => v.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/** `2026-08-06` means the whole day in Galápagos time (UTC-6), not UTC midnight. */
const GALAPAGOS_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * Types this proxy is willing to DECLARE. Evidence is served inline from
 * SIGTAR's own origin, so the declared type decides what the browser executes:
 * an upstream `text/html` reflected verbatim would run as a page on this origin
 * with the viewer's session. `nosniff` is no defence — the type is being
 * asserted explicitly, not sniffed.
 *
 * Anything outside the list is still served, but as an opaque download.
 */
const ALLOWED_MEDIA_TYPES: Record<string, string[]> = {
  PHOTO: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  VIDEO: ["video/mp4", "video/webm", "video/quicktime"],
};

function parseBoundary(value: string | undefined, edge: "start" | "end"): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const base = new Date(`${value}T${edge === "start" ? "00:00:00.000Z" : "23:59:59.999Z"}`);
    return new Date(base.getTime() + GALAPAGOS_OFFSET_MS);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function previeneRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireApp("previene"));

  // ── Read endpoints (served entirely from the local cache) ────────────────

  app.get("/api/reports", async (req) => {
    const query = listQuerySchema.parse(req.query);
    return listReports({
      desde: parseBoundary(query.desde, "start"),
      hasta: parseBoundary(query.hasta, "end"),
      tipos: parseList(query.tipos),
      clases: parseList(query.clases),
    });
  });

  app.get("/api/event-types", async () => listEventTypes());

  app.get("/api/estado", async () => getPrevieneStatus());

  /**
   * Manual refresh behind the viewer's "Reintentar" button. ADMIN-only: it
   * walks the upstream feed, and any signed-in viewer being able to trigger
   * that turns a UI button into an amplification lever.
   */
  app.post("/api/sync", { preHandler: requireRole("ADMIN") }, async (req) => {
    const result = await runPrevieneSync();
    req.log.info({ result }, "previene manual sync");
    return result;
  });

  // ── Media proxy ──────────────────────────────────────────────────────────
  /**
   * Streams a photo or video. Three things make this more than a fetch-and-send:
   *
   *  - The body is piped, never buffered: a video can be tens of MB.
   *  - `Range` is forwarded and 206/Content-Range propagated, which is what
   *    makes <video> seeking work at all.
   *  - The declared Content-Type is restricted to an allowlist, because inline
   *    evidence on this origin is executable if the type says so.
   */
  app.get("/media/:mediaId", async (req, reply) => {
    const { mediaId } = mediaParamsSchema.parse(req.params);

    // Resolved against our cache first: an id we never ingested never reaches
    // upstream, so this route cannot be used as an open relay.
    const media = await findMediaById(mediaId);
    if (!media) throw NotFound("Evidencia no encontrada");

    const range = typeof req.headers.range === "string" ? req.headers.range : undefined;

    // Registered before the upstream call so a client that gives up while
    // waiting for the first byte also releases the upstream socket. Scrubbing a
    // video abandons requests constantly; without this each one leaks a
    // connection until it times out on its own.
    const upstreamAbort = new AbortController();
    let stream: Readable | null = null;
    req.raw.on("close", () => {
      upstreamAbort.abort();
      if (stream && !stream.destroyed) stream.destroy();
    });

    let upstream: globalThis.Response;
    try {
      upstream = await openMediaStream(media.contentPath, { range, signal: upstreamAbort.signal });
    } catch (err) {
      if (err instanceof PrevieneApiError) throw new HttpError(err.retryable ? 502 : 500, err.message);
      throw err;
    }

    if (upstream.status === 404) {
      // Deliberately NOT persisted as `availability = 'gone'`. That flag is
      // terminal — sync never resets it and the viewer stops requesting the
      // file — so a two-minute upstream redeploy would erase evidence from the
      // viewer permanently. A transient failure must stay transient.
      throw NotFound("Evidencia no disponible en el origen");
    }
    if (!upstream.ok && upstream.status !== 206) {
      throw new HttpError(502, `El origen respondió ${upstream.status} al pedir la evidencia`);
    }
    if (!upstream.body) throw new HttpError(502, "El origen no devolvió contenido");

    await markMediaAvailability(mediaId, "ok").catch(() => {});

    // Mirror upstream's transfer semantics rather than inventing them: if the
    // origin ignored Range and sent 200, forwarding a 206 would corrupt the
    // client's view of the file.
    reply.status(upstream.status);
    const upstreamType = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const allowed = ALLOWED_MEDIA_TYPES[media.mediaType]?.includes(upstreamType) ?? false;
    const contentType = allowed ? upstreamType : "application/octet-stream";
    reply.header("Content-Type", contentType);
    const upstreamLength = upstream.headers.get("content-length");
    if (upstreamLength) reply.header("Content-Length", upstreamLength);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) reply.header("Content-Range", contentRange);
    const acceptRanges = upstream.headers.get("accept-ranges");
    if (acceptRanges) reply.header("Accept-Ranges", acceptRanges);

    // The file name is generated from the id: `original_file_name` comes from
    // the reporter's phone and is untrusted input. The extension is derived
    // from the type actually being served, not from the value cached at ingest,
    // so the name never contradicts the bytes. An unrecognised type gets no
    // extension and no `inline`: it is not something this viewer renders.
    const extension = allowed ? (contentType.split("/")[1] ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 8) : "";
    reply.header(
      "Content-Disposition",
      `${allowed ? "inline" : "attachment"}; filename="evidencia-${mediaId}${extension ? `.${extension}` : ""}"`
    );
    reply.header("Cache-Control", "private, no-store");
    reply.header("X-Content-Type-Options", "nosniff");

    stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    return reply.send(stream);
  });
}
