import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../lib/env.js";
import { NotFound } from "../../lib/errors.js";
import { getStorage } from "../../storage/index.js";

/**
 * Serves a stored file to RustGIS. COGs and FlatGeobufs are read by HTTP range
 * (the header first, then only the parts the view needs), so `Range` must be
 * answered with 206 + Content-Range: RustGIS treats a 200 to an offset range as
 * "this server doesn't do ranges" and gives up. With GEO_FILE_ACCEL_PREFIX the
 * bytes (and the ranges) are left to nginx through X-Accel-Redirect.
 */

export interface SendFileOptions {
  storagePath: string;
  contentType: string;
  cacheControl: string;
  etag: string;
  /** The stored bytes are gzip and are sent as such (the browser decodes them). */
  contentEncoding?: "gzip";
  /** Answer byte ranges (COG, FlatGeobuf). */
  ranges: boolean;
}

export type ParsedRange = { start: number; end: number } | "unsatisfiable" | null;

/**
 * One `bytes=` range of a file of `size` bytes: `a-b`, `a-` or `-n`. Several
 * ranges (or a malformed header) give null: the whole file is sent, as RFC 9110
 * allows. A range starting past the end is unsatisfiable (416).
 */
export function parseRange(header: string | undefined, size: number): ParsedRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, a, b] = match;
  if (a === "" && b === "") return null;
  if (a === "") {
    const suffix = Number(b);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable";
    if (size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= size) return "unsatisfiable";
  let end = b === "" ? size - 1 : Number(b);
  if (!Number.isSafeInteger(end)) return null;
  if (end < start) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

export async function sendStorageFile(req: FastifyRequest, reply: FastifyReply, opts: SendFileOptions) {
  const storage = getStorage();
  let size: number;
  let modifiedAt: Date;
  try {
    const stat = await storage.stat(opts.storagePath);
    size = stat.size;
    modifiedAt = stat.modifiedAt;
  } catch {
    throw NotFound("File not found");
  }

  reply.header("Content-Type", opts.contentType);
  reply.header("Cache-Control", opts.cacheControl);
  reply.header("ETag", opts.etag);
  reply.header("Last-Modified", modifiedAt.toUTCString());
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Accept-Ranges", opts.ranges ? "bytes" : "none");
  if (opts.contentEncoding) reply.header("Content-Encoding", opts.contentEncoding);

  const ifNoneMatch = req.headers["if-none-match"];
  if (!req.headers.range && typeof ifNoneMatch === "string" && ifNoneMatch.split(/\s*,\s*/).includes(opts.etag)) {
    reply.status(304);
    return reply.send();
  }

  if (opts.ranges && env.GEO_FILE_ACCEL_PREFIX) {
    // nginx serves the file (and resolves Range) from its read-only NAS mount.
    reply.header("X-Accel-Redirect", `${env.GEO_FILE_ACCEL_PREFIX}${opts.storagePath.replace(/^\/+/, "")}`);
    return reply.send();
  }

  const abs = storage.resolve(opts.storagePath);
  const range = opts.ranges ? parseRange(req.headers.range, size) : null;
  if (range === "unsatisfiable") {
    reply.status(416);
    reply.header("Content-Range", `bytes */${size}`);
    return reply.send();
  }
  if (range) {
    reply.status(206);
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    reply.header("Content-Length", String(range.end - range.start + 1));
    if (req.method === "HEAD") return reply.send(emptyBody());
    return reply.send(createReadStream(abs, { start: range.start, end: range.end }));
  }
  reply.header("Content-Length", String(size));
  if (req.method === "HEAD") return reply.send(emptyBody());
  return reply.send(createReadStream(abs));
}

/**
 * Fastify's automatic HEAD route sets Content-Length: 0 for an empty reply but
 * keeps the header for a stream (which it drains): an empty stream keeps the
 * real length without reading the file.
 */
function emptyBody(): Readable {
  return Readable.from([]);
}
