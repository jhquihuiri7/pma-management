// Reporte territorial diario del COE Provincial de Galápagos (módulo
// `coe_reporte`). Ported from the standalone Vercel app: institutions report
// the activities they plan for the day (08h00 cut) and their results (19h00
// cut). Reporting is public; each browser holds an anonymous history code.

export type CoeEstado = "pending" | "done" | "partial" | "missed" | "extra";
export type CoeInstancia = "MTT" | "GT" | "Directa";

export interface CoeMetrica {
  indicador: string;
  /** Numeric text as typed ("2.5"), finite and ≥ 0. */
  cantidad: string;
  unidad: string;
}

export interface CoeEvento {
  id: string;
  titulo: string;
}

export interface CoeCatalogos {
  islas: string[];
  instituciones: { grupo: string; nombres: string[] }[];
  equipos: Record<"MTT" | "GT", string[]>;
  estados: Record<CoeEstado, string>;
}

/** A programmed activity as the browser sends it (08h00 cut). */
export interface CoeActividadEntrada {
  id: string;
  evento: string;
  dia: string;
  isla: string;
  sector: string;
  institucion: string;
  instancia: CoeInstancia;
  equipo: string;
  descripcion: string;
  metas: CoeMetrica[];
  /** "pending" for a programmed activity; "extra" carries its result too. */
  estado: "pending" | "extra";
  resultado?: string;
  numeros?: CoeMetrica[];
}

/** The result of a programmed activity (19h00 cut). */
export interface CoeResultadoEntrada {
  envio: string;
  estado: "done" | "partial" | "missed";
  resultado: string;
  motivo: string;
  numeros: CoeMetrica[];
}

export interface CoeActividad {
  id: string;
  evento: string;
  dia: string;
  isla: string;
  sector: string;
  institucion: string;
  instancia: CoeInstancia;
  equipo: string;
  descripcion: string;
  metas: CoeMetrica[];
  estado: CoeEstado;
  resultado: string;
  motivo: string;
  numeros: CoeMetrica[];
  creadoEn: string;
  completadoEn: string | null;
}

export interface CoeDelegado {
  id: string;
  nombre: string;
  email: string;
  institucion: string;
}

export interface CoeDirectorio {
  destinatarios: string[];
  delegados: CoeDelegado[];
  correoConfigurado: boolean;
}
