import type { Pg2030Semaforo } from "@pma/types";
import { CONTRIBUCIONES } from "../ia/interpretar.js";
import {
  ETIQUETA_SEMAFORO,
  cuantas,
  ejeCorto,
  enumerar,
  pct,
  siglasDe,
  sujeto,
  usd,
  type Hechos,
} from "./hechos.js";
import { sinMarcado } from "./ooxml.js";

/**
 * The report's wording. Figures and institution names are always written
 * here, from the dashboard; the model only adds interpretation sentences with
 * no figures and no acronyms, because the local 2B model mislabels traffic
 * lights and invents what an acronym stands for when it handles them (tested
 * 2026-11-24). Every request has a deterministic fallback in the template's
 * own register, used when the model fails, times out or breaks a rule.
 */

export const SISTEMA =
  "Eres analista de planificación del Consejo de Gobierno del Régimen Especial de Galápagos (CGREG). " +
  "Escribes en español formal de informe técnico, en tercera persona.";

export interface PedidoIa {
  clave: string;
  /** What the progress line says while the model writes it. */
  titulo: string;
  usuario: string;
  /** The cleaned text, or null when the answer breaks a rule. */
  validar: (respuesta: string) => string | null;
  respaldo: string;
}

// ---------------------------------------------------------------------------
// Validation of the model's answers

const SIGLAS_PERMITIDAS = new Set(["CGREG", "DGTAR", "PDSOT", "PDSOTG"]);

