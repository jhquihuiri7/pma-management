import assert from "node:assert/strict";
import test from "node:test";
import type { RiesgosDelegacionEntrada, RiesgosFichaEntrada, RiesgosRecursoEntrada } from "@pma/types";
import { celdaSegura } from "../modules/riesgos/exportacion.js";
import {
  camposInvalidos,
  claveActivo,
  claveInstitucion,
  delegacionSchema,
  fichaSchema,
} from "../modules/riesgos/modelo.js";

function recurso(cambios: Partial<RiesgosRecursoEntrada> = {}): RiesgosRecursoEntrada {
  return {
    tipo: "Vehículos",
    nombre: "Camioneta 4x4",
    ubicacion: "Bodega central",
    unidad: "vehículos",
    cantidadExistente: 3,
    cantidadOperativa: 2,
    cantidadMovilizable: 1,
    esTitular: true,
    disponibilidad: "Inmediata",
    restricciones: "",
    detalles: { clase: "Camioneta", capacidad: "5 personas" },
    ...cambios,
  };
}

function ficha(cambios: Partial<RiesgosFichaEntrada> = {}): RiesgosFichaEntrada {
  return {
    id: "6b0e2a0c-7c55-4f0e-9a7b-0d6c3c1f2a11",
    institucionNombre: "Cuerpo de Bomberos",
    institucionTipo: "Público",
    mesaGrupo: "GT-3: Grupo de Trabajo Búsqueda y Rescate (Búsqueda, salvamento y rescate)",
    isla: "San Cristóbal",
    principal: { nombre: "Ana Pérez", cargo: "Jefa", correo: "ana@example.org", telefono: "0991234567" },
    alterno: { nombre: "Luis Mora", cargo: "Subjefe", correo: "luis@example.org", telefono: "0997654321" },
    delegadosConfirmados: true,
    brechas: "",
    observaciones: "",
    recursos: [recurso()],
    ...cambios,
  };
}

function rechazos(schema: typeof fichaSchema | typeof delegacionSchema, value: unknown): Record<string, string> {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, "the value should be rejected");
  return Object.fromEntries(camposInvalidos(result.error!).map((c) => [c.campo, c.mensaje]));
}

test("a complete ficha passes and keeps only the detail fields of its type", () => {
  const parsed = fichaSchema.parse(ficha({
    recursos: [recurso({ detalles: { clase: "Camioneta", capacidad: "", especialidad: "no corresponde" } })],
  }));
  assert.deepEqual(parsed.recursos[0].detalles, { clase: "Camioneta" });
});

test("quantities must step down from existing to operational to mobilizable", () => {
  const campos = rechazos(fichaSchema, ficha({
    recursos: [recurso({ cantidadExistente: 1, cantidadOperativa: 2, cantidadMovilizable: 3 })],
  }));
  assert.equal(campos["recursos.0.cantidadOperativa"], "No puede superar la cantidad existente.");
  assert.equal(campos["recursos.0.cantidadMovilizable"], "No puede superar la cantidad operativa.");
});

test("only an owner commits a resource, and nothing unavailable is mobilizable", () => {
  const ajeno = rechazos(fichaSchema, ficha({ recursos: [recurso({ esTitular: false })] }));
  assert.match(ajeno["recursos.0.cantidadMovilizable"], /titular/);

  const noDisponible = rechazos(fichaSchema, ficha({ recursos: [recurso({ disponibilidad: "No disponible" })] }));
  assert.match(noDisponible["recursos.0.disponibilidad"], /no disponible/i);

  assert.equal(fichaSchema.safeParse(ficha({
    recursos: [recurso({ esTitular: false, cantidadMovilizable: 0, disponibilidad: "No disponible" })],
  })).success, true);
});

test("the same asset twice in one ficha is rejected, whatever its spelling", () => {
  const campos = rechazos(fichaSchema, ficha({
    recursos: [recurso(), recurso({ nombre: "  camioneta   4X4 ", ubicacion: "bodega CENTRAL" })],
  }));
  assert.match(campos["recursos.1.nombre"], /duplicado/);
  assert.equal(campos["recursos.0.nombre"], undefined);
});

