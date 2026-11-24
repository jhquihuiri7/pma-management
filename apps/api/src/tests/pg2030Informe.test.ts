import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { armarInforme, fijarRutaPlantilla, plantilla } from "../modules/pg2030/informe/documento.js";
import { leerHechos, pct, usd } from "../modules/pg2030/informe/hechos.js";
import { redactarAnalisis, type Redactor } from "../modules/pg2030/informe/informeModule.js";
import { reemplazar, textoDe } from "../modules/pg2030/informe/ooxml.js";
import { nombreInventado, validarInterpretacion, validarObservacion } from "../modules/pg2030/informe/redaccion.js";
import { escribirZip, leerZip } from "../modules/pg2030/informe/zip.js";
import { CAMPOS, dinero, panelEjemplo } from "./fixtures/pg2030PanelEjemplo.js";

/** A 1×1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const hechos = () =>
  leerHechos(panelEjemplo(), {
    tipo: "Ejecutivo",
    sinAccionesSiglas: ["XI", "PHI"],
    objetivos: new Map([["e-com", "Incrementar el bienestar del habitante isleño."]]),
  });

/**
 * The template is an internal document kept out of the (public) repository:
 * PG2030_INFORME_PLANTILLA, or the copy in the repository root that .gitignore
 * keeps out. Without it the tests that build a report are skipped.
 */
const RUTA_PLANTILLA =
  process.env.PG2030_INFORME_PLANTILLA ?? fileURLToPath(new URL("../../../../6.1 Informe PG2030 2026 1T vf 10abr26.docx", import.meta.url));
const hayPlantilla = existsSync(RUTA_PLANTILLA);
if (hayPlantilla) fijarRutaPlantilla(RUTA_PLANTILLA);
const conPlantilla = { skip: hayPlantilla ? false : `sin plantilla en ${RUTA_PLANTILLA}` };

test("the template still has every paragraph the report takes by position", conPlantilla, () => {
  const P = plantilla();
  assert.equal(P.elementos.length, 239);
});

test("a missing template is a readable error", () => {
  fijarRutaPlantilla("/no/existe/plantilla.docx");
  try {
    assert.throws(() => plantilla(), /No se encontró la plantilla del informe en \/no\/existe\/plantilla\.docx/);
  } finally {
    fijarRutaPlantilla(hayPlantilla ? RUTA_PLANTILLA : null);
  }
});

test("the ZIP writer round-trips its files", () => {
  const archivos = new Map<string, Buffer>([
    ["[Content_Types].xml", Buffer.from("<Types/>")],
    ["word/document.xml", Buffer.from("<w:document>ñandú «x»</w:document>".repeat(200))],
    ["word/media/a.png", PNG],
  ]);
  const otra = leerZip(escribirZip(archivos));
  assert.deepEqual([...otra.keys()], [...archivos.keys()]);
  for (const [k, v] of archivos) assert.ok(otra.get(k)!.equals(v), k);
});

test("text is replaced even when Word split it across runs, keeping the first run's format", () => {
  const xml = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>del 202</w:t></w:r><w:r><w:t>6 y más</w:t></w:r></w:p>';
  const out = reemplazar(xml, "2026", "2027");
  assert.equal(textoDe(out), "del 2027 y más");
  assert.match(out, /<w:b\/><\/w:rPr><w:t xml:space="preserve">del 2027<\/w:t>/);
  assert.throws(() => reemplazar(xml, "2030", "x"), /no se encontró/);
});

test("an interpretation with figures, acronyms or another script is rejected", () => {
  const ok = "La gestión muestra avances, pero se requiere fortalecer la planificación para cumplir el Plan Galápagos 2030 en el corto plazo.";
  assert.equal(validarInterpretacion(ok, 2026), ok);
  assert.equal(validarInterpretacion("El avance del 80 % refleja una gestión adecuada de las metas institucionales del período.", 2026), null);
  assert.equal(validarInterpretacion("La institución SIGMA muestra rezagos importantes en la ejecución de las metas del período evaluado.", 2026), null);
  assert.equal(validarInterpretacion("这是一个测试 de la gestión de las metas del plan en el período evaluado y más.", 2026), null);
  // An answer cut by the token limit keeps its complete sentences only.
  assert.equal(validarInterpretacion(`${ok} Además, las instituciones deben`, 2026), ok);
  assert.equal(validarInterpretacion(`<think>pienso</think>**${ok}**`, 2026), ok);
});

