import assert from "node:assert/strict";
import test from "node:test";
import { admiteReportesNuevos, camposDe, clean, datosAnteriores, forms, limpiarRecursos, recordKey, type OperacionLimpieza } from "../modules/protocoloLimpieza/reglas.js";

// Ported from the standalone app's tests/protocol.test.mjs and
// tests/records.test.mjs: the rules are the same file for the web and the API.

// Campos mínimos de la columna "Datos trazabilidad" del protocolo (Word).
const minimum: Record<OperacionLimpieza, string[]> = {
  recoleccion: ["barrio", "fecha", "tipo", "t", "m3", "avance"],
  carga: ["tipo", "contenedor", "t", "m3", "u"],
  patioSCY: ["propietario", "contenedor", "fechaCarga", "fecha"],
  relleno: ["tipo", "t", "m3", "fecha"],
  puertoSCY: ["contenedor", "fecha", "foto", "documento"],
  embarque: ["buque", "fecha", "recepcion"],
  patioGYE: ["contenedor", "recepcion", "fecha"],
  recepcion: ["documento"],
  gestion: ["documento"],
};

test("cada ruta pide los campos mínimos del protocolo", () => {
  for (const [kind, ids] of Object.entries(minimum) as Array<[OperacionLimpieza, string[]]>) {
    const fields = forms[kind].fields.map((f) => f.id);
    for (const id of ids) assert.ok(fields.includes(id), `${forms[kind].name} sin ${id}`);
  }
  // Todos los campos mínimos son obligatorios (en R4 la llegada se registra como estimada).
  for (const [kind, ids] of Object.entries(minimum) as Array<[OperacionLimpieza, string[]]>) {
    for (const id of ids) {
      assert.ok(forms[kind].fields.find((f) => f.id === id)!.required, `${forms[kind].name}: ${id} debe ser obligatorio`);
    }
  }
});

const base = { fecha: "2026-11-10", contenedor: "C-1", t: 2, m3: 3, u: 4 };

test("valida unidades enteras, fecha de carga y fotografía", () => {
  assert.throws(() => clean("carga", { ...base, tipo: "Escombro", u: 1.5 }), /entero/);
  assert.throws(() => clean("patioSCY", { ...base, propietario: "P", fechaCarga: "2026-11-11" }), /carga de residuos/);
  assert.equal(clean("patioSCY", { ...base, propietario: "P", fechaCarga: "2026-11-09" }).fechaCarga, "2026-11-09");
  assert.throws(() => clean("puertoSCY", { ...base, documento: "G-1" }), /fotografía/);
  assert.throws(() => clean("puertoSCY", { ...base, documento: "G-1", foto: "../registros.sqlite" }), /fotografía/);
});

const data = { fecha: "2026-11-10", barrio: "Sector de prueba", tipo: "Escombro", t: 1, m3: 4, u: 3, avance: 50 };

test("rechaza cantidades negativas, fechas inválidas y tipos de residuo fuera de la lista", () => {
  assert.throws(() => clean("recoleccion", { ...data, t: -1 }));
  assert.throws(() => clean("recoleccion", { ...data, fecha: "2026-02-30" }));
  assert.throws(() => clean("recoleccion", { ...data, tipo: "Colchones" }), { message: "Elige Tipo de residuo." });
  assert.equal(clean("recoleccion", { ...data, tipo: "Desecho" }).tipo, "Desecho");
});

test("names the offending field and keeps the messages of the standalone app", () => {
  assert.throws(() => clean("inventada", data), { message: "Selecciona una operación válida." });
  assert.throws(() => clean("recoleccion", null), { message: "Selecciona una operación válida." });
  assert.throws(() => clean("recoleccion", { ...data, barrio: " " }), { message: "Completa Barrio." });
  assert.throws(() => clean("recoleccion", { ...data, avance: 101 }), { message: "Revisa el valor de Porcentaje de limpieza del barrio (%)." });
  assert.throws(() => clean("recoleccion", { ...data, tipo: "" }), { message: "Completa Tipo de residuo." });
  assert.throws(() => clean("recoleccion", { ...data, barrio: "x".repeat(501) }), { message: "Barrio supera los 500 caracteres." });
  assert.throws(() => clean("relleno", { ...data, documento: "C-9", recepcion: "2026-11-09" }), {
    message: "La recepción debe ser el mismo día del traslado o después.",
  });
  assert.throws(() => clean("puertoSCY", { ...base, documento: "G-1" }), {
    message: "Adjunta la fotografía interior del contenedor.",
  });
});

test("returns numbers for numeric fields, uppercases codes and drops fields the form does not have", () => {
  const out = clean("carga", { ...base, tipo: "Escombro", t: "1.5", contenedor: " c-1 ", inventado: "x", kind: "carga", lote: "L-1", costo: "5" });
  assert.equal(out.t, 1.5);
  assert.equal(out.contenedor, "C-1");
  // R1 no longer asks the lot nor the additional data ("Más datos").
  for (const id of ["lote", "costo", "inventado", "kind"]) assert.equal(id in out, false, id);
  // Validating twice gives the same values: the API re-checks what the web already cleaned.
  assert.deepEqual(clean("carga", out), out);
});