test("the two delegates must be different people", () => {
  const campos = rechazos(fichaSchema, ficha({
    alterno: { nombre: "ana pérez", cargo: "Jefa", correo: "ANA@example.org", telefono: "0991234567" },
  }));
  assert.match(campos["alterno.correo"], /distintos/);
  assert.match(campos["alterno.nombre"], /distintas/);
});

test("confirmation, catalog values, phones and the resource limit are enforced", () => {
  const campos = rechazos(fichaSchema, {
    ...ficha({ mesaGrupo: "MTT-9: inventada" }),
    delegadosConfirmados: false,
    principal: { nombre: "Ana Pérez", cargo: "Jefa", correo: "ana@example.org", telefono: "099-123" },
  });
  assert.ok(campos.delegadosConfirmados);
  assert.ok(campos.mesaGrupo);
  assert.match(campos["principal.telefono"], /dígitos/);

  const demasiados = Array.from({ length: 51 }, (_, i) => recurso({ nombre: `Recurso ${i}` }));
  assert.ok(rechazos(fichaSchema, ficha({ recursos: demasiados })).recursos);
  assert.ok(rechazos(fichaSchema, ficha({ recursos: [] })).recursos);
});

test("unknown fields are refused instead of silently stored", () => {
  assert.equal(fichaSchema.safeParse({ ...ficha(), estado: "validado" }).success, false);
  assert.equal(fichaSchema.safeParse(ficha({ recursos: [{ ...recurso(), estado: "validado" } as RiesgosRecursoEntrada] })).success, false);
});

test("an institution keeps one key across case, accents and spacing", () => {
  assert.equal(claveInstitucion("Ministerio de Educación"), claveInstitucion("  ministerio  de EDUCACION "));
  assert.notEqual(claveInstitucion("Ministerio de Educación"), claveInstitucion("Ministerio de Salud"));
  const enIsla = (cambios: Partial<RiesgosRecursoEntrada>, isla = "San Cristóbal") => claveActivo({ ...recurso(cambios), isla });
  assert.equal(enIsla({}), enIsla({ nombre: "CAMIONETA 4x4" }));
  assert.notEqual(enIsla({}), enIsla({}, "Santa Cruz"));
});

test("a resource has no island of its own; one sent by an older page is dropped", () => {
  const parsed = fichaSchema.parse(ficha({
    recursos: [{ ...recurso(), isla: "Isabela" } as RiesgosRecursoEntrada],
  }));
  assert.equal("isla" in parsed.recursos[0], false);
  // Other unknown fields are still refused.
  assert.equal(fichaSchema.safeParse(ficha({
    recursos: [{ ...recurso(), isla: "Isabela", extra: 1 } as RiesgosRecursoEntrada],
  })).success, false);
});

test("a COE designation needs its reporter and two distinct delegates", () => {
  const valida: RiesgosDelegacionEntrada = {
    id: "0c8a6f3e-1b1d-4a43-9b51-5a1a9f6a3e22",
    institucionNombre: "Cuerpo de Bomberos",
    institucionTipo: "Público",
    isla: "Santa Cruz",
    mesaGrupo: "No pertenece",
    reporta: { nombre: "Rosa Vera", cargo: "Secretaria", correo: "rosa@example.org", telefono: "0990000000" },
    principal: { nombre: "Ana Pérez", cargo: "Jefa", documento: "2000000001", correo: "ana@example.org", telefono: "0991234567" },
    alterno: { nombre: "Luis Mora", cargo: "Subjefe", documento: "", correo: "luis@example.org", telefono: "0997654321" },
    confirmado: true,
  };
  assert.equal(delegacionSchema.safeParse(valida).success, true);

  const campos = rechazos(delegacionSchema, { ...valida, alterno: { ...valida.alterno, correo: "ana@example.org" } });
  assert.match(campos["alterno.correo"], /distintos/);
  assert.ok(rechazos(delegacionSchema, { ...valida, reporta: { ...valida.reporta, correo: "no-es-correo" } })["reporta.correo"]);
});

test("exported cells never start a formula", () => {
  assert.equal(celdaSegura("=HYPERLINK(\"http://x\")"), "'=HYPERLINK(\"http://x\")");
  assert.equal(celdaSegura("  +1"), "'  +1");
  assert.equal(celdaSegura("@SUM"), "'@SUM");
  assert.equal(celdaSegura("0991234567"), "0991234567");
  assert.equal(celdaSegura(12), 12);
  assert.equal(celdaSegura(null), "");
});
