import type { Feature, FeatureCollection, GeoJsonProperties, LineString, Point } from "geojson";
import { extremosRuta, RUTAS_LIMPIEZA, type RutaLimpieza } from "@pma/types/protocolo-limpieza";
import { claveBarrio, revisionVigente, type FuenteCapasGeoportal } from "./barrios";

/**
 * The routes of the module's maps, read from the Geoportal rather than copied
 * into the code: map "Gestión de residuos y desechos de Santa Cruz - Rutas",
 * loaded on 2026-11-15 from capas_residuos_scx_shapefile.zip. Its layers keep
 * the original zip, with the QGIS style (.qml) that ESTILO_* below reproduce.
 *
 * Like the neighbourhoods (barrios.ts), the layers are identified by the
 * Geoportal's ids and read through its client, under the map's visibility.
 */
export const CAPAS_RUTAS = {
  mapId: "442ce67d-f6f3-4da7-8aa4-668029a07e3a",
  tramos: "613462cd-6e84-4851-98d9-469137d64ddc",
  puntos: "b1a8a3e3-55ab-4f3c-8633-ec7db4034b49",
  /** The point layer's name field. */
  campoNombre: "Nombre",
} as const;

export interface DatosRutas {
  tramos: FeatureCollection<LineString, GeoJsonProperties>;
  puntos: FeatureCollection<Point, GeoJsonProperties>;
}

export type EstadoRutas =
  | { estado: "lista"; datos: DatosRutas }
  | { estado: "no-disponible"; motivo: string }
  | { estado: "error"; motivo: string };

export const MOTIVO_RUTAS_SIN_ACCESO =
  "Las rutas no están disponibles en el Geoportal o no tienes permiso para verlas.";
export const MOTIVO_RUTAS_ERROR = "No se pudieron cargar las rutas del Geoportal.";

/**
 * Loads both layers. Never throws: without them the map keeps its schematic
 * routes, so every failure becomes a state the map can show.
 */
export async function cargarRutas(fuente: FuenteCapasGeoportal, capas = CAPAS_RUTAS): Promise<EstadoRutas> {
  try {
    const manifiestos = await fuente.fetchLayers(capas.mapId);
    const buscar = (id: string) => (Array.isArray(manifiestos) ? manifiestos.find((m) => m?.id === id) : undefined);
    const [tramos, puntos] = [buscar(capas.tramos), buscar(capas.puntos)];
    if (!tramos || !puntos) return { estado: "no-disponible", motivo: MOTIVO_RUTAS_SIN_ACCESO };
    const [datosTramos, datosPuntos] = await Promise.all([
      fuente.fetchLayerData(capas.mapId, capas.tramos, revisionVigente(tramos)),
      fuente.fetchLayerData(capas.mapId, capas.puntos, revisionVigente(puntos)),
    ]);
    if (!esColeccion(datosTramos) || !esColeccion(datosPuntos)) return { estado: "error", motivo: MOTIVO_RUTAS_ERROR };
    return { estado: "lista", datos: { tramos: soloLineas(datosTramos), puntos: soloPuntos(datosPuntos) } };
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 401 || status === 403 || status === 404) return { estado: "no-disponible", motivo: MOTIVO_RUTAS_SIN_ACCESO };
    return { estado: "error", motivo: MOTIVO_RUTAS_ERROR };
  }
}

function esColeccion(valor: unknown): valor is FeatureCollection {
  return (
    !!valor &&
    typeof valor === "object" &&
    (valor as { type?: unknown }).type === "FeatureCollection" &&
    Array.isArray((valor as { features?: unknown }).features)
  );
}

/** Only lines are routes, and only points are places: anything else in a layer is left out. */
function soloLineas(datos: FeatureCollection): FeatureCollection<LineString, GeoJsonProperties> {
  const features = datos.features.filter((f): f is Feature<LineString, GeoJsonProperties> => f?.geometry?.type === "LineString");
  return { type: "FeatureCollection", features };
}
function soloPuntos(datos: FeatureCollection): FeatureCollection<Point, GeoJsonProperties> {
  const features = datos.features.filter((f): f is Feature<Point, GeoJsonProperties> => f?.geometry?.type === "Point");
  return { type: "FeatureCollection", features };
}

