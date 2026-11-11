import type { LimitesNube, MetadatosNube } from "./reglas.js";

// What the viewer needs from a converted cloud, read from two PDAL outputs:
//   pdal info --summary <copc>                       → points, bounds, dimensions, CRS
//   pdal pipeline (readers.copc + filters.stats with count=Classification) --metadata
//                                                    → elevation statistics, points per class
// Pure, so it is tested with the real outputs of the sample cloud (tests/fixtures).

type Json = Record<string, unknown>;

const objeto = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function exigir(v: number | null, que: string): number {
  if (v === null) throw new Error(`PDAL no informó ${que}.`);
  return v;
}

export function metadatosDePdal(resumen: unknown, estadisticas: unknown): { metadatos: MetadatosNube; puntos: number } {
  const summary = objeto(objeto(resumen).summary);
  const puntos = exigir(numero(summary.num_points), "la cantidad de puntos");
  if (!Number.isSafeInteger(puntos) || puntos <= 0) throw new Error("La nube convertida no tiene puntos.");

  const b = objeto(summary.bounds);
  const limites: LimitesNube = {
    minx: exigir(numero(b.minx), "los límites"),
    miny: exigir(numero(b.miny), "los límites"),
    minz: exigir(numero(b.minz), "los límites"),
    maxx: exigir(numero(b.maxx), "los límites"),
    maxy: exigir(numero(b.maxy), "los límites"),
    maxz: exigir(numero(b.maxz), "los límites"),
  };

  const dimensiones = String(summary.dimensions ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const color = ["Red", "Green", "Blue"].every((d) => dimensiones.includes(d));

  // The horizontal CRS. A cloud may have none: the viewer then shows it without one.
  const srs = objeto(summary.srs);
  const wkt = String(srs.horizontal || srs.wkt || "").trim();
  const json = objeto(srs.json);
  const id = objeto(json.id);
  const epsg = id.authority === "EPSG" && Number.isSafeInteger(Number(id.code)) ? Number(id.code) : null;
  const crs = wkt
    ? { nombre: String(json.name || (epsg ? `EPSG:${epsg}` : "Sistema de coordenadas del archivo")), wkt, epsg, proj4: String(srs.proj4 ?? "").trim() }
    : null;

  // filters.stats: one statistic per dimension; Classification carries `bins` with its counts.
  const stats = objeto(objeto(objeto(estadisticas).stages)["filters.stats"]);
  const lista = Array.isArray(stats.statistic) ? (stats.statistic as unknown[]).map(objeto) : [];
  const zStat = lista.find((s) => s.name === "Z");
  const z = {
    min: numero(zStat?.minimum) ?? limites.minz,
    max: numero(zStat?.maximum) ?? limites.maxz,
    media: numero(zStat?.average) ?? (limites.minz + limites.maxz) / 2,
    desviacion: numero(zStat?.stddev) ?? 0,
  };
  const bins = objeto(lista.find((s) => s.name === "Classification")?.bins);
  const clases = Object.entries(bins)
    .map(([codigo, cuenta]) => ({ codigo: Math.round(Number(codigo)), puntos: Number(cuenta) }))
    .filter((c) => Number.isInteger(c.codigo) && c.codigo >= 0 && c.codigo <= 255 && Number.isSafeInteger(c.puntos) && c.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || a.codigo - b.codigo);

  return { metadatos: { crs, limites, dimensiones, color, clases, z }, puntos };
}
