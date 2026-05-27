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
  sampleId?: string;
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

export interface SampleDataset {
  id: string;
  name: string;
  filename: string;
  geometry: GisGeometry;
  feature_count: number;
  size: string;
  crs: string;
  geojson: FeatureCollection;
  icon: string;
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
  /** Original uploaded file (.zip/.shp), kept for provenance. Absent for samples. */
  sourceFile?: File | null;
  sourceFormat?: string;
}

export type { Feature, FeatureCollection, Geometry };
