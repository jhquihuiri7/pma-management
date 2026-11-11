import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

/**
 * Santa Cruz neighbourhoods for the module's map, read from the Geoportal
 * rather than copied into the code: layer `Barrios_Urbanos_SX` of the public
 * map "Mapa de Inundación Santa Cruz" (32 urban neighbourhoods, La Fortuna
 * included).
 *
 * The layer is identified by the Geoportal's own ids. They survive renaming the
 * map or the layer; only deleting the layer and uploading it again gives it a
 * new id, and then the map keeps working without neighbourhoods and says so.
 * The current revision is looked up on every load, so features appended in the
 * Geoportal show up here as well.
 */
export const CAPA_BARRIOS_SANTA_CRUZ = {
  mapId: "5a126161-0f1a-4fbc-b992-764fcdef4d19",
  layerId: "1c7be634-daba-457d-a917-3f7ff6ed3690",
  campoNombre: "Nombre_Bar",
} as const;

export interface ReferenciaCapaGeoportal {
  mapId: string;
  layerId: string;
  campoNombre: string;
}

/** The part of a Geoportal layer manifest this module needs. */
export interface ManifiestoCapa {
  id: string;
  dataRevision?: number | null;
}

/**
 * The Geoportal's own client (`fetchLayers` / `fetchLayerData` in
 * components/geo/gis/persistence.ts). Passed in so the geo API, and with it the
 * map's visibility rules, stays the only way in, and so tests need no network.
 */
export interface FuenteCapasGeoportal {
  fetchLayers(mapId: string): Promise<ManifiestoCapa[]>;
  fetchLayerData(mapId: string, layerId: string, revision?: number): Promise<FeatureCollection>;
}

export type EstadoBarrios =
  | { estado: "lista"; datos: FeatureCollection<Geometry, GeoJsonProperties>; revision: number }
  | { estado: "no-disponible"; motivo: string }
  | { estado: "error"; motivo: string };

export const MOTIVO_SIN_ACCESO =
  "La capa de barrios no está disponible en el Geoportal o no tienes permiso para verla.";
export const MOTIVO_ERROR = "No se pudo cargar la capa de barrios del Geoportal.";

/**
 * Loads the layer through the Geoportal. Never throws: the heat map must work
 * without neighbourhoods, so every failure becomes a state the map can show.
 *
 * The geo API answers 404 both for a missing map and for one the reader may not
 * see (it never reveals which), so both read as "no disponible".
 */
export async function cargarBarrios(
  fuente: FuenteCapasGeoportal,
  capa: ReferenciaCapaGeoportal = CAPA_BARRIOS_SANTA_CRUZ,
): Promise<EstadoBarrios> {
  try {
    const manifiestos = await fuente.fetchLayers(capa.mapId);
    const manifiesto = Array.isArray(manifiestos) ? manifiestos.find((m) => m?.id === capa.layerId) : undefined;
    if (!manifiesto) return { estado: "no-disponible", motivo: MOTIVO_SIN_ACCESO };

    const revision = revisionVigente(manifiesto);
    const datos = await fuente.fetchLayerData(capa.mapId, capa.layerId, revision);
    if (!esColeccion(datos)) return { estado: "error", motivo: MOTIVO_ERROR };
    return { estado: "lista", datos: soloPoligonos(datos), revision };
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 401 || status === 403 || status === 404) {
      return { estado: "no-disponible", motivo: MOTIVO_SIN_ACCESO };
    }
    return { estado: "error", motivo: MOTIVO_ERROR };
  }
}

/** Layers created before revisions existed report none; their data is revision 1. */
export function revisionVigente(manifiesto: ManifiestoCapa): number {
  const revision = manifiesto.dataRevision;
  return typeof revision === "number" && Number.isInteger(revision) && revision > 0 ? revision : 1;
}

