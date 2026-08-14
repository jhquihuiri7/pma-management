export interface GeoCategory {
  id: string;
  name: string;
  description: string;
  thematics: string[];
  iconName: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  accentClass: string;
}

export type GeoLayerType = "tile";

export interface GeoLayer {
  id: string;
  name: string;
  type: GeoLayerType;
  url: string;
  visible: boolean;
  opacity: number;
  attribution?: string;
  isBase?: boolean;
}

export interface GeoMap {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  thematic?: string;
  layers: GeoLayer[];
  center: [number, number];
  zoom: number;
  tags?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface GeoWorkspaceVectorCatalogLayer {
  kind: "vector";
  layerId: string;
  name: string;
  geometryType: "Point" | "LineString" | "Polygon";
  crs: string;
  featureCount: number;
  bbox: number[] | null;
  style: Record<string, unknown>;
}

export interface GeoWorkspaceRasterCatalogLayer {
  kind: "raster";
  layerId: string;
  name: string;
  bbox: number[] | null;
  opacity: number;
}

export interface GeoWorkspaceCatalogMap {
  mapId: string;
  mapTitle: string;
  categoryId: string;
  thematic: string;
  layers: Array<GeoWorkspaceVectorCatalogLayer | GeoWorkspaceRasterCatalogLayer>;
}

export const GEO_CHART_TYPES = [
  "kpi", "bar", "stackedBar", "line", "area", "donut", "histogram", "scatter", "sankey", "table",
] as const;
export type GeoChartType = typeof GEO_CHART_TYPES[number];

export const GEO_CHART_AGGREGATIONS = ["count", "distinctCount", "sum", "avg", "min", "max"] as const;
export type GeoChartAggregation = typeof GEO_CHART_AGGREGATIONS[number];

export type GeoChartFieldRole =
  | "dimension" | "measure" | "series" | "x" | "y" | "size" | "level" | "weight" | "value";

export interface GeoChartFieldBinding {
  role: GeoChartFieldRole;
  field: string;
  aggregation?: GeoChartAggregation;
  dateGrain?: "year" | "quarter" | "month" | "day";
}

export interface GeoChartOptions {
  palette?: string;
  orientation?: "horizontal" | "vertical";
  sort?: "none" | "asc" | "desc";
  topN?: number;
  includeNulls?: boolean;
  showLegend?: boolean;
  showLabels?: boolean;
  bins?: number;
}

/** Persisted chart recipe. It stores column references, never derived layer data. */
export interface GeoLayerVisualization {
  id: string;
  mapId: string;
  layerId: string;
  type: GeoChartType;
  title: string;
  position: number;
  bindings: GeoChartFieldBinding[];
  options: GeoChartOptions;
  version: 1;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type GeoVisualizationDraft = Omit<
  GeoLayerVisualization,
  "id" | "mapId" | "layerId" | "createdBy" | "createdAt" | "updatedAt"
>;
