import assert from "node:assert/strict";
import test from "node:test";
import { resolvePresupuesto } from "../modules/pg2030/catalogoModule.js";
import { proyectoPatchSchema } from "../routes/pg2030/catalogo.js";
import { institucionCreateSchema, institucionPatchSchema } from "../routes/pg2030/instituciones.js";

test("a budget amount exists exactly when the state is 'Monto'", () => {
  const monto = { estado: "Monto" as const, monto: 300_000 };
  const spi = { estado: "SPI" as const, monto: null };

  // Leaving 'Monto' drops the amount, whether or not the patch mentions it.
  assert.deepEqual(resolvePresupuesto(monto, { presupuestoEstado: "SPI" }), { estado: "SPI", monto: null });
  assert.deepEqual(
    resolvePresupuesto(monto, { presupuestoEstado: "No disponible", presupuestoReferencial: null }),
    { estado: "No disponible", monto: null },
  );

  // Entering 'Monto' needs an amount, from the patch or already on the row.
  assert.throws(() => resolvePresupuesto(spi, { presupuestoEstado: "Monto" }), /Indica el monto/);
  assert.deepEqual(
    resolvePresupuesto(spi, { presupuestoEstado: "Monto", presupuestoReferencial: 1_500 }),
    { estado: "Monto", monto: 1_500 },
  );
  assert.deepEqual(resolvePresupuesto(monto, { presupuestoReferencial: 2_000 }), { estado: "Monto", monto: 2_000 });
  assert.throws(() => resolvePresupuesto(monto, { presupuestoReferencial: null }), /Indica el monto/);

  // An amount on a non-'Monto' state is a contradiction, not something to drop silently.
  assert.throws(() => resolvePresupuesto(spi, { presupuestoReferencial: 10 }), /solo aplica/);

  // A patch that does not touch the budget keeps it.
  assert.deepEqual(resolvePresupuesto(monto, {}), monto);
  assert.deepEqual(resolvePresupuesto(spi, {}), spi);
});

test("project corrections clear optional texts with an empty string and refuse an empty patch", () => {
  assert.deepEqual(proyectoPatchSchema.parse({ plazo: "  " }), { plazo: null });
  assert.deepEqual(proyectoPatchSchema.parse({ hito2030: "  Hito  " }), { hito2030: "Hito" });
  assert.throws(() => proyectoPatchSchema.parse({ nombre: "   " }));
  assert.throws(() => proyectoPatchSchema.parse({}));
  assert.throws(() => proyectoPatchSchema.parse({ tipo: "Programa" }));
  assert.throws(() => proyectoPatchSchema.parse({ presupuestoReferencial: 0 }));
  // `codigo` is the plan's own key and is not editable.
  assert.throws(() => proyectoPatchSchema.parse({ codigo: "PG9999" }));
});

test("institution siglas are trimmed and their inner whitespace collapsed", () => {
  const parsed = institucionCreateSchema.parse({ nombre: " Consejo ", sigla: "  GAD   SC ", tipo: "GAD" });
  assert.equal(parsed.nombre, "Consejo");
  assert.equal(parsed.sigla, "GAD SC");
  assert.throws(() => institucionCreateSchema.parse({ nombre: "X", sigla: "   ", tipo: "GAD" }));
  assert.throws(() => institucionCreateSchema.parse({ nombre: "X", sigla: "X", tipo: "Privada" }));
  assert.throws(() => institucionPatchSchema.parse({}));
});
