import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.preprocess((v) => v !== "false" && v !== "0" && v !== false, z.boolean()).default(true),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  JWT_ACCESS_SECRET: z.string().min(32).default("dev-access-secret-change-me-please-32chars-min"),
  JWT_REFRESH_SECRET: z.string().min(32).default("dev-refresh-secret-change-me-please-32chars-min"),
  JWT_ACCESS_TTL: z.string().regex(/^[1-9]\d*[smhd]$/).default("15m"),
  JWT_REFRESH_TTL: z.string().regex(/^[1-9]\d*[smhd]$/).default("7d"),

  DATABASE_URL: z.string().optional(),

  STORAGE_ROOT: z.string().default("./data/storage"),
  STORAGE_PUBLIC_BASE_URL: z.string().default("http://localhost:4000/storage"),

  // Raster (orthophoto) uploads. Default ~5.5 GB (5 GB cap + headroom). The
  // raster upload route raises @fastify/multipart's per-request fileSize to this
  // value; other routes keep the smaller global limit.
  RASTER_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5_905_580_032),
  // Keep the uploaded original on the NAS after a COG is generated (Phase 5).
  RASTER_KEEP_ORIGINAL: z
    .preprocess((v) => v !== "false" && v !== "0" && v !== false, z.boolean())
    .default(true),
  // How many raster jobs the worker pulls per poll. Kept at 1 so only one GDAL
  // process runs at a time (orthophotos are RAM/CPU heavy on an 11 GB host).
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  // GDAL block cache (MB). Bounds the worker's RAM; GDAL streams by block so it
  // never loads the whole raster. Set as the GDAL_CACHEMAX env for each run.
  GDAL_CACHEMAX: z.coerce.number().int().positive().default(1024),
  // Hard timeout for a single GDAL invocation (ms). Default 3 h — comfortably
  // above a 5 GB COG build, and below pg-boss's 4 h job expiration.
  RASTER_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(10_800_000),

  // TiTiler (internal tile server). The browser NEVER reaches it directly — the
  // API proxies tiles and injects the COG path, so TiTiler can't be used to read
  // arbitrary files. TITILER_DATA_ROOT is the storage root as TiTiler sees it
  // (its NAS mount), used to build the file:// URL from the stored cog_path.
  TITILER_INTERNAL_URL: z.string().default("http://titiler:8000"),
  TITILER_DATA_ROOT: z.string().default("/data/storage"),

  // Galápagos Previene — external read-only reports API (Telegram bot backend).
  // It listens on the HOST's loopback, so from inside a container 127.0.0.1 is
  // the container itself: docker-compose maps host.docker.internal for this.
  // The key never reaches the browser — the API proxies every call.
  PREVIENE_API_BASE_URL: z.string().default("http://127.0.0.1:8080"),
  PREVIENE_API_KEY: z.string().default(""),
  // How often the worker pulls new/modified reports (ms). The spec asks for
  // 1–5 min; 2 min keeps the "sincronizado hace N min" badge meaningful.
  PREVIENE_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(120_000),
  // Upstream caps limit at 200; asking for more is a 422.
  PREVIENE_PAGE_SIZE: z.coerce.number().int().min(1).max(200).default(200),
  // Safety valve: stop after this many pages in one run so a pathological
  // cursor loop cannot spin forever holding the advisory lock.
  PREVIENE_MAX_PAGES_PER_RUN: z.coerce.number().int().positive().default(100),
  PREVIENE_SYNC_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  // Media is streamed, not buffered, so this bounds time-to-first-byte rather
  // than the whole transfer — a long video must not be cut off mid-download.
  PREVIENE_MEDIA_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default(""),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Fail-fast in production against insecure defaults. The dev fallbacks below are
// publicly known (committed in this file), so booting prod with them would let
// anyone forge valid access/refresh tokens and impersonate any user.
const DEV_DEFAULT_SECRETS = new Set([
  "dev-access-secret-change-me-please-32chars-min",
  "dev-refresh-secret-change-me-please-32chars-min",
]);

if (env.NODE_ENV === "production") {
  const problems: string[] = [];
  if (DEV_DEFAULT_SECRETS.has(env.JWT_ACCESS_SECRET)) problems.push("JWT_ACCESS_SECRET is the dev default");
  if (DEV_DEFAULT_SECRETS.has(env.JWT_REFRESH_SECRET)) problems.push("JWT_REFRESH_SECRET is the dev default");
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) problems.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ");
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is required");
  if (env.SMTP_HOST && !env.SMTP_FROM) problems.push("SMTP_FROM is required when SMTP_HOST is configured");
  if (env.SMTP_HOST && /@example\./i.test(env.SMTP_FROM)) problems.push("SMTP_FROM must be a verified SES identity, not example.com");
  if (problems.length > 0) {
    console.error("Refusing to start in production with insecure configuration:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  // Tokens travel in cookies; without Secure they can leak over plain HTTP.
  // Not fatal (some intranet deployments run HTTP), but you should put TLS in
  // front and set COOKIE_SECURE=true.
  if (!env.COOKIE_SECURE) {
    console.warn("WARNING: COOKIE_SECURE is false in production — auth cookies will be sent over unencrypted HTTP. Use TLS and set COOKIE_SECURE=true.");
  }
  // Not fatal: Galápagos Previene is an opt-in subsystem and the rest of SIGTAR
  // must still boot without it. Without a key the module simply reports itself
  // as disconnected instead of silently showing an empty map.
  if (!env.PREVIENE_API_KEY) {
    console.warn("WARNING: PREVIENE_API_KEY is not set — the Galápagos Previene module will stay in disconnected mode.");
  }
  if (/127\.0\.0\.1|localhost/.test(env.PREVIENE_API_BASE_URL)) {
    console.warn(
      "WARNING: PREVIENE_API_BASE_URL points at loopback. Inside a container that resolves to the container itself, not the host — use host.docker.internal (see extra_hosts in docker-compose.yml)."
    );
  }
}
