import assert from "node:assert/strict";
import test from "node:test";

import { leerCantidad, reglasCantidades } from "../lib/riesgosReglas";

const base = {
  cantidadExistente: 10,
  cantidadOperativa: 8,
  cantidadMovilizable: 5,
  esTitular: true,
  disponibilidad: "Inmediata" as const,
};

test("a quantity field keeps only digits", () => {
  assert.equal(leerCantidad("12"), 12);
  assert.equal(leerCantidad("012"), 12);
  assert.equal(leerCantidad("-5"), 5);
  assert.equal(leerCantidad("2.5"), 25);
  assert.equal(leerCantidad("1e3"), 13);
  assert.equal(leerCantidad(""), 0);
  assert.equal(leerCantidad("abc"), 0);
  assert.equal(leerCantidad("123456789"), 1234567, "never more than 7 digits");
});

test("existing ≥ operational ≥ mobilizable passes, equal values included", () => {
  assert.deepEqual(reglasCantidades(base), {});
  assert.deepEqual(reglasCantidades({ ...base, cantidadOperativa: 10, cantidadMovilizable: 10 }), {});
  assert.deepEqual(reglasCantidades({ ...base, cantidadExistente: 0, cantidadOperativa: 0, cantidadMovilizable: 0 }), {});
});

test("operational above existing and mobilizable above operational are named on their field", () => {
  assert.deepEqual(reglasCantidades({ ...base, cantidadOperativa: 11, cantidadMovilizable: 0 }), {
    cantidadOperativa: "No puede superar la cantidad existente.",
  });
  assert.deepEqual(reglasCantidades({ ...base, cantidadMovilizable: 9 }), {
    cantidadMovilizable: "No puede superar la cantidad operativa.",
  });
});

test("negative, fractional and oversized quantities are rejected", () => {
  assert.equal(reglasCantidades({ ...base, cantidadExistente: -1 }).cantidadExistente, "Solo números enteros, cero o mayores.");
  assert.equal(reglasCantidades({ ...base, cantidadOperativa: 2.5 }).cantidadOperativa, "Solo números enteros, cero o mayores.");
  assert.equal(
    reglasCantidades({ ...base, cantidadExistente: 1_000_001 }).cantidadExistente,
    "La cantidad es demasiado grande.",
  );
});

test("only an available, owned resource can be mobilized", () => {
  assert.match(reglasCantidades({ ...base, esTitular: false }).cantidadMovilizable ?? "", /titular/);
  assert.match(reglasCantidades({ ...base, disponibilidad: "No disponible" }).disponibilidad ?? "", /no disponible/);
  assert.deepEqual(reglasCantidades({ ...base, esTitular: false, disponibilidad: "No disponible", cantidadMovilizable: 0 }), {});
});
