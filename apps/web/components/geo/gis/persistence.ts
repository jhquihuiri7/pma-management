"use client";

import {
  ApiError,
  api,
  errorMessageFromEnvelope,
  requireOkReceipt,
  requirePersistedEntity,
} from "@/lib/api-client";
import type { Feature, FeatureCollection } from "geojson";
import type { GisGeometry, LayerStyle, RasterStatus } from "./types";
import type { GeoLayerVisualization, GeoVisualizationDraft } from "@pma/types/geo";
import type {
  GeoFeatureCreateInput,
  GeoFeatureCreateResult,
  GeoLayerAttributeSchema,
} from "@pma/types/geo";

export interface LayerManifest {
  id: string;
  mapId: string;
  name: string;
  geometryType: GisGeometry;
  crs: string;
  featureCount: number;
  bbox: number[] | null;
  sourceFormat: string;
  dataRevision: number;
  attributeSchema: GeoLayerAttributeSchema | null;
  schemaVersion: number;
  manualEntryEnabled: boolean;
  sizeBytes: number;
  style: LayerStyle;
  visible: boolean;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
  persisted?: boolean;
}

export interface CreateLayerArgs {
  name: string;
  geometry: GisGeometry;
  crs: string;
  geojson: FeatureCollection;
  featureCount: number;
  bbox: number[] | null;
  style: LayerStyle;
  visible: boolean;
  zIndex: number;
  sourceFormat: string;
  sourceFile?: File | null;
}

const base = (mapId: string) => `/geo/api/maps/${mapId}/layers`;

export async function fetchLayers(mapId: string): Promise<LayerManifest[]> {
  return api.get<LayerManifest[]>(base(mapId));
}

export async function fetchLayerData(mapId: string, layerId: string, revision?: number): Promise<FeatureCollection> {
  return api.get<FeatureCollection>(`${base(mapId)}/${layerId}/data${revision ? `/${revision}` : ""}`);
}

export interface LayerCaptureSchemaResponse {
  schema: GeoLayerAttributeSchema;
  schemaVersion: number;
  manualEntryEnabled: boolean;
  inferred: boolean;
}

export function fetchLayerCaptureSchema(mapId: string, layerId: string): Promise<LayerCaptureSchemaResponse> {
  return api.get<LayerCaptureSchemaResponse>(`${base(mapId)}/${layerId}/schema`);
}

export async function updateLayerCaptureSchemaRemote(
  mapId: string,
  layerId: string,
  schema: GeoLayerAttributeSchema,
  manualEntryEnabled: boolean,
): Promise<LayerManifest> {
  return requirePersistedEntity<LayerManifest>(
    await api.put<unknown>(`${base(mapId)}/${layerId}/schema`, { schema, manualEntryEnabled }),
    "El servidor no confirmó el esquema de captura",
    layerId,
  );
}

export async function createFeatureRemote(
  mapId: string,
  layerId: string,
  input: GeoFeatureCreateInput,
): Promise<GeoFeatureCreateResult> {
  const result = await api.post<GeoFeatureCreateResult>(`${base(mapId)}/${layerId}/features`, input);
  if (result.persisted !== true || !result.feature || result.revision < 1) {
    throw new ApiError(0, "El servidor no confirmó la nueva observación", result, "invalid_response");
  }
  return result;
}

