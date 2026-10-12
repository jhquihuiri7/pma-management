import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import { userApps, users } from "../db/schema/shared.js";
import {
  pg2030Anios,
  pg2030Bitacora,
  pg2030Convocatorias,
  pg2030Instituciones,
  pg2030MetasInstitucionales,
  pg2030Proyectos,
  pg2030UsuarioInstitucion,
} from "../db/schema/pg2030.js";
import {
  abrirAnio,
  ampliarCarga,
  crearReapertura,
  listBitacora,
  listInstitucionesDelAnio,
  setSinAcciones,
} from "../modules/pg2030/aniosModule.js";
import {
  createMeta,
  deleteMeta,
  listMetas,
  reportarMes,
  updateMeta,
  updatePlanificacion,
  type PlanMes,
} from "../modules/pg2030/metasModule.js";
import { createInstitucion } from "../modules/pg2030/institucionesModule.js";
import type { AccessTokenClaims } from "../auth/jwt.js";

const status = (code: number) => (error: { statusCode?: number }) => error.statusCode === code;

function claims(id: string, role: AccessTokenClaims["role"]): AccessTokenClaims {
  return { sub: id, adminId: id, email: `${id}@example.invalid`, role, apps: ["pg2030"], name: "test" };
}

/** One physical unit planned per month from April on, and $100 in June. */
function plan(overrides: Partial<Record<number, Partial<PlanMes>>> = {}): PlanMes[] {
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    return { mes, fisico: mes >= 4 ? 1 : 0, presupuesto: mes === 6 ? 100 : 0, ...overrides[mes] };
  });
}

