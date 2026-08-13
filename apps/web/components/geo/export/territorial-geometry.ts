import type { MultiPolygon, Polygon, Position } from "geojson";

import type { GeoBounds } from "@/lib/geo-export-data";

export type TerritoryGeometry = Polygon | MultiPolygon;

export interface TerritoryFeature {
  code: string;
  name: string;
  geometry: TerritoryGeometry;
}

export interface TerritoryPoint {
  longitude: number;
  latitude: number;
}

export interface ProjectedTerritory {
  path: string;
  bounds: GeoBounds;
  project: (position: Position) => readonly [number, number];
}

function polygonCoordinates(geometry: TerritoryGeometry): Position[][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function pointInRing(point: TerritoryPoint, ring: Position[]): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const [currentX, currentY] = ring[current];
    const [previousX, previousY] = ring[previous];
    const crosses = currentY > point.latitude !== previousY > point.latitude;
    const longitudeAtLatitude =
      ((previousX - currentX) * (point.latitude - currentY)) /
        (previousY - currentY || Number.EPSILON) +
      currentX;
    if (crosses && point.longitude < longitudeAtLatitude) inside = !inside;
  }
  return inside;
}

export function territoryContainsPoint(
  feature: TerritoryFeature,
  point: TerritoryPoint,
): boolean {
  return polygonCoordinates(feature.geometry).some((polygon) => {
    const [outer, ...holes] = polygon;
    return Boolean(
      outer &&
      pointInRing(point, outer) &&
      !holes.some((hole) => pointInRing(point, hole)),
    );
  });
}

function pointSegmentDistance(
  point: TerritoryPoint,
  start: Position,
  end: Position,
): number {
  const latitudeScale = Math.cos((point.latitude * Math.PI) / 180);
  const pointX = point.longitude * latitudeScale;
  const startX = start[0] * latitudeScale;
  const endX = end[0] * latitudeScale;
  const pointY = point.latitude;
  const startY = start[1];
  const endY = end[1];
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const ratio = lengthSquared
    ? Math.max(
        0,
        Math.min(
          1,
          ((pointX - startX) * deltaX + (pointY - startY) * deltaY) /
            lengthSquared,
        ),
      )
    : 0;
  return Math.hypot(
    pointX - (startX + ratio * deltaX),
    pointY - (startY + ratio * deltaY),
  );
}

function distanceToTerritory(feature: TerritoryFeature, point: TerritoryPoint): number {
  if (territoryContainsPoint(feature, point)) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  polygonCoordinates(feature.geometry).forEach((polygon) => {
    polygon.forEach((ring) => {
      for (let index = 1; index < ring.length; index += 1) {
        minimum = Math.min(
          minimum,
          pointSegmentDistance(point, ring[index - 1], ring[index]),
        );
      }
    });
  });
  return minimum;
}

function referencePoints(point: TerritoryPoint, bounds?: GeoBounds | null): TerritoryPoint[] {
  if (!bounds) return [point];
  return [
    point,
    { longitude: bounds.west, latitude: bounds.north },
    { longitude: bounds.east, latitude: bounds.north },
    { longitude: bounds.east, latitude: bounds.south },
    { longitude: bounds.west, latitude: bounds.south },
  ];
}

/**
 * Selects the territory containing most reference points from the visible map.
 * When the view falls over sea (common in Galápagos), the nearest boundary is
 * used so the locator still resolves to a useful administrative unit.
 */
export function selectTerritory(
  features: readonly TerritoryFeature[],
  point: TerritoryPoint,
  bounds?: GeoBounds | null,
): TerritoryFeature | null {
  if (!features.length) return null;
  const samples = referencePoints(point, bounds);
  const scored = features
    .map((feature) => ({
      feature,
      contained: samples.filter((sample) => territoryContainsPoint(feature, sample)).length,
      distance: distanceToTerritory(feature, point),
    }))
    .sort((first, second) =>
      second.contained - first.contained || first.distance - second.distance,
    );
  return scored[0]?.feature ?? null;
}

export function territoryBounds(
  features: readonly TerritoryFeature[],
): GeoBounds | null {
  let bounds: GeoBounds | null = null;
  const include = ([longitude, latitude]: Position) => {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    bounds = bounds
      ? {
          north: Math.max(bounds.north, latitude),
          south: Math.min(bounds.south, latitude),
          east: Math.max(bounds.east, longitude),
          west: Math.min(bounds.west, longitude),
        }
      : { north: latitude, south: latitude, east: longitude, west: longitude };
  };
  features.forEach((feature) => {
    polygonCoordinates(feature.geometry).forEach((polygon) =>
      polygon.forEach((ring) => ring.forEach(include)),
    );
  });
  return bounds;
}

export function createTerritoryProjection(
  features: readonly TerritoryFeature[],
  width = 240,
  height = 130,
  padding = 7,
): ProjectedTerritory | null {
  const bounds = territoryBounds(features);
  if (!bounds) return null;
  const longitudeSpan = Math.max(bounds.east - bounds.west, 0.00001);
  const latitudeSpan = Math.max(bounds.north - bounds.south, 0.00001);
  const scale = Math.min(
    (width - padding * 2) / longitudeSpan,
    (height - padding * 2) / latitudeSpan,
  );
  const drawnWidth = longitudeSpan * scale;
  const drawnHeight = latitudeSpan * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;
  const project = ([longitude, latitude]: Position) =>
    [
      offsetX + (longitude - bounds.west) * scale,
      offsetY + (bounds.north - latitude) * scale,
    ] as const;
  const path = features
    .flatMap((feature) => polygonCoordinates(feature.geometry))
    .flatMap((polygon) => polygon)
    .map((ring) =>
      ring
        .map((position, index) => {
          const [x, y] = project(position);
          return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ") + " Z",
    )
    .join(" ");
  return { path, bounds, project };
}

export function territoryPath(
  feature: TerritoryFeature,
  project: ProjectedTerritory["project"],
): string {
  return polygonCoordinates(feature.geometry)
    .flatMap((polygon) => polygon)
    .map((ring) =>
      ring
        .map((position, index) => {
          const [x, y] = project(position);
          return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ") + " Z",
    )
    .join(" ");
}
