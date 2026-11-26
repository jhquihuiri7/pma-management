import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { eq, inArray, like } from "drizzle-orm";
import type { CoeActividad, CoeActividadEntrada, CoeDirectorio, CoeEvento } from "@pma/types";
import { signAccessToken } from "../auth/jwt.js";
import { registerErrorHandler } from "../auth/middleware.js";
import { buildAuthRateLimitKeys } from "../auth/rateLimit.js";
import { closeDb, getDb } from "../db/client.js";
import { coeActividades, coeDelegados, coeDestinatarios, coeEventos } from "../db/schema/coeReporte.js";
import { authRateLimits, mailOutboxJobs, userApps, users } from "../db/schema/shared.js";
import { env } from "../lib/env.js";
import { propietarioDe } from "../modules/coeReporte/modelo.js";
import { coeReporteRoutes } from "../routes/coeReporte/index.js";

// Fictitious data only: the repository is public. Every value is unique per
// run, so earlier runs on the same database never interfere.

test(
  "Reporte territorial COE: public report by history code, protected board and notices",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(coeReporteRoutes, { prefix: "/coe-reporte" });

    const sufijo = randomUUID().slice(0, 8);
    const codigo = randomBytes(32).toString("base64url");
    const otroCodigo = randomBytes(32).toString("base64url");
    const destinatario = `coe-${sufijo}@example.invalid`;
    const delegadoCorreo = `delegado-${sufijo}@example.invalid`;
    const adminId = randomUUID();
    const viewerId = randomUUID();
    const outsiderId = randomUUID();
    const eventoIds: string[] = [];

    const origin = { origin: new URL(env.FRONTEND_ORIGIN).origin };
    const comoReportante = (c = codigo) => ({ ...origin, "x-codigo-historial": c });
    const token = (id: string, role: "ADMIN" | "VIEWER" | "REPORTER", apps: Array<"coe_reporte" | "pma">) =>
      signAccessToken({ sub: id, adminId: id, email: `${id}@example.invalid`, name: `coe ${role}`, role, apps });
    const auth = (jwt: string) => ({ authorization: `Bearer ${jwt}` });

    try {
      await db.insert(users).values([
        { id: adminId, email: `${adminId}@example.invalid`, name: "Administración COE", role: "ADMIN" },
        { id: viewerId, email: `${viewerId}@example.invalid`, name: "Visor COE", role: "VIEWER" },
        { id: outsiderId, email: `${outsiderId}@example.invalid`, name: "Solo PMA", role: "REPORTER" },
      ]);
      await db.insert(userApps).values([
        { userId: viewerId, appKey: "coe_reporte" },
        { userId: outsiderId, appKey: "pma" },
      ]);
      const adminJwt = await token(adminId, "ADMIN", []);
      const viewerJwt = await token(viewerId, "VIEWER", ["coe_reporte"]);
      const outsiderJwt = await token(outsiderId, "REPORTER", ["pma"]);

      let evento!: CoeEvento;
      const nueva = (cambios: Partial<CoeActividadEntrada> = {}): CoeActividadEntrada => ({
        id: randomUUID(),
        evento: evento.id,
        dia: "2026-11-26",
        isla: "Santa Cruz",
        sector: "Bellavista",
        institucion: `Institución de prueba ${sufijo}`,
        instancia: "MTT",
        equipo: "MTT 1",
        descripcion: "Actividad de prueba",
        metas: [{ indicador: "Tanques", cantidad: "4", unidad: "unidades" }],
        estado: "pending",
        ...cambios,
      });

      await t.test("the board's directory: only editors add recipients", async () => {
        const sinPermiso = await app.inject({
          method: "POST", url: "/coe-reporte/destinatarios", headers: auth(viewerJwt), payload: { email: destinatario },
        });
        assert.equal(sinPermiso.statusCode, 403);
        const res = await app.inject({
          method: "POST", url: "/coe-reporte/destinatarios", headers: auth(adminJwt), payload: { email: destinatario.toUpperCase() },
        });
        assert.equal(res.statusCode, 200, res.body);
        assert.ok((res.json() as CoeDirectorio).destinatarios.includes(destinatario));

        const delegado = await app.inject({
          method: "POST", url: "/coe-reporte/delegados", headers: auth(adminJwt),
          payload: { nombre: "Persona de prueba", email: delegadoCorreo, institucion: "fuerza naval" },
        });
        assert.equal(delegado.statusCode, 200, delegado.body);
        const fila = (delegado.json() as CoeDirectorio).delegados.find((d) => d.email === delegadoCorreo);
        assert.equal(fila?.institucion, "Fuerza Naval");
        const repetido = await app.inject({
          method: "POST", url: "/coe-reporte/delegados", headers: auth(adminJwt),
          payload: { nombre: "Otra", email: delegadoCorreo, institucion: "Fuerza Naval" },
        });
        assert.equal(repetido.statusCode, 409);
      });

      await t.test("events are created once per title and year", async () => {
        const sinCodigo = await app.inject({ method: "POST", url: "/coe-reporte/public/eventos", headers: origin, payload: { titulo: "x" } });
        assert.equal(sinCodigo.statusCode, 401);
        const sinOrigen = await app.inject({
          method: "POST", url: "/coe-reporte/public/eventos", headers: { "x-codigo-historial": codigo }, payload: { titulo: "x" },
        });
        assert.equal(sinOrigen.statusCode, 403);

        const titulo = `Evento de prueba ${sufijo}`;
        const creado = await app.inject({ method: "POST", url: "/coe-reporte/public/eventos", headers: comoReportante(), payload: { titulo } });
        assert.equal(creado.statusCode, 201, creado.body);
        evento = creado.json() as CoeEvento;
        eventoIds.push(evento.id);
        const otraVez = await app.inject({
          method: "POST", url: "/coe-reporte/public/eventos", headers: comoReportante(otroCodigo), payload: { titulo: `  ${titulo.toUpperCase()} ` },
        });
        assert.equal(otraVez.statusCode, 200);
        assert.equal((otraVez.json() as CoeEvento).id, evento.id);
        const lista = (await app.inject({ method: "GET", url: "/coe-reporte/public/eventos" })).json() as CoeEvento[];
        assert.ok(lista.some((e) => e.id === evento.id && e.titulo === titulo));
      });

      const programada = nueva();
      await t.test("programming is idempotent and queues one notice", async () => {
        const res = await app.inject({ method: "POST", url: "/coe-reporte/public/actividades", headers: comoReportante(), payload: programada });
        assert.equal(res.statusCode, 201, res.body);
        const guardada = res.json() as CoeActividad;
        assert.equal(guardada.estado, "pending");
        assert.equal(guardada.institucion, programada.institucion);

        const reintento = await app.inject({ method: "POST", url: "/coe-reporte/public/actividades", headers: comoReportante(), payload: programada });
        assert.equal(reintento.statusCode, 200);
        const ajeno = await app.inject({ method: "POST", url: "/coe-reporte/public/actividades", headers: comoReportante(otroCodigo), payload: programada });
        assert.equal(ajeno.statusCode, 409, "an id taken by another code is not revealed");

        const avisos = await db.select().from(mailOutboxJobs).where(eq(mailOutboxJobs.recipient, destinatario));
        assert.equal(avisos.length, 1);
        assert.match(avisos[0].subject, /^\[COE Galápagos\] Programación · Evento de prueba/);

        const malEvento = await app.inject({
          method: "POST", url: "/coe-reporte/public/actividades", headers: comoReportante(),
          payload: nueva({ evento: "EVT-2026-FFFFFFFFFFFFFFFF" }),
        });
        assert.equal(malEvento.statusCode, 400);
        assert.equal(malEvento.json().message, "Selecciona un evento válido.");
      });

      await t.test("each code sees only its own activities", async () => {
        const mias = (await app.inject({ method: "GET", url: "/coe-reporte/public/mis-actividades", headers: comoReportante() })).json() as CoeActividad[];
        assert.deepEqual(mias.map((a) => a.id), [programada.id]);
        const ajenas = (await app.inject({ method: "GET", url: "/coe-reporte/public/mis-actividades", headers: comoReportante(otroCodigo) })).json() as CoeActividad[];
        assert.equal(ajenas.length, 0);
        const malo = await app.inject({ method: "GET", url: "/coe-reporte/public/mis-actividades", headers: { "x-codigo-historial": "corto" } });
        assert.equal(malo.statusCode, 401);
      });

      await t.test("a result is recorded once, by its owner", async () => {
        const url = `/coe-reporte/public/actividades/${programada.id}/resultado`;
        const envio = randomUUID();
        const sinMotivo = await app.inject({
          method: "POST", url, headers: comoReportante(), payload: { envio, estado: "partial", resultado: "A medias", motivo: "", numeros: [] },
        });
        assert.equal(sinMotivo.statusCode, 400);
        const ajeno = await app.inject({
          method: "POST", url, headers: comoReportante(otroCodigo), payload: { envio, estado: "done", resultado: "Hecho", motivo: "", numeros: [] },
        });
        assert.equal(ajeno.statusCode, 404);

        const payload = { envio, estado: "partial", resultado: "A medias", motivo: "Lluvia", numeros: [{ indicador: "Tanques", cantidad: "2", unidad: "unidades" }] };
        const ok = await app.inject({ method: "POST", url, headers: comoReportante(), payload });
        assert.equal(ok.statusCode, 200, ok.body);
        const actividad = ok.json() as CoeActividad;
        assert.equal(actividad.estado, "partial");
        assert.ok(actividad.completadoEn);

        const reenvio = await app.inject({ method: "POST", url, headers: comoReportante(), payload });
        assert.equal(reenvio.statusCode, 200);
        const otro = await app.inject({ method: "POST", url, headers: comoReportante(), payload: { ...payload, envio: randomUUID() } });
        assert.equal(otro.statusCode, 409);

        const avisos = await db.select().from(mailOutboxJobs).where(eq(mailOutboxJobs.recipient, destinatario));
        assert.equal(avisos.length, 2);
        assert.ok(avisos.some((a) => a.subject.startsWith("[COE Galápagos] Resultado")));
      });

      await t.test("an unprogrammed activity is saved with its result", async () => {
        const sinResultado = await app.inject({
          method: "POST", url: "/coe-reporte/public/actividades", headers: comoReportante(), payload: nueva({ estado: "extra" }),
        });
        assert.equal(sinResultado.statusCode, 400);
        const res = await app.inject({
          method: "POST", url: "/coe-reporte/public/actividades", headers: comoReportante(),
          payload: nueva({ estado: "extra", resultado: "Apoyo imprevisto", instancia: "Directa", equipo: "", isla: "Isabela" }),
        });
        assert.equal(res.statusCode, 201, res.body);
        assert.equal((res.json() as CoeActividad).estado, "extra");
      });

      await t.test("the board needs a session with the module", async () => {
        assert.equal((await app.inject({ method: "GET", url: "/coe-reporte/actividades" })).statusCode, 401);
        assert.equal((await app.inject({ method: "GET", url: "/coe-reporte/actividades", headers: auth(outsiderJwt) })).statusCode, 403);
        const res = await app.inject({ method: "GET", url: `/coe-reporte/actividades?evento=${evento.id}`, headers: auth(viewerJwt) });
        assert.equal(res.statusCode, 200);
        const filas = res.json() as CoeActividad[];
        assert.equal(filas.length, 2);
        assert.ok(filas.every((f) => !("propietario" in f)), "the owner digest never leaves the API");
        const isabela = (await app.inject({
          method: "GET", url: `/coe-reporte/actividades?evento=${evento.id}&isla=Isabela`, headers: auth(viewerJwt),
        })).json() as CoeActividad[];
        assert.equal(isabela.length, 1);
        const directorio = (await app.inject({ method: "GET", url: "/coe-reporte/directorio", headers: auth(viewerJwt) })).json() as CoeDirectorio;
        assert.ok(directorio.destinatarios.includes(destinatario));
      });
    } finally {
      await app.close();
      if (eventoIds.length) {
        await db.delete(coeActividades).where(inArray(coeActividades.eventoId, eventoIds));
        await db.delete(coeEventos).where(inArray(coeEventos.id, eventoIds));
      }
      await db.delete(coeDestinatarios).where(eq(coeDestinatarios.email, destinatario));
      await db.delete(coeDelegados).where(eq(coeDelegados.email, delegadoCorreo));
      await db.delete(mailOutboxJobs).where(like(mailOutboxJobs.recipient, `%${sufijo}@example.invalid`));
      const buckets = ["coe-evento", "coe-actividad"].flatMap((scope) =>
        [codigo, otroCodigo].flatMap((c) =>
          Object.values(buildAuthRateLimitKeys({ scope, subject: propietarioDe(c), ip: "127.0.0.1" }))));
      await db.delete(authRateLimits).where(inArray(authRateLimits.bucketKey, buckets));
      await db.delete(userApps).where(inArray(userApps.userId, [adminId, viewerId, outsiderId]));
      await db.delete(users).where(inArray(users.id, [adminId, viewerId, outsiderId]));
      await closeDb();
    }
  },
);