export function limpiarTextoIa(respuesta: string): string {
  return respuesta
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/i, " ")
    .replace(/```[a-z]*\n?/gi, " ")
    .replace(/\*\*|__/g, "")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“«]+|["”»]+$/g, "")
    .trim();
}

function oraciones(texto: string): string[] {
  return texto.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«"“(])/).map((s) => s.trim()).filter(Boolean);
}

const NUMEROS = /\d+(?:[.,]\d+)*/g;
const SIGLAS = /(?<!\p{L})\p{Lu}{2,}(?!\p{L})/gu;
const palabras = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** Complete sentences only (the model may stop mid-sentence at its token limit). */
function completas(texto: string, max: number): string | null {
  let partes = oraciones(texto);
  if (partes.length && !/[.!?]$/.test(partes[partes.length - 1])) partes = partes.slice(0, -1);
  partes = partes.slice(0, max);
  return partes.length ? partes.join(" ") : null;
}

function pareceEspanol(t: string): boolean {
  return !/[぀-ヿ㐀-鿿가-힯]/.test(t) && /\b(el|la|los|las|de|que|en|del)\b/i.test(t);
}

/** How the dashboard rates a result; the model's tone must not contradict it. */
export type Valoracion = "favorable" | "mixta" | "desfavorable";

export function valoracionDe(semaforo: Pg2030Semaforo | null): Valoracion {
  return semaforo === "verde" ? "favorable" : semaforo === "amarillo" ? "mixta" : "desfavorable";
}

const TEXTO_VALORACION: Record<Valoracion, string> = {
  favorable: "FAVORABLE (el resultado está dentro de lo esperado)",
  mixta: "MIXTA (el resultado se acerca a lo esperado, pero con rezagos)",
  desfavorable: "DESFAVORABLE (el resultado está por debajo de lo esperado)",
};

/** Praise a result short of expected must not get (2026-11-24: "avance significativo" for 59 %). */
const ELOGIOS =
  /(?<!\p{L})(positiv[oa]s?|satisfactori[oa]s?|s[oó]lid[oa]s?|[oó]ptim[oa]s?|exitos[oa]s?|favorables?|excelentes?|avances? significativ[oa]s?|buen desempeño|alta eficiencia|eficiencia operativa)(?!\p{L})/iu;
/** Alarm a result within expected must not get. */
const ALARMAS = /(?<!\p{L})(deficien(?:te|tes|cia|cias)|cr[ií]tic[oa]s?|rezagos? importantes?|preocupantes?|graves?)(?!\p{L})/iu;

/** Capitalised words the model may use without them being in its input. */
const NOMBRES_PERMITIDOS = new Set([
  "Plan", "Galápagos", "Consejo", "Gobierno", "Régimen", "Especial", "Estado", "Función", "Ejecutiva", "Ejecutivo",
  "Provincia", "Desarrollo", "Sustentable", "Ordenamiento", "Territorial",
]);

/**
 * A capitalised word inside a sentence that the input never mentioned: the
 * model naming sectors or programs it made up (it expanded ANT and SECAP into
 * "Anticipación y Seguridad").
 */
export function nombreInventado(texto: string, entrada: string): string | null {
  for (const oracion of oraciones(texto)) {
    for (const palabra of oracion.split(/\s+/).slice(1)) {
      const limpia = palabra.replace(/^[«"“(¿¡]+|[»"”),.;:!?]+$/g, "");
      if (!/^\p{Lu}\p{Ll}+$/u.test(limpia) || NOMBRES_PERMITIDOS.has(limpia)) continue;
      if (!new RegExp(`(?<!\\p{L})${limpia}(?!\\p{L})`, "u").test(entrada)) return limpia;
    }
  }
  return null;
}

/**
 * An interpretation: whole sentences, no figures (other than 2030 and the
 * year), no acronyms, no names the input did not give, and a tone that does
 * not contradict the dashboard's rating.
 */
export function validarInterpretacion(
  respuesta: string,
  anio: number,
  { maxOraciones = 3, min = 12, max = 110, entrada, valoracion }: { maxOraciones?: number; min?: number; max?: number; entrada?: string; valoracion?: Valoracion } = {},
): string | null {
  const texto = completas(limpiarTextoIa(respuesta), maxOraciones);
  if (!texto || !pareceEspanol(texto)) return null;
  const numeros = texto.match(NUMEROS) ?? [];
  if (numeros.some((n) => n !== "2030" && n !== String(anio))) return null;
  if ((texto.match(SIGLAS) ?? []).some((s) => !SIGLAS_PERMITIDAS.has(s))) return null;
  if (entrada !== undefined && nombreInventado(texto, entrada)) return null;
  // The prompt's own wording leaking into the report ("la valoración desfavorable de este trimestre").
  if (/valoraci[oó]n (?:del resultado|favorable|desfavorable|mixta)|hallazgos? (?:indican|muestran|señalan)/i.test(texto)) return null;
  if (valoracion && valoracion !== "favorable" && ELOGIOS.test(texto)) return null;
  if (valoracion === "favorable" && ALARMAS.test(texto)) return null;
  const n = palabras(texto);
  return n >= min && n <= max ? texto : null;
}

/** The user's note in formal register: same figures and acronyms, nothing dropped. */
export function validarObservacion(respuesta: string, original: string): string | null {
  const texto = completas(limpiarTextoIa(respuesta), 12);
  if (!texto || !pareceEspanol(texto)) return null;
  const normal = (n: string) => n.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
  const permitidos = new Set((original.match(NUMEROS) ?? []).map(normal));
  if ((texto.match(NUMEROS) ?? []).some((n) => !permitidos.has(normal(n)))) return null;
  // Every figure of the note must survive the rewrite.
  const quedan = new Set((texto.match(NUMEROS) ?? []).map(normal));
  if ([...permitidos].some((n) => !quedan.has(n))) return null;
  const siglas = new Set([...(original.match(SIGLAS) ?? []), ...SIGLAS_PERMITIDAS]);
  if ((texto.match(SIGLAS) ?? []).some((s) => !siglas.has(s))) return null;
  const n = palabras(texto);
  const base = palabras(original);
  return n >= Math.max(8, base * 0.6) && n <= base * 2 + 40 ? texto : null;
}

/** "Texto del usuario" → sentence with its final period. */
export function conPunto(texto: string): string {
  const t = texto.trim().replace(/\s+/g, " ");
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

const REGLAS =
  "Reglas:\n- No escribas cifras, porcentajes ni montos.\n- No nombres instituciones ni siglas.\n" +
  "- No inventes nombres de sectores, áreas ni programas.\n- Mantén el tono de la valoración: no elogies un resultado que no es favorable.\n" +
  "- Sin viñetas, títulos ni markdown.\n";

function pedidoInterpretacion(
  h: Hechos,
  clave: string,
  titulo: string,
  tema: string,
  hallazgos: string[],
  valoracion: Valoracion,
  respaldo: string,
): PedidoIa {
  const p = h.periodo;
  const usuario =
    `HALLAZGOS del ${p.ordinal} trimestre de ${p.anio} sobre ${tema}:\n${hallazgos.map(sinMarcado).join("\n")}\n` +
    `Valoración del resultado: ${TEXTO_VALORACION[valoracion]}.\n\n` +
    "Escribe 2 o 3 oraciones que interpreten estos hallazgos: qué significan para el cumplimiento del Plan Galápagos 2030 y qué se debe fortalecer. No repitas los hallazgos: interprétalos.\n" +
    REGLAS +
    "Responde solo con las oraciones.";
  return {
    clave,
    titulo,
    usuario,
    validar: (r) => validarInterpretacion(r, p.anio, { entrada: usuario, valoracion }),
    respaldo,
  };
}

// ---------------------------------------------------------------------------
// 2 b) Reporting compliance in the antecedents

export function lineasCumplimiento(h: Hechos): string[] {
  const p = h.periodo;
  const por = (estado: string) => h.obligadas.filter((i) => i.estadoReporte === estado);
  const lineas: string[] = [];
  const cumplio = por("cumplio");
  const parcial = por("parcial");
  const noCumplio = por("no_cumplio");
  if (cumplio.length) {
    lineas.push(`${cuantas(cumplio.length, "institución cumplió", "instituciones cumplieron")} con la entrega de los reportes de avance del ${p.ordinal} trimestre (${siglasDe(cumplio).join(", ")}).`);
  }
  if (parcial.length) {
    lineas.push(`${cuantas(parcial.length, "institución entregó", "instituciones entregaron")} sus reportes de forma parcial (${siglasDe(parcial).join(", ")}).`);
  }
  if (noCumplio.length) {
    lineas.push(`${cuantas(noCumplio.length, "institución no remitió", "instituciones no remitieron")} la información (${siglasDe(noCumplio).join(", ")}).`);
  }
  if (!lineas.length) lineas.push(`Ninguna institución tenía metas programadas para el ${p.ordinal} trimestre.`);
  return lineas;
}

export function textoProgramacion(h: Hechos): string {
  const p = h.periodo;
  const c = h.d.cumplimiento;
  return (
    `De acuerdo con la programación planteada por las instituciones para el ${p.anio}, un total de ` +
    `${cuantas(c.obligadas, `institución${sujeto(h.tipo)} cuenta`, `instituciones${sujeto(h.tipo)} cuentan`)} con metas programadas para el ${p.ordinal} trimestre, ` +
    `existiendo un total de ${cuantas(c.aReportar, "meta planificada", "metas planificadas")} para el ${p.ordinal} trimestre del ${p.anio}.`
  );
}

// ---------------------------------------------------------------------------
// 6 a) Goals of the year

export function lineasMetas(h: Hechos): string[] {
  const pl = h.d.planificacion;
  const sinRespuesta = pl.institucionesSinRespuesta.map((i) => i.sigla).sort();
  const lineas = [`**${pl.conMetas}** ${pl.conMetas === 1 ? "institución definió" : "instituciones definieron"} metas.`];
  if (pl.sinAcciones > 0) {
    lineas.push(
      `**${pl.sinAcciones}** ${pl.sinAcciones === 1 ? "institución indicó" : "instituciones indicaron"} no tener acciones en su planificación vinculadas al cumplimiento del Plan Galápagos 2030` +
        `${h.sinAccionesSiglas.length ? ` (${h.sinAccionesSiglas.join(", ")})` : ""}.`,
    );
  }
  if (pl.sinRespuesta > 0) {
    lineas.push(`**${pl.sinRespuesta}** ${pl.sinRespuesta === 1 ? "institución no emitió" : "instituciones no emitieron"} una respuesta oficial (${sinRespuesta.join(", ")}).`);
  }
  const proporcion = pl.metas > 0 ? pl.metasConPresupuesto / pl.metas : null;
  let metas = `**${pl.metas}** ${pl.metas === 1 ? "meta fue planteada" : "metas fueron planteadas"} por las diferentes instituciones${sujeto(h.tipo)} para el ${h.periodo.anio}.`;
  if (proporcion !== null) {
    metas += ` De ellas, el ${pct(proporcion)} (${cuantas(pl.metasConPresupuesto, "meta", "metas")}) cuenta con presupuesto planificado`;
    metas += proporcion < 1 ? ", lo cual limita la capacidad de cuantificar la inversión total del Estado destinada al cumplimiento de estos objetivos." : ".";
  }
  lineas.push(metas);
  return lineas;
}

export function pedidoObservaciones(nota: string): PedidoIa {
  return {
    clave: "observaciones",
    titulo: "Observaciones",
    usuario:
      "Redacta el siguiente TEXTO con el estilo formal de un informe técnico del CGREG, en un solo párrafo. " +
      "Conserva todos los datos, cifras, nombres y siglas tal como están; no agregues información nueva.\n\n" +
      `TEXTO: ${nota}\n\nResponde solo con el párrafo.`,
    validar: (r) => validarObservacion(r, nota),
    respaldo: conPunto(nota),
  };
}

// ---------------------------------------------------------------------------
// 6 b) Reporting compliance (new section)

export function textoCumplimiento(h: Hechos): string {
  const p = h.periodo;
  const c = h.d.cumplimiento;
  if (c.obligadas === 0) return `Durante el ${p.ordinal} trimestre de ${p.anio} ninguna institución tenía metas programadas que reportar.`;
  const partes = [`${c.cumplio} ${c.cumplio === 1 ? "cumplió" : "cumplieron"} con la entrega completa`];
  if (c.parcial) partes.push(`${c.parcial} la ${c.parcial === 1 ? "realizó" : "realizaron"} de forma parcial`);
  if (c.noCumplio) partes.push(`${c.noCumplio} no ${c.noCumplio === 1 ? "remitió" : "remitieron"} la información`);
  return (
    `Durante el ${p.ordinal} trimestre de ${p.anio}, de un total de ${cuantas(c.obligadas, "institución obligada", "instituciones obligadas")} a reportar ` +
    `${cuantas(c.aReportar, "meta", "metas")}, ${enumerar(partes)}. En conjunto, se reportaron ${c.reportadas} de las ${c.aReportar} metas ` +
    `(${pct(c.aReportar ? c.reportadas / c.aReportar : null)}).`
  );
}

// ---------------------------------------------------------------------------
// 6 c) Alignment

/** The category with most goals, ignoring "pending". */
export function categoriaPredominante(h: Hechos): { categoria: string; n: number } | null {
  let mejor: { categoria: string; n: number } | null = null;
  for (const c of CONTRIBUCIONES) {
    const n = h.porCategoria[c] ?? 0;
    if (n > 0 && (!mejor || n > mejor.n)) mejor = { categoria: c, n };
  }
  return mejor;
}

function ejesPrincipales(h: Hechos): string[] {
  const conMetas = h.d.alineacion.porEje.filter((e) => e.total > 0).sort((a, b) => b.total - a.total);
  if (!conMetas.length) return [];
  const tope = conMetas[0].total;
  const segundos = conMetas.filter((e) => e.total < tope);
  const elegidos = conMetas.filter((e) => e.total === tope);
  if (elegidos.length === 1 && segundos.length) elegidos.push(...conMetas.filter((e) => e.total === segundos[0].total).slice(0, 1));
  return elegidos.map((e) => ejeCorto(e.eje.nombre));
}

export function textosAlineacion(h: Hechos): { intro: string; hallazgo: string } {
  const total = h.totalMetasAlineacion;
  const intro =
    `A continuación, se detalla el nivel de alineación de la planificación del ${h.periodo.anio} respecto al Plan Galápagos 2030. ` +
    `Se consolidan las **${total}** metas planteadas por las instituciones, categorizando su contribución en los distintos ejes estratégicos.`;
  const ejes = ejesPrincipales(h);
  const n = (c: string) => h.porCategoria[c] ?? 0;
  const pendientes = n("Pendiente de clasificación");
  const hallazgo =
    (ejes.length ? `Los datos evidencian una mayor concentración de metas en ${ejes.length > 1 ? "los ejes de" : "el eje de"} ${enumerar(ejes)}. ` : "") +
    `Tras aplicar la metodología de categorización del impacto, se determinó la contribución directa de ${cuantas(n("Contribución directa"), "meta", "metas")}, ` +
    `la contribución complementaria de ${cuantas(n("Contribución complementaria"), "meta", "metas")}, la alineación relativa de ${cuantas(n("Alineación relativa"), "meta", "metas")} ` +
    `y ${cuantas(n("Sin alineación"), "meta", "metas")} sin alineación` +
    (pendientes ? `; ${cuantas(pendientes, "meta se encuentra pendiente", "metas se encuentran pendientes")} de clasificación.` : ".");
  return { intro, hallazgo };
}

const RESPALDO_ALINEACION: Record<string, string> = {
  "Contribución directa":
    "El predominio de la contribución directa evidencia que una parte importante de la planificación institucional se orienta a acciones con impacto verificable en los indicadores del Plan Galápagos 2030; el desafío es sostener esta orientación y extenderla a las metas restantes.",
  "Contribución complementaria":
    "Se puede inferir que, si bien persiste una alta concentración en la categoría complementaria, se mantiene el desafío de fortalecer la planificación, orientando la gestión hacia indicadores con mayor capacidad de impacto directo en el desarrollo sostenible del archipiélago de Galápagos y al cumplimiento integral de las metas establecidas en el Plan Galápagos 2030.",
  "Alineación relativa":
    "La concentración en la alineación relativa indica que buena parte de la gestión planificada, aunque válida, no suma de forma cuantificable a los hitos del Plan Galápagos 2030, por lo que se requiere reformular indicadores y metas hacia una contribución más directa.",
  "Sin alineación":
    "La proporción de metas sin alineación evidencia que parte de la planificación institucional no guarda una relación demostrable con el Plan Galápagos 2030, lo que exige revisar su formulación en los próximos ejercicios.",
};

export function pedidoAlineacion(h: Hechos, hallazgo: string): PedidoIa {
  const predominante = categoriaPredominante(h);
  const respaldo = predominante
    ? RESPALDO_ALINEACION[predominante.categoria]
    : "Una vez concluida la clasificación de todas las metas, se podrá valorar con mayor precisión su contribución al Plan Galápagos 2030.";
  const valoracion: Valoracion =
    predominante?.categoria === "Contribución directa" ? "favorable" : !predominante || predominante.categoria === "Contribución complementaria" ? "mixta" : "desfavorable";
  return pedidoInterpretacion(h, "alineacion", "Alineación con el Plan", "la alineación de las metas institucionales con el Plan Galápagos 2030", [hallazgo], valoracion, respaldo);
}

// ---------------------------------------------------------------------------
// 6 d) Physical progress, budget and coherence

const conValor = (insts: Hechos["cuentan"], valor: (i: Hechos["cuentan"][number]) => number | null) =>
  insts.map((i) => `${i.institucion.sigla} (${pct(valor(i))})`).join(", ");

export function textosAvanceFisico(h: Hechos): { intro: string; hallazgo: string } | null {
  const a = h.d.avanceFisico;
  if (!h.cuentan.length || a.valor === null || !a.semaforo) return null;
  const p = h.periodo;
  const intro =
    `Durante el ${p.ordinal} trimestre de ${p.anio} (${p.rango.toLowerCase()}), se registraron un total de ${cuantas(h.metasQueCuentan, "meta reportada", "metas reportadas")} ` +
    `por ${cuantas(h.cuentan.length, "institución", "instituciones")}.`;
  const grupos: string[] = [];
  const f = h.fisicoPor;
  const valor = (i: Hechos["cuentan"][number]) => i.fisico.valor;
  const verbo = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);
  if (f.verde.length) grupos.push(`${verbo(f.verde.length, "alcanzó", "alcanzaron")} el avance esperado ${conValor(f.verde, valor)}`);
  if (f.amarillo.length) grupos.push(`${verbo(f.amarillo.length, "presentó", "presentaron")} un avance cercano al esperado ${conValor(f.amarillo, valor)}`);
  if (f.rojo.length) grupos.push(`${verbo(f.rojo.length, "presentó", "presentaron")} un avance menor al esperado ${conValor(f.rojo, valor)}`);
  if (f.sin_avance.length) grupos.push(`no ${verbo(f.sin_avance.length, "registró", "registraron")} avance ${f.sin_avance.map((i) => i.institucion.sigla).join(", ")}`);
  const hallazgo =
    `El avance físico institucional promedio alcanzó un **${pct(a.valor)}**, lo que corresponde a un ${ETIQUETA_SEMAFORO[a.semaforo]} para este período. ` +
    `En el análisis por institución, ${grupos.join("; ")}.`;
  return { intro, hallazgo };
}

const RESPALDO_FISICO: Record<Pg2030Semaforo, string> = {
  verde:
    "Este resultado refleja una ejecución satisfactoria de las actividades programadas; no obstante, es necesario mantener el seguimiento a las instituciones con niveles de cumplimiento inferiores para evitar rezagos en los siguientes cortes.",
  amarillo:
    "Si bien este resultado denota una ejecución aceptable de actividades y metas, se identifican oportunidades de mejora en las instituciones que no reportaron avances o alcanzaron niveles bajos de cumplimiento.",
  rojo:
    "El nivel alcanzado evidencia rezagos importantes en la ejecución de las metas programadas, por lo que se requiere que las instituciones con menor avance identifiquen sus nudos críticos y adopten medidas correctivas inmediatas.",
  sin_avance:
    "La ausencia de avance físico reportado impide valorar la contribución de la gestión institucional al Plan Galápagos 2030 en este período.",
};

export function pedidoAvanceFisico(h: Hechos, hallazgo: string): PedidoIa {
  const s = h.d.avanceFisico.semaforo;
  return pedidoInterpretacion(h, "avanceFisico", "Avance físico", "el avance físico de las metas institucionales", [hallazgo], valoracionDe(s), RESPALDO_FISICO[s ?? "sin_avance"]);
}

const LINEA_PRESUPUESTO: Record<Pg2030Semaforo | "sin_presupuesto", [string, string]> = {
  verde: ["alcanzó el avance esperado", "alcanzaron el avance esperado"],
  amarillo: ["presentó un avance cercano al esperado", "presentaron un avance cercano al esperado"],
  rojo: ["presentó un cumplimiento menor a lo planificado", "presentaron un cumplimiento menor a lo planificado"],
  sin_avance: ["no registró ejecución presupuestaria", "no registraron ejecución presupuestaria"],
  sin_presupuesto: ["sin presupuesto definido", "sin presupuesto definido"],
};

export function textosPresupuesto(h: Hechos): {
  cobertura: string;
  lineas: Array<{ clave: Pg2030Semaforo | "sin_presupuesto"; texto: string }>;
  hallazgo: string;
} | null {
  const pr = h.d.presupuesto;
  if (!h.cuentan.length) return null;
  const p = h.periodo;
  let cobertura =
    `Durante el ${p.ordinal} trimestre, de las ${cuantas(h.d.cumplimiento.aReportar, "meta a reportar", "metas a reportar")}, ` +
    `${pr.metasAReportarConPresupuesto} ${pr.metasAReportarConPresupuesto === 1 ? "contaba" : "contaban"} con presupuesto planificado al corte y se obtuvo el reporte de ` +
    `${pr.metasConPresupuestoReportadas} de ellas.`;
  if (pr.presupuestoSinReporte.planificado > 0) {
    cobertura +=
      ` Las metas con presupuesto que no reportaron suman ${usd(pr.presupuestoSinReporte.planificado)}, equivalente al ${pct(pr.presupuestoSinReporte.proporcion)} de lo planificado al corte, ` +
      "lo que genera un vacío de información que limita la evaluación integral del cumplimiento institucional para el período.";
  }
  const total = h.cuentan.length;
  const lineas = (Object.keys(LINEA_PRESUPUESTO) as Array<keyof typeof LINEA_PRESUPUESTO>)
    .filter((k) => h.presupuestoPor[k].length > 0)
    .map((k) => {
      const insts = h.presupuestoPor[k];
      const [uno, varios] = LINEA_PRESUPUESTO[k];
      return {
        clave: k,
        texto: `${cuantas(insts.length, "institución", "instituciones")} (${pct(insts.length / total)}) ${insts.length === 1 ? uno : varios} (${siglasDe(insts).join(", ")}).`,
      };
    });

  let hallazgo: string;
  if (pr.total.planificado > 0 && pr.total.semaforo) {
    hallazgo =
      `El presupuesto devengado al corte asciende a **${usd(pr.total.computable)}** frente a una planificación de **${usd(pr.total.planificado)}**. ` +
      `Esto representa un avance presupuestario general del **${pct(pr.total.avance)}** para el ${p.ordinal} trimestre de ${p.anio}, que corresponde a un ${ETIQUETA_SEMAFORO[pr.total.semaforo]}.`;
    const fuentes = pr.porFuente.filter((f) => f.dinero.planificado > 0);
    if (fuentes.length > 1) hallazgo += ` Por fuente de financiamiento, la ejecución fue de ${enumerar(fuentes.map((f) => `${pct(f.dinero.avance)} en ${f.fuente}`))}.`;
  } else {
    hallazgo = "Las metas reportadas en este corte no registran presupuesto planificado, por lo que no es posible calcular su avance presupuestario.";
  }
  return { cobertura, lineas, hallazgo };
}

export function pedidoPresupuesto(h: Hechos, hallazgo: string): PedidoIa {
  const pr = h.d.presupuesto;
  const general: Record<Pg2030Semaforo, string> = {
    verde: "La ejecución presupuestaria guarda relación con lo planificado para el período, lo que refleja una adecuada utilización de los recursos asignados.",
    amarillo: "La ejecución presupuestaria se aproxima a lo planificado, aunque persisten recursos pendientes de ejecución que deben atenderse en los siguientes meses del ejercicio fiscal.",
    rojo: "El nivel de utilización de los recursos es menor al esperado, lo que puede comprometer el cumplimiento de las metas programadas si no se adoptan medidas para agilizar la ejecución.",
    sin_avance: "No se registra ejecución presupuestaria en el período, lo que impide valorar la inversión destinada al cumplimiento del Plan Galápagos 2030.",
  };
  let respaldo = general[pr.total.semaforo ?? "sin_avance"];
  const corriente = pr.porFuente.find((f) => f.fuente === "Corriente")?.dinero;
  const inversion = pr.porFuente.find((f) => f.fuente === "Inversión")?.dinero;
  if (corriente?.avance != null && inversion?.avance != null && inversion.planificado > 0 && inversion.avance < corriente.avance - 0.05) {
    respaldo += " La diferencia entre fuentes evidencia que las limitaciones se concentran en la ejecución de proyectos de inversión.";
  }
  return pedidoInterpretacion(h, "presupuesto", "Ejecución presupuestaria", "la ejecución presupuestaria de las metas institucionales", [hallazgo], valoracionDe(pr.total.semaforo), respaldo);
}

export function textoCoherencia(h: Hechos): string | null {
  if (!h.cuentan.length) return null;
  const c = h.coherenciaPor;
  const partes: string[] = [];
  if (c.coherente.length) {
    partes.push(`${cuantas(c.coherente.length, "institución presenta", "instituciones presentan")} coherencia entre ambos avances (${siglasDe(c.coherente).join(", ")})`);
  }
  if (c.incoherencia_brecha.length) {
    partes.push(
      `${cuantas(c.incoherencia_brecha.length, "institución presenta", "instituciones presentan")} «Incoherencia: brecha», con una diferencia superior a 5 puntos entre ambos avances (${siglasDe(c.incoherencia_brecha).join(", ")})`,
    );
  }
  if (c.sin_financiamiento.length) {
    partes.push(`${cuantas(c.sin_financiamiento.length, "institución reporta", "instituciones reportan")} avance físico sin ejecución presupuestaria (${siglasDe(c.sin_financiamiento).join(", ")})`);
  }
  if (c.no_aplica.length) {
    partes.push(`${cuantas(c.no_aplica.length, "institución no registra", "instituciones no registran")} avance físico ni presupuesto planificado (${siglasDe(c.no_aplica).join(", ")})`);
  }
  const d = h.d;
  return (
    `A nivel global, la gestión presenta un avance físico promedio del ${pct(d.avanceFisico.valor)} frente a un avance presupuestario consolidado del ${pct(d.presupuesto.total.avance)}. ` +
    `${partes.length ? `${partes.map((s, i) => (i === 0 ? s[0].toUpperCase() + s.slice(1) : s)).join("; ")}.` : ""}`
  ).trim();
}

export function pedidoCoherencia(h: Hechos, hallazgo: string): PedidoIa {
  const c = h.coherenciaPor;
  const partes: string[] = [];
  if (c.incoherencia_brecha.length) {
    partes.push("Las diferencias entre el avance físico y el presupuestario sugieren posibles debilidades en el registro del devengado o en la programación de las metas, lo que requiere una validación administrativa por parte de las instituciones con brecha.");
  }
  if (c.sin_financiamiento.length) {
    partes.push("Asimismo, los avances físicos sin ejecución presupuestaria evidencian acciones operativas sin cuantificación de recursos, lo que limita la medición de la inversión pública destinada al Plan.");
  }
  const valoracion: Valoracion = partes.length ? "desfavorable" : "favorable";
  if (!partes.length) partes.push("La correspondencia entre el avance físico y el presupuestario refleja una gestión articulada entre la ejecución de las metas y el uso de los recursos.");
  return pedidoInterpretacion(
    h,
    "coherencia",
    "Coherencia físico-presupuestaria",
    "la coherencia entre el avance físico y el avance presupuestario de cada institución",
    [hallazgo],
    valoracion,
    partes.join(" "),
  );
}

// ---------------------------------------------------------------------------
// 7. Conclusions: a sentence with the figures + one sentence of implication.

export interface Conclusion {
  hallazgo: string;
  valoracion: Valoracion;
  /** Its implication must speak of this (the 2B model shuffles the numbered answers). */
  tema: RegExp;
  respaldo: string;
}

export function conclusiones(h: Hechos): Conclusion[] {
  const p = h.periodo;
  const d = h.d;
  const out: Conclusion[] = [];

  const c = d.cumplimiento;
  if (c.obligadas > 0) {
    out.push({
      hallazgo: `Durante el ${p.ordinal} trimestre de ${p.anio}, ${c.cumplio} de ${cuantas(c.obligadas, "institución obligada", "instituciones obligadas")} cumplieron con la entrega completa de sus reportes de avance y se reportaron ${c.reportadas} de las ${c.aReportar} metas programadas.`,
      valoracion: c.cumplio === c.obligadas ? "favorable" : c.cumplio > 0 ? "mixta" : "desfavorable",
      tema: /report|informaci|entreg|seguimiento/i,
      respaldo:
        c.cumplio === c.obligadas
          ? "Esto refleja el compromiso institucional con el seguimiento del Plan Galápagos 2030."
          : "La falta de reporte de algunas instituciones limita la evaluación integral del cumplimiento del Plan Galápagos 2030.",
    });
  }

  const predominante = categoriaPredominante(h);
  const ejes = ejesPrincipales(h);
  if (predominante && h.totalMetasAlineacion > 0) {
    out.push({
      hallazgo: `La planificación institucional muestra una mayor concentración de metas en ${ejes.length > 1 ? "los ejes de" : "el eje de"} ${enumerar(ejes)}, con predominio de la «${predominante.categoria}» (${predominante.n} de ${h.totalMetasAlineacion} metas).`,
      valoracion: predominante.categoria === "Contribución directa" ? "favorable" : predominante.categoria === "Contribución complementaria" ? "mixta" : "desfavorable",
      tema: /alinea|contribu|planifica|eje/i,
      respaldo:
        predominante.categoria === "Contribución directa"
          ? "Esto indica que la gestión pública se orienta a acciones con impacto verificable en el Plan Galápagos 2030."
          : "Esto indica que, aunque la gestión pública es válida, se requiere reorientar la planificación hacia acciones con contribución directa para impactar de manera efectiva en lo establecido en el Plan Galápagos 2030.",
    });
  }

  const a = d.avanceFisico;
  if (a.valor !== null && a.semaforo) {
    let hallazgo = `El avance físico promedio alcanzó el ${pct(a.valor)}, que corresponde a un ${ETIQUETA_SEMAFORO[a.semaforo]}.`;
    const verdes = h.fisicoPor.verde;
    if (verdes.length) hallazgo += ` ${verdes.length === 1 ? "Alcanzó" : "Alcanzaron"} el avance esperado ${enumerar(siglasDe(verdes))}.`;
    const rezagadas = [...h.fisicoPor.rojo, ...h.fisicoPor.sin_avance];
    if (rezagadas.length) {
      hallazgo += ` ${rezagadas.length === 1 ? "Requiere" : "Requieren"} atención por su avance menor al esperado ${conValor(rezagadas, (i) => i.fisico.valor)}.`;
    }
    out.push({ hallazgo, valoracion: valoracionDe(a.semaforo), tema: /f[ií]sic|metas|actividades|ejecuci/i, respaldo: RESPALDO_FISICO[a.semaforo] });
  }

  const t = d.presupuesto.total;
  if (t.planificado > 0 && t.semaforo) {
    const fuentes = d.presupuesto.porFuente.filter((f) => f.dinero.planificado > 0);
    out.push({
      hallazgo:
        `La ejecución presupuestaria global fue del ${pct(t.avance)}, que corresponde a un ${ETIQUETA_SEMAFORO[t.semaforo]}` +
        (fuentes.length > 1 ? `; por fuente de financiamiento, ${enumerar(fuentes.map((f) => `${f.fuente} alcanzó ${pct(f.dinero.avance)}`))}.` : "."),
      valoracion: valoracionDe(t.semaforo),
      tema: /presupuest|recurso|financ|gasto|inversi|fondos/i,
      respaldo:
        t.semaforo === "verde"
          ? "Los recursos asignados se están ejecutando conforme a lo planificado."
          : "Esta situación sugiere limitaciones administrativas y operativas en la ejecución de los recursos que deben ser atendidas.",
    });
  }

  const brecha = h.coherenciaPor.incoherencia_brecha;
  const sinFin = h.coherenciaPor.sin_financiamiento;
  if (h.cuentan.length && (brecha.length || sinFin.length)) {
    const partes: string[] = [];
    if (brecha.length) {
      partes.push(`${brecha.length} de ${cuantas(h.cuentan.length, "institución analizada", "instituciones analizadas")} ${brecha.length === 1 ? "presenta" : "presentan"} «Incoherencia: brecha» superior a 5 puntos entre sus avances físico y financiero (${siglasDe(brecha).join(", ")})`);
    }
    if (sinFin.length) {
      partes.push(`${cuantas(sinFin.length, "institución reporta", "instituciones reportan")} avances físicos sin ejecución financiera (${siglasDe(sinFin).join(", ")})`);
    }
    out.push({
      hallazgo: `${partes.map((s, i) => (i === 0 ? s[0].toUpperCase() + s.slice(1) : s)).join("; asimismo, ")}.`,
      valoracion: "desfavorable",
      tema: /coheren|brecha|registro|correspond|financier|presupuest/i,
      respaldo: "Esto evidencia la necesidad de fortalecer la calidad de la información reportada y su validación administrativa.",
    });
  }
  return out;
}

/** One request for every conclusion: numbered lines back, each checked on its own. */
export function pedidoConclusiones(h: Hechos, lista: Conclusion[]): PedidoIa & { separar: (respuesta: string) => Array<string | null> } {
  const anio = h.periodo.anio;
  const separar = (respuesta: string) => {
    const limpio = respuesta.replace(/<think>[\s\S]*?<\/think>/gi, " ");
    const porNumero = new Map<number, string>();
    for (const m of limpio.matchAll(/^\s*(\d+)[.)-]\s*(.+)$/gm)) porNumero.set(Number(m[1]), m[2]);
    return lista.map((_, i) => {
      const linea = porNumero.get(i + 1);
      const texto = linea ? validarInterpretacion(linea, anio, { maxOraciones: 1, min: 6, max: 60, entrada: usuario, valoracion: lista[i].valoracion }) : null;
      return texto && lista[i].tema.test(texto) ? texto : null;
    });
  };
  const usuario =
    `Estos son los HALLAZGOS principales del ${h.periodo.ordinal} trimestre de ${anio}, cada uno con su valoración:\n` +
    lista.map((c, i) => `${i + 1}. [${c.valoracion.toUpperCase()}] ${sinMarcado(c.hallazgo)}`).join("\n") +
    "\n\nPara cada hallazgo escribe UNA oración de conclusión que explique su implicación para el cumplimiento del Plan Galápagos 2030.\n" +
    REGLAS +
    `Responde con ${lista.length} líneas numeradas, en el mismo orden: "1. …", "2. …".`;
  return {
    clave: "conclusiones",
    titulo: "Conclusiones",
    usuario,
    validar: (r) => (separar(r).some((x) => x !== null) ? r : null),
    respaldo: "",
    separar,
  };
}
