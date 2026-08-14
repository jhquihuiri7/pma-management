import type { GisLayer, LayerStyle, RasterLayer } from "./types";

export const WORKSPACE_SCHEMA = "sigtar-workspace" as const;
export const WORKSPACE_VERSION = 1 as const;
export const MAX_WORKSPACE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_WORKSPACE_LAYERS = 1_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASEMAPS = new Set(["light", "dark", "satellite", "topo", "osm"]);
const STYLE_MODES = new Set(["single", "category", "ramp"]);
const CLASSIFICATIONS = new Set(["equal", "quantile", "jenks"]);

export type WorkspaceVectorEntry = {
  kind: "vector";
  source: { mapId: string; layerId: string };
  presentation: {
    name: string;
    visible: boolean;
    zIndex: number;
    style: LayerStyle;
  };
};

export type WorkspaceRasterEntry = {
  kind: "raster";
  source: { mapId: string; layerId: string };
  presentation: {
    name: string;
    visible: boolean;
    zIndex: number;
    opacity: number;
  };
};

export type WorkspaceDocument = {
  schema: typeof WORKSPACE_SCHEMA;
  version: typeof WORKSPACE_VERSION;
  exportedAt: string;
  view: {
    center: [number, number];
    zoom: number;
    basemap: string;
  };
  layers: Array<WorkspaceVectorEntry | WorkspaceRasterEntry>;
};

export function workspaceLayerKey(kind: "vector" | "raster", mapId: string, layerId: string): string {
  return `${kind}:${mapId}:${layerId}`;
}

export function buildWorkspaceDocument(args: {
  center: [number, number];
  zoom: number;
  basemap: string;
  vectorLayers: GisLayer[];
  rasterLayers: RasterLayer[];
  exportedAt?: string;
}): WorkspaceDocument {
  const vectors: WorkspaceVectorEntry[] = args.vectorLayers.flatMap((layer) => {
    if (!layer.workspaceSource) return [];
    return [{
      kind: "vector",
      source: { mapId: layer.workspaceSource.mapId, layerId: layer.workspaceSource.layerId },
      presentation: {
        name: layer.name,
        visible: layer.visible,
        zIndex: layer.zIndex ?? 0,
        style: layer.style,
      },
    }];
  });
  const rasters: WorkspaceRasterEntry[] = args.rasterLayers.flatMap((layer) => {
    if (!layer.workspaceSource) return [];
    return [{
      kind: "raster",
      source: { mapId: layer.workspaceSource.mapId, layerId: layer.workspaceSource.layerId },
      presentation: {
        name: layer.name,
        visible: layer.visible,
        zIndex: layer.zIndex,
        opacity: layer.opacity,
      },
    }];
  });
  return {
    schema: WORKSPACE_SCHEMA,
    version: WORKSPACE_VERSION,
    exportedAt: args.exportedAt ?? new Date().toISOString(),
    view: { center: args.center, zoom: args.zoom, basemap: args.basemap },
    layers: [...vectors, ...rasters],
  };
}

