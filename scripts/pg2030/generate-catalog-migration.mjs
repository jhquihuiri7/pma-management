#!/usr/bin/env node
// Generates apps/api/src/db/migrations/0032_pg2030_catalog_data.sql from the
// Plan Galápagos 2030 matrix (resultado_final.xlsx, sheet "Sheet1").
//
// Run once, offline, from the repository root:
//
//   node scripts/pg2030/generate-catalog-migration.mjs [path/to/resultado_final.xlsx]
//
// The output is a hand-reviewed migration: every correction listed in
// docs/pg2030-plan.md §3 is applied here so it shows up in the diff, and the
// script refuses to write anything if the counts the plan relies on drift.
// Once 0032 has been applied anywhere, do not regenerate it — correct the
// catalog from the PG2030 admin screens instead.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = resolve(process.argv[2] ?? join(ROOT, "resultado_final.xlsx"));
const OUTPUT = join(ROOT, "apps/api/src/db/migrations/0032_pg2030_catalog_data.sql");

// Row 189 is an MIT airport project mis-coded as PG0048. It is the only row
// that carries this objective, which is how it is recognised (and asserted).
const DISCARDED_OBJECTIVE = "O.E.1";
const DISCARDED_EXCEL_ROW = 189;

const PROJECT_TYPES = new Set(["Acción", "Proyecto"]);
const BUDGET_STATES = new Map([
  ["SPI", "SPI"],
  ["No disponible", "No disponible"],
  ["Presupuesto a definirse en la LISS", "A definirse en la LISS"],
]);
const PLAZOS = new Set(["Ahora (inmediato)", "Corto plazo (3 años)", "Mediano plazo (6 años)", "En marcha"]);

// What docs/pg2030-plan.md promises after the import. Any drift means the
// source changed and the plan has to be revisited before this file is.
const EXPECTED = {
  ejes: 5,
  objetivos: 5,
  politicas: 17,
  estrategias: 43,
  metas: 50,
  metasCuantificables: 12,
  proyectos: 139,
  hitos2030: 51,
  presupuesto: { Monto: 74, SPI: 60, "No disponible": 3, "A definirse en la LISS": 1, "Sin dato": 1 },
  presupuestoTotal: 101_377_000,
};

/** Collapse whitespace runs: the matrix is full of double spaces and stray newlines. */
function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** "G1: Institucionalizar…" → "Institucionalizar…" when the prefix repeats the code. */
function stripCodePrefix(code, text) {
  const prefix = `${code}:`;
  return text.startsWith(prefix) ? text.slice(prefix.length).trim() : text;
}

function fail(message) {
  throw new Error(`generate-catalog-migration: ${message}`);
}

function sqlText(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlTextArray(values) {
  return `ARRAY[${values.map(sqlText).join(", ")}]::text[]`;
}

const workbook = XLSX.readFile(SOURCE);
const sheet = workbook.Sheets.Sheet1;
if (!sheet) fail(`no "Sheet1" in ${SOURCE}`);
const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });

const discarded = [];
const rows = [];
rawRows.forEach((row, index) => {
  const excelRow = index + 2;
  if (clean(row["COD_UNI_OBJETIVO_ESTRATÉGICO"]) === DISCARDED_OBJECTIVE) {
    discarded.push({ excelRow, project: clean(row.COD_UNI_P), name: clean(row.PROYECTOS_O_ACCIONES) });
    return;
  }
  rows.push({ excelRow, row });
});
if (discarded.length !== 1 || discarded[0].excelRow !== DISCARDED_EXCEL_ROW) {
  fail(`expected to discard exactly Excel row ${DISCARDED_EXCEL_ROW}, got ${JSON.stringify(discarded)}`);
}

const ejes = new Map();
const objetivos = new Map();
const politicas = new Map();
const estrategias = new Map();
const metas = new Map();
const proyectos = new Map();
const corrections = [`Fila ${DISCARDED_EXCEL_ROW} descartada: ${discarded[0].project} "${discarded[0].name}" (objetivo ${DISCARDED_OBJECTIVE}).`];

/** Register a hierarchy node, refusing a code that changes parent or text between rows. */
function registerNode(map, code, data, label, excelRow) {
  if (!code) fail(`empty ${label} code in Excel row ${excelRow}`);
  const existing = map.get(code);
  if (!existing) {
    map.set(code, data);
    return;
  }
  for (const [key, value] of Object.entries(data)) {
    if (existing[key] !== value) {
      fail(`${label} ${code} has conflicting "${key}" in Excel row ${excelRow}: "${existing[key]}" vs "${value}"`);
    }
  }
}

