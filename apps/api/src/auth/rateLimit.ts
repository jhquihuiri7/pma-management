import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getPool } from "../db/client.js";
import { HttpError } from "../lib/errors.js";

type Bucket = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private operations = 0;

  constructor(private readonly maxEntries = 10_000) {}

  consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    this.operations += 1;
    if (this.operations % 256 === 0) this.prune(now);

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      if (!existing && this.buckets.size >= this.maxEntries) this.evictOldest();
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }
    if (existing.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1_000)),
      };
    }
    existing.count += 1;
    return { allowed: true };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestReset = Infinity;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt < oldestReset) {
        oldestKey = key;
        oldestReset = bucket.resetAt;
      }
    }
    if (oldestKey !== undefined) this.buckets.delete(oldestKey);
  }
}

function digestRateLimitKey(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(Buffer.byteLength(part)), "utf8");
    hash.update(":", "utf8");
    hash.update(part, "utf8");
    hash.update(";", "utf8");
  }
  return hash.digest("hex");
}

function normalizeSubject(subject: unknown): string {
  if (typeof subject !== "string") return "invalid";
  const value = subject.trim().toLowerCase();
  // Do not retain or hash an attacker-controlled multi-megabyte JSON string.
  return value.length > 0 && value.length <= 512 ? value : "invalid";
}

export function buildAuthRateLimitKeys(args: {
  scope: string;
  subject: unknown;
  ip: string;
}): { origin: string; subjectOrigin: string } {
  const subject = normalizeSubject(args.subject);
  const origin = args.ip.trim() || "unknown";
  return {
    origin: digestRateLimitKey([args.scope, "origin", origin]),
    subjectOrigin: digestRateLimitKey([args.scope, "subject-origin", subject, origin]),
  };
}

export type SharedRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

let sharedLimiterOperations = 0;

/**
 * Atomic fixed-window counter backed by PostgreSQL. It is shared by every API
 * replica and uses the database clock so host clock skew cannot open a window.
 */
export async function consumeSharedRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number,
): Promise<SharedRateLimitResult> {
  if (!/^[a-f0-9]{64}$/.test(bucketKey)) throw new TypeError("Invalid rate-limit bucket key");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid rate-limit limit");
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new RangeError("Invalid rate-limit window");

  const pool = getPool();
  sharedLimiterOperations += 1;
  if (sharedLimiterOperations % 256 === 0) {
    await pool.query(
      "delete from auth_rate_limits where expires_at < clock_timestamp() - interval '1 day'",
    );
  }

  const result = await pool.query<{
    attempt_count: number;
    retry_after_seconds: number;
  }>(
    `with rate_clock as (
       select clock_timestamp() as now_value,
              ($2::double precision * interval '1 millisecond') as window_value
     )
     insert into auth_rate_limits (bucket_key, attempt_count, expires_at, updated_at)
     select $1, 1, rate_clock.now_value + rate_clock.window_value, rate_clock.now_value
     from rate_clock
     on conflict (bucket_key) do update set
       attempt_count = case
         when auth_rate_limits.expires_at <= excluded.updated_at then 1
         when auth_rate_limits.attempt_count >= 2147483647 then 2147483647
         else auth_rate_limits.attempt_count + 1
       end,
       expires_at = case
         when auth_rate_limits.expires_at <= excluded.updated_at then excluded.expires_at
         else auth_rate_limits.expires_at
       end,
       updated_at = excluded.updated_at
     returning attempt_count,
       greatest(1, ceil(extract(epoch from (expires_at - updated_at))))::integer
         as retry_after_seconds`,
    [bucketKey, windowMs],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Rate-limit upsert returned no row");
  if (row.attempt_count <= limit) return { allowed: true };
  return { allowed: false, retryAfterSeconds: row.retry_after_seconds };
}

/**
 * Two complementary dimensions are consumed atomically: source origin and
 * account/token + origin. A hostile source therefore cannot exhaust the bucket
 * used by the legitimate account owner at another address, while password
 * spraying from one address is still bounded. Keys are one-way hashes, so no
 * email address or reset token is stored in the limiter table.
 */
export async function enforceAuthRateLimit(args: {
  request: FastifyRequest;
  reply: FastifyReply;
  scope: string;
  subject: unknown;
  limit: number;
  windowMs: number;
  originLimit?: number;
}): Promise<void> {
  const keys = buildAuthRateLimitKeys({
    scope: args.scope,
    subject: args.subject,
    ip: args.request.ip,
  });
  const originLimit = args.originLimit ?? Math.max(100, args.limit * 20);
  const [subjectOrigin, origin] = await Promise.all([
    consumeSharedRateLimit(keys.subjectOrigin, args.limit, args.windowMs),
    consumeSharedRateLimit(keys.origin, originLimit, args.windowMs),
  ]);
  const blocked = [subjectOrigin, origin].filter(
    (result): result is Extract<SharedRateLimitResult, { allowed: false }> => !result.allowed,
  );
  if (blocked.length === 0) return;
  const retryAfterSeconds = Math.max(...blocked.map((result) => result.retryAfterSeconds));
  args.reply.header("Retry-After", String(retryAfterSeconds));
  throw new HttpError(429, "Demasiados intentos; inténtalo nuevamente más tarde");
}
