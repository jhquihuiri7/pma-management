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
