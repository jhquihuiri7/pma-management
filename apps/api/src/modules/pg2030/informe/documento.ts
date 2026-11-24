import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pg2030Semaforo } from "@pma/types";
import { env } from "../../../lib/env.js";
import { escribirZip, leerZip } from "./zip.js";
import {
  anclaDe,
  conActualizarCampos,
  conSaltoAntes,
  dividirCuerpo,
  esc,
  fuente,
  imagen,
  indice,
  leyenda,
  limpiar,
  marcado,
  pPrDe,
  parrafo,
  parrafoImagen,
  rPrDe,
  reemplazar,
  reemplazarTodo,
  tabla,
  tamanoPng,
  textoDe,
  titulo,
  vacio,
  type Celda,
  type EntradaIndice,
  type Trozo,
} from "./ooxml.js";
import { fechaLarga, letraEje, pct, usd, type Hechos } from "./hechos.js";
import {
  conclusiones,
  lineasCumplimiento,
  lineasMetas,
  textoCoherencia,
  textoCumplimiento,
  textoInversion,
  textoProgramacion,
  textosAlineacion,
  textosAvanceFisico,
  textosPresupuesto,
} from "./redaccion.js";

/**
 * Assembles the quarterly report from the template («6.1 Informe PG2030 2026
 * 1T vf 10abr26.docx»): the cover, legal framework, antecedents, methodology,
 * recommendations and signatures are its own paragraphs, with only the
 * period, counts and the form's fields swapped in; section 6 and the
 * conclusions are written from the dashboard. Paragraphs are taken by their
 * position in the template body, and `verificarPlantilla` checks every
 * position used still holds the expected text.
 *
 * The template is an internal document and the repository is public, so it
 * is NOT in the code: it is read from storage (PG2030_INFORME_PLANTILLA, by
 * default <STORAGE_ROOT>/PG2030/plantilla-informe.docx). To install or replace
 * it, first remove internal share links from it, then for example:
 *   docker cp modelo.docx pma-api:/data/storage/PG2030/plantilla-informe.docx
 */

export const CLAVES_GRAFICO = ["alineacion", "avanceFisico", "presupuesto", "coherencia", "inversion"] as const;
export type ClaveGrafico = (typeof CLAVES_GRAFICO)[number];

export interface CamposInforme {
  numeroInforme: string;
  /** ISO date on the cover. */
  fecha: string;
  /** "Oficio Nro. …, del …, y Oficio Nro. …" (the call to plan the year). */
  oficiosMetas: string;
  /** "Oficio Nro. …, del …" (the call to report the quarter). */
  oficioAvances: string;
  /** ISO date, the deadline that call gave. */
  fechaLimite: string;
  enlaceAnexo: string;
  observaciones: string;
}

/** The analysis sentences, already validated or replaced by their fallback. */
export interface TextosInforme {
  interpretaciones: Map<string, string>;
  /** One implication per conclusion, in order. */
  implicaciones: string[];
}

interface Plantilla {
  archivos: Map<string, Buffer>;
  inicio: string;
  elementos: string[];
  fin: string;
}

/** The template's own numbers, found by shape so they are not written here (public repository). */
const NRO_INFORME = /CGREG-DGTAR-\d{4}-\d+/;
const FECHA_PORTADA = /^\s*\d{1,2} de \p{L}+ del \d{4}\s*$/u;
const OFICIOS_METAS = /Mediante .*?, el CGREG/;
const CONVOCADAS = /\d+ instituciones públicas/;

