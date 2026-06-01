import type { Feature, Geometry, Position } from "geojson";
import type { GisLayer } from "./types";

// ────────────────────────────────────────────────────────────
// Coordinate formatting / conversion (all WGS-84, EPSG:4326)
// ────────────────────────────────────────────────────────────

/** Decimal degrees → degrees-minutes-seconds, e.g. `0°13'12.0"S`. */
export function toDMS(value: number, axis: "lat" | "lng"): string {
  const dir = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "O";
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const minFull = (abs - d) * 60;
  const m = Math.floor(minFull);
  const s = (minFull - m) * 60;
  return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"${dir}`;
}

export interface UTMResult {
  zone: number;
  band: string;
  easting: number;
  northing: number;
  hemisphere: "N" | "S";
}

const UTM_BANDS = "CDEFGHJKLMNPQRSTUVWX";
function utmBand(lat: number): string {
  if (lat < -80 || lat > 84) return "";
  return UTM_BANDS.charAt(Math.floor((lat + 80) / 8));
}

/** Forward UTM projection (WGS-84 ellipsoid). Accurate to a few mm for Ecuador. */
export function toUTM(lat: number, lon: number): UTMResult {
  const a = 6378137.0; // WGS-84 semi-major axis
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;

  const zone = Math.floor((lon + 180) / 6) + 1;
  const lonOrigin = (zone - 1) * 6 - 180 + 3; // central meridian of the zone
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const lonOriginRad = (lonOrigin * Math.PI) / 180;

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = ep2 * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lonOriginRad);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad));

  const easting =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000;
  let northing =
    k0 *
    (M +
      N *
        Math.tan(latRad) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) northing += 10000000; // false northing for the southern hemisphere

  return {
    zone,
    band: utmBand(lat),
    easting: Math.round(easting),
    northing: Math.round(northing),
    hemisphere: lat < 0 ? "S" : "N",
  };
}

export function formatUTM(u: UTMResult): string {
  return `${u.zone}${u.band} ${u.easting.toLocaleString("en-US")}E ${u.northing.toLocaleString("en-US")}N`;
}

// ────────────────────────────────────────────────────────────
// Spatial queries against the clicked point
// ────────────────────────────────────────────────────────────

function pointInRing(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringsContain(lng: number, lat: number, rings: Position[][]): boolean {
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false; // outside the outer ring
  for (let i = 1; i < rings.length; i++) if (pointInRing(lng, lat, rings[i])) return false; // inside a hole
  return true;
}

/** Point-in-polygon for (Multi)Polygon geometries; `lng`/`lat` in decimal degrees. */
export function pointInPolygon(lng: number, lat: number, geom: Geometry): boolean {
  if (geom.type === "Polygon") return ringsContain(lng, lat, geom.coordinates);
  if (geom.type === "MultiPolygon") return geom.coordinates.some((poly) => ringsContain(lng, lat, poly));
  return false;
}

const M_PER_DEG_LAT = 111320;

/** Great-circle distance in metres. */
function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance in metres from a point to a segment, via a local planar approximation. */
function distToSegment(lat: number, lng: number, a: Position, b: Position): number {
  const mLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const px = (lng - a[0]) * mLng, py = (lat - a[1]) * M_PER_DEG_LAT;
  const vx = (b[0] - a[0]) * mLng, vy = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len2 = vx * vx + vy * vy;
  let t = len2 ? (px * vx + py * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = vx * t - px, cy = vy * t - py;
  return Math.sqrt(cx * cx + cy * cy);
}

function minDistToGeometry(lat: number, lng: number, geom: Geometry): number {
  if (geom.type === "Point") return haversine(lat, lng, geom.coordinates[1], geom.coordinates[0]);
  if (geom.type === "MultiPoint")
    return Math.min(...geom.coordinates.map((c) => haversine(lat, lng, c[1], c[0])));
  if (geom.type === "LineString") {
    let min = Infinity;
    for (let i = 1; i < geom.coordinates.length; i++)
      min = Math.min(min, distToSegment(lat, lng, geom.coordinates[i - 1], geom.coordinates[i]));
    return min;
  }
  if (geom.type === "MultiLineString") {
    let min = Infinity;
    for (const line of geom.coordinates)
      for (let i = 1; i < line.length; i++)
        min = Math.min(min, distToSegment(lat, lng, line[i - 1], line[i]));
    return min;
  }
  return Infinity;
}

export interface PointHit {
  layerId: string;
  layerName: string;
  /** `contiene` → the point falls inside a polygon; `cercano` → nearest point/line within tolerance. */
  relation: "contiene" | "cercano";
  feature: Feature;
  /** Distance in metres (only for `cercano` hits). */
  distanceM?: number;
}

/**
 * Inspect every visible layer at the clicked point.
 * Polygons report containment; points/lines report the nearest feature when it
 * sits within `nearToleranceM` (scaled to the current zoom by the caller).
 */
export function inspectPoint(
  lat: number,
  lng: number,
  layers: GisLayer[],
  nearToleranceM = 4000
): PointHit[] {
  const hits: PointHit[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;

    if (layer.geometry === "Polygon") {
      for (const feature of layer.geojson.features) {
        if (feature.geometry && pointInPolygon(lng, lat, feature.geometry))
          hits.push({ layerId: layer.id, layerName: layer.name, relation: "contiene", feature });
      }
    } else {
      let best: { feature: Feature; d: number } | null = null;
      for (const feature of layer.geojson.features) {
        if (!feature.geometry) continue;
        const d = minDistToGeometry(lat, lng, feature.geometry);
        if (!best || d < best.d) best = { feature, d };
      }
      if (best && best.d <= nearToleranceM)
        hits.push({
          layerId: layer.id,
          layerName: layer.name,
          relation: "cercano",
          feature: best.feature,
          distanceM: best.d,
        });
    }
  }
  return hits;
}

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}
