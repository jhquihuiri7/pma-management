// Logic of the dashboard, the records and the protocol views, ported from
// lib/dashboard.js of the standalone app. There it lived inside a DOM
// controller; here it is pure so the React views share it and tests reach it.
import {
  camposAnteriores,
  camposDe,
  conMayuscula,
  fold,
  forms,
  routes,
  RUTAS_LIMPIEZA,
  type CampoLimpieza,
  type OperacionLimpieza,
  type RecursoLimpieza,
  type RegistroLimpieza,
  type RutaLimpieza,
} from "@pma/types/protocolo-limpieza";
import { escenaRuta, type EstadoAcumulacion, type Unidad } from "./acumulacion";
import { claveBarrio } from "./barrios";

export type VistaLimpieza = "dashboard" | "history" | "protocol" | "nubes";

// Encabezado de cada vista, como en las páginas del Geoportal.
export const heroCopy: Record<VistaLimpieza, readonly [titulo: string, texto: string]> = {
  dashboard: ["Gestión de residuos", "Seguimiento de la recolección en Santa Cruz, el traslado marítimo desde Baltra y la gestión final en Guayaquil."],
  history: ["Registros operativos", "Consulta, edita y exporta los reportes de cada ruta del protocolo logístico."],
  protocol: ["Rutas y responsabilidades", "Trayecto, ejecutor y datos de trazabilidad de cada ruta del protocolo logístico."],
  nubes: ["Visualización 3D", "Nubes de puntos de cada sitio por fecha de levantamiento: elige un sitio y recorre su línea de tiempo para ver cómo cambia."],
};

export const UNIDADES: ReadonlyArray<readonly [Unidad, string]> = [
  ["t", "Toneladas"],
  ["m3", "Metros cúbicos"],
  ["u", "Unidades"],
];

const format = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 });
export const number = (n: number) => format.format(n);
export const displayDate = (d?: string | number | null) => (d ? String(d).split("-").reverse().join("/") : "") || "—";
/** Today in Galápagos (AAAA-MM-DD): the operation's own day, whatever the reader's clock says. */
export const currentDate = (now: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Galapagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
// Símbolo de la unidad elegida en el tablero: toneladas, metros cúbicos o unidades.
export const unitSymbol = (unit: string) => ({ m3: "m³", u: "unid." } as Record<string, string>)[unit] ?? "t";
export const qtyText = (v: number, unit: string) => number(v) + " " + unitSymbol(unit);
export const pctText = (v: number) => new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 }).format(v * 100) + " %";

/** Route icon: R2.1 is stored as R2-1.svg. */
/**
 * Icon of a route: the scene of its point on the map, without background
 * (public/protocolo-limpieza/mapa). The animated scene is for a route in execution.
 */
export const routeIconSrc = (route: string, animado = false) =>
  `/protocolo-limpieza/mapa/${escenaRuta(route)}${animado ? "-animado" : ""}.svg`;

export const eventDate = (r: Pick<RegistroLimpieza, "kind" | "data">) => String((r.kind === "relleno" ? r.data.recepcion : r.data.fecha) ?? "");

// ── Flujo logístico ─────────────────────────────────────────────────────────
// Cada nodo es una ruta del protocolo. R2.1 se deriva del acopio temporal.
export const flowMain: readonly RutaLimpieza[] = ["R1", "R2", "R3", "R4", "R5", "R6"];
export type TipoTraspaso = "main" | "branch";
// Traspasos entre rutas: de dónde sale lo que entra a cada ruta.
export const flowTransfers: ReadonlyArray<readonly [from: RutaLimpieza, to: RutaLimpieza, kind: TipoTraspaso]> = [
  ["R1", "R2", "main"],
  ["R1", "R2.1", "branch"],
  ["R2", "R3", "main"],
  ["R3", "R4", "main"],
  ["R4", "R5", "main"],
  ["R5", "R6", "main"],
];
export const flowZones: ReadonlyArray<readonly [key: "sc" | "sea" | "gye", name: string, symbol: "pin" | "ship"]> = [
  ["sc", "Santa Cruz", "pin"],
  ["sea", "Tramo marítimo", "ship"],
  ["gye", "Guayaquil", "pin"],
];

export interface Traspaso {
  from: RutaLimpieza;
  to: RutaLimpieza;
  kind: TipoTraspaso;
  amount: number;
  /** Part of what entered `from` that went on to `to` (0 when nothing entered). */
  share: number;
  label: string;
}

/** Entre cada ruta: cuánto pasó a la siguiente y qué parte es de lo que entró a la anterior. */
export function traspasos(state: Pick<EstadoAcumulacion, "moved" | "unit">): Traspaso[] {
  return flowTransfers.map(([from, to, kind]) => {
    const amount = state.moved[to], base = state.moved[from], share = base > 0 ? amount / base : 0;
    const label = `De ${from} a ${to} pasó ${qtyText(amount, state.unit)}, el ${pctText(share)} de lo que entró a ${from}`;
    return { from, to, kind, amount, share, label };
  });
}

