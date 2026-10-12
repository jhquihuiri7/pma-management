import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../db/client.js";
import { userApps, users } from "../db/schema/shared.js";
import { pg2030ConflictosImportacion, pg2030Proyectos } from "../db/schema/pg2030.js";
import {
  getCatalogo,
  marcarConflictoRevisado,
  updateProyecto,
} from "../modules/pg2030/catalogoModule.js";
import type { Pg2030Proyecto } from "@pma/types";

// Runs against a database migrated through 0032 (see the
// api-integration-test notes: a disposable Postgres, never pma-postgres).
test(
  "the imported PG2030 catalog matches the plan and can only be corrected by an administrator",
  { skip: !process.env.DATABASE_URL },
  async (t) => {
    const db = getDb();
    const adminId = randomUUID();
    const reporterId = randomUUID();

    try {
      await db.insert(users).values([
        { id: adminId, email: `pg2030-cat-admin-${adminId}@example.invalid`, name: "PG2030 catalog admin", role: "ADMIN" },
        { id: reporterId, email: `pg2030-cat-rep-${reporterId}@example.invalid`, name: "PG2030 catalog reporter", role: "REPORTER" },
      ]);
      await db.insert(userApps).values({ userId: reporterId, appKey: "pg2030" });

      const catalogo = await getCatalogo();
      const proyectos = new Map<string, Pg2030Proyecto>();
      for (const eje of catalogo.ejes)
        for (const objetivo of eje.objetivos)
          for (const politica of objetivo.politicas)
            for (const estrategia of politica.estrategias)
              for (const meta of estrategia.metas)
                for (const proyecto of meta.proyectos) proyectos.set(proyecto.codigo, proyecto);

      await t.test("counts and budget figures are the ones docs/pg2030-plan.md promises", () => {
        const { resumen } = catalogo;
        assert.deepEqual(
          [resumen.ejes, resumen.objetivos, resumen.politicas, resumen.estrategias, resumen.metas, resumen.proyectos],
          [5, 5, 17, 43, 50, 139],
        );
        assert.equal(resumen.metasCuantificables, 12);
        assert.equal(resumen.hitos2030, 51);
        assert.equal(resumen.presupuesto.proyectosConMonto, 74);
        assert.equal(resumen.presupuesto.total, 101_377_000);
        assert.deepEqual(resumen.presupuesto.porEstado, {
          Monto: 74,
          SPI: 60,
          "No disponible": 3,
          "A definirse en la LISS": 1,
          "Sin dato": 1,
        });
        assert.equal(proyectos.size, 139);
      });

      await t.test("the import applied the plan's corrections", () => {
        assert.deepEqual(catalogo.ejes.map((e) => e.codigo), ["GOB", "COM", "ENT", "E.H", "ECO"]);
        // Row 189 (the MIT airport mis-coded as PG0048) was discarded with its objective.
        assert.match(proyectos.get("PG0048")!.nombre, /sistema cuarentenario/);
        assert.equal(catalogo.ejes.flatMap((e) => e.objetivos).some((o) => o.codigo === "O.E.1"), false);
        // The formula pasted into PG0123's type became "Acción".
        assert.equal(proyectos.get("PG0123")!.tipo, "Acción");
        // "E14 (M1) " was trimmed into the same meta as every other E14 (M1) row.
        const metas = catalogo.ejes.flatMap((e) => e.objetivos.flatMap((o) => o.politicas.flatMap((p) => p.estrategias.flatMap((s) => s.metas))));
        assert.equal(metas.filter((m) => m.codigo.startsWith("E14 (M1)")).length, 1);
        assert.equal(metas.find((m) => m.codigo === "E14 (M1)")?.codigo, "E14 (M1)");
        // The "G1:" prefix repeated the code and was stripped.
        const g1 = catalogo.ejes[0].objetivos[0].politicas[0];
        assert.equal(g1.codigo, "G1");
        assert.doesNotMatch(g1.texto, /^G1:/);
        // PG0049 is the one project with no budget data at all.
        assert.equal(proyectos.get("PG0049")!.presupuestoEstado, "Sin dato");
        // Conflicts kept the first row's value and wait for review.
        const nombre = proyectos.get("PG0056")!.conflictos.find((c) => c.campo === "nombre");
        assert.ok(nombre);
        assert.equal(nombre.valoresAlternativos.length, 1);
      });

      await t.test("a reporter cannot correct the catalog", async () => {
        await assert.rejects(
          updateProyecto(reporterId, proyectos.get("PG0001")!.id, { plazo: "En marcha" }),
          (error: { statusCode?: number }) => error.statusCode === 403,
        );
      });

      await t.test("an administrator corrects a project and its budget pair stays consistent", async () => {
        const original = proyectos.get("PG0003")!;
        try {
          const corrected = await updateProyecto(adminId, original.id, { presupuestoEstado: "SPI", hito2030: "Hito corregido" });
          assert.equal(corrected.presupuestoEstado, "SPI");
          assert.equal(corrected.presupuestoReferencial, null);
          assert.equal(corrected.hito2030, "Hito corregido");

          await assert.rejects(
            updateProyecto(adminId, original.id, { presupuestoEstado: "Monto" }),
            (error: { statusCode?: number }) => error.statusCode === 400,
          );
          const restored = await updateProyecto(adminId, original.id, {
            presupuestoEstado: "Monto",
            presupuestoReferencial: original.presupuestoReferencial,
            hito2030: original.hito2030,
          });
          assert.equal(restored.presupuestoReferencial, original.presupuestoReferencial);
        } finally {
          await db
            .update(pg2030Proyectos)
            .set({
              presupuestoEstado: original.presupuestoEstado,
              presupuestoReferencial: original.presupuestoReferencial === null ? null : original.presupuestoReferencial.toFixed(2),
              hito2030: original.hito2030,
            })
            .where(eq(pg2030Proyectos.id, original.id));
        }
      });

      await t.test("reviewing a conflict records who did it, once", async () => {
        const conflicto = proyectos.get("PG0056")!.conflictos[0];
        try {
          const first = await marcarConflictoRevisado(adminId, conflicto.id);
          assert.equal(first.revisado, true);
          assert.equal(first.revisadoPorNombre, "PG2030 catalog admin");
          const again = await marcarConflictoRevisado(adminId, conflicto.id);
          assert.equal(again.revisadoAt, first.revisadoAt);
          assert.equal((await getCatalogo()).resumen.conflictosPendientes, catalogo.resumen.conflictosPendientes - 1);
        } finally {
          await db
            .update(pg2030ConflictosImportacion)
            .set({ revisado: false, revisadoPor: null, revisadoPorNombre: null, revisadoAt: null })
            .where(eq(pg2030ConflictosImportacion.id, conflicto.id));
        }
      });
    } finally {
      await db.delete(users).where(inArray(users.id, [adminId, reporterId]));
      await closeDb();
    }
  },
);
