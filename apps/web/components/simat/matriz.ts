import type { SimatNivelRiesgo, SimatUmbralesLluvia } from "@pma/types";
import type { NombreIcono } from "./iconos";
import { medida } from "@/lib/simat/formato";

/**
 * Escala de riesgo por lluvia (umbrales del equipo técnico, migración 0044):
 * la lluvia promedio en la ventana del criterio frente a tres umbrales da el
 * nivel; si el sector tiene umbral de mar y el mar lo alcanza, sube uno. Los
 * códigos reutilizan los colores de la vista previa (verde, ámbar, naranja,
 * rojo).
 */
export interface NivelEscala {
  name: SimatNivelRiesgo;
  code: "normal" | "caution" | "alert" | "emergency";
  decision: string;
  note: string;
  icon: NombreIcono;
}

export const ESCALA: NivelEscala[] = [
  { name: "Normal", code: "normal", decision: "Monitoreo rutinario", note: "Lluvia por debajo del umbral de vigilancia.", icon: "shield" },
  {
    name: "Vigilancia",
    code: "caution",
    decision: "Vigilancia reforzada",
    note: "Lluvia sobre el umbral de vigilancia: seguir su evolución y la de la marea.",
    icon: "alert",
  },
  {
    name: "Preparación",
    code: "alert",
    decision: "Preparación de la respuesta",
    note: "Lluvia sobre el umbral de preparación: alistar recursos y avisar a los responsables.",
    icon: "circleAlert",
  },
  {
    name: "Respuesta",
    code: "emergency",
    decision: "Activación de la respuesta",
    note: "Lluvia sobre el umbral de respuesta: aplicar el protocolo de la autoridad competente.",
    icon: "siren",
  },
];

export const indiceNivel = (nivel: string | null | undefined) => ESCALA.findIndex((i) => i.name === nivel);

/** Índice 0–3 por la lluvia (mm/h), como indiceLluvia() de la API. */
export function indiceLluvia(intensidad: number, u: SimatUmbralesLluvia): number {
  if (intensidad >= u.respuesta) return 3;
  if (intensidad >= u.preparacion) return 2;
  if (intensidad >= u.vigilancia) return 1;
  return 0;
}

/** Nivel con el mar: uno más si está alto, sin pasar de Respuesta. */
export const nivelConMar = (indice: number, marAlto: boolean | null) => ESCALA[Math.min(3, indice + (marAlto ? 1 : 0))];

/** Rango de lluvia de cada nivel con los umbrales del sector («5 – 15 mm/h»). */
export function rangoLluvia(indice: number, u: SimatUmbralesLluvia): string {
  const v = [u.vigilancia, u.preparacion, u.respuesta];
  if (indice === 0) return `< ${medida(v[0])} mm/h`;
  if (indice === 3) return `≥ ${medida(v[2])} mm/h`;
  return `${medida(v[indice - 1])} – ${medida(v[indice])} mm/h`;
}