test("praise for a result short of expected and made-up names are rejected (real 2B answers, 2026-11-24)", () => {
  const presupuesto =
    "La ejecución presupuestaria del primer trimestre de 2026 muestra un avance significativo respecto a la planificación inicial, lo cual refuerza el cumplimiento progresivo de los objetivos institucionales.";
  assert.equal(validarInterpretacion(presupuesto, 2026, { valoracion: "desfavorable" }), null);
  assert.ok(validarInterpretacion(presupuesto, 2026, { valoracion: "favorable" }));
  const inventado =
    "El avance físico cercano al esperado confirma que la infraestructura física está progresando, aunque se requiere supervisión específica en los sectores de Anticipación y Seguridad.";
  assert.equal(nombreInventado(inventado, "HALLAZGOS: El avance físico promedio alcanzó el 80%."), "Anticipación");
  assert.equal(validarInterpretacion(inventado, 2026, { entrada: "HALLAZGOS: avance físico", valoracion: "mixta" }), null);
  // Names the input gave (the axes) are fine.
  const ejes = "La concentración de metas en los ejes de Comunidad y Hábitat exige fortalecer la articulación con el Plan Galápagos 2030 en el resto de ejes.";
  assert.equal(validarInterpretacion(ejes, 2026, { entrada: "mayor concentración de metas en los ejes de Comunidad y Hábitat", valoracion: "mixta" }), ejes);
  // Alarm for a result within expected is rejected too.
  assert.equal(validarInterpretacion("El resultado revela deficiencias graves en la gestión de las metas institucionales del período.", 2026, { valoracion: "favorable" }), null);
});

test("the note's rewrite keeps its figures and acronyms and adds none", () => {
  const nota = "La institución ALFA remitió la matriz sin la programación mensual de 3 metas.";
  assert.ok(validarObservacion("La institución (ALFA) remitió la matriz sin incluir la programación mensual de 3 metas, lo que impidió evaluarlas.", nota));
  assert.equal(validarObservacion("La institución ALFA remitió la matriz sin la programación de 4 metas.", nota), null, "changed a figure");
  assert.equal(validarObservacion("Las instituciones ALFA y BETA remitieron la matriz sin la programación mensual de 3 metas.", nota), null, "added an acronym");
});