export interface LayerRevisionManifest {
  id: string;
  revision: number;
  featureCount: number;
  bbox: number[] | null;
  sizeBytes: number;
  checksum: string | null;
  action: "snapshot" | "append";
  featureId: string | null;
  changeReason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export function fetchLayerRevisions(mapId: string, layerId: string): Promise<LayerRevisionManifest[]> {
  return api.get<LayerRevisionManifest[]>(`${base(mapId)}/${layerId}/revisions`);
}

export async function createLayerRemote(mapId: string, args: CreateLayerArgs): Promise<LayerManifest> {
  const form = new FormData();
  form.append(
    "data",
    new Blob([JSON.stringify(args.geojson)], { type: "application/geo+json" }),
    "data.geojson"
  );
  if (args.sourceFile) form.append("source", args.sourceFile, args.sourceFile.name);
  form.append("name", args.name);
  form.append("geometryType", args.geometry);
  form.append("crs", args.crs);
  form.append("featureCount", String(args.featureCount));
  form.append("bbox", JSON.stringify(args.bbox));
  form.append("sourceFormat", args.sourceFormat);
  form.append("style", JSON.stringify(args.style));
  form.append("visible", String(args.visible));
  form.append("zIndex", String(args.zIndex));

  const manifest = requirePersistedEntity<LayerManifest>(
    await api.upload<unknown>(base(mapId), form, { timeoutMs: 120_000 }),
    "El servidor no confirmó la persistencia de la capa"
  );
  if (manifest.persisted !== true || !manifest.id) {
    throw new ApiError(0, "El servidor no confirmó la persistencia de la capa", manifest, "invalid_response");
  }
  return manifest;
}

export async function updateLayerRemote(
  mapId: string,
  layerId: string,
  patch: Partial<Pick<LayerManifest, "name" | "style" | "visible" | "zIndex">>
): Promise<void> {
  requirePersistedEntity<LayerManifest>(
    await api.patch<unknown>(`${base(mapId)}/${layerId}`, patch),
    "El servidor no confirmó los cambios de la capa",
    layerId
  );
}

export async function deleteLayerRemote(mapId: string, layerId: string): Promise<void> {
  requireOkReceipt(
    await api.delete<unknown>(`${base(mapId)}/${layerId}`),
    "El servidor no confirmó la eliminación de la capa"
  );
}

// ── User-authored visualizations ──────────────────────────────────────────

const visualizationBase = (mapId: string, layerId: string) => `${base(mapId)}/${layerId}/visualizations`;

export function fetchVisualizations(mapId: string, layerId: string): Promise<GeoLayerVisualization[]> {
  return api.get<GeoLayerVisualization[]>(visualizationBase(mapId, layerId));
}

export async function createVisualizationRemote(
  mapId: string,
  layerId: string,
  draft: GeoVisualizationDraft,
): Promise<GeoLayerVisualization> {
  return requirePersistedEntity<GeoLayerVisualization>(
    await api.post<unknown>(visualizationBase(mapId, layerId), draft),
    "El servidor no confirmó la visualización",
  );
}

export async function updateVisualizationRemote(
  mapId: string,
  layerId: string,
  visualizationId: string,
  draft: GeoVisualizationDraft,
): Promise<GeoLayerVisualization> {
  return requirePersistedEntity<GeoLayerVisualization>(
    await api.patch<unknown>(`${visualizationBase(mapId, layerId)}/${visualizationId}`, draft),
    "El servidor no confirmó los cambios de la visualización",
    visualizationId,
  );
}

export async function deleteVisualizationRemote(mapId: string, layerId: string, visualizationId: string): Promise<void> {
  requireOkReceipt(
    await api.delete<unknown>(`${visualizationBase(mapId, layerId)}/${visualizationId}`),
    "El servidor no confirmó la eliminación de la visualización",
  );
}

export function reorderVisualizationsRemote(mapId: string, layerId: string, ids: string[]): Promise<GeoLayerVisualization[]> {
  return api.put<GeoLayerVisualization[]>(`${visualizationBase(mapId, layerId)}/order`, { ids });
}

// ── Raster (orthophoto) layers ─────────────────────────────────────────────

export interface RasterLayerManifest {
  id: string;
  mapId: string;
  name: string;
  status: RasterStatus;
  errorMessage: string | null;
  originalFilename: string;
  fileType: string;
  sizeBytes: number;
  srid: number | null;
  crs: string | null;
  bbox: number[] | null;
  widthPx: number | null;
  heightPx: number | null;
  bandCount: number | null;
  hasAlpha: boolean;
  resolutionX: number | null;
  resolutionY: number | null;
  minZoom: number | null;
  maxZoom: number | null;
  opacity: number;
  visible: boolean;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  persisted?: boolean;
  operationId?: string;
}

const rasterBase = (mapId: string) => `/geo/api/maps/${mapId}/raster-layers`;

export async function fetchRasterLayers(mapId: string): Promise<RasterLayerManifest[]> {
  return api.get<RasterLayerManifest[]>(rasterBase(mapId));
}

export async function updateRasterRemote(
  mapId: string,
  layerId: string,
  patch: Partial<Pick<RasterLayerManifest, "name" | "opacity" | "visible" | "zIndex">>,
): Promise<void> {
  requirePersistedEntity<RasterLayerManifest>(
    await api.patch<unknown>(`${rasterBase(mapId)}/${layerId}`, patch),
    "El servidor no confirmó los cambios de la ortofoto",
    layerId
  );
}

export async function deleteRasterRemote(mapId: string, layerId: string): Promise<void> {
  requireOkReceipt(
    await api.delete<unknown>(`${rasterBase(mapId)}/${layerId}`),
    "El servidor no confirmó la eliminación de la ortofoto"
  );
}

export async function retryRasterRemote(mapId: string, layerId: string): Promise<RasterLayerManifest> {
  const manifest = requirePersistedEntity<RasterLayerManifest>(
    await api.post<unknown>(`${rasterBase(mapId)}/${layerId}/retry`),
    "El servidor no confirmó el reencolado",
    layerId
  );
  if (
    manifest.persisted !== true ||
    !manifest.operationId ||
    (manifest.status !== "queued" && manifest.status !== "processing")
  ) {
    throw new ApiError(0, "El servidor no confirmó el reencolado", manifest, "invalid_response");
  }
  return manifest;
}

export interface CreateRasterArgs {
  name: string;
  /** The .tif/.tiff plus any sidecars (.tfw/.prj/...). */
  files: File[];
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Upload an orthophoto. Uses XHR (not fetch) to expose upload progress for the
 * multi-GB transfer. Goes through the same proxy/base as the rest of the API and
 * sends cookies (admin-only route).
 */
export function createRasterRemote(mapId: string, args: CreateRasterArgs): Promise<RasterLayerManifest> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("name", args.name);
    for (const f of args.files) form.append("file", f, f.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${TILE_BASE}/geo/maps/${mapId}/raster-layers`);
    xhr.withCredentials = true;
    xhr.timeout = args.timeoutMs ?? 15 * 60_000;
    const abort = () => xhr.abort();
    args.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => args.signal?.removeEventListener("abort", abort);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) args.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const manifest = JSON.parse(xhr.responseText) as RasterLayerManifest;
          if (
            manifest.persisted !== true ||
            !manifest.operationId ||
            !manifest.id ||
            (manifest.status !== "queued" && manifest.status !== "processing")
          ) {
            throw new ApiError(200, "El servidor no confirmó la persistencia y el encolado de la ortofoto", manifest, "invalid_response");
          }
          cleanup();
          resolve(manifest);
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error("Respuesta inválida del servidor"));
        }
      } else {
        let details: unknown = xhr.responseText;
        try { details = JSON.parse(xhr.responseText); } catch { /* keep text */ }
        const msg = errorMessageFromEnvelope(details) || `Error ${xhr.status}`;
        cleanup();
        reject(new ApiError(xhr.status, msg, details, "http"));
      }
    };
    xhr.onerror = () => { cleanup(); reject(new ApiError(0, "Error de red al subir la ortofoto", undefined, "network")); };
    xhr.ontimeout = () => { cleanup(); reject(new ApiError(0, "La subida de la ortofoto superó el tiempo de espera", undefined, "timeout")); };
    xhr.onabort = () => { cleanup(); reject(new ApiError(0, "La subida de la ortofoto fue cancelada", undefined, "abort")); };
    if (args.signal?.aborted) {
      cleanup();
      reject(new ApiError(0, "La subida de la ortofoto fue cancelada", undefined, "abort"));
      return;
    }
    xhr.send(form);
  });
}

// Leaflet fetches tiles directly (not via apiFetch), so this must be a URL the
// browser can hit — through the same Next proxy / API base used everywhere else.
const TILE_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy").replace(/\/+$/, "");

export function rasterTileUrl(mapId: string, layerId: string): string {
  return `${TILE_BASE}/geo/maps/${mapId}/raster-layers/${layerId}/tiles/{z}/{x}/{y}.png`;
}

/** Persist the current viewport (center [lat,lng] + zoom). Open to any geo user. */
export async function saveViewport(mapId: string, center: [number, number], zoom: number): Promise<void> {
  requirePersistedEntity<{ id: string }>(
    await api.patch<unknown>(`/geo/api/maps/${mapId}/viewport`, { center, zoom }),
    "El servidor no confirmó la vista del mapa",
    mapId
  );
}

// ── helpers ──────────────────────────────────────────────────────────────
export function humanSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + " KB";
  return bytes + " B";
}

/** Walk arbitrarily-nested coordinate arrays to compute [minX,minY,maxX,maxY]. */
export function bboxOf(features: Feature[]): number[] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c)) {
      if (typeof c[0] === "number" && typeof c[1] === "number") {
        const x = c[0] as number, y = c[1] as number;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      } else {
        c.forEach(visit);
      }
    }
  };
  features.forEach((f) => f.geometry && "coordinates" in f.geometry && visit(f.geometry.coordinates));
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}