/** The neighbourhood's name as the Geoportal stores it, or null when blank. */
export function nombreBarrio(
  properties: GeoJsonProperties | undefined,
  campo: string = CAPA_BARRIOS_SANTA_CRUZ.campoNombre,
): string | null {
  const valor = properties?.[campo];
  if (valor === null || valor === undefined) return null;
  const nombre = String(valor).trim();
  return nombre ? nombre : null;
}

function esColeccion(valor: unknown): valor is FeatureCollection {
  return (
    !!valor &&
    typeof valor === "object" &&
    (valor as { type?: unknown }).type === "FeatureCollection" &&
    Array.isArray((valor as { features?: unknown }).features)
  );
}

/** Only areas are drawn: a stray point or line in the layer is not a neighbourhood. */
function soloPoligonos(datos: FeatureCollection): FeatureCollection<Geometry, GeoJsonProperties> {
  const features = datos.features.filter(
    (feature): feature is Feature<Geometry, GeoJsonProperties> =>
      !!feature?.geometry && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon"),
  );
  return { type: "FeatureCollection", features };
}

/**
 * Key that matches a reported neighbourhood with its polygon whatever the
 * spelling: "Las Orquídeas" (protocol list) and "LAS ORQUIDEAS" (layer) are
 * the same neighbourhood. No accents, no case, single spaces.
 */
export function claveBarrio(nombre: unknown): string {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");
}

/** The layer's neighbourhood names, once each and in alphabetical order: the form's options. */
export function nombresBarrios(
  datos: FeatureCollection,
  campo: string = CAPA_BARRIOS_SANTA_CRUZ.campoNombre,
): string[] {
  const porClave = new Map<string, string>();
  for (const feature of datos.features) {
    const nombre = nombreBarrio(feature.properties, campo);
    if (nombre && !porClave.has(claveBarrio(nombre))) porClave.set(claveBarrio(nombre), nombre);
  }
  return Array.from(porClave.values()).sort((a, b) => a.localeCompare(b, "es"));
}

type Rgb = readonly [r: number, g: number, b: number];

/** Red at 0 % (Tailwind red-600) and lime at 100 % (Tailwind lime-500). */
const COLOR_SIN_LIMPIEZA: Rgb = [220, 38, 38];
const COLOR_LIMPIO: Rgb = [132, 204, 22];
const OPACIDAD_LIMPIEZA = 0.6;

function rgbAHsl([r, g, b]: Rgb): [h: number, s: number, l: number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0)) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h * 60, s, l];
}

function hslARgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const canal = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [canal(0), canal(8), canal(4)];
}

/**
 * Fill of a neighbourhood by its cleaning percentage: red at 0 % and lime at
 * 100 %. The hue turns through orange and yellow (a straight RGB mix of red
 * and lime is a muddy brown halfway), and the opacity stays the same, so a
 * clean neighbourhood shows as clearly as a dirty one.
 */
export function colorLimpieza(porcentaje: number): { fillColor: string; fillOpacity: number } {
  const t = Math.min(1, Math.max(0, Number.isFinite(porcentaje) ? porcentaje / 100 : 0));
  const [h0, s0, l0] = rgbAHsl(COLOR_SIN_LIMPIEZA);
  const [h1, s1, l1] = rgbAHsl(COLOR_LIMPIO);
  const [r, g, b] = hslARgb(h0 + (h1 - h0) * t, s0 + (s1 - s0) * t, l0 + (l1 - l0) * t);
  return { fillColor: `rgb(${r}, ${g}, ${b})`, fillOpacity: OPACIDAD_LIMPIEZA };
}

/** The legend's CSS gradient, sampled from colorLimpieza so it always matches the map. */
export function gradienteLimpieza(pasos = 8): string {
  const paradas = Array.from({ length: pasos + 1 }, (_, i) => {
    const pct = (i / pasos) * 100;
    const { fillColor, fillOpacity } = colorLimpieza(pct);
    return `${fillColor.replace("rgb(", "rgba(").replace(")", `, ${fillOpacity})`)} ${Math.round(pct)}%`;
  });
  return `linear-gradient(90deg, ${paradas.join(", ")})`;
}