function budgetOf(value, code, excelRow) {
  if (typeof value === "number") {
    if (!(value > 0)) fail(`non-positive budget ${value} for ${code} in Excel row ${excelRow}`);
    return { estado: "Monto", monto: value };
  }
  const text = clean(value);
  if (text === "") return { estado: "Sin dato", monto: null };
  const estado = BUDGET_STATES.get(text);
  if (!estado) fail(`unknown budget value "${text}" for ${code} in Excel row ${excelRow}`);
  return { estado, monto: null };
}

for (const { excelRow, row } of rows) {
  const ejeCode = clean(row["COD_UNI_EJE_ESTRATÉGICO"]);
  const objetivoCode = clean(row["COD_UNI_OBJETIVO_ESTRATÉGICO"]);
  const politicaCode = clean(row.COD_UNI_POLITICA);
  const estrategiaCode = clean(row.COD_UNI_ESTRATEGIA);
  const metaCode = clean(row.COD_UNI_METAS);
  const proyectoCode = clean(row.COD_UNI_P);

  registerNode(ejes, ejeCode, { nombre: clean(row["EJES_ESTRATÉGICOS"]) }, "eje", excelRow);
  registerNode(objetivos, objetivoCode, { eje: ejeCode, texto: clean(row["OBJETIVOS_ESTRATÉGICOS"]) }, "objetivo", excelRow);
  registerNode(politicas, politicaCode, {
    objetivo: objetivoCode,
    texto: stripCodePrefix(politicaCode, clean(row["POLÍTICA"])),
  }, "política", excelRow);
  registerNode(estrategias, estrategiaCode, {
    politica: politicaCode,
    texto: stripCodePrefix(estrategiaCode, clean(row.ESTRATEGIAS)),
  }, "estrategia", excelRow);

  const cuantificable = clean(row.TIENE_META_CUANTIFICABLE);
  if (cuantificable !== "SI" && cuantificable !== "NO") {
    fail(`unexpected TIENE_META_CUANTIFICABLE "${cuantificable}" in Excel row ${excelRow}`);
  }
  registerNode(metas, metaCode, {
    estrategia: estrategiaCode,
    texto: clean(row.METAS),
    cuantificable: cuantificable === "SI",
  }, "meta", excelRow);

  if (!/^PG\d{4}$/.test(proyectoCode)) fail(`unexpected project code "${proyectoCode}" in Excel row ${excelRow}`);
  const plazo = clean(row.PLAZO_ANEXO_7);
  if (plazo && !PLAZOS.has(plazo)) fail(`unexpected plazo "${plazo}" for ${proyectoCode} in Excel row ${excelRow}`);

  const candidate = {
    meta: metaCode,
    nombre: clean(row.PROYECTOS_O_ACCIONES),
    tipo: clean(row["TIPO_(ACCIÓN_PROYECTO)"]),
    plazo,
    budget: budgetOf(row.PRESUPUESTO_REFERENCIAL, proyectoCode, excelRow),
    tipoEntidadResponsable: clean(row.TIPO_DE_ENTIDAD_RESPONSABLE),
    responsablesPlan: clean(row.RESPONSABLE),
    entidadesEjecutoras: clean(row["ACTUALIZACIÓN_ENTIDAD_EJECUTORA"]),
    hito2023: clean(row.HITOS_2023),
    hito2030: clean(row.HITOS_2030),
  };
  const list = proyectos.get(proyectoCode) ?? [];
  list.push({ excelRow, ...candidate });
  proyectos.set(proyectoCode, list);
}

// Project fields that are compared across rows. The first row in the original
// order wins; every distinct later value is kept as a conflict for the admin.
const PROJECT_FIELDS = [
  ["nombre", "nombre"],
  ["plazo", "plazo"],
  ["tipoEntidadResponsable", "tipo_entidad_responsable"],
  ["responsablesPlan", "responsables_plan"],
  ["entidadesEjecutoras", "entidades_ejecutoras"],
  ["hito2023", "hito_2023"],
  ["hito2030", "hito_2030"],
];

