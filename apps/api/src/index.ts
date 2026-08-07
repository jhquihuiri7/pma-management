import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { env } from "./lib/env.js";
import { registerErrorHandler, authenticate } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { storageRoutes } from "./routes/storage.js";
import { usersRoutes } from "./routes/users.js";
import { pmaRoutes } from "./routes/pma/index.js";
import { rgdpRoutes } from "./routes/rgdp/index.js";
import { geoRoutes } from "./routes/geo/index.js";
import { previeneRoutes } from "./routes/previene/index.js";
import { closeDb } from "./db/client.js";
import { stopBoss } from "./jobs/boss.js";
import { getDb } from "./db/client.js";
import { sql } from "drizzle-orm";

async function start() {
  const app = Fastify({
    logger: env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty" } }
      : true,
    bodyLimit: 50 * 1024 * 1024,
    // Disabled by default. Production compose exposes the API only through its
    // one nginx hop and explicitly sets this to 1, making req.ip safe for auth
    // throttling without trusting spoofed forwarding headers in standalone use.
    trustProxy: env.TRUST_PROXY_HOPS > 0 ? env.TRUST_PROXY_HOPS : false,
  });

  registerErrorHandler(app);

  const allowedOrigins = [env.FRONTEND_ORIGIN];
  if (env.NODE_ENV === "development") {
    const url = new URL(env.FRONTEND_ORIGIN);
    const alt = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    allowedOrigins.push(`${url.protocol}//${alt}:${url.port}`);
  }

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
  });

  await app.register(cookie, { secret: env.JWT_ACCESS_SECRET });
  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024 },
  });

  app.get("/health", async (_req, reply) => {
    try {
      await getDb().execute(sql`select 1`);
      return { status: "ok", database: "ok", timestamp: new Date().toISOString() };
    } catch {
      return reply.status(503).send({ status: "unavailable", database: "error" });
    }
  });

  // Public auth endpoints + /auth/me (protected)
  await app.register(async (instance) => {
    instance.addHook("preHandler", async (req) => {
      // /auth/me requires auth; everything else under /auth is public
      if (req.url.endsWith("/me") || req.url.includes("/me?")) {
        await authenticate(req, {} as any);
      }
    });
    await authRoutes(instance);
  }, { prefix: "/auth" });

  // Protected storage proxy
  await app.register(storageRoutes, { prefix: "/storage" });

  // Central user management (cross-subsystem, ADMIN only)
  await app.register(usersRoutes, { prefix: "/api/users" });

  // Subsystem routes (Phase 2). Each prefix mirrors the web URL space.
  await app.register(pmaRoutes, { prefix: "/pma" });
  await app.register(rgdpRoutes, { prefix: "/rgdp" });
  await app.register(geoRoutes, { prefix: "/geo" });
  await app.register(previeneRoutes, { prefix: "/previene" });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received; closing API`);
    await app.close().catch((error) => app.log.error(error));
    await stopBoss().catch((error) => app.log.error(error));
    await closeDb().catch((error) => app.log.error(error));
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`API listening on :${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

start();
