import type {
  Pg2030Coherencia,
  Pg2030Dashboard,
  Pg2030DashboardInstitucion,
  Pg2030InstitucionTipo,
  Pg2030Semaforo,
} from "@pma/types";

/**
 * Formats and the facts the report reads out of the dashboard payload. Every
 * figure in the report comes from `getDashboard` (the user chose "cifras del
 * panel"): nothing here recomputes an indicator, it only groups and words them.
 */

export const ORDINALES = ["primer", "segundo", "tercer", "cuarto"] as const;
export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

const DOS = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 });
const DINERO = new Intl.NumberFormat("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const mayuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "72,5%" (es-EC decimals, as the template's amounts). */
export function pct(fraccion: number | null | undefined, vacio = "No aplica"): string {
  return fraccion === null || fraccion === undefined ? vacio : `${DOS.format(fraccion * 100)}%`;
}

/** "$12.345,67". */
export function usd(valor: number): string {
  return `$${DINERO.format(valor)}`;
}

/** "1 institución" / "3 instituciones". */
export function cuantas(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "A", "A y B", "A, B y C". */
export function enumerar(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** "2026-05-04" → "4 de mayo del 2026" (cover) or "4 de mayo de 2026" (body). */
export function fechaLarga(iso: string, conector: "de" | "del" = "de"): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} ${conector} ${m[1]}`;
}

export const ETIQUETA_SEMAFORO: Record<Pg2030Semaforo, string> = {
  verde: "avance esperado",
  amarillo: "avance cercano al esperado",
  rojo: "avance menor al esperado",
  sin_avance: "sin avance reportado",
};

/** Short axis name from the catalog's ("Nuestra COMUNIDAD (C): …" → "Comunidad"). */
const NOMBRES_CORTOS: Record<string, string> = {
  GOBERNANZA: "Gobernanza",
  COMUNIDAD: "Comunidad",
  ENTORNO: "Entorno",
  HÁBITAT: "Hábitat",
  HABITAT: "Hábitat",
  ECONOMIA: "Economía",
  ECONOMÍA: "Economía",
};
export function ejeCorto(nombre: string): string {
  const m = nombre.match(/Nuestr[ao]\s+([A-ZÁÉÍÓÚÑ]+)/);
  if (!m) return nombre;
  return NOMBRES_CORTOS[m[1]] ?? mayuscula(m[1].toLowerCase());
}

/** The axis letter in its name, "(C)", which picks its icon in the template. */
export function letraEje(nombre: string): string | null {
  return nombre.match(/\(([A-Z])\)/)?.[1] ?? null;
}

export interface Periodo {
  anio: number;
  trimestre: 1 | 2 | 3 | 4;
  /** "primer". */
  ordinal: string;
  /** Last month the figures cover (1–12). */
  mesFin: number;
  /** "Enero – Marzo". */
  rango: string;
  /** "Primer trimestre 2026". */
  trimestreTitulo: string;
}

export function periodoDe(d: Pg2030Dashboard): Periodo {
  const anio = d.anio!.anio;
  const trimestre = d.corte!.trimestre;
  const mesFin = d.corte!.hasta > 0 ? d.corte!.hasta : 3 * trimestre;
  const ordinal = ORDINALES[trimestre - 1];
  return {
    anio,
    trimestre,
    ordinal,
    mesFin,
    rango: mesFin === 1 ? "Enero" : `Enero – ${mayuscula(MESES[mesFin - 1])}`,
    trimestreTitulo: `${mayuscula(ordinal)} trimestre ${anio}`,
  };
}

/** How the institutions in scope are called in a sentence. */
export function sujeto(tipo: Pg2030InstitucionTipo | undefined): string {
  if (tipo === "Ejecutivo") return " del Ejecutivo";
  if (tipo === "GAD") return " de los gobiernos autónomos descentralizados";
  return "";
}

export const siglasDe = (insts: Pg2030DashboardInstitucion[]) => insts.map((i) => i.institucion.sigla);

export interface Hechos {
  d: Pg2030Dashboard;
  periodo: Periodo;
  tipo?: Pg2030InstitucionTipo;
  /** Institutions that declared no actions linked to the Plan this year. */
  sinAccionesSiglas: string[];
  /** Strategic objective text per axis id. */
  objetivos: Map<string, string>;
  /** Institutions with goals that count at the cutoff (charts 5 and 7). */
  cuentan: Pg2030DashboardInstitucion[];
  /** Institutions with goals to report in the cutoff. */
  obligadas: Pg2030DashboardInstitucion[];
  metasQueCuentan: number;
  fisicoPor: Record<Pg2030Semaforo, Pg2030DashboardInstitucion[]>;
  presupuestoPor: Record<Pg2030Semaforo | "sin_presupuesto", Pg2030DashboardInstitucion[]>;
  coherenciaPor: Record<Pg2030Coherencia, Pg2030DashboardInstitucion[]>;
  /** Goals per contribution category, all axes together. */
  porCategoria: Record<string, number>;
  totalMetasAlineacion: number;
}

export function leerHechos(
  d: Pg2030Dashboard,
  extra: { tipo?: Pg2030InstitucionTipo; sinAccionesSiglas: string[]; objetivos: Map<string, string> },
): Hechos {
  const porSigla = (a: Pg2030DashboardInstitucion, b: Pg2030DashboardInstitucion) => a.institucion.sigla.localeCompare(b.institucion.sigla);
  const cuentan = d.instituciones.filter((i) => i.cuenta).sort(porSigla);
  const obligadas = d.instituciones.filter((i) => i.estadoReporte !== "no_obligada").sort(porSigla);

  const fisicoPor: Hechos["fisicoPor"] = { verde: [], amarillo: [], rojo: [], sin_avance: [] };
  for (const i of cuentan) if (i.fisico.semaforo) fisicoPor[i.fisico.semaforo].push(i);
  for (const k of Object.keys(fisicoPor) as Pg2030Semaforo[]) fisicoPor[k].sort((a, b) => b.fisico.valor! - a.fisico.valor! || porSigla(a, b));

  const presupuestoPor: Hechos["presupuestoPor"] = { verde: [], amarillo: [], rojo: [], sin_avance: [], sin_presupuesto: [] };
  for (const i of cuentan) {
    if (i.presupuesto.sinPresupuesto || !i.presupuesto.semaforo) presupuestoPor.sin_presupuesto.push(i);
    else presupuestoPor[i.presupuesto.semaforo].push(i);
  }

  const coherenciaPor: Hechos["coherenciaPor"] = { coherente: [], sin_financiamiento: [], incoherencia_brecha: [], no_aplica: [] };
  for (const i of cuentan) coherenciaPor[i.coherencia].push(i);

  const porCategoria: Record<string, number> = {};
  for (const cat of d.alineacion.categorias) porCategoria[cat] = d.alineacion.porEje.reduce((s, e) => s + (e.porCategoria[cat] ?? 0), 0);

  return {
    d,
    periodo: periodoDe(d),
    tipo: extra.tipo,
    sinAccionesSiglas: [...extra.sinAccionesSiglas].sort(),
    objetivos: extra.objetivos,
    cuentan,
    obligadas,
    metasQueCuentan: d.instituciones.reduce((s, i) => s + i.metas.filter((m) => m.cuenta).length, 0),
    fisicoPor,
    presupuestoPor,
    coherenciaPor,
    porCategoria,
    totalMetasAlineacion: d.alineacion.porEje.reduce((s, e) => s + e.total, 0),
  };
}