test("no form has additional data, nor asks the lot, how quantities were obtained or who reports", () => {
  for (const kind of Object.keys(forms) as OperacionLimpieza[]) {
    assert.deepEqual(camposDe(kind), forms[kind].fields, kind);
    // Every field is asked in the form itself: required, or a reception date.
    for (const f of camposDe(kind)) assert.ok(f.required || f.id === "recepcion", `${kind}: ${f.id}`);
    const ids = camposDe(kind).map((f) => f.id);
    for (const id of ["lote", "medicion", "metodo", "responsable", "sello", "viaje", "notas", "costo", "entrega", "recibe", "equipo"]) {
      assert.ok(!ids.includes(id), `${kind} pide ${id}`);
    }
    const tipo = camposDe(kind).find((f) => f.id === "tipo");
    if (tipo) assert.deepEqual([tipo.type, tipo.options], ["select", ["Escombro", "Desecho"]], kind);
  }
});

test("an older report keeps the values of fields the form no longer asks", () => {
  const antiguo = { ...data, lote: "L-001", medicion: "Medida", responsable: "Ana", notas: "Lluvia", inventado: "x" };
  assert.deepEqual(datosAnteriores("recoleccion", antiguo), { lote: "L-001", medicion: "Medida", responsable: "Ana", notas: "Lluvia" });
  assert.deepEqual(datosAnteriores("embarque", { viaje: "V-7", sello: "S-1", documento: "GR-1", buque: "B" }), { viaje: "V-7", sello: "S-1" });
});

test("the duplicate key ignores case, surrounding spaces and how an accent was typed", () => {
  const a = clean("recoleccion", data);
  const b = clean("recoleccion", { ...data, barrio: "  SECTOR DE PRUEBA " });
  assert.equal(recordKey("recoleccion", a), recordKey("recoleccion", b));
  // "í" as one character (NFC) and as "i" + combining accent (NFD) are the same neighbourhood.
  const compuesto = clean("recoleccion", { ...data, barrio: "Las Orqu\u00eddeas" });
  const descompuesto = clean("recoleccion", { ...data, barrio: "Las Orqui\u0301deas" });
  assert.equal(recordKey("recoleccion", compuesto), recordKey("recoleccion", descompuesto));
  // Another day, or the other type of waste, is another collection.
  assert.notEqual(recordKey("recoleccion", a), recordKey("recoleccion", clean("recoleccion", { ...data, fecha: "2026-11-11" })));
  assert.notEqual(recordKey("recoleccion", a), recordKey("recoleccion", clean("recoleccion", { ...data, tipo: "Desecho" })));
  assert.notEqual(recordKey("recoleccion", a), recordKey("carga", a));
  // A shipment without a voyage number is told apart by its departure date.
  const embarque = { contenedor: "C-1", fecha: "2026-11-10" };
  assert.notEqual(recordKey("embarque", embarque), recordKey("embarque", { ...embarque, fecha: "2026-11-11" }));
  assert.equal(recordKey("embarque", { ...embarque, viaje: "V-7" }), recordKey("embarque", { ...embarque, fecha: "2026-11-11", viaje: "v-7" }));
});

test("resources: whole quantities above zero, with the resource (capitalised) and its institution", () => {
  assert.deepEqual(limpiarRecursos(undefined), []);
  assert.deepEqual(limpiarRecursos([]), []);
  assert.deepEqual(
    limpiarRecursos([{ cantidad: "10", recurso: " personas ", institucion: " Consejo de Gobierno " }, { cantidad: 1, recurso: "vehículo", institucion: "GAD Santa Cruz" }]),
    [{ cantidad: 10, recurso: "Personas", institucion: "Consejo de Gobierno" }, { cantidad: 1, recurso: "Vehículo", institucion: "GAD Santa Cruz" }],
  );
  const fila = { cantidad: 2, recurso: "personas", institucion: "MIT" };
  assert.throws(() => limpiarRecursos("10 personas"), { message: "Revisa los recursos disponibles." });
  assert.throws(() => limpiarRecursos([fila, { ...fila, cantidad: 0 }]), { message: "Usa un número entero mayor que cero en la cantidad del recurso 2." });
  assert.throws(() => limpiarRecursos([{ ...fila, cantidad: 1.5 }]), /entero/);
  assert.throws(() => limpiarRecursos([{ ...fila, cantidad: "" }]), /cantidad del recurso 1/);
  assert.throws(() => limpiarRecursos([{ ...fila, recurso: " " }]), { message: "Completa el recurso 1." });
  assert.throws(() => limpiarRecursos([{ ...fila, institucion: "" }]), { message: "Completa la institución del recurso 1." });
  assert.throws(() => limpiarRecursos([{ ...fila, institucion: "x".repeat(201) }]), /200 caracteres/);
  assert.throws(() => limpiarRecursos(Array.from({ length: 21 }, () => fila)), { message: "Registra como máximo 20 recursos por reporte." });
});

test("Carga en contenedores takes no new reports, but its earlier reports still validate for an edit", () => {
  assert.equal(admiteReportesNuevos("carga"), false);
  const nuevas = (Object.keys(forms) as OperacionLimpieza[]).filter(admiteReportesNuevos);
  assert.deepEqual(nuevas, ["recoleccion", "patioSCY", "relleno", "puertoSCY", "embarque", "patioGYE", "recepcion", "gestion"]);
  assert.deepEqual(nuevas.filter((k) => forms[k].route === "R1"), ["recoleccion"]);
  assert.deepEqual(clean("carga", { fecha: "2026-11-10", contenedor: "c-1", tipo: "Escombro", t: 2, m3: 3, u: 1 }), {
    fecha: "2026-11-10", contenedor: "C-1", tipo: "Escombro", t: 2, m3: 3, u: 1,
  });
});
