import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { asc, eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import { userApps, users } from "../db/schema/shared.js";
import {
  pg2030Anios,
  pg2030Clasificaciones,
  pg2030Instituciones,
  pg2030MetasInstitucionales,
  pg2030MetasPlan,
  pg2030Proyectos,
  pg2030UsuarioInstitucion,
} from "../db/schema/pg2030.js";
import { abrirAnio } from "../modules/pg2030/aniosModule.js";
import { createInstitucion } from "../modules/pg2030/institucionesModule.js";
import { createMeta, listMetas, reportarMes, updateMeta } from "../modules/pg2030/metasModule.js";
import { updateMetaPlan } from "../modules/pg2030/catalogoModule.js";
import {
  MAX_RESPUESTAS_INVALIDAS,
  clasificacionAlCorte,
  encolarFaltantes,
  procesarClasificaciones,
  solicitudesDe,
  vistaDe,
} from "../modules/pg2030/clasificacionModule.js";
import { ProveedorIaError, type ClasificadorIa } from "../modules/pg2030/ia/cliente.js";
import type { AccessTokenClaims } from "../auth/jwt.js";

/** A model that answers by prompt kind. */
function modelo(contribucion: string, inversion: string): ClasificadorIa {
  return async (prompt) => (prompt.includes("nivel de alineación") ? contribucion : inversion);
}

test(
  "PG2030 classification queue: requests on input changes, answers, retries and the cutoff's choice",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    const Y = 2040 + Math.floor(Math.random() * 50);
    const abierto = { now: new Date(`${Y}-02-10T15:00:00Z`) };
    const adminId = randomUUID();
    const repId = randomUUID();
    const institucionIds: string[] = [];
    let metaId = "";
    const [proyecto] = await db.select().from(pg2030Proyectos).where(eq(pg2030Proyectos.codigo, "PG0121"));
    const [metaPlan] = await db.select().from(pg2030MetasPlan).where(eq(pg2030MetasPlan.id, proyecto.metaPlanId));

    const run = (clasificar: ClasificadorIa) => procesarClasificaciones({ limit: 50, clasificar, metaIds: [metaId] });
    const solicitudes = async () =>
      db.select().from(pg2030Clasificaciones).where(eq(pg2030Clasificaciones.metaId, metaId)).orderBy(asc(pg2030Clasificaciones.createdAt));

    try {
      await db.insert(users).values([
        { id: adminId, email: `${adminId}@example.invalid`, name: "Admin cola", role: "ADMIN" },
        { id: repId, email: `${repId}@example.invalid`, name: "Reportero cola", role: "REPORTER" },
      ]);
      await db.insert(userApps).values({ userId: repId, appKey: "pg2030" });
      const inst = await createInstitucion(adminId, { nombre: "Inst cola", sigla: `COLA-${randomUUID().slice(0, 6)}`, tipo: "Ejecutivo" });
      institucionIds.push(inst.id);
      await db.insert(pg2030UsuarioInstitucion).values({ userId: repId, institucionId: inst.id, asignadoPorNombre: "test" });
      await abrirAnio(adminId, { anio: Y, primerCorte: 1, fechaLimiteCarga: null }, abierto);

      await t.test("creating a goal queues one request with the Plan goal and the institution's text", async () => {
        const meta = await createMeta(repId, {
          anio: Y,
          institucionId: inst.id,
          proyectoId: proyecto.id,
          nombre: "Productores asistidos",
          descripcion: "En buenas prácticas agrícolas",
          unidadMedida: "productores",
          planificacion: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, fisico: 1, presupuesto: 0 })),
        }, abierto);
        metaId = meta.id;
        assert.equal(meta.clasificacion.estado, "analizando");
        const [s] = await solicitudes();
        assert.equal(s.metaTexto, metaPlan.texto);
        assert.equal(s.contexto, "Productores asistidos - En buenas prácticas agrícolas");
      });

      await t.test("only changes to the model's input queue a new request", async () => {
        await updateMeta(repId, metaId, { unidadMedida: "productores asistidos" }, abierto);
        assert.equal((await solicitudes()).length, 1, "the unit is not part of the input");
        await reportarMes(repId, metaId, 1, { fisicoEjecutado: 1, presupuestoDevengado: 0, hitosAlcanzados: "Taller 1" }, abierto);
        assert.equal((await solicitudes()).length, 2);
        assert.match((await solicitudes())[1].contexto, /Taller 1$/);
        // Saving the same milestone again changes nothing.
        await reportarMes(repId, metaId, 1, { fisicoEjecutado: 1, presupuestoDevengado: 0, hitosAlcanzados: "Taller 1" }, abierto);
        assert.equal((await solicitudes()).length, 2);
      });

      await t.test("a valid answer classifies the request", async () => {
        await run(modelo("<think>…</think> Contribución complementaria (Alineación parcial)", "Servicios."));
        const all = await solicitudes();
        assert.ok(all.every((s) => s.estado === "clasificada"));
        const payload = await listMetas(
          { sub: repId, adminId: repId, email: "", name: "", role: "REPORTER", apps: ["pg2030"] } as AccessTokenClaims,
          Y, undefined, abierto,
        );
        assert.deepEqual(
          [payload.metas[0].clasificacion.estado, payload.metas[0].clasificacion.contribucion, payload.metas[0].clasificacion.tipoInversion],
          ["clasificada", "Contribución complementaria", "Servicios"],
        );
      });

      await t.test("answers outside the list are retried, then the request ends without a category", async () => {
        await updateMeta(repId, metaId, { descripcion: "Nueva descripción" }, abierto);
        for (let i = 0; i < MAX_RESPUESTAS_INVALIDAS; i++) {
          // The retry waits a minute; make it due now.
          await db.update(pg2030Clasificaciones).set({ availableAt: new Date(0) }).where(eq(pg2030Clasificaciones.metaId, metaId));
          await run(modelo("Contribución directa", "No sé"));
        }
        const last = (await solicitudes()).at(-1)!;
        assert.equal(last.estado, "sin_clasificar");
        assert.equal(last.contribucion, "Contribución directa", "the half that was valid is kept");
        assert.equal(last.tipoInversion, null);
      });

      await t.test("provider failures back off and never end the request", async () => {
        await updateMeta(repId, metaId, { descripcion: "Otra descripción" }, abierto);
        const result = await run(async () => { throw new ProveedorIaError("HTTP 503"); });
        assert.equal(result.erroresProveedor >= 1, true);
        const last = (await solicitudes()).at(-1)!;
        assert.equal(last.estado, "pendiente");
        assert.equal(last.intentos, 1);
        assert.ok(last.availableAt.getTime() > Date.now(), "the next attempt is delayed");
        assert.equal(last.lastError, "HTTP 503");
      });

      await t.test("correcting the Plan goal's text re-queues its institutional goals", async () => {
        const antes = (await solicitudes()).length;
        await updateMetaPlan(adminId, metaPlan.id, { texto: `${metaPlan.texto} (corregida)` });
        try {
          const all = await solicitudes();
          assert.equal(all.length, antes + 1);
          assert.match(all.at(-1)!.metaTexto, /\(corregida\)$/);
        } finally {
          await db.update(pg2030MetasPlan).set({ texto: metaPlan.texto }).where(eq(pg2030MetasPlan.id, metaPlan.id));
        }
      });

      await t.test("a cutoff uses the latest request created before its deadline", async () => {
        const map = await solicitudesDe(db, [metaId]);
        const all = map.get(metaId)!;
        const despuesDeLaPrimera = new Date(all[1].createdAt.getTime() - 1);
        assert.equal(clasificacionAlCorte(all, despuesDeLaPrimera).contribucion, "Contribución complementaria");
        // A cutoff still open uses the latest request.
        assert.deepEqual(clasificacionAlCorte(all, null), vistaDe(all.at(-1)));
      });

      await t.test("goals without any request get one from the worker's sweep", async () => {
        await db.delete(pg2030Clasificaciones).where(eq(pg2030Clasificaciones.metaId, metaId));
        await encolarFaltantes();
        assert.equal((await solicitudes()).length, 1);
      });
    } finally {
      await db.delete(pg2030MetasInstitucionales).where(eq(pg2030MetasInstitucionales.anio, Y));
      await db.delete(pg2030Anios).where(eq(pg2030Anios.anio, Y));
      await db.delete(users).where(inArray(users.id, [adminId, repId]));
      await db.delete(pg2030Instituciones).where(inArray(pg2030Instituciones.id, institucionIds));
      await closeDb();
    }
  },
);
