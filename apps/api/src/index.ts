import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { env } from "./lib/env.js";
import { registerErrorHandler, authenticate } from "./auth/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { storageRoutes } from "./routes/storage.js";
import { pmaRoutes } from "./routes/pma/index.js";
import { rgdpRoutes } from "./routes/rgdp/index.js";
import { pglpRoutes } from "./routes/pglp/index.js";
import { geoRoutes } from "./routes/geo/index.js";

async function start() {
  const app = Fastify({
    logger: env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty" } }
      : true,
    bodyLimit: 50 * 1024 * 1024,
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

  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

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

  // Subsystem routes (Phase 2). Each prefix mirrors the web URL space.
  await app.register(pmaRoutes, { prefix: "/pma" });
  await app.register(rgdpRoutes, { prefix: "/rgdp" });
  await app.register(pglpRoutes, { prefix: "/pglp" });
  await app.register(geoRoutes, { prefix: "/geo" });

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`API listening on :${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
