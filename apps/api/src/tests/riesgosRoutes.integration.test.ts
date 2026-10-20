import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { inArray } from "drizzle-orm";
import type {
  RiesgosDelegacion,
  RiesgosDelegacionEntrada,
  RiesgosFicha,
  RiesgosFichaEntrada,
  RiesgosFichaResumen,
  RiesgosRecurso,
  RiesgosResumen,
  RiesgosTabla,
} from "@pma/types";
import { signAccessToken } from "../auth/jwt.js";
import { registerErrorHandler } from "../auth/middleware.js";
import { buildAuthRateLimitKeys } from "../auth/rateLimit.js";
import { closeDb, getDb } from "../db/client.js";
import { riesgosDelegaciones, riesgosFichas } from "../db/schema/riesgos.js";
import { authRateLimits, userApps, users } from "../db/schema/shared.js";
import { env } from "../lib/env.js";
import { claveInstitucion } from "../modules/riesgos/modelo.js";
import { riesgosRoutes } from "../routes/riesgos/index.js";

test(
  "Gestión de Riesgos: public forms, protected results and the review rules",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(riesgosRoutes, { prefix: "/riesgos" });

    // Unique per run, so earlier runs on the same database never interfere.
    const institucion = `Bomberos de prueba ${randomUUID().slice(0, 8)}`;
    const adminId = randomUUID();
    const viewerId = randomUUID();
    const outsiderId = randomUUID();
    const fichaIds: string[] = [];
    const delegacionIds: string[] = [];

    const origin = { origin: new URL(env.FRONTEND_ORIGIN).origin };
    const token = (id: string, role: "ADMIN" | "VIEWER" | "REPORTER", apps: Array<"riesgos" | "pma">) =>
      signAccessToken({ sub: id, adminId: id, email: `${id}@example.invalid`, name: `riesgos ${role}`, role, apps });
    const auth = (jwt: string) => ({ authorization: `Bearer ${jwt}` });

    const nuevaFicha = (cambios: Partial<RiesgosFichaEntrada> = {}): RiesgosFichaEntrada => {
      const id = randomUUID();
      fichaIds.push(id);
      return {
        id,
        institucionNombre: institucion,
        institucionTipo: "Público",
        mesaGrupo: "GT-1: Grupo de Trabajo Apoyo Logístico (Logística)",
        isla: "Santa Cruz",
        principal: { nombre: "Ana Pérez", cargo: "Jefa", correo: "ana@example.org", telefono: "0991234567" },
        alterno: { nombre: "Luis Mora", cargo: "Subjefe", correo: "luis@example.org", telefono: "0997654321" },
        delegadosConfirmados: true,
        brechas: "",
        observaciones: "=cmd|' /C calc'!A0",
        recursos: [
          {
            tipo: "Talento humano", nombre: "Brigadistas", isla: "Santa Cruz", ubicacion: "Estación central",
            unidad: "Personas", cantidadExistente: 12, cantidadOperativa: 10, cantidadMovilizable: 8,
            esTitular: true, disponibilidad: "Inmediata", restricciones: "", detalles: { turno: "24/7" },
          },
          {
            tipo: "Talento humano", nombre: "Voluntarios", isla: "Isabela", ubicacion: "Puerto Villamil",
            unidad: " personas ", cantidadExistente: 5, cantidadOperativa: 5, cantidadMovilizable: 5,
            esTitular: true, disponibilidad: "Condicionada", restricciones: "", detalles: {},
          },
          {
            tipo: "Vehículos", nombre: "Ambulancia prestada", isla: "Santa Cruz", ubicacion: "Hospital",
            unidad: "vehículos", cantidadExistente: 1, cantidadOperativa: 1, cantidadMovilizable: 0,
            esTitular: false, disponibilidad: "Condicionada", restricciones: "", detalles: {},
          },
        ],
        ...cambios,
      };
    };

    try {
      await db.insert(users).values([
        { id: adminId, email: `${adminId}@example.invalid`, name: "Administradora de riesgos", role: "ADMIN" },
        { id: viewerId, email: `${viewerId}@example.invalid`, name: "Visor de riesgos", role: "VIEWER" },
        { id: outsiderId, email: `${outsiderId}@example.invalid`, name: "Solo PMA", role: "REPORTER" },
      ]);
      await db.insert(userApps).values([
        { userId: viewerId, appKey: "riesgos" },
        { userId: outsiderId, appKey: "pma" },
      ]);
      const adminJwt = await token(adminId, "ADMIN", []);
      const viewerJwt = await token(viewerId, "VIEWER", ["riesgos"]);
      const outsiderJwt = await token(outsiderId, "REPORTER", ["pma"]);

      const primera = nuevaFicha();

      await t.test("the catalogs are public", async () => {
        const res = await app.inject({ method: "GET", url: "/riesgos/public/catalogos" });
        assert.equal(res.statusCode, 200);
        assert.equal(res.json().maxRecursos, 50);
        assert.ok(res.json().islas.includes("Baltra"));
      });

      await t.test("a ficha is accepted only from our own pages, and a retry keeps one row", async () => {
        const sinOrigen = await app.inject({ method: "POST", url: "/riesgos/public/fichas", payload: primera });
        assert.equal(sinOrigen.statusCode, 403);

        const creada = await app.inject({ method: "POST", url: "/riesgos/public/fichas", headers: origin, payload: primera });
        assert.equal(creada.statusCode, 201, creada.body);
        assert.equal(creada.json().id, primera.id);
        assert.equal(creada.json().codigo, primera.id.slice(0, 8).toUpperCase());

        const reintento = await app.inject({ method: "POST", url: "/riesgos/public/fichas", headers: origin, payload: primera });
        assert.equal(reintento.statusCode, 200);
        assert.equal(reintento.json().createdAt, creada.json().createdAt);
      });

      await t.test("a rejected ficha names each field with the form's own path", async () => {
        const mala = nuevaFicha();
        mala.recursos[0].cantidadOperativa = 99;
        const res = await app.inject({ method: "POST", url: "/riesgos/public/fichas", headers: origin, payload: mala });
        assert.equal(res.statusCode, 400);
        const campos = res.json().details.campos as Array<{ campo: string; mensaje: string }>;
        assert.ok(campos.some((c) => c.campo === "recursos.0.cantidadOperativa"), JSON.stringify(campos));
      });

      await t.test("results need a session and access to the module", async () => {
        assert.equal((await app.inject({ method: "GET", url: "/riesgos/fichas" })).statusCode, 401);
        assert.equal((await app.inject({ method: "GET", url: "/riesgos/fichas", headers: auth(outsiderJwt) })).statusCode, 403);
        const res = await app.inject({ method: "GET", url: "/riesgos/fichas", headers: auth(viewerJwt) });
        assert.equal(res.statusCode, 200);
        const mia = (res.json() as RiesgosFichaResumen[]).find((f) => f.id === primera.id);
        assert.equal(mia?.recursos, 3);
        assert.equal(mia?.estado, "pendiente");
      });

      await t.test("only an administrator reviews; resources follow their ficha", async () => {
        const visor = await app.inject({
          method: "PUT", url: `/riesgos/fichas/${primera.id}/revision`, headers: auth(viewerJwt),
          payload: { estado: "validado", nota: "" },
        });
        assert.equal(visor.statusCode, 403);

        const res = await app.inject({
          method: "PUT", url: `/riesgos/fichas/${primera.id}/revision`, headers: auth(adminJwt),
          payload: { estado: "validado", nota: "Revisada en campo" },
        });
        assert.equal(res.statusCode, 200, res.body);
        const ficha = res.json() as RiesgosFicha;
        assert.equal(ficha.estado, "validado");
        assert.equal(ficha.revisadoPorNombre, "Administradora de riesgos");
        assert.deepEqual(ficha.detalleRecursos.map((r) => r.estado), ["validado", "validado", "validado"]);
        assert.deepEqual(ficha.detalleRecursos.map((r) => r.movilizableConsolidado), [8, 5, 0]);
      });

      await t.test("capacity adds up per type and unit, never across units", async () => {
        const res = await app.inject({ method: "GET", url: "/riesgos/resumen", headers: auth(viewerJwt) });
        assert.equal(res.statusCode, 200);
        const resumen = res.json() as RiesgosResumen;
        const personas = resumen.capacidad.find((f) => f.tipo === "Talento humano" && f.unidad === "personas");
        assert.ok(personas, JSON.stringify(resumen.capacidad));
        // "Personas" and " personas " are one unit; only this run's ficha is validated.
        assert.ok(personas.porIsla["Santa Cruz"] >= 8);
        assert.ok(personas.porIsla.Isabela >= 5);
        assert.equal(personas.total, Object.values(personas.porIsla).reduce((a, b) => a + b, 0));
      });

      await t.test("a second validated ficha cannot count the same owned asset twice", async () => {
        const segunda = nuevaFicha({ institucionNombre: `  ${institucion.toUpperCase()} ` });
        const creada = await app.inject({ method: "POST", url: "/riesgos/public/fichas", headers: origin, payload: segunda });
        assert.equal(creada.statusCode, 201, creada.body);

        const choque = await app.inject({
          method: "PUT", url: `/riesgos/fichas/${segunda.id}/revision`, headers: auth(adminJwt),
          payload: { estado: "validado", nota: "" },
        });
        assert.equal(choque.statusCode, 409);
        assert.match(choque.json().message, /Brigadistas/);
        // The failed review left nothing half-done.
        const pendiente = (await app.inject({ method: "GET", url: `/riesgos/fichas/${segunda.id}`, headers: auth(adminJwt) })).json() as RiesgosFicha;
        assert.equal(pendiente.estado, "pendiente");
        assert.ok(pendiente.detalleRecursos.every((r) => r.estado === "pendiente"));

        const excluir = await app.inject({
          method: "PUT", url: `/riesgos/fichas/${primera.id}/revision`, headers: auth(adminJwt),
          payload: { estado: "excluido", nota: "Reemplazada por la ficha nueva" },
        });
        assert.equal(excluir.statusCode, 200);
        const validar = await app.inject({
          method: "PUT", url: `/riesgos/fichas/${segunda.id}/revision`, headers: auth(adminJwt),
          payload: { estado: "validado", nota: "" },
        });
        assert.equal(validar.statusCode, 200, validar.body);
      });

      await t.test("resources filter by institution and export formula-safe", async () => {
        const clave = claveInstitucion(institucion);
        const lista = await app.inject({ method: "GET", url: `/riesgos/recursos?institucion=${clave}&estado=validado`, headers: auth(viewerJwt) });
        assert.equal(lista.statusCode, 200);
        assert.equal((lista.json() as RiesgosRecurso[]).length, 3);

        const tabla = (await app.inject({ method: "GET", url: `/riesgos/exportar/recursos?institucion=${clave}`, headers: auth(viewerJwt) })).json() as RiesgosTabla;
        assert.equal(tabla.filas.length, 6);
        const observaciones = tabla.encabezados.indexOf("Observaciones");
        assert.ok(tabla.filas.every((fila) => String(fila[observaciones]).startsWith("'=")));
      });

      await t.test("a COE designation is stored once and listed for the results", async () => {
        const id = randomUUID();
        delegacionIds.push(id);
        const entrada: RiesgosDelegacionEntrada = {
          id,
          institucionNombre: institucion,
          institucionTipo: "Público",
          isla: "Santa Cruz",
          mesaGrupo: "No pertenece",
          reporta: { nombre: "Rosa Vera", cargo: "Secretaria", correo: "rosa@example.org", telefono: "0990000000" },
          principal: { nombre: "Carlos Ruiz", cargo: "Jefe", documento: "2000000001", correo: "carlos@example.org", telefono: "0991111111" },
          alterno: { nombre: "Marta León", cargo: "Técnica", documento: "", correo: "marta@example.org", telefono: "0992222222" },
          confirmado: true,
        };
        const creada = await app.inject({ method: "POST", url: "/riesgos/public/delegaciones", headers: origin, payload: entrada });
        assert.equal(creada.statusCode, 201, creada.body);
        const reintento = await app.inject({ method: "POST", url: "/riesgos/public/delegaciones", headers: origin, payload: entrada });
        assert.equal(reintento.statusCode, 200);

        const lista = await app.inject({ method: "GET", url: `/riesgos/delegaciones?q=${encodeURIComponent(institucion)}`, headers: auth(viewerJwt) });
        const filas = lista.json() as RiesgosDelegacion[];
        assert.equal(filas.length, 1);
        assert.equal(filas[0].principal.documento, "2000000001");

        const tabla = (await app.inject({ method: "GET", url: `/riesgos/exportar/delegaciones?q=${encodeURIComponent(institucion)}`, headers: auth(viewerJwt) })).json() as RiesgosTabla;
        assert.equal(tabla.filas.length, 1);
      });
    } finally {
      await app.close();
      if (fichaIds.length) await db.delete(riesgosFichas).where(inArray(riesgosFichas.id, fichaIds));
      if (delegacionIds.length) await db.delete(riesgosDelegaciones).where(inArray(riesgosDelegaciones.id, delegacionIds));
      const buckets = ["riesgos-ficha", "riesgos-delegacion"].flatMap((scope) =>
        Object.values(buildAuthRateLimitKeys({ scope, subject: claveInstitucion(institucion), ip: "127.0.0.1" })));
      await db.delete(authRateLimits).where(inArray(authRateLimits.bucketKey, buckets));
      await db.delete(userApps).where(inArray(userApps.userId, [adminId, viewerId, outsiderId]));
      await db.delete(users).where(inArray(users.id, [adminId, viewerId, outsiderId]));
      await closeDb();
    }
  },
);
