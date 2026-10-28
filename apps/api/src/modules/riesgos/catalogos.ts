import type {
  RiesgosCampoDetalle,
  RiesgosCatalogos,
  RiesgosDisponibilidad,
  RiesgosInstitucionTipo,
  RiesgosIsla,
  RiesgosRecursoTipo,
} from "@pma/types";

// The single source of the module's lists. The web reads them from
// GET /riesgos/public/catalogos, and `satisfies` keeps them in step with the
// shared types (the enums of migration 0035 hold the same values).

export const ISLAS = ["San Cristóbal", "Santa Cruz", "Isabela", "Floreana", "Baltra"] as const satisfies readonly RiesgosIsla[];

export const TIPOS_INSTITUCION = ["Público", "Privado", "ONG", "Otro"] as const satisfies readonly RiesgosInstitucionTipo[];

export const SIN_MESA = "No pertenece";

export const MESAS_TECNICAS = [
  "MTT-1: Agua segura, saneamiento y gestión de residuos",
  "MTT-2: Salud y atención Prehospitalaria",
  "MTT-3: Servicios básicos esenciales",
  "MTT-4: Gestión de alojamientos temporales y asistencia humanitaria",
  "MTT-5: Educación en situación de emergencia",
  "MTT-6: Medios de Vida y Productividad",
  "MTT-7: Infraestructura esencial y Vivienda",
] as const;

export const GRUPOS_TRABAJO = [
  "GT-1: Grupo de Trabajo Apoyo Logístico (Logística)",
  "GT-2: Grupo de Trabajo Seguridad y Control",
  "GT-3: Grupo de Trabajo Búsqueda y Rescate (Búsqueda, salvamento y rescate)",
] as const;

export const MESAS_GRUPOS = [SIN_MESA, ...MESAS_TECNICAS, ...GRUPOS_TRABAJO] as const;

export const TIPOS_RECURSO = [
  "Talento humano",
  "Vehículos",
  "Maquinaria y equipos",
  "Infraestructura",
  "Comunicaciones",
  "Logística",
] as const satisfies readonly RiesgosRecursoTipo[];

export const DISPONIBILIDADES = ["Inmediata", "Condicionada", "No disponible"] as const satisfies readonly RiesgosDisponibilidad[];

export const MAX_RECURSOS = 50;

/** Fields each resource type asks for on top of the common ones. */
export const CAMPOS_DETALLE: Record<RiesgosRecursoTipo, RiesgosCampoDetalle[]> = {
  "Talento humano": [
    { clave: "especialidad", etiqueta: "Especialidad o función", ejemplo: "Ej. atención prehospitalaria" },
    { clave: "certificacion", etiqueta: "Certificación / capacidad", ejemplo: "Ej. BLS, búsqueda y rescate" },
    { clave: "turno", etiqueta: "Turno o cobertura", ejemplo: "Ej. 24/7" },
  ],
  "Vehículos": [
    { clave: "clase", etiqueta: "Clase de vehículo", ejemplo: "Ej. ambulancia, camioneta" },
    { clave: "capacidad", etiqueta: "Capacidad", ejemplo: "Ej. 8 personas / 2 toneladas" },
    { clave: "combustible", etiqueta: "Combustible", ejemplo: "Ej. diésel" },
  ],
  "Maquinaria y equipos": [
    { clave: "funcion", etiqueta: "Tipo / función", ejemplo: "Ej. excavadora, bomba" },
    { clave: "capacidad", etiqueta: "Capacidad técnica", ejemplo: "Ej. 50 m³/h" },
    { clave: "operador", etiqueta: "Operador disponible", ejemplo: "Sí / No / Condicionado" },
  ],
  "Infraestructura": [
    { clave: "instalacion", etiqueta: "Tipo de instalación", ejemplo: "Ej. albergue, bodega" },
    { clave: "capacidad", etiqueta: "Capacidad / aforo", ejemplo: "Ej. 80 personas" },
    { clave: "servicios", etiqueta: "Servicios disponibles", ejemplo: "Agua, energía, accesibilidad" },
  ],
  "Comunicaciones": [
    { clave: "sistema", etiqueta: "Sistema / banda", ejemplo: "Ej. VHF, satelital" },
    { clave: "cobertura", etiqueta: "Cobertura", ejemplo: "Ej. zona urbana e interislas" },
    { clave: "autonomia", etiqueta: "Autonomía", ejemplo: "Ej. 12 horas" },
  ],
  "Logística": [
    { clave: "bien", etiqueta: "Bien o servicio", ejemplo: "Ej. agua, combustible, transporte" },
    { clave: "capacidad", etiqueta: "Capacidad / volumen", ejemplo: "Ej. 2.000 litros" },
    { clave: "reposicion", etiqueta: "Reposición", ejemplo: "Ej. cada 72 horas" },
  ],
};

export function catalogos(): RiesgosCatalogos {
  return {
    islas: [...ISLAS],
    tiposInstitucion: [...TIPOS_INSTITUCION],
    sinMesa: SIN_MESA,
    mesasTecnicas: [...MESAS_TECNICAS],
    gruposTrabajo: [...GRUPOS_TRABAJO],
    tiposRecurso: [...TIPOS_RECURSO],
    disponibilidades: [...DISPONIBILIDADES],
    camposDetalle: CAMPOS_DETALLE,
    maxRecursos: MAX_RECURSOS,
  };
}
