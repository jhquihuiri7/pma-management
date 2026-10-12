import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { interpretarContribucion, interpretarInversion } from "../modules/pg2030/ia/interpretar.js";
import { promptContribucion, promptInversion } from "../modules/pg2030/ia/prompts.js";
import { construirContexto, huellaDe } from "../modules/pg2030/clasificacionModule.js";

const here = dirname(fileURLToPath(import.meta.url));

test("contribution answers resolve to one category, whatever the model wraps them in", () => {
  const cases: Array<[string, string | null]> = [
    ["Contribución directa", "Contribución directa"],
    ["contribucion complementaria.", "Contribución complementaria"],
    ['"Alineación relativa"', "Alineación relativa"],
    ["Contribución complementaria (Alineación parcial)", "Contribución complementaria"],
    ["Sin alineación: (Sin datos)", "Sin alineación"],
    ["Sin datos", "Sin alineación"],
    ["<think>La meta apoya un componente operativo…</think>\nContribución complementaria", "Contribución complementaria"],
    ["```\nAlineación relativa\n```", "Alineación relativa"],
    ["La categoría que corresponde es: Contribución directa.", "Contribución directa"],
    // Ambiguous or empty answers are invalid and get retried.
    ["Contribución directa o complementaria", null],
    ["Contribución directa y Alineación relativa", null],
    ["", null],
    ["<think>sin terminar", null],
    ["No puedo determinarlo", null],
  ];
  for (const [raw, expected] of cases) assert.equal(interpretarContribucion(raw), expected, raw);
});

test("investment answers keep 'Bienes-servicios' apart from 'Servicios'", () => {
  const cases: Array<[string, string | null]> = [
    ["Obras", "Obras"],
    ["Bienes-servicios", "Bienes-servicios"],
    ["bienes servicios", "Bienes-servicios"],
    ["Servicios.", "Servicios"],
    ["El tipo de inversión es: Adquisición de bienes", "Adquisición de bienes"],
    ["Contratación de personal", "Contratación de personal"],
    ['"Sin datos"', "Sin datos"],
    ["Obras y Estudios", null],
  ];
  for (const [raw, expected] of cases) assert.equal(interpretarInversion(raw), expected, raw);
});

test("the prompts are the annex's, word for word, with only the two placeholders filled", () => {
  const plan = readFileSync(join(here, "../../../../docs/pg2030-plan.md"), "utf8");
  const annex = plan.slice(plan.indexOf("## Anexo A"), plan.indexOf("## Anexo B"));
  const [contribucion, inversion] = [...annex.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  // Function replacers: "$&" must arrive as typed, not as a pattern.
  const fill = (t: string) => t.replace("{meta}", () => "META $& $1").replace("{contexto}", () => "CTX");
  assert.equal(promptContribucion("META $& $1", "CTX"), fill(contribucion));
  assert.equal(promptInversion("META $& $1", "CTX"), fill(inversion));
});

test("the context joins the goal, its beneficiaries and what each reported month says", () => {
  const meta = { nombre: "Productores asistidos", descripcion: "En buenas prácticas", beneficiariosDirectos: "120 familias" };
  const contexto = construirContexto(meta, [
    { mes: 6, reportado: true, hitosAlcanzados: "Taller 2", observaciones: null },
    { mes: 5, reportado: true, hitosAlcanzados: "Taller 1", observaciones: "Lluvias" },
    { mes: 7, reportado: false, hitosAlcanzados: "no guardado", observaciones: null },
  ]);
  assert.equal(contexto, "Productores asistidos - En buenas prácticas - 120 familias - Taller 1 - Lluvias - Taller 2");
  assert.equal(huellaDe("Meta del Plan", contexto), huellaDe("Meta del Plan", contexto));
  assert.notEqual(huellaDe("Meta del Plan", contexto), huellaDe("Otra meta", contexto));
});