// ── Limpieza por barrio ─────────────────────────────────────────────────────
export interface LimpiezaBarrio {
  /** The neighbourhood as it was reported. */
  barrio: string;
  avance: number;
  fecha: string;
}

/**
 * Latest cleaning percentage of each neighbourhood, by claveBarrio: the R1
 * collection report with the newest date that names it (on the same day, the
 * one saved last). The newest date always wins, even one after today.
 */
export function limpiezaPorBarrio(records: readonly RegistroLimpieza[]): Map<string, LimpiezaBarrio> {
  const latest = new Map<string, LimpiezaBarrio>();
  const recolecciones = records
    .filter((r) => r.kind === "recoleccion" && r.data.barrio && r.data.avance !== undefined && eventDate(r))
    .sort((a, b) => eventDate(a).localeCompare(eventDate(b)) || (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
  for (const r of recolecciones) {
    latest.set(claveBarrio(r.data.barrio), { barrio: String(r.data.barrio), avance: Number(r.data.avance), fecha: eventDate(r) });
  }
  return latest;
}

export interface FilaLimpieza {
  barrio: string;
  avance: number;
  fecha: string;
}

/**
 * The neighbourhoods that have a cleaning report (0–100 %), most advanced
 * first. Those without a report are left out. A neighbourhood keeps the
 * spelling of the layer (or of the protocol) when it is in `nombres`; one
 * reported under another name keeps the reported name.
 */
export function listaLimpieza(nombres: readonly string[], limpieza: ReadonlyMap<string, LimpiezaBarrio>): FilaLimpieza[] {
  const oficiales = new Map(nombres.map((nombre) => [claveBarrio(nombre), nombre] as const));
  const filas: FilaLimpieza[] = [];
  limpieza.forEach((dato, clave) => {
    filas.push({ barrio: oficiales.get(clave) ?? dato.barrio, avance: dato.avance, fecha: dato.fecha });
  });
  return filas.sort((a, b) => b.avance - a.avance || a.barrio.localeCompare(b.barrio, "es"));
}

// ── Recursos por ruta ───────────────────────────────────────────────────────
export interface RecursosRuta {
  route: RutaLimpieza;
  /** Date of the report the resources come from, or null when the route has none yet. */
  fecha: string | null;
  recursos: RecursoLimpieza[];
}

/**
 * Resources of each route as its latest report gives them: the report with the
 * newest date (on the same day, the one saved last). The newest date always
 * wins, even one after today.
 */
export function recursosPorRuta(records: readonly RegistroLimpieza[]): RecursosRuta[] {
  return RUTAS_LIMPIEZA.map((route) => {
    const ultimo = records
      .filter((r) => forms[r.kind]?.route === route && eventDate(r))
      .sort((a, b) => eventDate(b).localeCompare(eventDate(a)) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
    return { route, fecha: ultimo ? eventDate(ultimo) : null, recursos: ultimo?.recursos ?? [] };
  });
}

/** "10 personas (CGREG) | 2 personas (GAD SCX)": for the CSV and the search. */
export const recursosTexto = (recursos: readonly RecursoLimpieza[] | undefined) =>
  (recursos ?? []).map((r) => `${number(r.cantidad)} ${conMayuscula(r.recurso)} (${r.institucion})`).join(" | ");

// ── Registros ───────────────────────────────────────────────────────────────
export function visibleHistory(records: readonly RegistroLimpieza[], route: string, search: string): RegistroLimpieza[] {
  const q = fold(search);
  return records
    .filter(
      (r) =>
        (!route || forms[r.kind]?.route === route) &&
        (!q || Object.values(r.data).some((v) => fold(v).includes(q)) || fold(recursosTexto(r.recursos)).includes(q)),
    )
    .sort((a, b) => eventDate(b).localeCompare(eventDate(a)));
}

/** Every field of every form, once, in form order: the CSV's columns. */
// The fields of every form, then those the forms no longer ask (older reports keep them).
export const csvFields: readonly string[] = Array.from(
  new Set(Object.values(forms).flatMap((f) => f.fields.map((p) => p.id)).concat(Object.keys(camposAnteriores))),
);

// A cell that starts like a formula is written as text, so a spreadsheet never runs it.
const csvCell = (v: unknown) => {
  let s = String(v ?? "");
  if (typeof v === "string" && /^[=+@\-\t\r\n]/.test(s.trimStart())) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};

export const CSV_FILE_NAME = "trazabilidad_santa_cruz.csv";

/** The CSV the export button downloads: BOM, semicolons and CRLF, for Excel in Spanish. */
export function buildCsv(rows: readonly RegistroLimpieza[]): string {
  const lines: unknown[][] = [
    ["ruta", "operación", "ejecutor", ...csvFields, "recursos"],
    ...rows.map((r) => [
      forms[r.kind].route,
      forms[r.kind].name,
      routes[forms[r.kind].route][1],
      ...csvFields.map((f) => r.data[f]),
      recursosTexto(r.recursos),
    ]),
  ];
  return "﻿" + lines.map((r) => r.map(csvCell).join(";")).join("\r\n");
}

// ── Formulario ──────────────────────────────────────────────────────────────
export const executors: readonly string[] = Array.from(new Set(Object.values(routes).map((route) => route[1])));

export function operationsOf(executor: string): OperacionLimpieza[] {
  return (Object.keys(forms) as OperacionLimpieza[]).filter((kind) => routes[forms[kind].route][1] === executor);
}

// The neighbourhood is chosen from a list (the Geoportal's layer), so it is not typed with suggestions.
export const suggestedFields = ["contenedor"] as const;

/** Values offered while typing: what was already reported. */
export function suggestions(records: readonly RegistroLimpieza[], key: (typeof suggestedFields)[number]): string[] {
  const reported = records.map((r) => r.data[key]).filter(Boolean).map(String);
  return Array.from(new Set(reported)).sort((a, b) => a.localeCompare(b, "es"));
}

// Offered while typing a resource: the protocol's own and what was already reported.
const RECURSOS_PROTOCOLO = ["Personas", "Vehículos", "Volquetas", "Maquinaria", "Contenedores", "Buques"];
// The protocol's institutions, as its Ejecución and Apoyo columns write them.
const INSTITUCIONES_PROTOCOLO = Array.from(
  new Set(RUTAS_LIMPIEZA.flatMap((r) => [routes[r][1], ...routes[r][2].split(" - ")])),
);

export function sugerenciasRecurso(records: readonly RegistroLimpieza[], campo: "recurso" | "institucion"): string[] {
  const base = campo === "recurso" ? RECURSOS_PROTOCOLO : INSTITUCIONES_PROTOCOLO;
  const reportados = records.flatMap((r) => (r.recursos ?? []).map((x) => (campo === "recurso" ? conMayuscula(x.recurso) : x.institucion)));
  return Array.from(new Set([...base, ...reportados])).sort((a, b) => a.localeCompare(b, "es"));
}

/** The form asks for the neighbourhood's cleaning percentage right after the neighbourhood. */
export function ordenarCampos(campos: readonly CampoLimpieza[]): CampoLimpieza[] {
  const lista = campos.filter((c) => c.id !== "avance");
  const avance = campos.find((c) => c.id === "avance");
  const i = lista.findIndex((c) => c.id === "barrio");
  if (avance && i >= 0) lista.splice(i + 1, 0, avance);
  else if (avance) lista.push(avance);
  return lista;
}

/** Shown before "Más datos": what the protocol asks for, plus the fields every report needs to read well. */

// ── Prellenado de un reporte nuevo ──────────────────────────────────────────
/** Each report has its own: never copied from the previous one. */
const CAMPOS_PROPIOS_DEL_REPORTE = new Set(["documento"]);

export interface Prellenado {
  data: Record<string, string | number>;
  recursos: RecursoLimpieza[];
  /** The report the values come from. */
  desde: string;
}

const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 864e5);
function moverFecha(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * A new report of `kind` starts from the latest report of the same operation
 * (by its date, and on the same day the one saved last): every value and its
 * resources, except the photos, the document number and who reports it. The
 * main date becomes today and the other dates move by as much, so they keep
 * their distance from it (a voyage keeps its days at sea). Null when the
 * operation has no report yet.
 */
export function prellenado(records: readonly RegistroLimpieza[], kind: OperacionLimpieza, hoy: string): Prellenado | null {
  const ultimo = records
    .filter((r) => r.kind === kind)
    .sort((a, b) => eventDate(b).localeCompare(eventDate(a)) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  if (!ultimo) return null;
  const anterior = String(ultimo.data.fecha ?? "");
  const dias = esFecha(anterior) ? diasEntre(anterior, hoy) : null;
  const data: Record<string, string | number> = { fecha: hoy };
  for (const campo of camposDe(kind)) {
    const valor = ultimo.data[campo.id];
    if (valor === undefined || valor === "" || campo.id === "fecha" || campo.type === "photo" || CAMPOS_PROPIOS_DEL_REPORTE.has(campo.id)) continue;
    data[campo.id] = campo.type === "date" && dias !== null && esFecha(String(valor)) ? moverFecha(String(valor), dias) : valor;
  }
  return { data, recursos: (ultimo.recursos ?? []).map((r) => ({ ...r })), desde: ultimo.id };
}
