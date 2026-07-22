import type { GeoCategory, GeoMap, GeoLayer } from "@/types/geo";

export const GEO_CATEGORIES: GeoCategory[] = [
  {
    id: "informacion-base",
    name: "Información Base",
    description: "Cartografía base y capas de referencia que sustentan el análisis del territorio.",
    thematics: [
      "Límites administrativos",
      "Cartografía base",
      "Red hídrica",
      "Red vial",
      "Modelo digital de elevación",
    ],
    iconName: "Database",
    bgClass: "bg-slate-50",
    textClass: "text-slate-700",
    borderClass: "border-slate-200 hover:border-slate-400",
    accentClass: "bg-slate-100",
  },
  {
    id: "fisico-ambiental",
    name: "Físico Ambiental",
    description: "Recurso natural que sostiene y condiciona las diversas actividades de la población.",
    thematics: [
      "Recursos naturales no renovables",
      "Recursos naturales renovables",
      "Ecosistemas",
      "Amenazas naturales",
      "Amenazas climáticas",
      "Clima",
      "Conflictos ambientales",
      "Zonas de protección, regeneración y recuperación ambiental",
      "Calidad ambiental",
      "Contaminación",
    ],
    iconName: "TreePine",
    bgClass: "bg-green-50",
    textClass: "text-green-700",
    borderClass: "border-green-200 hover:border-green-400",
    accentClass: "bg-green-100",
  },
  {
    id: "asentamientos-humanos",
    name: "Asentamientos Humanos",
    description: "Distribución de la población, ocupación del territorio y vínculos entre asentamientos.",
    thematics: [
      "Distribución demográfica",
      "Uso y ocupación del suelo",
      "Movilidad, conectividad e infraestructura",
    ],
    iconName: "Building2",
    bgClass: "bg-blue-50",
    textClass: "text-blue-700",
    borderClass: "border-blue-200 hover:border-blue-400",
    accentClass: "bg-blue-100",
  },
  {
    id: "sociocultural",
    name: "Sociocultural",
    description: "Derechos sociales y culturales, inequidades y desequilibrios socioterritoriales.",
    thematics: [
      "Demografía y población",
      "Servicios públicos y sociales",
      "Patrimonio y diversidad cultural",
      "Pobreza y desigualdad",
      "Seguridad y convivencia ciudadana",
    ],
    iconName: "Users",
    bgClass: "bg-rose-50",
    textClass: "text-rose-700",
    borderClass: "border-rose-200 hover:border-rose-400",
    accentClass: "bg-rose-100",
  },
  {
    id: "economico-productivo",
    name: "Económico Productivo",
    description: "Factores vinculados con el desarrollo de la economía integral del territorio.",
    thematics: [
      "Actividades económicas y productivas",
      "Empleo",
      "Concentración y distribución de la riqueza",
      "Servicios a la producción",
      "Funcionalidad económica del territorio",
      "Economía popular y solidaria",
      "Modelos de consumo",
      "Seguridad alimentaria",
      "Desarrollo de tecnologías productivas limpias",
      "Infraestructura productiva",
    ],
    iconName: "BriefcaseBusiness",
    bgClass: "bg-amber-50",
    textClass: "text-amber-700",
    borderClass: "border-amber-200 hover:border-amber-400",
    accentClass: "bg-amber-100",
  },
  {
    id: "politico-institucional",
    name: "Político Institucional",
    description: "Capacidad institucional y de actores territoriales para la gestión del territorio.",
    thematics: [
      "Capacidades institucionales locales",
      "Gobernanza del riesgo",
      "Articulación interinstitucional",
      "Actores territoriales y organización social",
      "Participación ciudadana",
      "Sistema de protección de derechos",
    ],
    iconName: "Scale",
    bgClass: "bg-purple-50",
    textClass: "text-purple-700",
    borderClass: "border-purple-200 hover:border-purple-400",
    accentClass: "bg-purple-100",
  },
];

export function getGeoCategory(categoryId: string) {
  return GEO_CATEGORIES.find((category) => category.id === categoryId);
}

export function getGeoThematics(categoryId: string) {
  return getGeoCategory(categoryId)?.thematics ?? [];
}

export function getDefaultGeoThematic(categoryId: string) {
  return getGeoThematics(categoryId)[0] ?? "";
}

const OSM: GeoLayer = {
  id: "osm",
  name: "OpenStreetMap",
  type: "tile",
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  visible: true,
  opacity: 1,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  isBase: true,
};

const SATELLITE: GeoLayer = {
  id: "satellite",
  name: "Imagen Satelital",
  type: "tile",
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  visible: false,
  opacity: 1,
  attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP",
  isBase: true,
};

const TOPO: GeoLayer = {
  id: "topo",
  name: "Topografía",
  type: "tile",
  url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  visible: false,
  opacity: 0.85,
  attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  isBase: true,
};