// ── Where each map point is ─────────────────────────────────────────────────

export type LatLng = [lat: number, lon: number];

/** The route that comes before each one (R2.1 branches off R1, like R2). */
const ANTERIOR: Partial<Record<RutaLimpieza, RutaLimpieza>> = { R2: "R1", "R2.1": "R1", R3: "R2", R4: "R3", R5: "R4", R6: "R5" };

/**
 * The places each map point may be called in the layer. A route's point is
 * where it starts, which is also where the route before it ends ("Patio GYE"
 * starts R6 and is the "Patio contenedores GYE" where R5 ends); R2.1's point
 * is where it ends, and `gestion` is the end of R6. All as the protocol names them.
 */
export function nombresDelPunto(id: string): string[] {
  if (id === "gestion") return [extremosRuta("R6")[1]];
  if (id === "R2.1") return [extremosRuta("R2.1")[1]];
  if (!RUTAS_LIMPIEZA.includes(id as RutaLimpieza)) return [];
  const ruta = id as RutaLimpieza;
  const anterior = ANTERIOR[ruta];
  return [extremosRuta(ruta)[0], ...(anterior ? [extremosRuta(anterior)[1]] : [])];
}

/**
 * Coordinates of the module's points (ids of acumulacion.ts) found in the
 * point layer, matched by name whatever the case or accents. A point the layer
 * does not have (the urban zone of R1) is left out: it keeps its own place.
 */
export function ubicacionesDePuntos(
  puntos: FeatureCollection<Point, GeoJsonProperties>,
  ids: readonly string[],
  campo: string = CAPAS_RUTAS.campoNombre,
): Map<string, LatLng> {
  const porNombre = new Map<string, LatLng>();
  for (const f of puntos.features) {
    const nombre = f.properties?.[campo];
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (nombre && Number.isFinite(lat) && Number.isFinite(lon)) porNombre.set(claveBarrio(nombre), [lat, lon]);
  }
  const ubicaciones = new Map<string, LatLng>();
  for (const id of ids) {
    const encontrado = nombresDelPunto(id).map((n) => porNombre.get(claveBarrio(n))).find(Boolean);
    if (encontrado) ubicaciones.set(id, encontrado);
  }
  return ubicaciones;
}

/** A route's line as [lat, lon] pairs, or null when the layer has none for it. */
export function lineaDeRuta(tramos: FeatureCollection<LineString, GeoJsonProperties>, ruta: string): LatLng[] | null {
  const f = tramos.features.find((t) => String(t.properties?.ruta ?? "").trim() === ruta);
  const coords = f?.geometry?.coordinates;
  return coords && coords.length > 1 ? coords.map(([lon, lat]) => [lat, lon] as LatLng) : null;
}

// ── The QGIS style of the zip (tramos_residuos.qml, puntos_rutas_scx.qml, barrios.qml) ──

/** QGIS draws millimetres at 96 dpi on screen. */
export const PX_POR_MM = 96 / 25.4;
const mm = (v: number) => Math.round(v * PX_POR_MM * 100) / 100;

export type SimboloTramo = "principal" | "maritimo" | "ramal";

export interface EstiloTramo {
  /** The rule's label in the QGIS legend. */
  leyenda: string;
  color: string;
  /** Line width in px. */
  ancho: number;
  /** Custom dash pattern in px (dash, gap, …). */
  guiones: number[];
}