test(
  "PG2030 years, initial load, monthly report, locking, reopening and audit log",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    // A year far from any real one, replaying 2026: opened in October from T2.
    const Y = 2040 + Math.floor(Math.random() * 50);
    const at = (iso: string) => ({ now: new Date(iso.replace("Y", String(Y))) });
    const octubre = at("Y-10-12T15:00:00Z");
    const diciembre = at("Y-12-01T06:00:00Z");
    const suffix = randomUUID().slice(0, 6).toUpperCase();

    const adminId = randomUUID();
    const repAId = randomUUID();
    const repBId = randomUUID();
    const viewerId = randomUUID();
    const institucionIds: string[] = [];
    let metaId = "";

    try {
      await db.insert(users).values([
        { id: adminId, email: `${adminId}@example.invalid`, name: "PG2030 plan admin", role: "ADMIN" },
        { id: repAId, email: `${repAId}@example.invalid`, name: "Reportera A", role: "REPORTER" },
        { id: repBId, email: `${repBId}@example.invalid`, name: "Reportero B", role: "REPORTER" },
        { id: viewerId, email: `${viewerId}@example.invalid`, name: "Visor", role: "VIEWER" },
      ]);
      await db.insert(userApps).values([repAId, repBId, viewerId].map((userId) => ({ userId, appKey: "pg2030" as const })));
      const instA = await createInstitucion(adminId, { nombre: "Institución A", sigla: `A-${suffix}`, tipo: "Ejecutivo" });
      const instB = await createInstitucion(adminId, { nombre: "Institución B", sigla: `B-${suffix}`, tipo: "GAD" });
      institucionIds.push(instA.id, instB.id);
      await db.insert(pg2030UsuarioInstitucion).values([
        { userId: repAId, institucionId: instA.id, asignadoPorNombre: "test" },
        { userId: repBId, institucionId: instB.id, asignadoPorNombre: "test" },
      ]);
      const [proyecto] = await db.select().from(pg2030Proyectos).where(eq(pg2030Proyectos.codigo, "PG0034"));
      const [otroProyecto] = await db.select().from(pg2030Proyectos).where(eq(pg2030Proyectos.codigo, "PG0035"));

      await t.test("a year opened after a cutoff expired needs a future initial-load deadline", async () => {
        await assert.rejects(abrirAnio(adminId, { anio: Y, primerCorte: 2, fechaLimiteCarga: null }, octubre), status(400));
        await assert.rejects(abrirAnio(adminId, { anio: Y, primerCorte: 2, fechaLimiteCarga: `${Y}-10-01` }, octubre), status(400));
        await assert.rejects(abrirAnio(repAId, { anio: Y, primerCorte: 2, fechaLimiteCarga: `${Y}-11-30` }, octubre), status(403));

        const anio = await abrirAnio(adminId, { anio: Y, primerCorte: 2, fechaLimiteCarga: `${Y}-11-30` }, octubre);
        assert.deepEqual(anio.cortes.map((c) => c.estado), ["no_habilitado", "en_carga", "en_carga", "abierto"]);
        assert.deepEqual(anio.cortes.map((c) => c.plazoCierre), [`${Y}-04-30`, `${Y}-11-30`, `${Y}-11-30`, `${Y + 1}-01-31`]);
        await assert.rejects(abrirAnio(adminId, { anio: Y, primerCorte: 2, fechaLimiteCarga: `${Y}-11-30` }, octubre), status(409));

        // Every active institution is called.
        const llamadas = await db.select().from(pg2030Convocatorias).where(eq(pg2030Convocatorias.anio, Y));
        assert.ok(llamadas.some((c) => c.institucionId === instA.id) && llamadas.some((c) => c.institucionId === instB.id));
      });

      await t.test("a reporter plans only for their institution, with a funding source when there is budget", async () => {
        const base = { anio: Y, proyectoId: proyecto.id, nombre: "Personas capacitadas", unidadMedida: "personas", planificacion: plan() };
        await assert.rejects(createMeta(repAId, { ...base, institucionId: instB.id }, octubre), status(403));
        await assert.rejects(createMeta(repAId, { ...base, institucionId: instA.id }, octubre), status(400));
        await assert.rejects(createMeta(viewerId, { ...base, institucionId: instA.id, fuenteFinanciamiento: "Corriente" }, octubre), status(403));

        const meta = await createMeta(repAId, { ...base, institucionId: instA.id, fuenteFinanciamiento: "Corriente" }, octubre);
        metaId = meta.id;
        assert.equal(meta.totales.fisicoPlanificado, 9);
        assert.equal(meta.totales.presupuestoPlanificado, 100);
        assert.equal(meta.proyecto.codigo, "PG0034");
        // January–March travel with T2, which is still in the initial load.
        assert.equal(meta.meses[0].bloqueado, false);
        assert.ok(meta.meses.every((m) => m.puedePlanificar && m.puedeReportar));
      });

      await t.test("'sin acciones' and having goals exclude each other", async () => {
        await assert.rejects(setSinAcciones(repAId, Y, instA.id, true), status(409));
        await assert.rejects(setSinAcciones(repAId, Y, instB.id, true), status(403));
        await setSinAcciones(repBId, Y, instB.id, true);
        await assert.rejects(
          createMeta(adminId, { anio: Y, institucionId: instB.id, proyectoId: proyecto.id, nombre: "X", unidadMedida: "u", planificacion: plan({ 6: { presupuesto: 0 } }) }, octubre),
          status(409),
        );
        const estados = await listInstitucionesDelAnio(Y);
        assert.equal(estados.find((e) => e.institucion.id === instA.id)?.estado, "con_metas");
        assert.equal(estados.find((e) => e.institucion.id === instB.id)?.estado, "sin_acciones");
        await setSinAcciones(adminId, Y, instB.id, false);
        assert.equal((await listInstitucionesDelAnio(Y)).find((e) => e.institucion.id === instB.id)?.estado, "sin_respuesta");
      });

      await t.test("during the load the reporter reports, the administrator too, and cumulative values are flagged", async () => {
        const mayo = await reportarMes(repAId, metaId, 5, { fisicoEjecutado: 1, presupuestoDevengado: 0, hitosAlcanzados: "Taller 1" }, octubre);
        assert.equal(mayo.avisoAcumulado, false);
        const junio = await reportarMes(repAId, metaId, 6, { fisicoEjecutado: 3, presupuestoDevengado: 80 }, octubre);
        assert.equal(junio.avisoAcumulado, true, "3 against 1 planned looks cumulative");
        // Reporting 0 still counts as reported.
        const enero = await reportarMes(adminId, metaId, 1, { fisicoEjecutado: 0, presupuestoDevengado: 0 }, octubre);
        assert.equal(enero.meta.meses[0].reportadoAt !== null, true);
        assert.equal(enero.meta.totales.fisicoEjecutado, 4);
        // T4 is not in the load: there only the institution reports.
        await assert.rejects(reportarMes(adminId, metaId, 11, { fisicoEjecutado: 1, presupuestoDevengado: 0 }, octubre), status(403));
        // Nothing was logged: no cutoff has closed yet.
        assert.equal((await listBitacora(Y, instA.id)).length, 0);
      });

      await t.test("when the load ends, its months lock for everyone", async () => {
        await assert.rejects(updatePlanificacion(repAId, metaId, plan({ 5: { fisico: 2 } }), diciembre), status(409));
        await assert.rejects(reportarMes(repAId, metaId, 5, { fisicoEjecutado: 2, presupuestoDevengado: 0 }, diciembre), status(409));
        await assert.rejects(reportarMes(adminId, metaId, 2, { fisicoEjecutado: 0, presupuestoDevengado: 0 }, diciembre), status(409));
        // T4 is still open.
        const octubreMes = await reportarMes(repAId, metaId, 10, { fisicoEjecutado: 1, presupuestoDevengado: 0 }, diciembre);
        assert.equal(octubreMes.meta.meses[9].reportadoAt !== null, true);
        // Future months' plan stays editable; closed ones must come back unchanged.
        const replanned = await updatePlanificacion(repAId, metaId, plan({ 12: { fisico: 4 } }), diciembre);
        assert.equal(replanned.totales.fisicoPlanificado, 12);
        // Values in locked months block deleting the goal or moving its project.
        await assert.rejects(deleteMeta(repAId, metaId, diciembre), status(409));
        await assert.rejects(updateMeta(repAId, metaId, { proyectoId: otroProyecto.id }, diciembre), status(409));
        // The load cannot be extended once over.
        await assert.rejects(ampliarCarga(adminId, Y, `${Y}-12-31`, diciembre), status(409));
      });

      await t.test("texts stay editable after closing, and each change is logged", async () => {
        const updated = await updateMeta(repAId, metaId, { descripcion: "Capacitación en oficios" }, diciembre);
        assert.equal(updated.descripcion, "Capacitación en oficios");
        const [entrada] = await listBitacora(Y, instA.id);
        assert.equal(entrada.accion, "meta_modificada");
        assert.equal(entrada.trimestre, 2);
        assert.deepEqual(entrada.detalle.cortes, [2, 3]);
      });

      await t.test("a reopening lets one institution correct a closed cutoff, logged", async () => {
        await assert.rejects(
          crearReapertura(adminId, Y, { trimestre: 1, institucionId: instA.id, fechaLimite: `${Y}-12-10`, motivo: "x" }, diciembre),
          status(400),
          "T1 is not habilitated: its months reopen with T2",
        );
        await assert.rejects(
          crearReapertura(adminId, Y, { trimestre: 4, institucionId: instA.id, fechaLimite: `${Y}-12-10`, motivo: "x" }, diciembre),
          status(409),
          "T4 is still open",
        );
        await crearReapertura(adminId, Y, { trimestre: 2, institucionId: instA.id, fechaLimite: `${Y}-12-10`, motivo: "Corrige mayo" }, diciembre);

        const corregido = await reportarMes(repAId, metaId, 5, { fisicoEjecutado: 2, presupuestoDevengado: 0 }, diciembre);
        assert.equal(corregido.meta.meses[4].fisicoEjecutado, 2);
        // January travels with T2, so it reopened too; T3 did not.
        const meses = (await listMetas(claims(repAId, "REPORTER"), Y, undefined, diciembre)).metas[0].meses;
        assert.equal(meses[0].bloqueado, false);
        assert.equal(meses[7].bloqueado, true);
        // Institution B was not reopened.
        await assert.rejects(
          createMeta(repBId, { anio: Y, institucionId: instB.id, proyectoId: proyecto.id, nombre: "B", unidadMedida: "u", planificacion: plan({ 5: { fisico: 1 }, 6: { presupuesto: 0 } }) }, diciembre),
          status(409),
        );

        const acciones = (await listBitacora(Y, instA.id)).map((e) => e.accion);
        assert.deepEqual(acciones.slice(0, 2), ["mes_modificado", "reapertura"]);
        // After the reopening's deadline the cutoff locks again.
        await assert.rejects(
          reportarMes(repAId, metaId, 5, { fisicoEjecutado: 1, presupuestoDevengado: 0 }, at("Y-12-11T06:00:00Z")),
          status(409),
        );
      });

      await t.test("a viewer reads every month but can change none", async () => {
        await assert.rejects(listMetas(claims(viewerId, "VIEWER"), Y, undefined, diciembre), status(400));
        const payload = await listMetas(claims(viewerId, "VIEWER"), Y, instA.id, diciembre);
        assert.equal(payload.puedeEditar, false);
        assert.ok(payload.metas[0].meses.every((m) => !m.puedePlanificar && !m.puedeReportar));
        // A reporter asking for another institution still gets their own.
        const own = await listMetas(claims(repBId, "REPORTER"), Y, instA.id, diciembre);
        assert.equal(own.institucion?.id, instB.id);
        assert.equal(own.metas.length, 0);
      });

      await t.test("an institution created later is called only in the most recent year", async () => {
        await abrirAnio(adminId, { anio: Y + 1, primerCorte: 1, fechaLimiteCarga: null }, diciembre);
        const instC = await createInstitucion(adminId, { nombre: "Institución C", sigla: `C-${suffix}`, tipo: "Otro" });
        institucionIds.push(instC.id);
        assert.equal((await listInstitucionesDelAnio(Y)).find((e) => e.institucion.id === instC.id)?.estado, "no_convocada");
        assert.equal((await listInstitucionesDelAnio(Y + 1)).find((e) => e.institucion.id === instC.id)?.estado, "sin_respuesta");
        await assert.rejects(ampliarCarga(adminId, Y + 1, `${Y + 1}-12-31`, diciembre), status(400));
      });
    } finally {
      await db.delete(pg2030MetasInstitucionales).where(inArray(pg2030MetasInstitucionales.anio, [Y, Y + 1]));
      await db.delete(pg2030Bitacora).where(inArray(pg2030Bitacora.anio, [Y, Y + 1]));
      await db.delete(pg2030Anios).where(inArray(pg2030Anios.anio, [Y, Y + 1]));
      await db.delete(users).where(inArray(users.id, [adminId, repAId, repBId, viewerId]));
      if (institucionIds.length > 0) {
        await db.delete(pg2030Instituciones).where(inArray(pg2030Instituciones.id, institucionIds));
      }
      await closeDb();
    }
  },
);
