import type { Geometry, Position } from "geojson";

import type { GisLayer, RasterLayer } from "@/components/geo/gis/types";
import { buildSymbolizer, type ResolvedSymbol } from "@/components/geo/gis/symbology";
import type { GeoMap } from "@/types/geo";

export interface GeoBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type ExportLegendSymbol = "point" | "line" | "polygon" | "raster";

export interface ExportLegendLayer {
  id: string;
  layerId: string;
  layerLabel: string;
  label: string;
  symbol: ExportLegendSymbol;
  color?: string;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  detail?: string;
  /** The symbol as the map draws it, for a faithful swatch. */
  symbolSpec?: ResolvedSymbol;
}

/** Classes per layer in the export legend (the on-screen one shows 12). */
const EXPORT_LEGEND_MAX_CLASSES = 12;

export interface MapScale {
  denominator: number;
  label: string;
  barDistance: number;
  unit: "m" | "km";
}

export interface ReferenceSystem {
  name: string;
  datum: string;
  units: string;
  epsg: number;
  sourceCrs: string[];
}

export interface TerritorialIndicator {
  id: "escala" | "area" | "precision" | "hoja";
  label: string;
  value: string;
}

export interface ElevationProfilePoint {
  distance: number;
  elevation: number;
}

export interface LandCoverItem {
  id: string;
  label: string;
  percentage: number;
  color?: string;
  areaLabel?: string;
}

export interface GeoExportData {
  legend: ExportLegendLayer[];
  scale: MapScale;
  bounds: GeoBounds | null;
  areaSquareMetres: number | null;
  areaLabel: string;
  referenceSystem: ReferenceSystem;
  indicators: TerritorialIndicator[];
  elevation: ElevationProfilePoint[] | null;
  landCover: LandCoverItem[] | null;
}

export interface BuildGeoExportDataInput {
  geoMap: GeoMap;
  vectorLayers: readonly GisLayer[];
  rasterLayers: readonly RasterLayer[];
  center: [number, number];
  zoom: number;
  bounds?: GeoBounds;
  viewportWidthPx?: number;
}

const EARTH_RADIUS_METRES = 6_378_137;
const METRES_PER_PIXEL_TO_SCALE = 96 / 0.0254;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function validBounds(bounds: GeoBounds | null | undefined): bounds is GeoBounds {
  return Boolean(
    bounds &&
    finite(bounds.north) &&
    finite(bounds.south) &&
    finite(bounds.east) &&
    finite(bounds.west) &&
    bounds.north >= bounds.south &&
    bounds.east >= bounds.west,
  );
}

function includePosition(bounds: GeoBounds | null, position: Position): GeoBounds | null {
  const [longitude, latitude] = position;
  if (!finite(longitude) || !finite(latitude)) return bounds;
  if (!bounds) return { north: latitude, south: latitude, east: longitude, west: longitude };
  return {
    north: Math.max(bounds.north, latitude),
    south: Math.min(bounds.south, latitude),
    east: Math.max(bounds.east, longitude),
    west: Math.min(bounds.west, longitude),
  };
}

function geometryBounds(geometry: Geometry | null, current: GeoBounds | null): GeoBounds | null {
  if (!geometry) return current;
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.reduce<GeoBounds | null>((bounds, child) => geometryBounds(child, bounds), current);
  }
  let bounds = current;
  const visit = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      bounds = includePosition(bounds, coordinates as Position);
      return;
    }
    coordinates.forEach(visit);
  };
  visit(geometry.coordinates);
  return bounds;
}

export function calculateVisibleBounds(
  vectorLayers: readonly GisLayer[],
  rasterLayers: readonly RasterLayer[],
): GeoBounds | null {
  let bounds: GeoBounds | null = null;
  vectorLayers.filter((layer) => layer.visible).forEach((layer) => {
    layer.geojson.features.forEach((feature) => {
      bounds = geometryBounds(feature.geometry, bounds);
    });
  });
  rasterLayers.filter((layer) => layer.visible && layer.status === "processed").forEach((layer) => {
    const bbox = layer.bbox;
    if (!bbox || bbox.length < 4 || !bbox.slice(0, 4).every(finite)) return;
    bounds = includePosition(bounds, [bbox[0], bbox[1]]);
    bounds = includePosition(bounds, [bbox[2], bbox[3]]);
  });
  return bounds;
}

export function deriveVisibleLayers(
  vectorLayers: readonly GisLayer[],
  rasterLayers: readonly RasterLayer[],
): { vectors: GisLayer[]; rasters: RasterLayer[] } {
  return {
    vectors: vectorLayers.filter((layer) => layer.visible),
    rasters: rasterLayers.filter((layer) => layer.visible && layer.status === "processed"),
  };
}

function vectorSymbol(layer: GisLayer): ExportLegendSymbol {
  if (layer.geometry === "Point") return "point";
  if (layer.geometry === "LineString") return "line";
  return "polygon";
}

