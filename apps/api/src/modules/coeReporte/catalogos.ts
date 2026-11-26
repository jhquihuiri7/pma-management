import type { CoeCatalogos, CoeEstado } from "@pma/types";

// Catalogs of the original app (public/app.js): islands, institutions in seven
// groups, the seven technical working tables (MTT) and the three working
// groups (GT). Islands and institutions also accept a free-text "other".

export const ISLAS = ["San Cristóbal", "Santa Cruz", "Isabela", "Floreana", "Baltra"] as const;

export const INSTITUCIONES: CoeCatalogos["instituciones"] = [
  { grupo: "Régimen Especial", nombres: ["Consejo de Gobierno del Régimen Especial de Galápagos"] },
  {
    grupo: "Ministerios y Secretarías",
    nombres: [
      "Ministerio de Ambiente y Energía",
      "Ministerio de Desarrollo Económico y Productivo",
      "Ministerio de Educación, Deporte y Cultura",
      "Ministerio de Gobierno",
      "Ministerio de Infraestructura y Tecnología",
      "Ministerio de Salud Pública",
      "Ministerio de Trabajo y Desarrollo Humano",
      "Secretaría Nacional de Gestión de Riesgos",
    ],
  },
  {
    grupo: "Agencias, Empresas Públicas y Entidades del Estado",
    nombres: [
      "Agencia de Regulación y Control de la Bioseguridad y Cuarentena para Galápagos",
      "Agencia Nacional de Regulación y Control de Transporte Terrestre, Tránsito y Seguridad Vial",
      "BanEcuador B.P.",
      "Corporación Nacional de Telecomunicaciones",
      "Dirección General de Aviación Civil",
      "Dirección del Parque Nacional Galápagos",
      "Empresa Eléctrica Provincial Galápagos",
      "Instituto Ecuatoriano de Seguridad Social",
      "Instituto Nacional de Meteorología e Hidrología (INAMHI)",
      "Instituto Oceanográfico y Antártico de la Armada (INOCAR)",
      "Petroecuador",
      "Servicio Integrado de Seguridad ECU 911",
    ],
  },
  {
    grupo: "Seguridad, Fuerzas Armadas y Organismos de Socorro",
    nombres: [
      "Capitanía de Puerto Ayora",
      "Capitanía de Puerto Baquerizo Moreno",
      "Capitanía de Puerto Villamil",
      "Cruz Roja Junta Provincial de Galápagos",
      "Cuerpo de Bomberos de Isabela",
      "Cuerpo de Bomberos de Santa Cruz",
      "Cuerpo de Bomberos San Cristóbal",
      "Fuerza Naval",
      "Policía Nacional del Ecuador",
    ],
  },
  {
    grupo: "Gobiernos Autónomos Descentralizados (GAD) Municipales",
    nombres: [
      "Gobierno Autónomo Descentralizado Municipal de Santa Cruz",
      "Gobierno Autónomo Descentralizado Municipal Isabela",
      "Gobierno Autónomo Descentralizado Municipal San Cristóbal",
    ],
  },
  {
    grupo: "Gobiernos Autónomos Descentralizados (GAD) Parroquiales",
    nombres: [
      "Gobierno Autónomo Descentralizado Parroquial El Progreso",
      "Gobierno Autónomo Descentralizado Parroquial Rural Bellavista",
      "Gobierno Autónomo Descentralizado Parroquial Rural Isla Santa María",
      "Gobierno Autónomo Descentralizado Parroquial Rural Santa Rosa",
      "Gobierno Autónomo Descentralizado Parroquial Rural Tomás de Berlanga",
    ],
  },
  { grupo: "Organizaciones científicas y de apoyo", nombres: ["Fundación Charles Darwin para las Islas Galápagos"] },
];

/** MTT 1..7 and GT 1..3, in this order: the code is the 1-based position. */
export const EQUIPOS: CoeCatalogos["equipos"] = {
  MTT: [
    "Agua segura, saneamiento y gestión de residuos",
    "Salud y atención prehospitalaria",
    "Servicios básicos esenciales",
    "Gestión de alojamientos temporales y asistencia humanitaria",
    "Educación en situación de emergencia",
    "Medios de vida y productividad",
    "Infraestructura esencial y vivienda",
  ],
  GT: ["Logística", "Seguridad y Control", "Búsqueda, Salvamento y Rescate"],
};

export const ESTADOS: Record<CoeEstado, string> = {
  pending: "Pendiente de reporte",
  done: "Cumplida",
  partial: "Avance parcial",
  missed: "No ejecutada",
  extra: "No programada",
};

export function catalogos(): CoeCatalogos {
  return { islas: [...ISLAS], instituciones: INSTITUCIONES, equipos: EQUIPOS, estados: ESTADOS };
}

/** "MTT 3 · Servicios básicos esenciales", or the direct-action label. */
export function nombreEquipo(instancia: string, equipo: string): string {
  if (!equipo) return "Acción institucional directa";
  const [tipo, numero] = equipo.split(" ");
  const nombre = EQUIPOS[tipo as "MTT" | "GT"]?.[Number(numero) - 1];
  return nombre ? `${equipo} · ${nombre}` : equipo || instancia;
}