export const GEO_MAPS: GeoMap[] = [
  {
    id: "mapa-001",
    title: "Cobertura Vegetal del Ecuador",
    description:
      "Distribución espacial de la cobertura vegetal en el territorio ecuatoriano, incluyendo bosques nativos, páramos y zonas de cultivo. Actualizado con datos de teledetección.",
    categoryId: "fisico-ambiental",
    thematic: "Ecosistemas",
    center: [-1.8, -78.2],
    zoom: 7,
    tags: ["vegetación", "bosques", "páramos"],
    createdBy: "Sistema",
    createdAt: "2024-01-15T10:00:00Z",
    layers: [{ ...SATELLITE, visible: true }, { ...OSM, visible: false }, { ...TOPO }],
  },
  {
    id: "mapa-002",
    title: "Red Hídrica Nacional",
    description:
      "Cuencas hidrográficas principales, ríos y cuerpos de agua del Ecuador con indicadores de calidad y caudal medido en estaciones hidrométricas.",
    categoryId: "fisico-ambiental",
    thematic: "Recursos naturales renovables",
    center: [-1.8, -78.2],
    zoom: 7,
    tags: ["ríos", "cuencas", "hidrología"],
    createdBy: "Sistema",
    createdAt: "2024-01-20T10:00:00Z",
    layers: [{ ...TOPO, visible: true }, { ...OSM, visible: false }],
  },
  {
    id: "mapa-003",
    title: "Calidad de Agua - Costa Ecuatoriana",
    description:
      "Monitoreo de la calidad del agua en la zona costera, ríos y estuarios de la región litoral. Incluye parámetros fisicoquímicos y biológicos.",
    categoryId: "fisico-ambiental",
    thematic: "Calidad ambiental",
    center: [-1.0, -80.5],
    zoom: 8,
    tags: ["costa", "calidad", "litoral"],
    createdBy: "Sistema",
    createdAt: "2024-02-05T10:00:00Z",
    layers: [{ ...SATELLITE, visible: true }, { ...OSM, visible: false }],
  },
  {
    id: "mapa-004",
    title: "Variabilidad Climática Amazónica",
    description:
      "Análisis de temperatura, precipitación y eventos climáticos extremos en la región amazónica ecuatoriana con proyecciones al 2050.",
    categoryId: "fisico-ambiental",
    thematic: "Clima",
    center: [-1.5, -76.5],
    zoom: 8,
    tags: ["amazonía", "precipitación", "temperatura"],
    createdBy: "Sistema",
    createdAt: "2024-02-10T10:00:00Z",
    layers: [{ ...TOPO, visible: true }, { ...OSM }],
  },
  {
    id: "mapa-005",
    title: "Uso del Suelo Urbano - Guayaquil",
    description:
      "Clasificación detallada del uso del suelo en el área metropolitana de Guayaquil: residencial, comercial, industrial y zonas de expansión.",
    categoryId: "asentamientos-humanos",
    thematic: "Uso y ocupación del suelo",
    center: [-2.19, -79.89],
    zoom: 12,
    tags: ["urbano", "Guayaquil", "planificación"],
    createdBy: "Sistema",
    createdAt: "2024-02-15T10:00:00Z",
    layers: [{ ...SATELLITE, visible: true }, { ...OSM }],
  },
  {
    id: "mapa-006",
    title: "Zonas de Riesgo Sísmico y Volcánico",
    description:
      "Amenazas geológicas activas: zonas sísmicas, áreas de influencia volcánica, fallas activas y probabilidad de deslizamientos.",
    categoryId: "fisico-ambiental",
    thematic: "Amenazas naturales",
    center: [-0.5, -78.5],
    zoom: 8,
    tags: ["sísmica", "volcánica", "geología"],
    createdBy: "Sistema",
    createdAt: "2024-03-01T10:00:00Z",
    layers: [{ ...TOPO, visible: true }, { ...OSM }],
  },
  {
    id: "mapa-007",
    title: "Reserva Marina Galápagos",
    description:
      "Delimitación y zonificación de la Reserva Marina de Galápagos. Incluye zonas de protección absoluta, uso sostenible y reserva.",
    categoryId: "fisico-ambiental",
    thematic: "Zonas de protección, regeneración y recuperación ambiental",
    center: [-0.95, -90.97],
    zoom: 9,
    tags: ["Galápagos", "marina", "reserva"],
    createdBy: "Sistema",
    createdAt: "2024-03-10T10:00:00Z",
    layers: [{ ...SATELLITE, visible: true }, { ...OSM }],
  },
  {
    id: "mapa-008",
    title: "Bosque Protector Chocó",
    description:
      "Área de bosque protector en la región del Chocó ecuatoriano, uno de los hotspots de biodiversidad más importantes del planeta.",
    categoryId: "fisico-ambiental",
    thematic: "Ecosistemas",
    center: [0.5, -78.5],
    zoom: 9,
    tags: ["Chocó", "bosque", "endémicas"],
    createdBy: "Sistema",
    createdAt: "2024-03-20T10:00:00Z",
    layers: [{ ...SATELLITE, visible: true }, { ...TOPO }, { ...OSM }],
  },
  {
    id: "mapa-009",
    title: "Límites Administrativos Ambientales",
    description:
      "Circunscripciones territoriales, zonas de control ambiental y áreas de gestión de las autoridades ambientales nacionales y provinciales.",
    categoryId: "politico-institucional",
    thematic: "Capacidades institucionales locales",
    center: [-1.8, -78.2],
    zoom: 7,
    tags: ["administrativo", "límites", "gestión"],
    createdBy: "Sistema",
    createdAt: "2024-04-01T10:00:00Z",
    layers: [{ ...OSM }],
  },
  {
    id: "mapa-010",
    title: "Zonas de Inundación - Región Costa",
    description:
      "Identificación de zonas susceptibles a inundaciones durante la época lluviosa y eventos El Niño, con niveles de amenaza y afectación histórica.",
    categoryId: "fisico-ambiental",
    thematic: "Amenazas climáticas",
    center: [-1.8, -79.8],
    zoom: 8,
    tags: ["inundación", "El Niño", "riesgo hídrico"],
    createdBy: "Sistema",
    createdAt: "2024-04-10T10:00:00Z",
    layers: [{ ...SATELLITE, visible: true }, { ...OSM }, { ...TOPO }],
  },
];
