/** Responses of /geo/workspace/v1 (apps/api/src/routes/geo/workspaceV1.ts). */

export interface WorkspaceConfig {
  engine: "legacy" | "rustgis";
  appPath: string;
  origins: string[];
  maxProjectBytes: number;
  ai: { enabled: boolean; path: string; model: string };
}

export interface CatalogItem {
  key: string;
  kind: "vector" | "raster";
  id: string;
  name: string;
  mapId: string;
  mapTitle: string;
  categoryId: string;
  thematic: string;
  bbox: number[] | null;
  crs: string | null;
  sizeBytes: number;
  updatedAt: string;
  vector?: { geometryType: string; featureCount: number; revision: number; fgb: "ready" | "pending" | "error" | null };
  raster?: {
    bandCount: number | null;
    hasAlpha: boolean;
    widthPx: number | null;
    heightPx: number | null;
    resolution: number | null;
    version: number;
    readableInPlace: boolean;
  };
  load: { mode: "stream" | "tiles" | "preparing"; path: string | null; copyPath: string | null };
}

export interface CatalogPage {
  items: CatalogItem[];
  nextOffset: number | null;
}

export interface WorkspaceNotice {
  kind: "unavailable" | "updated" | "preparing" | "copy" | "tiles";
  name: string;
  detail?: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  sourceMapId: string | null;
  revision: number;
  sizeBytes: number;
  layerCount: number;
  rustgisVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenedProject {
  project: string;
  notices: WorkspaceNotice[];
  title: string;
  sourceMapId?: string | null;
  id?: string;
  revision?: number;
}

export interface ReadableMap {
  id: string;
  title: string;
  categoryId: string;
  thematic: string;
  updatedAt: string;
}
