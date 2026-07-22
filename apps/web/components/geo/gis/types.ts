import type { FeatureCollection, Feature, Geometry } from "geojson";

export type GisGeometry = "Point" | "LineString" | "Polygon";
export type SymbologyMode = "single" | "category" | "ramp";
export type Classification = "equal" | "quantile" | "jenks";
export type ColumnType = "numeric" | "categorical" | "date" | "empty";

export interface LayerStyle {
  mode: SymbologyMode;
  color: string;
  palette: string;
  ramp: string;
  classification: Classification;
  classes: number;
  colorBy: string | null;
  opacity: number;
  strokeWidth: number;
  size: number;
  labels: boolean;
  labelField: string | null;
}

export interface GisLayer {
  id: string;
  name: string;
  filename?: string;
  geometry: GisGeometry;
  geojson: FeatureCollection;
  size?: string;
  crs?: string;
  visible: boolean;
  loadedAt: number;
  style: LayerStyle;
  /** Stacking order (higher = drawn on top). Mirrors geo_map_layers.z_index. */
  zIndex?: number;
  /** True once the layer is stored on the server/NAS. */
  persisted?: boolean;
}

export type RasterStatus =
  | "uploaded" // compatibility with rows created before the durable queue flow
  | "queued"
  | "processing"
  | "processed"
  | "deleting"
  | "error";

/**
 * A raster (orthophoto) layer. Kept separate from GisLayer (vectors) because the
 * render path is totally different: the browser consumes XYZ tiles from the API
 * proxy, never the pixels. Drawn in a dedicated Leaflet pane below the vectors.
 */
export interface RasterLayer {
  id: string;
  name: string;
  status: RasterStatus;
  errorMessage?: string | null;
  opacity: number;
  visible: boolean;
  zIndex: number;
  /** [minX, minY, maxX, maxY] in EPSG:4326, for fitBounds / tile bounds. */
  bbox: number[] | null;
  /** XYZ template ".../tiles/{z}/{x}/{y}.png" consumed by L.tileLayer. */
  tileUrl: string;
}

export interface Basemap {
  name: string;
  url: string;
  attribution: string;
}

export interface SchemaColumn {
  key: string;
  type: ColumnType;
  values: unknown[];
}

export interface IdentifyInfo {
  layerId: string;
  layerName: string;
  feature: Feature;
  latlng: { lat: number; lng: number } | null;
}

export interface FocusFeature {
  layerId: string;
  feature: Feature;
}

export interface AddLayerInput {
  id?: string;
  name: string;
  filename?: string;
  geometry: GisGeometry;
  geojson: FeatureCollection;
  size?: string;
  crs?: string;
  /** Original uploaded file (.zip/.shp), kept for provenance. */
  sourceFile?: File | null;
  sourceFormat?: string;
}

export interface AddLayerResult {
  persisted: boolean;
  id: string;
}

export type { Feature, FeatureCollection, Geometry };