export function deriveLegend(
  vectorLayers: readonly GisLayer[],
  rasterLayers: readonly RasterLayer[],
): ExportLegendLayer[] {
  const visible = deriveVisibleLayers(vectorLayers, rasterLayers);
  const vectors = visible.vectors.flatMap<ExportLegendLayer>((layer) => {
    // Same classes, order and symbols the map draws (symbology.ts).
    const { field, classes } = buildSymbolizer(layer);
    const shown = field ? classes.slice(0, EXPORT_LEGEND_MAX_CLASSES) : classes;
    return shown.map((cls, index) => {
      const sym = cls.symbol;
      const line = sym.geometry === "LineString";
      return {
        id: field ? `${layer.id}:class:${index}` : layer.id,
        layerId: layer.id,
        layerLabel: layer.name,
        label: field && layer.style.mode === "category" ? `${layer.name} · ${cls.label}` : layer.name,
        symbol: vectorSymbol(layer),
        color: sym.color,
        fillColor: sym.color,
        strokeColor: line ? sym.color : sym.strokeColor ?? sym.color,
        strokeWidth: Math.max(1, sym.strokeWidth),
        opacity: layer.style.opacity,
        detail: field && layer.style.mode === "ramp" ? cls.label : String(cls.count),
        symbolSpec: sym,
      };
    });
  });
  const rasters = visible.rasters.map<ExportLegendLayer>((layer) => ({
    id: layer.id,
    layerId: layer.id,
    layerLabel: layer.name,
    label: layer.name,
    symbol: "raster",
    color: "#94a3b8",
    strokeColor: "#64748b",
    opacity: layer.opacity,
    detail: "Ortofoto",
  }));
  return [...vectors, ...rasters];
}

function niceNumber(value: number): number {
  if (!finite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

export function calculateMapScale(
  zoom: number,
  latitude: number,
  viewportWidthPx = 1200,
): MapScale {
  const safeZoom = Math.min(24, Math.max(0, finite(zoom) ? zoom : 9));
  const safeLatitude = Math.min(85, Math.max(-85, finite(latitude) ? latitude : 0));
  const metresPerPixel =
    (Math.cos((safeLatitude * Math.PI) / 180) * 2 * Math.PI * EARTH_RADIUS_METRES) /
    (256 * 2 ** safeZoom);
  const denominator = Math.max(1, Math.round(niceNumber(metresPerPixel * METRES_PER_PIXEL_TO_SCALE)));
  const nominalBarWidthPx = Math.min(260, Math.max(120, viewportWidthPx * 0.18));
  const rawBarDistance = metresPerPixel * nominalBarWidthPx;
  const metres = niceNumber(rawBarDistance);
  const useKilometres = metres >= 1000;
  return {
    denominator,
    label: `1:${new Intl.NumberFormat("es-EC", { maximumFractionDigits: 0 }).format(denominator)}`,
    barDistance: useKilometres ? metres / 1000 : metres,
    unit: useKilometres ? "km" : "m",
  };
}

export function deriveReferenceSystem(center: [number, number], vectorLayers: readonly GisLayer[]): ReferenceSystem {
  const latitude = finite(center[0]) ? center[0] : 0;
  const longitude = finite(center[1]) ? center[1] : -90;
  const zone = Math.min(60, Math.max(1, Math.floor((longitude + 180) / 6) + 1));
  const north = latitude >= 0;
  const epsg = (north ? 32600 : 32700) + zone;
  const sourceCrs = Array.from(new Set(vectorLayers.map((layer) => layer.crs).filter((crs): crs is string => Boolean(crs))));
  return {
    name: `WGS 84 / UTM Zona ${zone}${north ? "N" : "S"}`,
    datum: "WGS 84",
    units: "Metros",
    epsg,
    sourceCrs,
  };
}

function boundsAreaSquareMetres(bounds: GeoBounds | null): number | null {
  if (!validBounds(bounds)) return null;
  const middleLatitude = (bounds.north + bounds.south) / 2;
  const width =
    ((bounds.east - bounds.west) * Math.PI * EARTH_RADIUS_METRES * Math.cos((middleLatitude * Math.PI) / 180)) /
    180;
  const height = ((bounds.north - bounds.south) * Math.PI * EARTH_RADIUS_METRES) / 180;
  const area = Math.abs(width * height);
  return finite(area) && area > 0 ? area : null;
}

function formatArea(areaSquareMetres: number | null): string {
  if (!areaSquareMetres) return "No disponible";
  if (areaSquareMetres >= 1_000_000) {
    return `${new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 }).format(areaSquareMetres / 1_000_000)} km²`;
  }
  return `${new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 }).format(areaSquareMetres / 10_000)} ha`;
}

export function buildGeoExportData(input: BuildGeoExportDataInput): GeoExportData {
  const visible = deriveVisibleLayers(input.vectorLayers, input.rasterLayers);
  const bounds = validBounds(input.bounds)
    ? input.bounds
    : calculateVisibleBounds(visible.vectors, visible.rasters);
  const scale = calculateMapScale(input.zoom, input.center[0], input.viewportWidthPx);
  const referenceSystem = deriveReferenceSystem(input.center, visible.vectors);
  const areaSquareMetres = boundsAreaSquareMetres(bounds);
  const areaLabel = formatArea(areaSquareMetres);
  const legend = deriveLegend(visible.vectors, visible.rasters);

  return {
    legend,
    scale,
    bounds,
    areaSquareMetres,
    areaLabel,
    referenceSystem,
    indicators: [
      { id: "escala", label: "Escala", value: scale.label },
      { id: "area", label: "Área visible", value: areaLabel },
      { id: "precision", label: "Precisión", value: "Según fuente" },
      { id: "hoja", label: "Hoja", value: "1 de 1" },
    ],
    // There are currently no elevation or land-cover endpoints in the GIS API.
    // Null makes that absence explicit and lets the UI show an honest empty state.
    elevation: null,
    landCover: null,
  };
}
