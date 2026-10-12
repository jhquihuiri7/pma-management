import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import { userApps, users } from "../db/schema/shared.js";
import {
  pg2030Anios,
  pg2030Instituciones,
  pg2030MetasInstitucionales,
  pg2030Proyectos,
  pg2030UsuarioInstitucion,
} from "../db/schema/pg2030.js";
import { abrirAnio, setSinAcciones } from "../modules/pg2030/aniosModule.js";
import { createInstitucion } from "../modules/pg2030/institucionesModule.js";
import { createMeta, reportarMes, type PlanMes } from "../modules/pg2030/metasModule.js";
import { procesarClasificaciones } from "../modules/pg2030/clasificacionModule.js";
import { getDashboard } from "../modules/pg2030/dashboardModule.js";
import type { AccessTokenClaims } from "../auth/jwt.js";

const claims = (id: string, role: AccessTokenClaims["role"]): AccessTokenClaims =>
  ({ sub: id, adminId: id, email: "", name: "", role, apps: ["pg2030"] });

function plan(values: Partial<Record<number, [number, number]>>): PlanMes[] {
  return Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, fisico: values[i + 1]?.[0] ?? 0, presupuesto: values[i + 1]?.[1] ?? 0 }));
}

test(
  "PG2030 dashboard: every chart at a closed T1, with the axis filter and a reporter's scope",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    const Y = 2040 + Math.floor(Math.random() * 50);
    const febrero = { now: new Date(`${Y}-02-10T15:00:00Z`) };
    const abril = { now: new Date(`${Y}-04-10T15:00:00Z`) };
    const mayo = { now: new Date(`${Y}-05-02T15:00:00Z`) };
    const sfx = randomUUID().slice(0, 6);
    const adminId = randomUUID();
    const repA = randomUUID();
    const repB = randomUUID();
    const instIds: string[] = [];

    try {
      await db.insert(users).values([
        { id: adminId, email: `${adminId}@example.invalid`, name: "Admin tablero", role: "ADMIN" },
        { id: repA, email: `${repA}@example.invalid`, name: "Rep A", role: "REPORTER" },
        { id: repB, email: `${repB}@example.invalid`, name: "Rep B", role: "REPORTER" },
      ]);
      await db.insert(userApps).values([{ userId: repA, appKey: "pg2030" }, { userId: repB, appKey: "pg2030" }]);
      // Type "Otro" keeps CGREG (Ejecutivo) and anything else out of the filtered view.
      const [A, B, C, D] = await Promise.all(["A", "B", "C", "D"].map((s) =>
        createInstitucion(adminId, { nombre: `Inst ${s}`, sigla: `${s}-${sfx}`, tipo: "Otro" })));
      instIds.push(A.id, B.id, C.id, D.id);
      await db.insert(pg2030UsuarioInstitucion).values([
        { userId: repA, institucionId: A.id, asignadoPorNombre: "t" },
        { userId: repB, institucionId: B.id, asignadoPorNombre: "t" },
      ]);
      await abrirAnio(adminId, { anio: Y, primerCorte: 1, fechaLimiteCarga: null }, febrero);
      await setSinAcciones(adminId, Y, D.id, true);

      const [pg0001] = await db.select().from(pg2030Proyectos).where(eq(pg2030Proyectos.codigo, "PG0001"));
      const [pg0034] = await db.select().from(pg2030Proyectos).where(eq(pg2030Proyectos.codigo, "PG0034"));
      const meta = (institucionId: string, proyectoId: string, nombre: string, p: PlanMes[], fuente?: "Corriente" | "Inversión") =>
        createMeta(adminId, { anio: Y, institucionId, proyectoId, nombre, unidadMedida: "u", fuenteFinanciamiento: fuente, planificacion: p }, febrero);

      // A1 (GOB): 3 of 3 done; $1.000 planned, $1.300 accrued → capped at the plan.
      const a1 = await meta(A.id, pg0001.id, "Meta A1", plan({ 1: [1, 0], 2: [1, 1_000], 3: [1, 0] }), "Corriente");
      // A2 (COM): 1 of 2, no budget.
      const a2 = await meta(A.id, pg0034.id, "Meta A2", plan({ 3: [2, 0] }));
      // B1 (COM): March never saved → planned, not reported.
      const b1 = await meta(B.id, pg0034.id, "Meta B1", plan({ 1: [1, 0], 2: [1, 200], 3: [2, 0] }), "Inversión");
      // B2 (COM): reported with nothing done; $500 planned, nothing accrued.
      const b2 = await meta(B.id, pg0034.id, "Meta B2", plan({ 2: [2, 500] }), "Inversión");

      const report = (user: string, id: string, mes: number, fis: number, dev: number) =>
        reportarMes(user, id, mes, { fisicoEjecutado: fis, presupuestoDevengado: dev }, abril);
      for (const [mes, fis, dev] of [[1, 1, 0], [2, 1, 1_300], [3, 1, 0]]) await report(repA, a1.id, mes, fis, dev);
      for (const [mes, fis] of [[1, 0], [2, 0], [3, 1]]) await report(repA, a2.id, mes, fis, 0);
      for (const mes of [1, 2]) await report(repB, b1.id, mes, 1, 0);
      for (const mes of [1, 2, 3]) await report(repB, b2.id, mes, 0, 0);

      await procesarClasificaciones({
        limit: 100,
        metaIds: [a1.id, a2.id, b1.id, b2.id],
        clasificar: async (prompt) => {
          const alineacion = prompt.includes("nivel de alineación");
          if (prompt.includes("Meta A1")) return alineacion ? "Contribución directa" : "Servicios";
          if (prompt.includes("Meta A2")) return alineacion ? "Alineación relativa" : "Obras";
          return "???";
        },
      });

      const filtro = { anio: Y, trimestre: 1 as const, tipoInstitucion: "Otro" as const };
      const d = await getDashboard(claims(adminId, "ADMIN"), filtro, mayo);
      const inst = (id: string) => d.instituciones.find((i) => i.institucion.id === id)!;

      await t.test("the cutoff and the year's call (charts 2 and 3)", () => {
        assert.deepEqual(d.corte, { trimestre: 1, habilitado: true, estado: "cerrado", hasta: 3, enCurso: false });
        assert.deepEqual(
          [d.planificacion.convocadas, d.planificacion.conMetas, d.planificacion.sinAcciones, d.planificacion.sinRespuesta],
          [4, 2, 1, 1],
        );
        assert.deepEqual(d.planificacion.institucionesSinRespuesta.map((i) => i.id), [C.id]);
        assert.deepEqual([d.planificacion.metas, d.planificacion.metasConPresupuesto], [4, 3]);
        assert.deepEqual(
          [d.cumplimiento.obligadas, d.cumplimiento.cumplio, d.cumplimiento.parcial, d.cumplimiento.noCumplio, d.cumplimiento.aReportar, d.cumplimiento.reportadas],
          [2, 1, 1, 0, 4, 3],
        );
        assert.equal(inst(B.id).estadoReporte, "parcial");
        assert.equal(inst(B.id).metas.find((m) => m.id === b1.id)!.cuenta, false, "an unreported goal is not counted");
      });

      await t.test("alignment by axis, with the AI's pending goal in its own column (chart 4)", () => {
        assert.ok(d.alineacion.categorias.includes("Pendiente de clasificación"));
        const gob = d.alineacion.porEje.find((e) => e.eje.codigo === "GOB")!;
        const com = d.alineacion.porEje.find((e) => e.eje.codigo === "COM")!;
        assert.equal(gob.porCategoria["Contribución directa"], 1);
        assert.equal(com.porCategoria["Alineación relativa"], 1);
        assert.equal(com.porCategoria["Pendiente de clasificación"], 1);
        assert.equal(com.total, 2);
      });

      await t.test("physical progress: institutional averages, then their average (chart 5)", () => {
        assert.equal(inst(A.id).fisico.valor, 0.75);
        assert.equal(inst(A.id).fisico.semaforo, "amarillo");
        assert.equal(inst(B.id).fisico.valor, 0);
        assert.equal(inst(B.id).fisico.semaforo, "sin_avance");
        assert.equal(d.avanceFisico.valor, 0.375);
      });

      await t.test("budget in dollars, capped per goal, by source (chart 6)", () => {
        assert.deepEqual([d.presupuesto.total.planificado, d.presupuesto.total.computable, d.presupuesto.total.devengado], [1_500, 1_000, 1_300]);
        assert.equal(d.presupuesto.total.avance!.toFixed(4), "0.6667");
        const fuente = (f: string) => d.presupuesto.porFuente.find((x) => x.fuente === f)!.dinero;
        assert.equal(fuente("Corriente").avance, 1);
        assert.equal(fuente("Inversión").avance, 0);
        assert.equal(fuente("Cooperación").avance, null, "nothing planned: 'No aplica'");
        assert.deepEqual([d.presupuesto.metasAReportarConPresupuesto, d.presupuesto.metasConPresupuestoReportadas], [3, 2]);
        assert.equal(d.presupuesto.presupuestoSinReporte.planificado, 200);
        assert.equal(d.presupuesto.presupuestoSinReporte.proporcion!.toFixed(4), (200 / 1_700).toFixed(4));
        assert.equal(d.presupuesto.institucionesPorSemaforo.verde, 1);
        assert.equal(d.presupuesto.institucionesPorSemaforo.sin_avance, 1);
      });

      await t.test("coherence and investment type (charts 7 and 8)", () => {
        assert.equal(inst(A.id).coherencia, "incoherencia_brecha", "75 % physical vs 100 % budget");
        assert.equal(inst(B.id).coherencia, "coherente", "0 % and 0 %");
        assert.deepEqual(d.inversion.map((t) => t.tipo).sort(), ["Pendiente de clasificación", "Servicios"]);
        assert.equal(d.inversion.find((t) => t.tipo === "Servicios")!.total.planificado, 1_000);
      });

      await t.test("the axis filter recomputes charts 3–8 only with that axis' goals", async () => {
        const gobId = d.ejes.find((e) => e.codigo === "GOB")!.id;
        const g = await getDashboard(claims(adminId, "ADMIN"), { ...filtro, ejeId: gobId }, mayo);
        assert.equal(g.planificacion.metas, 1);
        assert.equal(g.planificacion.sinRespuesta, 1, "the call's counts ignore the axis");
        assert.equal(g.avanceFisico.valor, 1);
        assert.deepEqual(g.instituciones.map((i) => i.institucion.id), [A.id]);
      });

      await t.test("a reporter only sees their institution", async () => {
        const r = await getDashboard(claims(repB, "REPORTER"), { anio: Y, trimestre: 1 }, mayo);
        assert.deepEqual(r.instituciones.map((i) => i.institucion.id), [B.id]);
        assert.equal(r.planificacion.metas, 2);
      });

      await t.test("an open cutoff counts only finished months", async () => {
        const open = await getDashboard(claims(adminId, "ADMIN"), { anio: Y, trimestre: 2, tipoInstitucion: "Otro" }, mayo);
        assert.deepEqual([open.corte!.enCurso, open.corte!.hasta], [true, 4]);
      });
    } finally {
      await db.delete(pg2030MetasInstitucionales).where(eq(pg2030MetasInstitucionales.anio, Y));
      await db.delete(pg2030Anios).where(eq(pg2030Anios.anio, Y));
      await db.delete(users).where(inArray(users.id, [adminId, repA, repB]));
      await db.delete(pg2030Instituciones).where(inArray(pg2030Instituciones.id, instIds));
      await closeDb();
    }
  },
);
