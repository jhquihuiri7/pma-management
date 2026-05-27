import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.preprocess((v) => v !== "false" && v !== "0" && v !== false, z.boolean()).default(true),

  JWT_ACCESS_SECRET: z.string().min(32).default("dev-access-secret-change-me-please-32chars-min"),
  JWT_REFRESH_SECRET: z.string().min(32).default("dev-refresh-secret-change-me-please-32chars-min"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  DATABASE_URL: z.string().optional(),

  STORAGE_ROOT: z.string().default("./data/storage"),
  STORAGE_PUBLIC_BASE_URL: z.string().default("http://localhost:4000/storage"),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("PMA Management <no-reply@example.com>"),
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
}
