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
