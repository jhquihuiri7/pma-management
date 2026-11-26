import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { CoeActividad } from "@pma/types";
import { mensajeAviso } from "../modules/coeReporte/avisosModule.js";
import { actividadSchema, codigoEvento, propietarioDe, resultadoSchema } from "../modules/coeReporte/modelo.js";

// Fictitious data only: the repository is public.

const base = () => ({
  id: randomUUID(),
  evento: "EVT-2026-0123456789ABCDEF",
  dia: "2026-11-26",
  isla: "santa  cruz",
  sector: "Bellavista",
  institucion: "cuerpo de bomberos de santa cruz",
  instancia: "MTT",
  equipo: "MTT 3",
  descripcion: "Limpieza de cunetas",
  metas: [{ indicador: "Cunetas", cantidad: "12", unidad: "tramos" }],
  estado: "pending",
});

test("event code: same title in any case or spacing, same year, same event", () => {
  const a = codigoEvento("Lluvias  intensas Santa Cruz", "2026");
  assert.match(a, /^EVT-2026-[A-F0-9]{16}$/);
  assert.equal(codigoEvento("lluvias intensas santa cruz", "2026"), a);
  assert.notEqual(codigoEvento("lluvias intensas santa cruz", "2027"), a);
});

test("history code is stored only as its SHA-256", () => {
  const owner = propietarioDe("a".repeat(43));
  assert.match(owner, /^[a-f0-9]{64}$/);
});

test("activity: catalog names, team per coordination and pending drops results", () => {
  const ok = actividadSchema.parse({ ...base(), resultado: "ignorado", numeros: [{ indicador: "x", cantidad: 1, unidad: "u" }] });
  assert.equal(ok.isla, "Santa Cruz");
  assert.equal(ok.institucion, "Cuerpo de Bomberos de Santa Cruz");
  assert.equal(ok.resultado, "");
  assert.deepEqual(ok.numeros, []);

  assert.equal(actividadSchema.safeParse({ ...base(), equipo: "MTT 8" }).success, false);
  assert.equal(actividadSchema.safeParse({ ...base(), instancia: "GT", equipo: "GT 3" }).success, true);
  assert.equal(actividadSchema.safeParse({ ...base(), instancia: "Directa", equipo: "GT 1" }).success, false);
  assert.equal(actividadSchema.safeParse({ ...base(), dia: "2026-02-30" }).success, false);
  assert.equal(actividadSchema.safeParse({ ...base(), metas: [{ indicador: "x", cantidad: "-1", unidad: "u" }] }).success, false);
  assert.equal(actividadSchema.safeParse({ ...base(), estado: "extra" }).success, false, "extra needs a result");
  assert.equal(actividadSchema.safeParse({ ...base(), estado: "extra", resultado: "Hecho" }).success, true);
  assert.equal(actividadSchema.safeParse({ ...base(), propietario: "x" }).success, false, "unknown keys are refused");
});

test("result: a reason is required unless it was done", () => {
  const envio = randomUUID();
  assert.equal(resultadoSchema.safeParse({ envio, estado: "partial", resultado: "Parcial", motivo: "" }).success, false);
  const done = resultadoSchema.parse({ envio, estado: "done", resultado: "Hecho", motivo: "no aplica", numeros: [] });
  assert.equal(done.motivo, "");
  assert.equal(resultadoSchema.safeParse({ envio, estado: "extra", resultado: "x", motivo: "" }).success, false);
});

test("notice: subject, plain text and escaped HTML", () => {
  const actividad: CoeActividad = {
    id: randomUUID(),
    evento: "EVT-2026-0123456789ABCDEF",
    dia: "2026-11-26",
    isla: "Isabela",
    sector: "Puerto Villamil",
    institucion: "Institución de prueba",
    instancia: "GT",
    equipo: "GT 1",
    descripcion: "Entrega de <agua>",
    metas: [],
    estado: "missed",
    resultado: "No se entregó",
    motivo: "Mal tiempo",
    numeros: [{ indicador: "Litros", cantidad: "0", unidad: "l" }],
    creadoEn: "2026-11-26T13:00:00.000Z",
    completadoEn: "2026-11-27T00:00:00.000Z",
  };
  const m = mensajeAviso(actividad, "resultado", "Evento  de prueba", "https://example.invalid/coe-reporte/tablero");
  assert.equal(m.subject, "[COE Galápagos] Resultado · Evento de prueba");
  assert.match(m.text, /Resultado · Corte 19h00/);
  assert.match(m.text, /Coordinación: GT 1 · Logística/);
  assert.match(m.text, /Estado: No ejecutada/);
  assert.match(m.text, /Motivo: Mal tiempo/);
  assert.match(m.text, /Indicadores: Litros · 0 l/);
  assert.ok(m.html.includes("Entrega de &lt;agua&gt;"));
  assert.ok(!m.html.includes("<agua>"));
});