/** [position, text it must contain]: every template paragraph the report uses by position. */
const POSICIONES: Array<[number, string | RegExp]> = [
  [8, "Informe Técnico"], [9, NRO_INFORME], [11, "Dirección de Gestión de Territorio"],
  [14, "Período Enero – Marzo 2026"], [17, FECHA_PORTADA], [26, "Contenido"],
  [38, "ENERO – MARZO 2026"], [40, "Marco legal"], [52, "Antecedentes"], [73, "Requerimiento de metas"],
  [75, CONVOCADAS], [77, "Formalización de delegados técnicos"], [78, "período 2026-2030"],
  [80, "Requerimiento de avances primer trimestre"], [82, "la DGTAR solicitó a las instituciones públicas"],
  [84, "De acuerdo con la programación"], [86, "al primer trimestre"], [88, "instituciones cumplieron"],
  [91, "Metodología de seguimiento"], [95, "PG2030_2026_INSTITUCIÓN"], [107, "Rangos de cumplimiento"],
  [110, "Elaboración"], [122, "primer trimestre de 2026"], [124, "Limitaciones"], [128, "Objetivo general"],
  [130, "primer trimestre de 2026"], [132, "Ejercicio fiscal Enero – Marzo 2026"],
  [134, "Metas planteadas en el Ejercicio Fiscal 2026"], [136, "requerimiento de metas 2026"],
  [138, "instituciones definieron metas"], [143, "Así también"], [147, "Alineación de la planificación"],
  [160, "Avance institucional promedio acumulado"], [205, "Conclusiones"], [207, "Durante el primer trimestre"],
  [215, "Recomendaciones"], [225, "medios de verificación"], [227, "Anexos"], [229, "año 2026 T1"],
  [230, "https://"], [232, "Firmas de responsabilidad"], [234, "Elaborado por"],
];

export function verificarPlantilla(elementos: string[]): void {
  if (elementos.length !== 239) throw new Error(`Plantilla del informe: se esperaban 239 elementos y hay ${elementos.length}`);
  for (const [i, texto] of POSICIONES) {
    const contenido = textoDe(elementos[i]);
    if (typeof texto === "string" ? !contenido.includes(texto) : !texto.test(contenido)) {
      throw new Error(`Plantilla del informe: el elemento ${i} ya no contiene «${texto}»`);
    }
  }
  if (!elementos[238].startsWith("<w:sectPr")) throw new Error("Plantilla del informe: el último elemento no es la sección");
}

let cache: { ruta: string; plantilla: Plantilla } | null = null;
let rutaFijada: string | null = null;

export function rutaPlantilla(): string {
  return rutaFijada ?? (env.PG2030_INFORME_PLANTILLA || join(env.STORAGE_ROOT, "PG2030", "plantilla-informe.docx"));
}

/** Tests point at the local copy of the template (null: back to the configured one). */
export function fijarRutaPlantilla(ruta: string | null): void {
  rutaFijada = ruta;
  cache = null;
}

/** The parsed template; throws a readable error when the file is missing or no longer matches. */
export function plantilla(): Plantilla {
  const ruta = rutaPlantilla();
  if (cache?.ruta === ruta) return cache.plantilla;
  let datos: Buffer;
  try {
    datos = readFileSync(ruta);
  } catch (error) {
    throw new Error(`No se encontró la plantilla del informe en ${ruta} (${(error as NodeJS.ErrnoException).code ?? "error"})`);
  }
  const archivos = leerZip(datos);
  const documento = archivos.get("word/document.xml");
  if (!documento) throw new Error("Plantilla del informe sin word/document.xml");
  const { inicio, elementos, fin } = dividirCuerpo(documento.toString("utf8"));
  verificarPlantilla(elementos);
  const lista = { archivos, inicio, elementos, fin };
  cache = { ruta, plantilla: lista };
  return lista;
}

/** Template icons of the axes, by the letter in their name (table 2 of the template). */
const ICONOS: Record<string, string> = { C: "rId8", N: "rId9", E: "rId10", H: "rId11" };
const TAMANO_ICONO = { ancho: 456565, alto: 449580 };

const ESTADO_REPORTE: Record<string, { label: string; color: string }> = {
  cumplio: { label: "Cumplió", color: "0CA30C" },
  parcial: { label: "Cumplimiento parcial", color: "FAB219" },
  no_cumplio: { label: "No cumplió", color: "D03B3B" },
};

/** Column order of the template's alignment table. */
const ORDEN_CATEGORIAS = ["Alineación relativa", "Contribución complementaria", "Contribución directa", "Sin alineación", "Pendiente de clasificación"];

