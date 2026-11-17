import type { SimatIsla } from "@pma/types";

// The API runs compiled JS with plain node, where @pma/types (TypeScript
// source) cannot be loaded: import only types from it and keep runtime
// constants here. Mirrors SIMAT_ISLAS in packages/types/src/simat.ts.
export const ISLAS: readonly SimatIsla[] = ["Santa Cruz", "San Cristóbal", "Isabela", "Floreana"];

/** Galápagos has no DST: local time is a fixed UTC−6. */
export const GALAPAGOS_OFFSET_MS = 6 * 60 * 60 * 1000;

/** The Galápagos local calendar date (YYYY-MM-DD) for an instant. */
export function fechaGalapagos(instante: Date, offsetDias = 0): string {
  return new Date(instante.getTime() - GALAPAGOS_OFFSET_MS + offsetDias * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** A wall-clock time in Galápagos local time, as a true UTC instant. */
export function instanteGalapagos(local: string): Date {
  // Accept "YYYY-MM-DDTHH:MM:SS(.sss)?" without a zone and pin it to −06:00.
  const limpio = local.trim().replace(" ", "T");
  return new Date(`${limpio}-06:00`);
}

/**
 * Which island a coordinate falls on. Rough bounding boxes, enough to classify
 * the stations SIMAT ingests (Baltra counts as Santa Cruz). Falls back to Santa
 * Cruz, the archipelago's centre.
 */
export function islaDeCoordenada(lat: number, lon: number): SimatIsla {
  if (lat <= -1.1) return "Floreana";
  if (lon <= -90.7) return "Isabela";
  if (lon >= -89.9) return "San Cristóbal";
  return "Santa Cruz";
}
