"use client";

import { apiFetch } from "@/lib/api-client";
import type { Feature, FeatureCollection } from "geojson";
import type { GisGeometry, LayerStyle, RasterStatus } from "./types";

export interface LayerManifest {
  id: string;
  mapId: string;
  name: string;
  geometryType: GisGeometry;
  crs: string;
  featureCount: number;
  bbox: number[] | null;
  sourceFormat: string;
  sourcePath: string | null;
  dataPath: string;
  sizeBytes: number;
  style: LayerStyle;
  visible: boolean;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
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
  const res = await apiFetch(base(mapId));
  if (!res.ok) throw new Error(`fetchLayers ${res.status}`);
  return res.json();
}

export async function fetchLayerData(mapId: string, layerId: string): Promise<FeatureCollection> {
  const res = await apiFetch(`${base(mapId)}/${layerId}/data`);
  if (!res.ok) throw new Error(`fetchLayerData ${res.status}`);
  return res.json();
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

  const res = await apiFetch(base(mapId), { method: "POST", body: form });
  if (!res.ok) throw new Error(`createLayer ${res.status}`);
  return res.json();
}

export async function updateLayerRemote(
  mapId: string,
  layerId: string,
  patch: Partial<Pick<LayerManifest, "name" | "style" | "visible" | "zIndex">>
): Promise<void> {
  const res = await apiFetch(`${base(mapId)}/${layerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateLayer ${res.status}`);
}

export async function deleteLayerRemote(mapId: string, layerId: string): Promise<void> {
  const res = await apiFetch(`${base(mapId)}/${layerId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteLayer ${res.status}`);
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
}

const rasterBase = (mapId: string) => `/geo/api/maps/${mapId}/raster-layers`;

export async function fetchRasterLayers(mapId: string): Promise<RasterLayerManifest[]> {
  const res = await apiFetch(rasterBase(mapId));
  if (!res.ok) throw new Error(`fetchRasterLayers ${res.status}`);
  return res.json();
}

export async function updateRasterRemote(
  mapId: string,
  layerId: string,
  patch: Partial<Pick<RasterLayerManifest, "name" | "opacity" | "visible" | "zIndex">>,
): Promise<void> {
  const res = await apiFetch(`${rasterBase(mapId)}/${layerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateRaster ${res.status}`);
}

export async function deleteRasterRemote(mapId: string, layerId: string): Promise<void> {
  const res = await apiFetch(`${rasterBase(mapId)}/${layerId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteRaster ${res.status}`);
}

export async function retryRasterRemote(mapId: string, layerId: string): Promise<RasterLayerManifest> {
  const res = await apiFetch(`${rasterBase(mapId)}/${layerId}/retry`, { method: "POST" });
  if (!res.ok) throw new Error(`retryRaster ${res.status}`);
  return res.json();
}

export interface CreateRasterArgs {
  name: string;
  /** The .tif/.tiff plus any sidecars (.tfw/.prj/...). */
  files: File[];
  onProgress?: (pct: number) => void;
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
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) args.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error("Respuesta inválida del servidor")); }
      } else {
        let msg = `Error ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).message || msg; } catch { /* keep default */ }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Error de red al subir la ortofoto"));
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
  const res = await apiFetch(`/geo/api/maps/${mapId}/viewport`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ center, zoom }),
  });
  if (!res.ok) throw new Error(`saveViewport ${res.status}`);
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
