import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { z } from "zod";
import { registerErrorHandler } from "../auth/middleware.js";
import { storageRoutes } from "../routes/storage.js";

test("Zod request errors are returned as structured HTTP 400", async () => {
  const app = Fastify();
  registerErrorHandler(app);
  app.post("/validate", async (request) => z.object({ id: z.string().uuid() }).parse(request.body));

  const response = await app.inject({ method: "POST", url: "/validate", payload: { id: "not-a-uuid" } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "ValidationError");
  await app.close();
});

test("generic PMA, RGDP and GEO storage paths reject unauthenticated requests", async () => {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(storageRoutes, { prefix: "/storage" });

  for (const root of ["PMA", "RGDP", "GEO"]) {
    const response = await app.inject({ method: "GET", url: `/storage/${root}/plan/file.pdf` });
    assert.equal(response.statusCode, 401);
  }
  await app.close();
});