test("the report keeps the template and writes the cutoff's figures", conPlantilla, async () => {
  const h = hechos();
  // A model that answers well once, breaks the rules once, then fails outright.
  let llamadas = 0;
  const redactor: Redactor = async (usuario) => {
    llamadas += 1;
    if (usuario.startsWith("Redacta el siguiente TEXTO")) return "La institución ALFA remitió la matriz sin la programación mensual de 3 metas, lo que impidió evaluar su cumplimiento.";
    if (usuario.includes("alineación")) return "La planificación se concentra en acciones de apoyo; se requiere orientarla hacia una contribución directa al Plan Galápagos 2030.";
    if (usuario.includes("avance físico de las metas")) return "La institución GAMA alcanzó el 90 % y eso es bueno para el plan provincial.";
    throw new (await import("../modules/pg2030/ia/cliente.js")).ProveedorIaError("Tiempo agotado");
  };
  const avisos: string[] = [];
  const pasos: string[] = [];
  const textos = await redactarAnalisis(h, CAMPOS, redactor, (_p, _t, d) => pasos.push(d), (a) => avisos.push(a));
  assert.equal(llamadas, 4, "after the provider fails, the remaining slots do not call it");
  assert.match(avisos[0], /No se pudo usar la IA \(Tiempo agotado\)/);
  assert.match(textos.interpretaciones.get("alineacion")!, /contribución directa al Plan/);
  assert.match(textos.interpretaciones.get("avanceFisico")!, /^Si bien este resultado/, "rule-breaking answer → fallback");
  assert.equal(pasos[pasos.length - 1], "Armando el documento");

  const docx = armarInforme(h, CAMPOS, textos, { alineacion: PNG, avanceFisico: PNG, presupuesto: PNG, coherencia: PNG, inversion: PNG });
  if (process.env.PG2030_INFORME_SALIDA) writeFileSync(process.env.PG2030_INFORME_SALIDA, docx);
  const archivos = leerZip(docx);
  const doc = archivos.get("word/document.xml")!.toString("utf8");
  const texto = textoDe(doc);

  for (const esperado of [
    "Nro. CGREG-DGTAR-2026-099",
    "Período Enero – Marzo 2026",
    "15 de abril del 2026",
    "Mediante Oficio Nro. CGREG-P-2025-0001-OF, del 3 de noviembre de 2025, el CGREG notificó a 24 instituciones públicas",
    "con fecha límite de remisión para el 20 de marzo de 2026.",
    "7 instituciones cumplieron con la entrega de los reportes de avance del primer trimestre (ALFA, BETA, DELTA, GAMA, KAPA, OMEGA, SIGMA).",
    "4 instituciones no remitieron la información (IOTA, LAMBDA, OMICRON, RHO).",
    "instituciones indicaron no tener acciones en su planificación vinculadas al cumplimiento del Plan Galápagos 2030 (PHI, XI).",
    `El avance físico institucional promedio alcanzó un ${pct(0.8)}`,
    `asciende a ${usd(300000)} frente a una planificación de ${usd(500000)}`,
    "Cumplimiento del reporte de avances",
    "Presupuesto por tipo de inversión",
    "Gráfico 5: Presupuesto planificado y devengado por tipo de inversión – Primer trimestre 2026",
    "Tabla 7: Presupuesto por tipo de inversión – Primer trimestre 2026",
    "La institución ALFA remitió la matriz sin la programación mensual de 3 metas, lo que impidió evaluar su cumplimiento.",
    "Matriz consolidada “PG2030_Consolidado metas año 2026 T1”",
    "https://drive.example.org/matriz",
    "Firmas de responsabilidad",
  ]) {
    assert.ok(texto.includes(esperado), `falta: ${esperado}`);
  }
  // The legal framework and methodology are the template's text.
  assert.ok(texto.includes("El Código Orgánico Administrativo en el artículo 28"));
  assert.ok(texto.includes("Contribución directa (Alineación total):"));

  // Every bookmark is whole, every TOC line points at one, every image has its part.
  const inicios = [...doc.matchAll(/<w:bookmarkStart w:id="(\d+)" w:name="([^"]+)"\/>/g)];
  const fines = new Set([...doc.matchAll(/<w:bookmarkEnd w:id="(\d+)"\/>/g)].map((m) => m[1]));
  for (const m of inicios) assert.ok(fines.has(m[1]), `marcador sin cierre: ${m[2]}`);
  const nombres = new Set(inicios.map((m) => m[2]));
  const anclas = [...doc.matchAll(/w:anchor="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(anclas.length, 18, "TOC: title, 10 sections, 2 + 5 subsections");
  for (const a of anclas) assert.ok(nombres.has(a), `el índice apunta a ${a}, que no existe`);
  const rels = archivos.get("word/_rels/document.xml.rels")!.toString("utf8");
  for (let n = 1; n <= 5; n++) {
    assert.ok(rels.includes(`Id="rIdPG${n}"`));
    assert.ok(archivos.has(`word/media/pg2030_grafico${n}.png`));
  }
  assert.ok(rels.includes('Target="https://drive.example.org/matriz"'));
  assert.match(archivos.get("word/settings.xml")!.toString("utf8"), /<w:updateFields w:val="true"\/><w:hdrShapeDefaults/);
  assert.equal((doc.match(/<w:tbl>/g) ?? []).length + (doc.match(/<w:tbl [^>]*>/g) ?? []).length, 8, "tabla 1 + 6 tables + signatures");
});

test("a cutoff with nothing reported still produces the report", conPlantilla, async () => {
  const d = panelEjemplo();
  d.instituciones = d.instituciones.map((i) => ({ ...i, reportadas: 0, cuenta: false, estadoReporte: "no_cumplio", metas: [] }));
  d.avanceFisico = { valor: null, semaforo: null };
  d.presupuesto.total = dinero(0, 0, 0);
  d.inversion = [];
  const h = leerHechos(d, { sinAccionesSiglas: [], objetivos: new Map() });
  const textos = await redactarAnalisis(h, { ...CAMPOS, observaciones: "" }, async () => "", () => {}, () => {});
  const texto = textoDe(leerZip(armarInforme(h, { ...CAMPOS, enlaceAnexo: "" }, textos, {})).get("word/document.xml")!.toString("utf8"));
  assert.ok(texto.includes("no se registraron metas reportadas que permitan calcular el avance institucional"));
  assert.ok(!texto.includes("https://"), "no link paragraph without a link");
  const archivos = leerZip(armarInforme(h, { ...CAMPOS, enlaceAnexo: "" }, textos, {}));
  assert.ok(!archivos.get("word/_rels/document.xml.rels")!.toString("utf8").includes('Id="rId12"'), "nor the template's hyperlink relationship");
  // Whatever link the template had, the report does not carry it.
  for (const [nombre, datos] of archivos) assert.ok(!/\/drive\/d\/s\//.test(datos.toString("latin1")), `${nombre} lleva un enlace compartido`);
});

test("a busy provider (429) is retried before falling back; a second failure gives up", async () => {
  const { ProveedorIaError } = await import("../modules/pg2030/ia/cliente.js");
  const ok = "La gestión requiere fortalecer la planificación para cumplir el Plan Galápagos 2030 en los siguientes cortes del año.";
  const pausas: number[] = [];
  let llamadas = 0;
  const unaVez: Redactor = async () => {
    llamadas += 1;
    if (llamadas === 1) throw new ProveedorIaError("HTTP 429: temporarily rate-limited upstream");
    return ok;
  };
  const textos = await redactarAnalisis(hechos(), { ...CAMPOS, observaciones: "" }, unaVez, () => {}, () => {}, { pausa: async (ms) => void pausas.push(ms) });
  assert.deepEqual(pausas, [10_000], "one wait, then the retry answered");
  assert.equal(textos.interpretaciones.get("alineacion"), ok);

  const avisos: string[] = [];
  llamadas = 0;
  const siempre: Redactor = async () => {
    llamadas += 1;
    throw new ProveedorIaError("HTTP 429: busy");
  };
  await redactarAnalisis(hechos(), { ...CAMPOS, observaciones: "" }, siempre, () => {}, (a) => avisos.push(a), { pausa: async () => {} });
  assert.equal(llamadas, 3, "first try + two retries, then every other slot skips the provider");
  assert.match(avisos[0], /No se pudo usar la IA \(HTTP 429/);
});
