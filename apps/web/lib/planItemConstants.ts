export const SUBPLAN_OPTIONS = [
  "Plan de Prevencion y Mitigacion de Impactos",
  "Plan de Seguridad y Salud Ocupacional",
  "Plan de Contingencias",
  "Plan de Manejo de Desechos",
  "Plan de Monitoreo y Seguimiento",
  "Plan de rescate de vida silvestre",
  "Plan de Capacitacion",
  "Plan de Rehabilitacion de Areas Afectadas",
  "Plan de Relaciones Comunitarias",
  "Plan de Cierre y Abandono",
  "Plan de Comunicacion y Capacitacion",
  "Plan de Comunicacion, Capacitacion y Educacion Ambiental",
  "Plan de Educacion Ambiental",
  "Plan de Rehabilitacion",
  "Plan de Cierre, Abandono y Entrega del Area",
] as const;

// Canonical "direcciones". The field is a fixed selector (no free text) to
// avoid the spelling variants that used to fragment direccion-based grouping.
export const DIRECCION_OPTIONS = [
  "DAF",
  "DGTAR",
  "DOSPPSVR",
  "DOSPPSVR / DGTAR",
  "OPC",
] as const;

export const PERIODICITY_OPTIONS = [
  "Al finalizar la etapa de operacion",
  "Anual",
  "Bimensual",
  "Bianual",
  "Diaria",
  "En caso de suceder",
  "Mensual",
  "Permanente",
  "Semanal",
  "Semestral",
  "Trianual",
  "Trimestral",
  "Cuatrimestral",
  "Unica vez",
] as const;

export const ORIGIN_GENERATION_OPTIONS = [
  "AMI - Almacenamiento de insumo",
  "AMP - Almacenamiento del producto",
  "CC - Control de calidad",
  "DP - Descarga de producto",
  "MN - Mantenimiento",
  "PP - Proceso productivo",
  "SAX - Servicios auxiliares",
  "SP - Subproducto",
  "TI - Transporte de insumo",
  "TP - Transporte de producto",
  "OT - Otro",
] as const;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchClosestOption(
  input: string,
  options: readonly string[]
): string | null {
  if (!input) return null;
  const norm = normalize(input);
  if (!norm) return null;

  const exact = options.find((o) => normalize(o) === norm);
  if (exact) return exact;

  const contains = options.find((o) => {
    const n = normalize(o);
    return n.includes(norm) || norm.includes(n);
  });
  if (contains) return contains;

  return null;
}