/** The three rules of tramos_residuos.qml (a 2.4 mm transparent line under each, which draws nothing). */
export const ESTILO_TRAMOS: Record<SimboloTramo, EstiloTramo> = {
  principal: { leyenda: "Ruta principal hacia Guayaquil", color: "#17a893", ancho: mm(1), guiones: [4, 1.4, 0.9, 1.4].map(mm) },
  maritimo: { leyenda: "Tramo marítimo y fluvial", color: "#4f7cd6", ancho: mm(1.1), guiones: [1.1, 1.9].map(mm) },
  ramal: { leyenda: "Derivación local · relleno sanitario", color: "#f59e0b", ancho: mm(1), guiones: [4, 1.4, 0.9, 1.4].map(mm) },
};

/**
 * The rule a route segment takes, in the .qml's order:
 * "grupo" = 'Flujo principal' AND "modo" = 'Vial'; "modo" LIKE 'Mar%'; "grupo" = 'Ramal al relleno'.
 */
export function simboloTramo(properties: GeoJsonProperties | undefined): SimboloTramo | null {
  const grupo = String(properties?.grupo ?? ""), modo = String(properties?.modo ?? "");
  if (grupo === "Flujo principal" && modo === "Vial") return "principal";
  if (modo.startsWith("Mar")) return "maritimo";
  if (grupo === "Ramal al relleno") return "ramal";
  return null;
}

/** Route labels: the route code in a mint pill on the line (8 pt bold, 1.3 × 0.5 mm padding, 2.2 mm radius). */
export const ETIQUETA_TRAMO = {
  campo: "ruta",
  color: "#0f766e",
  fondo: "#d5f3ea",
  borde: "#9fdcc9",
  bordeAncho: mm(0.2),
  radio: mm(2.2),
  rellenoX: mm(1.3),
  rellenoY: mm(0.5),
  /** 8 pt. */
  tamano: 8 * (96 / 72),
  peso: 700,
} as const;

/** Each point: a white 5 mm disc, its 3.8 mm colour disc and a 1.4 mm white centre. */
export const ANILLOS_PUNTO = { exterior: mm(5), color: mm(3.8), centro: mm(1.4) } as const;

const VERDE_AZULADO = "#17a893", AMBAR = "#f59e0b", MORADO = "#6657d9";
/** The categories of puntos_rutas_scx.qml, by the point's name. */
const COLOR_PUNTO: Record<string, string> = {
  [claveBarrio("Acopio temporal")]: VERDE_AZULADO,
  [claveBarrio("Patio contenedores SCX")]: VERDE_AZULADO,
  [claveBarrio("Muelle de Itabaca")]: VERDE_AZULADO,
  [claveBarrio("Relleno sanitario SCX")]: AMBAR,
  [claveBarrio("Puerto GYE")]: MORADO,
  [claveBarrio("Patio contenedores GYE")]: MORADO,
  [claveBarrio("Sitio de gestión de residuos")]: MORADO,
};
/** A point's colour; a name the style does not list is drawn in the Santa Cruz colour. */
export const colorPunto = (nombre: unknown) => COLOR_PUNTO[claveBarrio(nombre)] ?? VERDE_AZULADO;

/** Point labels: the name, 9 pt semibold, with a 1.1 mm white halo, 1.6 mm from the symbol. */
export const ETIQUETA_PUNTO = { color: "#1f2937", halo: mm(1.1), distancia: mm(1.6), tamano: 9 * (96 / 72), peso: 600 } as const;

/** barrios.qml: a mint fill with a green outline, the whole symbol at 75 % opacity. */
export const ESTILO_BARRIO_ZIP = { relleno: "#e7f7f0", borde: "#8dd8bd", bordeAncho: mm(0.4), opacidad: 0.75 } as const;
/** Neighbourhood labels: 8 pt semibold with a 0.9 mm white halo, from 1:60.000 inwards. */
export const ETIQUETA_BARRIO = { color: "#0f6b58", halo: mm(0.9), tamano: 8 * (96 / 72), peso: 600, escalaMaxima: 60000 } as const;

/** Map scale denominator at a latitude and zoom, on a 96 dpi screen (like QGIS). */
export function escalaMapa(lat: number, zoom: number): number {
  const metrosPorPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (zoom + 8);
  return metrosPorPx / (0.0254 / 96);
}