const projects = [];
const conflicts = [];
for (const [code, candidates] of proyectos) {
  const metaCodes = new Set(candidates.map((c) => c.meta));
  if (metaCodes.size !== 1) fail(`project ${code} belongs to more than one meta: ${[...metaCodes].join(", ")}`);

  // Type: only "Acción"/"Proyecto" count. A formula pasted into the cell
  // (PG0123: "PG0131+N132+O59") is a correction, not an alternative value.
  const validTypes = candidates.map((c) => c.tipo).filter((t) => PROJECT_TYPES.has(t));
  for (const c of candidates) {
    if (!PROJECT_TYPES.has(c.tipo)) corrections.push(`${code}: tipo inválido "${c.tipo}" (fila ${c.excelRow}) ignorado.`);
  }
  if (validTypes.length === 0) fail(`project ${code} has no valid type`);
  const tipo = validTypes[0];
  if (new Set(validTypes).size > 1) {
    conflicts.push({ code, campo: "tipo", usado: tipo, alternativos: [...new Set(validTypes)].filter((t) => t !== tipo) });
  }

  const first = candidates[0];
  for (const [key, column] of PROJECT_FIELDS) {
    const values = [...new Set(candidates.map((c) => c[key]))];
    if (values.length > 1) {
      conflicts.push({ code, campo: column, usado: first[key], alternativos: values.filter((v) => v !== first[key]) });
    }
  }
  const budgets = [...new Set(candidates.map((c) => `${c.budget.estado}:${c.budget.monto ?? ""}`))];
  if (budgets.length > 1) {
    const label = (b) => (b.estado === "Monto" ? String(b.monto) : b.estado);
    conflicts.push({
      code,
      campo: "presupuesto_referencial",
      usado: label(first.budget),
      alternativos: [...new Set(candidates.slice(1).map((c) => label(c.budget)))].filter((v) => v !== label(first.budget)),
    });
  }

  projects.push({ code, ...first, tipo });
}
projects.sort((a, b) => a.code.localeCompare(b.code));

