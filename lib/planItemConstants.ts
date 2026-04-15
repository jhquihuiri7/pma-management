export const SUBPLAN_OPTIONS = [
  "Plan de Prevención y Mitigación de Impactos",
  "Plan de Seguridad y Salud Ocupacional",
  "Plan de Contingencias",
  "Plan de Manejo de Desechos",
  "Plan de Monitoreo y Seguimiento",
  "Plan de rescate de vida silvestre",
  "Plan de Capacitación",
  "Plan de Rehabilitación de Áreas Afectadas",
  "Plan de Relaciones Comunitarias",
  "Plan de Cierre y Abandono",
] as const;

export const PERIODICITY_OPTIONS = [
  "Al finalizar la etapa de operación",
  "Anual",
  "Bianual",
  "En caso de suceder",
  "Mensual",
  "Permanente",
  "Semanal",
  "Semestral",
  "Trimestral",
  "Única vez",
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
