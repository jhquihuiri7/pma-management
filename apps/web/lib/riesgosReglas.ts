import type { RiesgosRecursoEntrada } from "@/types";

// Quantity rules of a resource. The API enforces the same ones
// (apps/api/src/modules/riesgos/modelo.ts); checking them here as the user
// types puts each message under its field at once instead of after "Siguiente".

/** The cap the API applies to every quantity. */
export const MAX_CANTIDAD = 1_000_000;

export type CampoCantidad = "cantidadExistente" | "cantidadOperativa" | "cantidadMovilizable";

export const CAMPOS_CANTIDAD: readonly CampoCantidad[] = ["cantidadExistente", "cantidadOperativa", "cantidadMovilizable"];

export type AvisosCantidades = Partial<Record<CampoCantidad | "disponibilidad", string>>;

/**
 * What a quantity field keeps of what was typed or pasted: digits only, so a
 * minus sign, a decimal point or a letter never reach the value. Empty is 0.
 */
export function leerCantidad(texto: string): number {
  const digitos = texto.replace(/\D/g, "").slice(0, 7);
  return digitos ? Number(digitos) : 0;
}

/** Existing ≥ operational ≥ really mobilizable, all whole numbers from zero up. */
export function reglasCantidades(
  r: Pick<RiesgosRecursoEntrada, CampoCantidad | "esTitular" | "disponibilidad">,
): AvisosCantidades {
  const avisos: AvisosCantidades = {};
  for (const campo of CAMPOS_CANTIDAD) {
    const valor = r[campo];
    if (!Number.isInteger(valor) || valor < 0) avisos[campo] = "Solo números enteros, cero o mayores.";
    else if (valor > MAX_CANTIDAD) avisos[campo] = "La cantidad es demasiado grande.";
  }
  if (!avisos.cantidadOperativa && r.cantidadOperativa > r.cantidadExistente) {
    avisos.cantidadOperativa = "No puede superar la cantidad existente.";
  }
  if (!avisos.cantidadMovilizable && r.cantidadMovilizable > r.cantidadOperativa) {
    avisos.cantidadMovilizable = "No puede superar la cantidad operativa.";
  }
  if (!avisos.cantidadMovilizable && !r.esTitular && r.cantidadMovilizable > 0) {
    avisos.cantidadMovilizable = "Solo la institución titular puede reportar cantidad movilizable.";
  }
  if (r.disponibilidad === "No disponible" && r.cantidadMovilizable > 0) {
    avisos.disponibilidad = "Un recurso no disponible no puede tener cantidad movilizable.";
  }
  return avisos;
}