export function armarInforme(
  h: Hechos,
  campos: CamposInforme,
  textos: TextosInforme,
  graficos: Partial<Record<ClaveGrafico, Buffer>>,
): Buffer {
  const P = plantilla();
  const E = (i: number) => limpiar(P.elementos[i]);
  const d = h.d;
  const p = h.periodo;
  const color = (hex: string) => hex.replace("#", "").toUpperCase();
  const semaforo = (s: Pg2030Semaforo | null): Trozo[] => (s ? [{ punto: color(d.leyenda.semaforo[s].color) }, " "] : []);
  const conPunto = (s: Pg2030Semaforo | null, texto: string): Celda => [...semaforo(s), texto];

  const cuerpo: string[] = [];
  const entradas: EntradaIndice[] = [];
  const imagenes: Array<{ rId: string; ruta: string; png: Buffer }> = [];
  let nTabla = 1; // Tabla 1 (rangos de cumplimiento) is the template's own.
  let nGrafico = 0;

  const literal = (...indices: number[]) => indices.forEach((i) => cuerpo.push(E(i)));
  const rango = (desde: number, hasta: number) => {
    for (let i = desde; i <= hasta; i++) cuerpo.push(E(i));
  };
  // Subsection letters restart under every numbered section, as Word numbers them.
  let letra = 0;
  const subtitulos = () => `${"abcdefghij"[letra++]})`;
  const enIndice = (xml: string, nivel: 1 | 2, numero?: string) => {
    if (nivel === 1) letra = 0;
    entradas.push({ nivel, numero, texto: textoDe(xml).trim(), ancla: anclaDe(xml) });
  };
  const nuevoSubtitulo = (texto: string) => {
    const t = titulo(texto, pPrDe(E(147)), rPrDe(E(147)));
    cuerpo.push(t.xml);
    entradas.push({ nivel: 2, numero: subtitulos(), texto, ancla: t.ancla });
  };
  const subtituloLiteral = (xml: string) => {
    cuerpo.push(xml);
    enIndice(xml, 2, subtitulos());
  };
  const nuevaTabla = (titulo: string, xml: string) => {
    nTabla += 1;
    cuerpo.push(leyenda("Tabla", nTabla, `${titulo} – ${p.trimestreTitulo}`), xml, fuente(p.anio), vacio());
  };
  const figura = (clave: ClaveGrafico, titulo: string) => {
    const png = graficos[clave];
    if (!png) return;
    nGrafico += 1;
    const rId = `rIdPG${nGrafico}`;
    imagenes.push({ rId, ruta: `media/pg2030_grafico${nGrafico}.png`, png });
    cuerpo.push(leyenda("Gráfico", nGrafico, `${titulo} – ${p.trimestreTitulo}`), parrafoImagen(imagen(rId, tamanoPng(png), 15)), fuente(p.anio), vacio());
  };
  const analisis = (clave: string) => {
    const texto = textos.interpretaciones.get(clave);
    if (texto) cuerpo.push(parrafo([texto]), vacio());
  };

  // ---- Cover
  rango(0, 8);
  cuerpo.push(reemplazar(E(9), NRO_INFORME, campos.numeroInforme.trim() || `CGREG-DGTAR-${p.anio}-`));
  rango(10, 13);
  cuerpo.push(reemplazar(E(14), "Período Enero – Marzo 2026", `Período ${p.rango} ${p.anio}`));
  literal(15, 16);
  cuerpo.push(reemplazarTodo(E(17), fechaLarga(campos.fecha, "del")));
  const posicionIndice = cuerpo.push("") - 1;

  // ---- Title and 1. Marco legal
  const tituloInforme = conSaltoAntes(reemplazar(E(38), "ENERO – MARZO 2026", `${p.rango.toUpperCase()} ${p.anio}`));
  cuerpo.push(tituloInforme);
  enIndice(tituloInforme, 1);
  literal(39);
  cuerpo.push(E(40));
  enIndice(E(40), 1, "1.");
  rango(41, 51);

  // ---- 2. Antecedentes
  cuerpo.push(E(52));
  enIndice(E(52), 1, "2.");
  rango(53, 72);
  subtituloLiteral(E(73));
  literal(74);
  const oficiosMetas = campos.oficiosMetas.trim().replace(/[.,;\s]+$/, "");
  let p75 = reemplazar(E(75), OFICIOS_METAS, oficiosMetas ? `Mediante ${oficiosMetas}, el CGREG` : "El CGREG");
  const convocadas = d.planificacion.convocadas;
  p75 = reemplazar(p75, CONVOCADAS, `${convocadas} ${convocadas === 1 ? "institución pública" : "instituciones públicas"}`);
  cuerpo.push(p75);
  literal(76, 77);
  cuerpo.push(reemplazar(reemplazar(E(78), "para el año 2026", `para el año ${p.anio}`), "período 2026-2030", `período ${p.anio}-2030`));
  literal(79);
  subtituloLiteral(reemplazar(E(80), "primer trimestre", `${p.ordinal} trimestre`));
  literal(81);
  const oficioAvances = campos.oficioAvances.trim().replace(/[.,;\s]+$/, "");
  cuerpo.push(
    reemplazarTodo(
      E(82),
      `${oficioAvances ? `Mediante ${oficioAvances}, la DGTAR` : "La DGTAR"} solicitó a las instituciones públicas el reporte de avances de la planificación anual ${p.anio} ` +
        "vinculada al Plan Galápagos 2030, así como la formalización de delegados técnicos para el presente ejercicio fiscal" +
        (campos.fechaLimite ? `, con fecha límite de remisión para el ${fechaLarga(campos.fechaLimite)}.` : "."),
    ),
  );
  literal(83);
  cuerpo.push(reemplazarTodo(E(84), textoProgramacion(h)));
  literal(85);
  cuerpo.push(reemplazar(E(86), "primer trimestre", `${p.ordinal} trimestre`));
  literal(87);
  for (const linea of lineasCumplimiento(h)) cuerpo.push(parrafo(linea, pPrDe(E(88)), rPrDe(E(88))));
  literal(90);

  // ---- 3. Metodología, 4. Limitaciones, 5. Objetivo general
  cuerpo.push(E(91));
  enIndice(E(91), 1, "3.");
  rango(92, 94);
  cuerpo.push(reemplazar(reemplazar(E(95), "PG2030_2026_INSTITUCIÓN", `PG2030_${p.anio}_INSTITUCIÓN`), "ejercicio fiscal 2026", `ejercicio fiscal ${p.anio}`));
  rango(96, 121);
  cuerpo.push(reemplazar(E(122), "primer trimestre de 2026", `${p.ordinal} trimestre de ${p.anio}`));
  literal(123);
  cuerpo.push(E(124));
  enIndice(E(124), 1, "4.");
  rango(125, 127);
  cuerpo.push(E(128));
  enIndice(E(128), 1, "5.");
  literal(129);
  cuerpo.push(reemplazar(E(130), "primer trimestre de 2026", `${p.ordinal} trimestre de ${p.anio}`));
  literal(131);

  // ---- 6. Resultados
  const resultados = reemplazar(E(132), "Enero – Marzo 2026", `${p.rango} ${p.anio}`);
  cuerpo.push(resultados);
  enIndice(resultados, 1, "6.");
  literal(133);

  // a) Goals of the year
  subtituloLiteral(reemplazar(E(134), "Ejercicio Fiscal 2026", `Ejercicio Fiscal ${p.anio}`));
  cuerpo.push(reemplazar(E(136), "requerimiento de metas 2026", `requerimiento de metas ${p.anio}`));
  literal(137);
  // The template's first run there is the bold count; the sentence itself is plain.
  const rPrLista = '<w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
  for (const linea of lineasMetas(h)) cuerpo.push(parrafo(linea, pPrDe(E(138)), rPrLista));
  const observaciones = textos.interpretaciones.get("observaciones");
  if (observaciones) cuerpo.push(vacio(), parrafo([observaciones], pPrDe(E(143)), rPrDe(E(143))));
  cuerpo.push(vacio());

  // b) Reporting compliance
  nuevoSubtitulo("Cumplimiento del reporte de avances");
  cuerpo.push(vacio(), parrafo(textoCumplimiento(h)), vacio());
  if (h.obligadas.length) {
    cuerpo.push(parrafo("A continuación, se presenta el detalle del cumplimiento del reporte por institución:"));
    const c = d.cumplimiento;
    nuevaTabla(
      "Cumplimiento del reporte de avances por institución",
      tabla(
        [
          { titulo: "INSTITUCIÓN", ancho: 1900 },
          { titulo: "Metas a reportar", ancho: 1450, alinear: "center" },
          { titulo: "Metas reportadas", ancho: 1450, alinear: "center" },
          { titulo: "Cumplimiento del reporte", ancho: 1700, alinear: "center" },
          { titulo: "Estado", ancho: 1994 },
        ],
        h.obligadas.map((i) => {
          const estado = ESTADO_REPORTE[i.estadoReporte];
          return [i.institucion.sigla, String(i.aReportar), String(i.reportadas), pct(i.cumplimiento), estado ? [{ punto: estado.color }, " ", estado.label] : ""];
        }),
        ["Total", String(c.aReportar), String(c.reportadas), pct(c.aReportar ? c.reportadas / c.aReportar : null), ""],
        { sz: 20 },
      ),
    );
  }

  // c) Alignment
  subtituloLiteral(reemplazar(E(147), "Primer trimestre 2026", p.trimestreTitulo));
  cuerpo.push(vacio());
  const alineacion = textosAlineacion(h);
  cuerpo.push(parrafo(alineacion.intro), vacio(), parrafo(alineacion.hallazgo), vacio());
  analisis("alineacion");
  const ejes = d.alineacion.porEje.filter((e) => e.total > 0);
  if (ejes.length) {
    const categorias = ORDEN_CATEGORIAS.filter((c) => d.alineacion.categorias.includes(c));
    const numericas = 1 + categorias.length;
    const anchoNum = numericas > 5 ? 732 : 806;
    const anchoEje = numericas > 5 ? 1902 : 2056;
    const anchoObjetivo = 8494 - anchoEje - anchoNum * numericas;
    const total = (c: string) => String(h.porCategoria[c] ?? 0);
    nuevaTabla(
      "Resumen de metas, contribución y alineación por eje del Plan Galápagos 2030",
      tabla(
        [
          { titulo: "EJES DEL PLAN GALÁPAGOS 2030", ancho: anchoEje },
          { titulo: "OBJETIVO ESTRATÉGICO", ancho: anchoObjetivo },
          { titulo: `Número de metas establecidas en el ${p.anio}`, ancho: anchoNum, alinear: "center", vertical: true },
          ...categorias.map((c) => ({ titulo: c, ancho: anchoNum, alinear: "center" as const, vertical: true })),
        ],
        ejes.map((e) => {
          const letra = letraEje(e.eje.nombre);
          const icono = letra && ICONOS[letra] ? [{ xml: imagen(ICONOS[letra], TAMANO_ICONO, 1.1) }, { salto: true as const }] : [];
          return [
            [...icono, e.eje.nombre],
            h.objetivos.get(e.eje.id) ?? "",
            String(e.total),
            ...categorias.map((c) => String(e.porCategoria[c] ?? 0)),
          ];
        }),
        ["TOTAL", "", String(h.totalMetasAlineacion), ...categorias.map(total)],
        { sz: 18, altoEncabezado: 2100 },
      ),
    );
    figura("alineacion", "Metas por eje del Plan Galápagos 2030 según su contribución");
  }

  // d) Physical progress, budget and coherence
  subtituloLiteral(E(160));
  cuerpo.push(vacio());
  const avance = textosAvanceFisico(h);
  if (!avance) {
    cuerpo.push(parrafo(`Durante el ${p.ordinal} trimestre de ${p.anio} no se registraron metas reportadas que permitan calcular el avance institucional.`), vacio());
  } else {
    cuerpo.push(parrafo(avance.intro), vacio());
    cuerpo.push(parrafo([{ t: "Avance físico:", b: true }, "  ", ...semaforo(d.avanceFisico.semaforo), pct(d.avanceFisico.valor)]), vacio());
    cuerpo.push(parrafo(avance.hallazgo), vacio());
    analisis("avanceFisico");
    cuerpo.push(parrafo("A continuación, se presenta la tabla resumen del avance físico por cada institución:"));
    const conFisico = h.cuentan.filter((i) => i.fisico.valor !== null);
    nuevaTabla(
      "Avance físico acumulado por institución",
      tabla(
        [
          { titulo: "INSTITUCIÓN", ancho: 2323 },
          { titulo: "Promedio de % de Avance Físico Acumulado", ancho: 2552, alinear: "center" },
        ],
        conFisico.map((i) => [i.institucion.sigla, conPunto(i.fisico.semaforo, pct(i.fisico.valor))]),
        ["Total", conPunto(d.avanceFisico.semaforo, pct(d.avanceFisico.valor))],
        { sz: 22 },
      ),
    );
    figura("avanceFisico", "Avance físico acumulado por institución");

    const presupuesto = textosPresupuesto(h)!;
    cuerpo.push(parrafo([...semaforo(d.presupuesto.total.semaforo), { t: " Ejecución presupuestaria", b: true }]), vacio());
    cuerpo.push(parrafo(presupuesto.cobertura), vacio());
    cuerpo.push(parrafo("De la información recabada, el desempeño financiero de las instituciones se distribuye de la siguiente manera:"), vacio());
    for (const linea of presupuesto.lineas) {
      const punto: Trozo[] = linea.clave === "sin_presupuesto" ? [] : semaforo(linea.clave as Pg2030Semaforo);
      cuerpo.push(parrafo([...punto, " ", ...marcado(linea.texto)]));
    }
    cuerpo.push(vacio(), parrafo(presupuesto.hallazgo), vacio());
    analisis("presupuesto");
    cuerpo.push(
      parrafo(`La siguiente matriz presenta la ejecución presupuestaria de las metas reportadas durante el ${p.ordinal} trimestre del Ejercicio Fiscal ${p.anio}, detallada por fuente de financiamiento.`),
    );
    const fuentes = d.presupuesto.porFuente.filter((f) => ["Corriente", "Inversión", "Cooperación"].includes(f.fuente) || f.dinero.planificado > 0 || f.dinero.devengado > 0);
    const t = d.presupuesto.total;
    nuevaTabla(
      "Ejecución presupuestaria de la gestión pública por fuente de financiamiento",
      tabla(
        [
          { titulo: "Fuente de financiamiento", ancho: 2300 },
          { titulo: "Presupuesto planificado", ancho: 2000, alinear: "center" },
          { titulo: "Presupuesto devengado", ancho: 2000, alinear: "center" },
          { titulo: "Avance presupuestario", ancho: 2194, alinear: "center" },
        ],
        fuentes.map((f) =>
          f.dinero.planificado > 0
            ? [f.fuente, usd(f.dinero.planificado), usd(f.dinero.computable), conPunto(f.dinero.semaforo, pct(f.dinero.avance))]
            : [f.fuente, usd(0), "No aplica", "No aplica"],
        ),
        ["TOTAL", usd(t.planificado), usd(t.computable), t.planificado > 0 ? conPunto(t.semaforo, pct(t.avance)) : "No aplica"],
        { sz: 22 },
      ),
    );
    figura("presupuesto", "Presupuesto planificado y devengado por fuente de financiamiento");

    cuerpo.push(parrafo([{ t: "Análisis comparativo entre el avance físico y presupuestario por institución", b: true }]), vacio());
    cuerpo.push(parrafo(textoCoherencia(h) ?? ""), vacio());
    analisis("coherencia");
    cuerpo.push(
      parrafo(`A continuación, se presenta el análisis del avance físico y presupuestario correspondiente al ${p.ordinal} trimestre del ejercicio fiscal ${p.anio}, así como el número de metas por institución.`),
    );
    nuevaTabla(
      "Análisis de coherencia entre avance físico y presupuestario por institución",
      tabla(
        [
          { titulo: "INSTITUCIÓN", ancho: 1300 },
          { titulo: "Metas a reportar", ancho: 850, alinear: "center" },
          { titulo: "Metas reportadas", ancho: 850, alinear: "center" },
          { titulo: "Cumplimiento del reporte", ancho: 1100, alinear: "center" },
          { titulo: "Avance físico", ancho: 1150, alinear: "center" },
          { titulo: "Avance presupuestario", ancho: 1400, alinear: "center" },
          { titulo: "Coherencia", ancho: 1844, alinear: "center" },
        ],
        h.cuentan.map((i) => [
          i.institucion.sigla,
          String(i.aReportar),
          String(i.reportadas),
          pct(i.cumplimiento),
          conPunto(i.fisico.semaforo, pct(i.fisico.valor)),
          i.presupuesto.sinPresupuesto ? "Sin presupuesto definido" : conPunto(i.presupuesto.semaforo, pct(i.presupuesto.valor)),
          [{ punto: color(d.leyenda.coherencia[i.coherencia].color) }, " ", d.leyenda.coherencia[i.coherencia].label],
        ]),
        undefined,
        { sz: 18 },
      ),
    );
    figura("coherencia", "Avance físico frente a avance presupuestario por institución");
  }

  // e) Budget by investment type
  const inversion = textoInversion(h);
  if (inversion) {
    nuevoSubtitulo("Presupuesto por tipo de inversión");
    cuerpo.push(vacio(), parrafo(inversion), vacio());
    analisis("inversion");
    const tipos = d.inversion.filter((x) => x.total.planificado > 0 || x.total.devengado > 0).sort((a, b) => b.total.planificado - a.total.planificado);
    const t = d.presupuesto.total;
    nuevaTabla(
      "Presupuesto por tipo de inversión",
      tabla(
        [
          { titulo: "Tipo de inversión", ancho: 2300 },
          { titulo: "Metas", ancho: 900, alinear: "center" },
          { titulo: "Presupuesto planificado", ancho: 1800, alinear: "center" },
          { titulo: "Presupuesto devengado", ancho: 1800, alinear: "center" },
          { titulo: "Avance presupuestario", ancho: 1694, alinear: "center" },
        ],
        tipos.map((x) => [
          x.tipo,
          String(x.total.metas),
          usd(x.total.planificado),
          usd(x.total.computable),
          x.total.planificado > 0 ? conPunto(x.total.semaforo, pct(x.total.avance)) : "No aplica",
        ]),
        ["TOTAL", String(t.metas), usd(t.planificado), usd(t.computable), t.planificado > 0 ? conPunto(t.semaforo, pct(t.avance)) : "No aplica"],
        { sz: 20 },
      ),
    );
    figura("inversion", "Presupuesto planificado y devengado por tipo de inversión");
  }

  // ---- 7. Conclusiones
  cuerpo.push(E(205));
  enIndice(E(205), 1, "7.");
  literal(206);
  conclusiones(h).forEach((c, i) => {
    const implicacion = textos.implicaciones[i] ?? c.respaldo;
    cuerpo.push(parrafo([...marcado(c.hallazgo), " ", implicacion], pPrDe(E(207)), rPrDe(E(207))), vacio());
  });

  // ---- 8. Recomendaciones, 9. Anexos, 10. Firmas
  cuerpo.push(E(215));
  enIndice(E(215), 1, "8.");
  rango(216, 226);
  cuerpo.push(E(227));
  enIndice(E(227), 1, "9.");
  literal(228);
  cuerpo.push(reemplazar(E(229), "año 2026 T1", `año ${p.anio} T${p.trimestre}`));
  const enlace = campos.enlaceAnexo.trim();
  if (enlace) cuerpo.push(reemplazarTodo(E(230), enlace));
  literal(231);
  cuerpo.push(E(232));
  enIndice(E(232), 1, "10.");
  rango(233, 238);

  cuerpo[posicionIndice] = conSaltoAntesIndice(indice(P.elementos[26], entradas));

  // ---- Package
  const documento = P.inicio + cuerpo.join("") + P.fin;
  let rels = P.archivos.get("word/_rels/document.xml.rels")!.toString("utf8");
  // rId12 is the template's annex hyperlink: the form's link, or gone with its paragraph.
  rels = enlace
    ? rels.replace(/(<Relationship Id="rId12" [^>]*Target=")[^"]*(")/, `$1${esc(enlace)}$2`)
    : rels.replace(/<Relationship Id="rId12" [^>]*\/>/, "");
  rels = rels.replace(
    "</Relationships>",
    imagenes.map((i) => `<Relationship Id="${i.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${i.ruta}"/>`).join("") +
      "</Relationships>",
  );

  const salida = new Map(P.archivos);
  salida.set("word/document.xml", Buffer.from(documento, "utf8"));
  salida.set("word/_rels/document.xml.rels", Buffer.from(rels, "utf8"));
  salida.set("word/settings.xml", Buffer.from(conActualizarCampos(P.archivos.get("word/settings.xml")!.toString("utf8")), "utf8"));
  for (const i of imagenes) salida.set(`word/${i.ruta}`, i.png);
  return escribirZip(salida);
}

/** The "Contenido" heading opens page 2, as in the template. */
function conSaltoAntesIndice(sdt: string): string {
  const i = sdt.search(/<w:p[ >]/);
  const j = sdt.indexOf("</w:p>", i) + "</w:p>".length;
  return sdt.slice(0, i) + conSaltoAntes(sdt.slice(i, j)) + sdt.slice(j);
}
