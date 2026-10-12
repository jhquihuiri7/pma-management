import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { eq, inArray } from "drizzle-orm";
import { signAccessToken } from "../auth/jwt.js";
import { registerErrorHandler } from "../auth/middleware.js";
import { closeDb, getDb } from "../db/client.js";
import { userApps, users } from "../db/schema/shared.js";
import { pg2030Ejes, pg2030Politicas } from "../db/schema/pg2030.js";
import { pg2030Routes } from "../routes/pg2030/index.js";
import type { Pg2030Catalogo, Pg2030Me } from "@pma/types";

test(
  "PG2030 routes inherit the session and app checks, and corrections require an administrator",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    const adminId = randomUUID();
    const reporterId = randomUUID();
    const outsiderId = randomUUID();
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(pg2030Routes, { prefix: "/pg2030" });

    const token = (id: string, role: "ADMIN" | "REPORTER", apps: Array<"pg2030" | "pma">) =>
      signAccessToken({ sub: id, adminId: id, email: `${id}@example.invalid`, name: "route test", role, apps });
    const auth = (jwt: string) => ({ authorization: `Bearer ${jwt}` });

    const [eje] = await db.select().from(pg2030Ejes).where(eq(pg2030Ejes.codigo, "GOB"));
    const [politica] = await db.select().from(pg2030Politicas).where(eq(pg2030Politicas.codigo, "G1"));

    try {
      await db.insert(users).values([
        { id: adminId, email: `${adminId}@example.invalid`, name: "PG2030 route admin", role: "ADMIN" },
        { id: reporterId, email: `${reporterId}@example.invalid`, name: "PG2030 route reporter", role: "REPORTER" },
        { id: outsiderId, email: `${outsiderId}@example.invalid`, name: "PMA only reporter", role: "REPORTER" },
      ]);
      await db.insert(userApps).values([
        { userId: reporterId, appKey: "pg2030" },
        { userId: outsiderId, appKey: "pma" },
      ]);
      const adminJwt = await token(adminId, "ADMIN", []);
      const reporterJwt = await token(reporterId, "REPORTER", ["pg2030"]);
      const outsiderJwt = await token(outsiderId, "REPORTER", ["pma"]);

      await t.test("the catalog needs a session and PG2030 access", async () => {
        assert.equal((await app.inject({ method: "GET", url: "/pg2030/catalogo" })).statusCode, 401);
        assert.equal((await app.inject({ method: "GET", url: "/pg2030/catalogo", headers: auth(outsiderJwt) })).statusCode, 403);

        const ok = await app.inject({ method: "GET", url: "/pg2030/catalogo", headers: auth(reporterJwt) });
        assert.equal(ok.statusCode, 200);
        assert.equal((ok.json() as Pg2030Catalogo).resumen.proyectos, 139);
      });

      await t.test("a reporter reads but does not correct", async () => {
        const catalogo = (await app.inject({ method: "GET", url: "/pg2030/catalogo", headers: auth(reporterJwt) })).json() as Pg2030Catalogo;
        const proyectoId = catalogo.ejes[0].objetivos[0].politicas[0].estrategias[0].metas[0].proyectos[0].id;
        const patch = await app.inject({
          method: "PATCH",
          url: `/pg2030/catalogo/proyectos/${proyectoId}`,
          headers: auth(reporterJwt),
          payload: { plazo: "En marcha" },
        });
        assert.equal(patch.statusCode, 403);

        const create = await app.inject({
          method: "POST",
          url: "/pg2030/instituciones",
          headers: auth(reporterJwt),
          payload: { nombre: "X", sigla: "X", tipo: "Otro" },
        });
        assert.equal(create.statusCode, 403);
        assert.equal((await app.inject({ method: "GET", url: "/pg2030/instituciones", headers: auth(reporterJwt) })).statusCode, 200);
      });

      await t.test("named levels win over the generic /:nivel/:id route", async () => {
        const eje200 = await app.inject({
          method: "PATCH",
          url: `/pg2030/catalogo/ejes/${eje.id}`,
          headers: auth(adminJwt),
          payload: { nombre: "Eje renombrado" },
        });
        assert.equal(eje200.statusCode, 200);
        assert.equal(eje200.json().nombre, "Eje renombrado");

        const politica200 = await app.inject({
          method: "PATCH",
          url: `/pg2030/catalogo/politicas/${politica.id}`,
          headers: auth(adminJwt),
          payload: { texto: "Política corregida" },
        });
        assert.equal(politica200.statusCode, 200);

        const unknownLevel = await app.inject({
          method: "PATCH",
          url: `/pg2030/catalogo/proyectoz/${politica.id}`,
          headers: auth(adminJwt),
          payload: { texto: "x" },
        });
        assert.equal(unknownLevel.statusCode, 400);
      });

      await t.test("/me reports a reporter without an institution as unable to write", async () => {
        const me = (await app.inject({ method: "GET", url: "/pg2030/me", headers: auth(reporterJwt) })).json() as Pg2030Me;
        assert.equal(me.role, "REPORTER");
        assert.equal(me.institucion, null);
        assert.equal(me.puedeEscribir, false);
      });
    } finally {
      await db.update(pg2030Ejes).set({ nombre: eje.nombre }).where(eq(pg2030Ejes.id, eje.id));
      await db.update(pg2030Politicas).set({ texto: politica.texto }).where(eq(pg2030Politicas.id, politica.id));
      await db.delete(users).where(inArray(users.id, [adminId, reporterId, outsiderId]));
      await app.close();
      await closeDb();
    }
  },
);