export function parseWorkspaceDocument(value: unknown): WorkspaceDocument {
  const root = record(value, "El archivo no contiene un objeto JSON válido");
  onlyKeys(root, ["schema", "version", "exportedAt", "view", "layers"], "El Workspace contiene campos no permitidos");
  if (root.schema !== WORKSPACE_SCHEMA) throw new Error("El archivo no es un Workspace de SIGTAR");
  if (root.version !== WORKSPACE_VERSION) {
    throw new Error(`La versión ${String(root.version)} del Workspace no es compatible`);
  }
  if (typeof root.exportedAt !== "string" || !Number.isFinite(Date.parse(root.exportedAt))) {
    throw new Error("La fecha de exportación del Workspace no es válida");
  }
  const view = record(root.view, "La vista del Workspace no es válida");
  onlyKeys(view, ["center", "zoom", "basemap"], "La vista contiene campos no permitidos");
  const centerValue = view.center;
  if (!Array.isArray(centerValue) || centerValue.length !== 2) throw new Error("El centro del Workspace no es válido");
  const lat = finiteNumber(centerValue[0], "La latitud del Workspace no es válida", -90, 90);
  const lng = finiteNumber(centerValue[1], "La longitud del Workspace no es válida", -180, 180);
  const zoom = finiteNumber(view.zoom, "El zoom del Workspace no es válido", 0, 22);
  if (!Number.isInteger(zoom)) throw new Error("El zoom del Workspace debe ser un entero");
  if (typeof view.basemap !== "string" || !BASEMAPS.has(view.basemap)) {
    throw new Error("El mapa base del Workspace no es compatible");
  }
  if (!Array.isArray(root.layers)) throw new Error("La lista de capas del Workspace no es válida");
  if (root.layers.length > MAX_WORKSPACE_LAYERS) {
    throw new Error(`El Workspace supera el límite de ${MAX_WORKSPACE_LAYERS} capas`);
  }

  const seen = new Set<string>();
  const layers = root.layers.map((raw, index) => {
    const layer = record(raw, `La capa ${index + 1} no es válida`);
    onlyKeys(layer, ["kind", "source", "presentation"], `La capa ${index + 1} contiene campos no permitidos`);
    if (layer.kind !== "vector" && layer.kind !== "raster") {
      throw new Error(`El tipo de la capa ${index + 1} no es compatible`);
    }
    const source = record(layer.source, `El origen de la capa ${index + 1} no es válido`);
    onlyKeys(source, ["mapId", "layerId"], `El origen de la capa ${index + 1} contiene campos no permitidos`);
    if (typeof source.mapId !== "string" || !UUID_RE.test(source.mapId)) {
      throw new Error(`El mapa de origen de la capa ${index + 1} no es válido`);
    }
    if (typeof source.layerId !== "string" || !UUID_RE.test(source.layerId)) {
      throw new Error(`El identificador de la capa ${index + 1} no es válido`);
    }
    const key = workspaceLayerKey(layer.kind, source.mapId, source.layerId);
    if (seen.has(key)) throw new Error(`El Workspace contiene una capa duplicada (${index + 1})`);
    seen.add(key);

    const presentation = record(layer.presentation, `La presentación de la capa ${index + 1} no es válida`);
    onlyKeys(
      presentation,
      layer.kind === "raster" ? ["name", "visible", "zIndex", "opacity"] : ["name", "visible", "zIndex", "style"],
      `La presentación de la capa ${index + 1} contiene campos no permitidos`,
    );
    const common = {
      name: boundedString(presentation.name, `El nombre de la capa ${index + 1} no es válido`, 200),
      visible: booleanValue(presentation.visible, `La visibilidad de la capa ${index + 1} no es válida`),
      zIndex: integerValue(presentation.zIndex, `El orden de la capa ${index + 1} no es válido`, -10_000, 10_000),
    };
    if (layer.kind === "raster") {
      return {
        kind: "raster" as const,
        source: { mapId: source.mapId, layerId: source.layerId },
        presentation: {
          ...common,
          opacity: finiteNumber(presentation.opacity, `La opacidad de la capa ${index + 1} no es válida`, 0, 1),
        },
      };
    }
    return {
      kind: "vector" as const,
      source: { mapId: source.mapId, layerId: source.layerId },
      presentation: { ...common, style: parseStyle(presentation.style, index + 1) },
    };
  });

  return {
    schema: WORKSPACE_SCHEMA,
    version: WORKSPACE_VERSION,
    exportedAt: root.exportedAt,
    view: { center: [lat, lng], zoom, basemap: view.basemap },
    layers,
  };
}

function parseStyle(value: unknown, index: number): LayerStyle {
  const style = record(value, `El estilo de la capa ${index} no es válido`);
  onlyKeys(style, [
    "mode", "color", "palette", "ramp", "classification", "classes", "colorBy",
    "opacity", "strokeWidth", "size", "labels", "labelField",
  ], `El estilo de la capa ${index} contiene campos no permitidos`);
  if (typeof style.mode !== "string" || !STYLE_MODES.has(style.mode)) throw new Error(`El modo de estilo de la capa ${index} no es válido`);
  if (typeof style.classification !== "string" || !CLASSIFICATIONS.has(style.classification)) throw new Error(`La clasificación de la capa ${index} no es válida`);
  return {
    mode: style.mode as LayerStyle["mode"],
    color: colorValue(style.color, index),
    palette: boundedString(style.palette, `La paleta de la capa ${index} no es válida`, 50),
    ramp: boundedString(style.ramp, `La rampa de la capa ${index} no es válida`, 50),
    classification: style.classification as LayerStyle["classification"],
    classes: integerValue(style.classes, `Las clases de la capa ${index} no son válidas`, 1, 20),
    colorBy: nullableString(style.colorBy, `El atributo de color de la capa ${index} no es válido`, 200),
    opacity: finiteNumber(style.opacity, `La opacidad de la capa ${index} no es válida`, 0, 1),
    strokeWidth: finiteNumber(style.strokeWidth, `El borde de la capa ${index} no es válido`, 0, 20),
    size: finiteNumber(style.size, `El tamaño de la capa ${index} no es válido`, 0, 100),
    labels: booleanValue(style.labels, `Las etiquetas de la capa ${index} no son válidas`),
    labelField: nullableString(style.labelField, `El atributo de etiqueta de la capa ${index} no es válido`, 200),
  };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: string[], message: string): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error(message);
}

function finiteNumber(value: unknown, message: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(message);
  return value;
}

function integerValue(value: unknown, message: string, min: number, max: number): number {
  const parsed = finiteNumber(value, message, min, max);
  if (!Number.isInteger(parsed)) throw new Error(message);
  return parsed;
}

function booleanValue(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new Error(message);
  return value;
}

function boundedString(value: unknown, message: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(message);
  return value;
}

function nullableString(value: unknown, message: string, max: number): string | null {
  if (value === null) return null;
  return boundedString(value, message, max);
}

function colorValue(value: unknown, index: number): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`El color de la capa ${index} no es válido`);
  return value;
}
