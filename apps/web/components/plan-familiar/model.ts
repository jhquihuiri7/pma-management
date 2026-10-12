import type { FamilyEmergencyPlan } from "@pma/types";

export type ClientFamilyPlan = Omit<FamilyEmergencyPlan, "submissionId" | "consent"> & {
  submissionId: string;
  consent: boolean;
};

export const FAMILY_PLAN_STEPS = [
  "Datos y acuerdos principales",
  "Nuestra familia y sus apoyos",
  "Riesgos que debemos preparar",
  "Rutas y puntos seguros",
  "Croquis y ubicación",
  "Mochila y recursos",
  "Acciones familiares",
  "Práctica y actualización",
] as const;

export const FAMILY_PLAN_ISLANDS = ["San Cristóbal", "Santa Cruz", "Isabela", "Floreana", "Otra"] as const;

export const RESOURCE_NAMES = [
  "Agua y alimentos no perecibles",
  "Linterna y pilas",
  "Radio o cargador portátil",
  "Botiquín y medicinas personales",
  "Documentos protegidos o copias",
  "Mascarillas, silbato y abrigo",
  "Llaves y dinero en efectivo",
  "Artículos para bebé, adulto mayor o mascota",
  "Otro recurso importante",
] as const;

export function emptyFamilyPlan(): ClientFamilyPlan {
  return {
    submissionId: "",
    family: "",
    island: "San Cristóbal",
    sector: "",
    address: "",
    date: "",
    phone: "",
    altPhone: "",
    contact: "",
    contactPhone: "",
    meeting: "",
    noSignal: "",
    reviewDate: "",
    updater: "",
    members: [{ name: "", age: 0, relation: "", phone: "", support: "", role: "" }],
    pets: [],
    risks: [{ type: "", effect: "", prevention: "", first: "", priority: "Alta" }],
    routes: [
      { situation: "Sismo", route: "", point: "", notice: "" },
      { situation: "Inundación o lluvia intensa", route: "", point: "", notice: "" },
      { situation: "Incendio u otra emergencia", route: "", point: "", notice: "" },
    ],
    sketch: "",
    reference: "",
    location: null,
    resources: RESOURCE_NAMES.map((item) => ({ item, status: "No", amount: "", location: "", pending: "" })),
    usefulPhones: "",
    actions: (["Antes", "Antes", "Durante", "Durante", "Después", "Después"] as const).map((moment) => ({
      moment,
      action: "",
      person: "",
      date: "",
      done: false,
    })),
    practice: { date: "", exercise: "", improvement: "", person: "" },
    participants: "",
    consent: false,
  };
}
