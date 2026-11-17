import type { SimatNivelRiesgo } from "@pma/types";
import type { NombreIcono } from "./iconos";

/** Matriz lluvia × mar de la vista previa (risk-ui.js): textos y decisiones. */
export interface NivelMatriz {
  name: SimatNivelRiesgo;
  code: "normal" | "caution" | "alert" | "emergency";
  rain: string;
  sea: string;
  decision: string;
  note: string;
  icon: NombreIcono;
}

export const MATRIZ: NivelMatriz[] = [
  { name: "Normal", code: "normal", rain: "Baja", sea: "Bajo", decision: "Monitoreo preventivo", note: "Escenario de operación habitual.", icon: "shield" },
  {
    name: "Precaución",
    code: "caution",
    rain: "Baja",
    sea: "Alto",
    decision: "Preparación y alerta",
    note: "El mar alto puede dificultar la descarga costera.",
    icon: "alert",
  },
  {
    name: "Alerta",
    code: "alert",
    rain: "Alta",
    sea: "Bajo",
    decision: "Activación preventiva",
    note: "La lluvia intensa puede saturar drenajes y elevar la escorrentía.",
    icon: "circleAlert",
  },
  {
    name: "Emergencia",
    code: "emergency",
    rain: "Alta",
    sea: "Alto",
    decision: "Activación de emergencia y evacuación si corresponde",
    note: "Posible inundación combinada. Aplica el protocolo de la autoridad competente.",
    icon: "siren",
  },
];

export const indiceNivel = (nivel: string | null | undefined) => MATRIZ.findIndex((i) => i.name === nivel);