// --- Assertions against the plan ----------------------------------------------
// Seeded in the expected key order so the JSON comparison below checks values.
const presupuesto = Object.fromEntries(Object.keys(EXPECTED.presupuesto).map((estado) => [estado, 0]));
let presupuestoTotal = 0;
for (const p of projects) {
  presupuesto[p.budget.estado] = (presupuesto[p.budget.estado] ?? 0) + 1;
  if (p.budget.monto !== null) presupuestoTotal += p.budget.monto;
}
const actual = {
  ejes: ejes.size,
  objetivos: objetivos.size,
  politicas: politicas.size,
  estrategias: estrategias.size,
  metas: metas.size,
  metasCuantificables: [...metas.values()].filter((m) => m.cuantificable).length,
  proyectos: projects.length,
  hitos2030: new Set(projects.map((p) => p.hito2030).filter(Boolean)).size,
  presupuesto,
  presupuestoTotal,
};
for (const [key, expected] of Object.entries(EXPECTED)) {
  if (JSON.stringify(actual[key]) !== JSON.stringify(expected)) {
    fail(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual[key])}`);
  }
}

// --- SQL ----------------------------------------------------------------------
const sha256 = createHash("sha256").update(readFileSync(SOURCE)).digest("hex");
const ejeOrder = [...ejes.keys()];
const statements = [];

statements.push(`INSERT INTO "pg2030_ejes" ("codigo", "nombre", "orden") VALUES
${ejeOrder.map((code, i) => `  (${sqlText(code)}, ${sqlText(ejes.get(code).nombre)}, ${i + 1})`).join(",\n")}
ON CONFLICT ("codigo") DO NOTHING;`);

function childInsert(table, parentTable, parentColumn, columns, entries) {
  const valueColumns = ["parent", "codigo", ...columns.map(([name]) => name)];
  const values = entries
    .map(([code, data]) => `  (${[sqlText(data.parent), sqlText(code), ...columns.map(([name, render]) => render(data[name]))].join(", ")})`)
    .join(",\n");
  const targetColumns = [parentColumn, "codigo", ...columns.map(([name]) => name)].map((c) => `"${c}"`).join(", ");
  const selected = ["p.\"id\"", "v.\"codigo\"", ...columns.map(([name, , cast]) => (cast ? `v."${name}"::${cast}` : `v."${name}"`))].join(", ");
  return `INSERT INTO "${table}" (${targetColumns})
SELECT ${selected}
FROM (VALUES
${values}
) AS v(${valueColumns.map((c) => `"${c}"`).join(", ")})
JOIN "${parentTable}" p ON p."codigo" = v."parent"
ON CONFLICT ("codigo") DO NOTHING;`;
}

const text = (v) => sqlText(v);
statements.push(childInsert("pg2030_objetivos", "pg2030_ejes", "eje_id", [["texto", text]],
  [...objetivos].map(([code, d]) => [code, { parent: d.eje, texto: d.texto }])));
statements.push(childInsert("pg2030_politicas", "pg2030_objetivos", "objetivo_id", [["texto", text]],
  [...politicas].map(([code, d]) => [code, { parent: d.objetivo, texto: d.texto }])));
statements.push(childInsert("pg2030_estrategias", "pg2030_politicas", "politica_id", [["texto", text]],
  [...estrategias].map(([code, d]) => [code, { parent: d.politica, texto: d.texto }])));
statements.push(childInsert("pg2030_metas_plan", "pg2030_estrategias", "estrategia_id",
  [["texto", text], ["cuantificable", (v) => (v ? "true" : "false")]],
  [...metas].map(([code, d]) => [code, { parent: d.estrategia, texto: d.texto, cuantificable: d.cuantificable }])));
statements.push(childInsert("pg2030_proyectos", "pg2030_metas_plan", "meta_plan_id", [
  ["nombre", text],
  ["tipo", text, '"pg2030_proyecto_tipo"'],
  ["plazo", text],
  ["presupuesto_estado", text, '"pg2030_presupuesto_estado"'],
  ["presupuesto_referencial", (v) => (v === null ? "NULL" : String(v)), "numeric"],
  ["tipo_entidad_responsable", text],
  ["responsables_plan", text],
  ["entidades_ejecutoras", text],
  ["hito_2023", text],
  ["hito_2030", text],
], projects.map((p) => [p.code, {
  parent: p.meta,
  nombre: p.nombre,
  tipo: p.tipo,
  plazo: p.plazo,
  presupuesto_estado: p.budget.estado,
  presupuesto_referencial: p.budget.monto,
  tipo_entidad_responsable: p.tipoEntidadResponsable,
  responsables_plan: p.responsablesPlan,
  entidades_ejecutoras: p.entidadesEjecutoras,
  hito_2023: p.hito2023,
  hito_2030: p.hito2030,
}])));

if (conflicts.length > 0) {
  statements.push(`INSERT INTO "pg2030_conflictos_importacion" ("proyecto_id", "campo", "valor_usado", "valores_alternativos")
SELECT p."id", v."campo", v."valor_usado", v."valores_alternativos"
FROM (VALUES
${conflicts.map((c) => `  (${sqlText(c.code)}, ${sqlText(c.campo)}, ${sqlText(c.usado)}, ${sqlTextArray(c.alternativos)})`).join(",\n")}
) AS v("codigo", "campo", "valor_usado", "valores_alternativos")
JOIN "pg2030_proyectos" p ON p."codigo" = v."codigo"
ON CONFLICT ("proyecto_id", "campo") DO NOTHING;`);
}

statements.push(`INSERT INTO "pg2030_instituciones" ("nombre", "sigla", "tipo") VALUES
  ('Consejo de Gobierno del Régimen Especial de Galápagos', 'CGREG', 'Ejecutivo')
ON CONFLICT DO NOTHING;`);

const header = `-- PG2030: catálogo del Plan Galápagos 2030 hasta el nivel de proyecto, y CGREG
-- como única institución inicial.
--
-- GENERATED by scripts/pg2030/generate-catalog-migration.mjs from
-- resultado_final.xlsx (sha256 ${sha256}).
-- Do not edit by hand and do not regenerate once applied: the catalog is
-- corrected from the PG2030 admin screens after this point.
--
-- Counts asserted by the generator: ${actual.ejes} ejes, ${actual.objetivos} objetivos,
-- ${actual.politicas} políticas, ${actual.estrategias} estrategias, ${actual.metas} metas (${actual.metasCuantificables} cuantificables),
-- ${actual.proyectos} proyectos, ${actual.hitos2030} hitos 2030 distintos, ${actual.presupuesto.Monto} proyectos con presupuesto
-- referencial por $${actual.presupuestoTotal.toLocaleString("es-EC")}.
--
-- Corrections applied (docs/pg2030-plan.md §3):
${corrections.map((c) => `--   - ${c}`).join("\n")}
--   - Códigos recortados y espacios repetidos colapsados en todos los textos.
--   - Prefijo "<código>:" quitado de los textos de políticas y estrategias.
--
-- ${conflicts.length} conflicts recorded in pg2030_conflictos_importacion (first row wins):
${conflicts.map((c) => `--   - ${c.code} ${c.campo}`).join("\n")}
--
-- Every insert is idempotent (ON CONFLICT DO NOTHING).
`;

writeFileSync(OUTPUT, `${header}\n${statements.join("\n--> statement-breakpoint\n")}\n`);
console.log(`Wrote ${OUTPUT}`);
console.log(JSON.stringify({ ...actual, conflicts: conflicts.length, corrections: corrections.length }, null, 2));
