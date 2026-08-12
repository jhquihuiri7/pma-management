"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Map as LeafletMap } from "leaflet";
import type { FeatureCollection } from "geojson";
import {
  PanelLeft, PanelRight, Table2, Info, Ruler, ZoomIn, ZoomOut, Home,
  Search, Download, Upload, X, AlignLeft, Maximize, Minimize, ArrowLeft,
  MousePointer, MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-client";
import LayersPanel from "./LayersPanel";
import UploadModal from "./UploadModal";
import GisMap from "./GisMap";
import DashboardsPanel from "./DashboardsPanel";
import { inferSchema, fmtNum, categoryCounts } from "./charts";
import { toDMS, toUTM, formatUTM, inspectPoint as inspectLayersAt, formatDistance, type PointHit } from "./geo-point";
import { BASEMAPS, BASEMAP_PREVIEWS, COLOR_RAMPS } from "./gis-data";
import {
  fetchLayers, fetchLayerData, createLayerRemote, updateLayerRemote, deleteLayerRemote,
  saveViewport, bboxOf, humanSize, type LayerManifest,
  fetchRasterLayers, rasterTileUrl, updateRasterRemote, deleteRasterRemote, retryRasterRemote,
  type RasterLayerManifest,
} from "./persistence";
import type { AddLayerInput, AddLayerResult, GisGeometry, GisLayer, RasterLayer, IdentifyInfo, FocusFeature, LayerStyle } from "./types";
import type { GeoMap } from "@/types/geo";
import "./gis.css";

const MapExportBuilder = dynamic(
  () => import("@/components/geo/export/MapExportBuilder"),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[1200] grid place-items-center bg-black/10 backdrop-blur-[2px]">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-lg">
          Preparando constructor cartográfico…
        </div>
      </div>
    ),
  },
);

type DeferredWrite = {
  timer: ReturnType<typeof setTimeout>;
  run: () => Promise<void>;
};

function manifestToLayer(m: LayerManifest, geojson: FeatureCollection): GisLayer {
  return {
    id: m.id,
    name: m.name,
    geometry: m.geometryType,
    geojson,
    crs: m.crs,
    size: humanSize(m.sizeBytes),
    visible: m.visible,
    loadedAt: Date.parse(m.createdAt) || Date.now(),
    style: m.style,
    zIndex: m.zIndex,
    persisted: true,
  };
}

function manifestToRaster(m: RasterLayerManifest, mapId: string): RasterLayer {
  return {
    id: m.id,
    name: m.name,
    status: m.status,
    errorMessage: m.errorMessage,
    opacity: m.opacity,
    visible: m.visible,
    zIndex: m.zIndex,
    bbox: m.bbox,
    tileUrl: rasterTileUrl(mapId, m.id),
  };
}

// Refresh worker-controlled fields (status/error/bbox) from the server while
// keeping the user's local presentation (opacity/visible) that's debounce-saved.
function mergeRasters(prev: RasterLayer[], manifests: RasterLayerManifest[], mapId: string): RasterLayer[] {
  const byId = new Map(prev.map((r) => [r.id, r]));
  return manifests.map((m) => {
    const base = manifestToRaster(m, mapId);
    const p = byId.get(m.id);
    return p ? { ...base, opacity: p.opacity, visible: p.visible, zIndex: p.zIndex } : base;
  });
}

function defaultStyleFor(geometry: GisGeometry, index = 0): LayerStyle {
  const colors = ["#3f7c5f", "#c46d27", "#2c5481", "#9d4636", "#6e5a2c", "#4a4458"];
  return {
    mode: "single",
    color: colors[index % colors.length],
    palette: "categorical",
    ramp: geometry === "Point" ? "blues" : "earth",
    classification: "quantile",
    classes: 5,
    colorBy: null,
    opacity: geometry === "LineString" ? 1 : 0.78,
    strokeWidth: geometry === "Point" ? 0 : 1,
    size: 6,
    labels: false,
    labelField: null,
  };
}

export default function GisEditor({ geoMap, mapId, mapTitle, backHref, initialCenter, initialZoom, canEdit = false, canDelete = false }: {
  geoMap?: GeoMap;
  mapId?: string;
  mapTitle?: string;
  backHref?: string;
  initialCenter?: [number, number];
  initialZoom?: number;
  // When false (public visitors) the editor is read-only: no add, remove,
  // reorder, style edits, or server persistence. Any logged-in geo user (incl.
  // VIEWER) gets canEdit; deleting layers stays ADMIN-only via canDelete.
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const [layers, setLayers] = useState<GisLayer[]>([]);
  const layersRef = useRef<GisLayer[]>([]);
  const [rasterLayers, setRasterLayers] = useState<RasterLayer[]>([]);
  const rasterLayersRef = useRef<RasterLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [basemap, setBasemap] = useState("light");
  const [tool, setTool] = useState<"pan" | "identify" | "measure" | "inspect">("pan");
  const [showUpload, setShowUpload] = useState(false);
  const [identify, setIdentify] = useState<IdentifyInfo | null>(null);
  const [inspectPoint, setInspectPoint] = useState<[number, number] | null>(null);
  const [attrPanelOpen, setAttrPanelOpen] = useState(false);
  const [coord, setCoord] = useState<[number, number]>([-0.5, -90.5]);
  const [zoom, setZoom] = useState(7);
  const [showLegend, setShowLegend] = useState(true);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [focusFeature, setFocusFeature] = useState<FocusFeature | null>(null);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [deletingLayerIds, setDeletingLayerIds] = useState<Set<string>>(new Set());
  const deletingLayerIdsRef = useRef(new Set<string>());
  const [busyRasterIds, setBusyRasterIds] = useState<Set<string>>(new Set());
  const rasterActionIdsRef = useRef(new Set<string>());
  const rasterPollInFlightRef = useRef(false);
  const rasterPollErrorShownRef = useRef(false);
  const deferredWrites = useRef<Record<string, DeferredWrite>>({});
  const latestWriteVersion = useRef<Record<string, number>>({});
  const writeQueues = useRef<Record<string, Promise<void>>>({});
  const pendingWriteCount = useRef(0);
  const failedWriteKeys = useRef(new Set<string>());
  const confirmedLayers = useRef(new Map<string, GisLayer>());
  const confirmedRasters = useRef(new Map<string, RasterLayer>());
  const mountedRef = useRef(true);
  // Auto-fit happens once (first layer of an empty map); a remembered viewport
  // or any user pan/zoom disables it so the view is never yanked around.
  const hasAutoFitted = useRef(false);
  const canMutate = canEdit && hydrated && hydrationError === null;
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    rasterLayersRef.current = rasterLayers;
  }, [rasterLayers]);

  const refreshSaveState = useCallback(() => {
    if (!mountedRef.current) return;
    if (pendingWriteCount.current > 0 || Object.keys(deferredWrites.current).length > 0) setSaveState("saving");
    else if (failedWriteKeys.current.size > 0) setSaveState("error");
    else setSaveState("saved");
  }, []);

  const runQueuedWrite = useCallback(async (
    key: string,
    operation: () => Promise<void>
  ) => {
    pendingWriteCount.current += 1;
    refreshSaveState();
    const previous = writeQueues.current[key] ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(operation);
    writeQueues.current[key] = queued;
    try {
      await queued;
      failedWriteKeys.current.delete(key);
    } catch (error) {
      failedWriteKeys.current.add(key);
      throw error;
    } finally {
      pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
      if (writeQueues.current[key] === queued) delete writeQueues.current[key];
      refreshSaveState();
    }
  }, [refreshSaveState]);

  const scheduleDeferredWrite = useCallback((
    key: string,
    delayMs: number,
    operation: (version: number) => Promise<void>,
  ) => {
    const previous = deferredWrites.current[key];
    if (previous) clearTimeout(previous.timer);
    const version = (latestWriteVersion.current[key] ?? 0) + 1;
    latestWriteVersion.current[key] = version;
    const run = () => operation(version);
    // Critical metadata is started synchronously. React does not await effect
    // cleanup during client-side navigation, so leaving it only in a debounce
    // timer can discard the user's last edit before any request exists.
    if (delayMs <= 0) {
      if (previous) delete deferredWrites.current[key];
      refreshSaveState();
      void run().catch(() => undefined);
      return;
    }
    const timer = setTimeout(() => {
      if (deferredWrites.current[key]?.timer === timer) {
        delete deferredWrites.current[key];
      }
      refreshSaveState();
      void run().catch(() => undefined);
    }, delayMs);
    deferredWrites.current[key] = { timer, run };
    refreshSaveState();
  }, [refreshSaveState]);

  const flushDeferredWrites = useCallback(async () => {
    const scheduled = Object.entries(deferredWrites.current);
    for (const [key, entry] of scheduled) {
      clearTimeout(entry.timer);
      if (deferredWrites.current[key] === entry) delete deferredWrites.current[key];
    }
    refreshSaveState();
    const scheduledResults = await Promise.allSettled(scheduled.map(([, entry]) => entry.run()));
    const queuedResults = await Promise.allSettled(Object.values(writeQueues.current));
    const failure = [...scheduledResults, ...queuedResults].find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }, [refreshSaveState]);

  const handleViewportChange = useCallback((center: [number, number], zoom: number) => {
    hasAutoFitted.current = true; // the view is now user/remembered-controlled
    if (!mapId || !canMutate) return; // public/read-only users don't persist viewport
    scheduleDeferredWrite("viewport", 0, async () => {
      try {
        await runQueuedWrite("viewport", () => saveViewport(mapId, center, zoom));
      } catch (error) {
        toast.error(apiErrorMessage(error, "No se pudo guardar la vista del mapa"));
        throw error;
      }
    });
  }, [mapId, canMutate, runQueuedWrite, scheduleDeferredWrite]);

  // Load persisted layers for this map (so the editor doesn't start from zero).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mapId) { setHydrated(true); return; }
      setSaveState("loading");
      try {
        const manifests = await fetchLayers(mapId);
        manifests.sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0)); // top of stack first
        const built = await Promise.all(
          manifests.map(async (m) => manifestToLayer(m, await fetchLayerData(mapId, m.id)))
        );
        if (!cancelled) {
          layersRef.current = built;
          confirmedLayers.current = new Map(built.map((layer) => [layer.id, layer]));
          setLayers(built);
          setActiveLayerId(built[0]?.id ?? null);
          if (built.length) hasAutoFitted.current = true;
        }
        const rasters = await fetchRasterLayers(mapId);
        if (!cancelled) {
          const builtRasters = rasters.map((m) => manifestToRaster(m, mapId));
          rasterLayersRef.current = builtRasters;
          confirmedRasters.current = new Map(builtRasters.map((raster) => [raster.id, raster]));
          setRasterLayers(builtRasters);
          if (rasters.some((r) => r.status === "processed")) hasAutoFitted.current = true;
          setHydrationError(null);
          refreshSaveState();
        }
      } catch (error) {
        if (!cancelled) {
          const message = apiErrorMessage(error, "No se pudieron cargar las capas guardadas");
          setHydrationError(message);
          setSaveState("error");
          toast.error(message);
        }
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [mapId, refreshSaveState]);

  // Once loaded, if the map has no layers yet, prompt admins to add one.
  useEffect(() => {
    if (!canMutate) return;
    const t = setTimeout(() => { setLayers((cur) => { if (cur.length === 0) setShowUpload(true); return cur; }); }, 400);
    return () => clearTimeout(t);
  }, [canMutate]);

  // Debounced metadata save (style/visibility/name/order) for a persisted layer.
  const scheduleSave = useCallback((layer: GisLayer) => {
    if (!mapId || !canMutate || !layer.persisted) return;
    const key = `vector:${layer.id}`;
    scheduleDeferredWrite(key, 0, async (version) => {
      try {
        await runQueuedWrite(key, () => updateLayerRemote(mapId, layer.id, {
          name: layer.name, style: layer.style, visible: layer.visible, zIndex: layer.zIndex,
        }));
        confirmedLayers.current.set(layer.id, layer);
      } catch (error) {
        if (latestWriteVersion.current[key] === version) {
          const confirmed = confirmedLayers.current.get(layer.id);
          if (confirmed && mountedRef.current) {
            setLayers((current) => {
              const rolledBack = current.map((item) => item.id === layer.id ? confirmed : item);
              layersRef.current = rolledBack;
              return rolledBack;
            });
          }
        }
        toast.error(apiErrorMessage(error, `No se pudo guardar la capa ${layer.name}`));
        throw error;
      }
    });
  }, [mapId, canMutate, runQueuedWrite, scheduleDeferredWrite]);

  useEffect(() => {
    mountedRef.current = true;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingWriteCount.current === 0 && Object.keys(deferredWrites.current).length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("beforeunload", warnBeforeUnload);
      // Requests for critical edits start synchronously, so a client-side route
      // change cannot discard a still-unscheduled debounce. Let already-started
      // queues finish and surface any exceptional failure to diagnostics.
      void flushDeferredWrites().catch((error) => {
        console.error("No se pudieron completar las escrituras GIS al desmontar", error);
      });
    };
  }, [flushDeferredWrites]);

  useEffect(() => {
    if (!mapInstance) return;
    const onZoom = () => setZoom(mapInstance.getZoom());
    mapInstance.on("zoomend", onZoom);
    setZoom(mapInstance.getZoom());
    return () => { mapInstance.off("zoomend", onZoom); };
  }, [mapInstance]);

  // Track fullscreen so the button can flip its icon/label and toggle back.
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  };

  const activeLayer = layers.find((l) => l.id === activeLayerId);

  const addLayer = async (ds: AddLayerInput): Promise<AddLayerResult> => {
    const currentLayers = layersRef.current;
    const idx = currentLayers.length;
    const wasEmpty = currentLayers.length === 0;
    const style = defaultStyleFor(ds.geometry, idx);
    const zIndex = currentLayers.reduce((m, l) => Math.max(m, l.zIndex ?? 0), -1) + 1;
    const featureCount = ds.geojson.features.length;
    const bbox = bboxOf(ds.geojson.features);

    // Frame the very first layer of an empty map (once), unless the user already
    // has a remembered/manual view.
    const maybeAutoFit = () => {
      if (wasEmpty && !hasAutoFitted.current && mapInstance && bbox) {
        const [minX, minY, maxX, maxY] = bbox;
        try { mapInstance.fitBounds([[minY, minX], [maxY, maxX]], { padding: [40, 40] }); } catch { /* empty bounds */ }
        hasAutoFitted.current = true;
      }
    };

    // Persist to the server/NAS when we have a real map id.
    if (mapId) {
      const createKey = "vector:create";
      pendingWriteCount.current += 1;
      refreshSaveState();
      try {
        const manifest = await createLayerRemote(mapId, {
          name: ds.name, geometry: ds.geometry, crs: ds.crs || "EPSG:4326",
          geojson: ds.geojson, featureCount, bbox,
          style, visible: true, zIndex,
          sourceFormat: ds.sourceFormat || (ds.sourceFile ? "shapefile" : "geojson"),
          sourceFile: ds.sourceFile,
        });
        const layer = manifestToLayer(manifest, ds.geojson);
        confirmedLayers.current.set(layer.id, layer);
        setLayers((prev) => {
          const next = [layer, ...prev];
          layersRef.current = next;
          return next;
        });
        setActiveLayerId(layer.id);
        failedWriteKeys.current.delete(createKey);
        maybeAutoFit();
        return { persisted: true, id: manifest.id };
      } catch (error) {
        failedWriteKeys.current.add(createKey);
        throw error;
      } finally {
        pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
        refreshSaveState();
      }
    }

    // Local-only fallback (no map id, or save failed).
    const id = "layer_" + Date.now() + "_" + Math.round(Math.random() * 1e4);
    const layer: GisLayer = {
      id, name: ds.name, filename: ds.filename, geometry: ds.geometry,
      geojson: ds.geojson, size: ds.size, crs: ds.crs, visible: true, loadedAt: Date.now(),
      style, zIndex, persisted: false,
    };
    setLayers((prev) => {
      const next = [layer, ...prev];
      layersRef.current = next;
      return next;
    });
    setActiveLayerId(id);
    maybeAutoFit();
    return { persisted: false, id };
  };

  const updateLayer = (next: GisLayer) => {
    if (deletingLayerIdsRef.current.has(next.id)) return;
    setLayers((prev) => {
      const updated = prev.map((l) => (l.id === next.id ? next : l));
      layersRef.current = updated;
      return updated;
    });
    scheduleSave(next);
  };

  const removeLayer = async (id: string) => {
    const layer = layers.find((l) => l.id === id);
    if (!layer || deletingLayerIdsRef.current.has(id)) return;
    if (!mapId || !layer.persisted) {
      setLayers((prev) => {
        const next = prev.filter((l) => l.id !== id);
        layersRef.current = next;
        return next;
      });
      if (activeLayerId === id) setActiveLayerId(null);
      return;
    }

    deletingLayerIdsRef.current.add(id);
    setDeletingLayerIds(new Set(deletingLayerIdsRef.current));
    try {
      const key = `vector:${id}`;
      const deferred = deferredWrites.current[key];
      if (deferred) {
        clearTimeout(deferred.timer);
        delete deferredWrites.current[key];
      }
      latestWriteVersion.current[key] = (latestWriteVersion.current[key] ?? 0) + 1;
      refreshSaveState();
      await writeQueues.current[key]?.catch(() => undefined);
      await deleteLayerRemote(mapId, id);
      confirmedLayers.current.delete(id);
      setLayers((prev) => {
        const next = prev.filter((l) => l.id !== id);
        layersRef.current = next;
        return next;
      });
      if (activeLayerId === id) setActiveLayerId(null);
      toast.success("Capa eliminada correctamente");
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo eliminar la capa en el servidor"));
    } finally {
      deletingLayerIdsRef.current.delete(id);
      setDeletingLayerIds(new Set(deletingLayerIdsRef.current));
    }
  };

  const moveLayer = (id: string, direction: number) => {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx < 0) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      if (
        deletingLayerIdsRef.current.has(prev[idx].id) ||
        deletingLayerIdsRef.current.has(prev[newIdx].id)
      ) return prev;
      const next = [...prev];
      // Swap positions and their z-index so the new stacking order persists.
      const a = { ...next[idx] }, b = { ...next[newIdx] };
      const az = a.zIndex, bz = b.zIndex;
      a.zIndex = bz; b.zIndex = az;
      next[idx] = b; next[newIdx] = a;
      if (mapId) { scheduleSave(a); scheduleSave(b); }
      layersRef.current = next;
      return next;
    });
  };

  // ── Raster (orthophoto) layer handlers ───────────────────────────────────
  const handleRasterUploaded = (m: RasterLayerManifest) => {
    if (!mapId) return;
    const raster = manifestToRaster(m, mapId);
    confirmedRasters.current.set(raster.id, raster);
    setRasterLayers((prev) => {
      const next = [raster, ...prev.filter((r) => r.id !== m.id)];
      rasterLayersRef.current = next;
      return next;
    });
  };

  const updateRaster = (next: RasterLayer) => {
    if (rasterActionIdsRef.current.has(next.id)) return;
    setRasterLayers((prev) => {
      const updated = prev.map((r) => (r.id === next.id ? next : r));
      rasterLayersRef.current = updated;
      return updated;
    });
    if (!mapId || !canMutate) return;
    if (next.status === "deleting") return;
    const key = `raster:${next.id}`;
    scheduleDeferredWrite(key, 0, async (version) => {
      try {
        await runQueuedWrite(key, () => updateRasterRemote(mapId, next.id, {
          name: next.name, opacity: next.opacity, visible: next.visible, zIndex: next.zIndex,
        }));
        confirmedRasters.current.set(next.id, next);
      } catch (error) {
        if (latestWriteVersion.current[key] === version) {
          const confirmed = confirmedRasters.current.get(next.id);
          if (confirmed && mountedRef.current) {
            setRasterLayers((current) => {
              const rolledBack = current.map((item) => item.id === next.id
                ? { ...item, name: confirmed.name, opacity: confirmed.opacity, visible: confirmed.visible, zIndex: confirmed.zIndex }
                : item);
              rasterLayersRef.current = rolledBack;
              return rolledBack;
            });
          }
        }
        toast.error(apiErrorMessage(error, `No se pudo guardar la ortofoto ${next.name}`));
        throw error;
      }
    });
  };

  const removeRaster = async (id: string) => {
    if (!mapId || rasterActionIdsRef.current.has(id)) return;
    const previous = rasterLayers.find((r) => r.id === id);
    if (!previous || previous.status === "deleting") return;
    rasterActionIdsRef.current.add(id);
    setBusyRasterIds(new Set(rasterActionIdsRef.current));
    setRasterLayers((current) => current.map((r) => r.id === id ? { ...r, status: "deleting" } : r));
    try {
      const key = `raster:${id}`;
      const deferred = deferredWrites.current[key];
      if (deferred) {
        clearTimeout(deferred.timer);
        delete deferredWrites.current[key];
      }
      latestWriteVersion.current[key] = (latestWriteVersion.current[key] ?? 0) + 1;
      refreshSaveState();
      await writeQueues.current[key]?.catch(() => undefined);
      await deleteRasterRemote(mapId, id);
      confirmedRasters.current.delete(id);
      setRasterLayers((current) => {
        const next = current.filter((r) => r.id !== id);
        rasterLayersRef.current = next;
        return next;
      });
      toast.success("Ortofoto eliminada correctamente");
    } catch (error) {
      setRasterLayers((current) => current.map((r) => r.id === id ? previous : r));
      toast.error(apiErrorMessage(error, "No se pudo eliminar la ortofoto en el servidor"));
    } finally {
      rasterActionIdsRef.current.delete(id);
      setBusyRasterIds(new Set(rasterActionIdsRef.current));
    }
  };

  const retryRaster = async (id: string) => {
    if (!mapId || rasterActionIdsRef.current.has(id)) return;
    rasterActionIdsRef.current.add(id);
    setBusyRasterIds(new Set(rasterActionIdsRef.current));
    try {
      const manifest = await retryRasterRemote(mapId, id);
      setRasterLayers((prev) => prev.map((r) => (
        r.id === id ? { ...r, status: manifest.status, errorMessage: manifest.errorMessage } : r
      )));
      toast.success("Ortofoto confirmada en la cola de procesamiento");
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo reintentar el procesamiento"));
    } finally {
      rasterActionIdsRef.current.delete(id);
      setBusyRasterIds(new Set(rasterActionIdsRef.current));
    }
  };

  // Poll while any orthophoto is still uploading/processing, so the panel and
  // map update when the worker finishes (or fails). Stops once nothing pends.
  const hasPendingRaster = rasterLayers.some((r) =>
    r.status === "uploaded" || r.status === "queued" || r.status === "processing" || r.status === "deleting"
  );
  useEffect(() => {
    if (!mapId || !hasPendingRaster) return;
    const t = setInterval(async () => {
      if (rasterPollInFlightRef.current) return;
      rasterPollInFlightRef.current = true;
      try {
        const manifests = await fetchRasterLayers(mapId);
        setRasterLayers((prev) => mergeRasters(prev, manifests, mapId));
        rasterPollErrorShownRef.current = false;
      } catch (error) {
        if (!rasterPollErrorShownRef.current) {
          rasterPollErrorShownRef.current = true;
          toast.error(apiErrorMessage(error, "No se pudo actualizar el estado de las ortofotos; se reintentará automáticamente"));
        }
      } finally {
        rasterPollInFlightRef.current = false;
      }
    }, 3000);
    return () => clearInterval(t);
  }, [mapId, hasPendingRaster]);

  const handleIdentify = (info: IdentifyInfo) => {
    setIdentify(info);
    if (info?.layerId) setActiveLayerId(info.layerId);
  };

  const zoomTo = (delta: number) => mapInstance && mapInstance.setZoom(mapInstance.getZoom() + delta);
  const goHome = () => mapInstance && mapInstance.setView([-0.5, -90.5], 9);

  const searchResults = searchQ.trim().length > 0 && activeLayer
    ? activeLayer.geojson.features.filter((f) =>
        Object.values(f.properties || {}).some((v) => String(v).toLowerCase().includes(searchQ.toLowerCase()))
      ).slice(0, 8)
    : [];

  const handleBackClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!backHref) return;
    event.preventDefault();
    try {
      await flushDeferredWrites();
      window.location.assign(backHref);
    } catch {
      toast.error("No se puede salir mientras haya cambios que no pudieron guardarse.");
    }
  };

  return (
    <div className={"gis-shell app-shell" + (showLeft ? "" : " no-left") + (showRight ? "" : " no-right")}>
      {/* TOPBAR */}
      <div className="topbar">
        <div className="brand">
          {backHref && (
            <a className="brand-back" href={backHref} data-tip="Volver al mapa" onClick={(event) => void handleBackClick(event)}>
              <ArrowLeft size={14} /> Volver
            </a>
          )}
          <div className="brand-mark">D</div>
          <div>
            <div className="brand-text">DGTAR <span className="brand-sub">/ {mapTitle || "GIS Ambiental"}</span></div>
          </div>
        </div>

        <div className="tb-group">
          <button className={"tb-btn" + (showLeft ? " active" : "")} onClick={() => setShowLeft(!showLeft)} data-tip="Capas"><PanelLeft size={14} /></button>
          <button className={"tb-btn" + (showRight ? " active" : "")} onClick={() => setShowRight(!showRight)} data-tip="Dashboards"><PanelRight size={14} /></button>
          <button className={"tb-btn" + (attrPanelOpen ? " active" : "")} onClick={() => setAttrPanelOpen(!attrPanelOpen)} data-tip="Tabla de atributos"><Table2 size={14} /></button>
        </div>

        <div className="tb-group">
          <button
            className={"tb-btn" + (tool === "inspect" ? " active" : "")}
            onClick={() => { if (tool === "inspect") { setTool("pan"); setInspectPoint(null); } else setTool("inspect"); }}
            data-tip="Consultar punto (coordenadas e info geográfica)"
          ><MousePointer size={14} /></button>
          <button className={"tb-btn" + (tool === "identify" ? " active" : "")} onClick={() => setTool(tool === "identify" ? "pan" : "identify")} data-tip="Identificar"><Info size={14} /></button>
          <button className={"tb-btn" + (tool === "measure" ? " active" : "")} onClick={() => setTool(tool === "measure" ? "pan" : "measure")} data-tip="Medir distancia"><Ruler size={14} /></button>
        </div>

        <div className="tb-group">
          <button className="tb-btn" data-tip="Acercar" onClick={() => zoomTo(1)}><ZoomIn size={14} /></button>
          <button className="tb-btn" data-tip="Alejar" onClick={() => zoomTo(-1)}><ZoomOut size={14} /></button>
          <button className="tb-btn" data-tip="Vista inicial" onClick={goHome}><Home size={14} /></button>
        </div>

        <div className="tb-spacer" />

        <div style={{ position: "relative" }}>
          <div className="search">
            <Search size={14} />
            <input
              placeholder={activeLayer ? `Buscar en ${activeLayer.name}…` : "Buscar feature…"}
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            />
          </div>
          {searchOpen && searchResults.length > 0 && activeLayer && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--background)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "var(--shadow-md)", zIndex: 50, overflow: "hidden" }}>
              {searchResults.map((f, i) => {
                const p = f.properties || {};
                const name = p.nombre || p.name || p.id || "Feature";
                return (
                  <div key={i} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12 }}
                    onMouseDown={() => {
                      setFocusFeature({ layerId: activeLayer.id, feature: f });
                      setIdentify({ layerId: activeLayer.id, layerName: activeLayer.name, feature: f, latlng: null });
                      setSearchQ("");
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontWeight: 500 }}>{String(name)}</div>
                    <div style={{ fontSize: 10.5, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{f.geometry?.type}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="tb-group">
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 text-[13px] font-medium text-white transition-colors hover:bg-teal-700"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar mapa
          </button>
          {canMutate && (
            <button className="tb-btn primary" onClick={() => setShowUpload(true)}><Upload size={14} /> Agregar capa</button>
          )}
        </div>
      </div>

      {/* LEFT RAIL */}
      <LayersPanel
        layers={layers}
        activeId={activeLayerId}
        onActive={setActiveLayerId}
        onChange={updateLayer}
        onRemove={removeLayer}
        onMove={moveLayer}
        onOpenUpload={() => setShowUpload(true)}
        readOnly={!canMutate}
        canDelete={canDelete}
        busyLayerIds={deletingLayerIds}
        busyRasterIds={busyRasterIds}
        rasterLayers={rasterLayers}
        onRasterChange={updateRaster}
        onRasterRemove={removeRaster}
        onRasterRetry={retryRaster}
      />

      {/* MAP AREA */}
      <div className="map-area">
        <GisMap
          layers={layers}
          rasterLayers={rasterLayers}
          basemap={basemap}
          tool={tool}
          initialCenter={initialCenter}
          initialZoom={initialZoom}
          onIdentify={handleIdentify}
          onCoordChange={setCoord}
          onViewportChange={handleViewportChange}
          onPointInspect={setInspectPoint}
          inspectPoint={inspectPoint}
          focusFeature={focusFeature}
          onMapReady={setMapInstance}
        />

        {hydrationError && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 80, maxWidth: 520, padding: "10px 12px", borderRadius: 8, background: "var(--background)", border: "1px solid #9d4636", boxShadow: "var(--shadow-md)", fontSize: 12 }} role="alert">
            <span>{hydrationError}</span>{" "}
            <button className="icon-btn" onClick={() => window.location.reload()} style={{ width: "auto", paddingInline: 8 }}>Reintentar</button>
          </div>
        )}

        <div className="map-floating map-tools">
          <div className="tool-card">
            <button className={"tool-btn" + (isFullscreen ? " active" : "")} data-tip={isFullscreen ? "Pantalla normal" : "Pantalla completa"} onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
            <button className={"tool-btn" + (showLegend ? " active" : "")} data-tip="Leyenda" onClick={() => setShowLegend(!showLegend)}>
              <AlignLeft size={14} />
            </button>
          </div>
        </div>

        {showLegend && layers.some((l) => l.visible) && (
          <LegendCard layers={layers.filter((l) => l.visible)} onClose={() => setShowLegend(false)} />
        )}

        <div className="map-floating basemap-switch">
          {Object.entries(BASEMAPS).map(([key, b]) => (
            <div key={key} className={"basemap-tile" + (basemap === key ? " active" : "")} style={{ background: BASEMAP_PREVIEWS[key] }} onClick={() => setBasemap(key)} data-tip={b.name}>
              <span>{b.name}</span>
            </div>
          ))}
        </div>

        <div className="map-status-overlay">
          <div>{coord[0].toFixed(4)}, {coord[1].toFixed(4)}</div>
          <div>z {zoom.toFixed(1)}</div>
        </div>

        {identify && <IdentifyPopup info={identify} onClose={() => setIdentify(null)} />}

        {inspectPoint && (
          <PointInspectPopup
            lat={inspectPoint[0]}
            lng={inspectPoint[1]}
            hits={inspectLayersAt(inspectPoint[0], inspectPoint[1], layers)}
            onFocus={(h) => {
              setActiveLayerId(h.layerId);
              setFocusFeature({ layerId: h.layerId, feature: h.feature });
            }}
            onClose={() => setInspectPoint(null)}
          />
        )}

        {attrPanelOpen && activeLayer && (
          <AttributeTablePanel
            layer={activeLayer}
            onClose={() => setAttrPanelOpen(false)}
            onSelect={(f) => {
              setFocusFeature({ layerId: activeLayer.id, feature: f });
              setIdentify({ layerId: activeLayer.id, layerName: activeLayer.name, feature: f, latlng: null });
            }}
          />
        )}
      </div>

      {/* RIGHT RAIL */}
      <DashboardsPanel layer={activeLayer} />

      {/* STATUS BAR */}
      <div className="statusbar">
        <span><span className="dot" />{layers.length === 0 ? "Listo · sin capas" : `${layers.length} capa${layers.length === 1 ? "" : "s"} · ${layers.filter((l) => l.visible).length} visible${layers.filter((l) => l.visible).length === 1 ? "" : "s"}`}</span>
        <span className="sep">|</span>
        <span>EPSG:4326 — WGS 84</span>
        <span className="sep">|</span>
        <span>Vista: {coord[0].toFixed(4)}°, {coord[1].toFixed(4)}°</span>
        <div style={{ flex: 1 }} />
        {mapId && (
          <>
            <span>
              {saveState === "saving" ? "Guardando…"
                : saveState === "saved" ? "Guardado ✓"
                : saveState === "error" ? "Error al guardar"
                : "Cargando estado…"}
            </span>
            <span className="sep">|</span>
          </>
        )}
        <span>Tool: {tool}</span>
        <span className="sep">|</span>
        <span>{BASEMAPS[basemap].name}</span>
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onAdd={addLayer}
          mapId={mapId}
          onRasterUploaded={handleRasterUploaded}
        />
      )}

      {exportOpen && (
        <MapExportBuilder
          geoMap={geoMap ?? {
            id: mapId ?? "mapa",
            title: mapTitle ?? "Mapa del Geoportal",
            description: "",
            categoryId: "geo",
            layers: [],
            center: initialCenter ?? [-0.5, -90.5],
            zoom: initialZoom ?? zoom,
            createdBy: "Geoportal",
            createdAt: new Date().toISOString(),
          }}
          vectorLayers={layers.filter((layer) => layer.visible)}
          rasterLayers={rasterLayers.filter((layer) => layer.visible && layer.status === "processed")}
          view={{
            basemap,
            center: mapInstance
              ? [mapInstance.getCenter().lat, mapInstance.getCenter().lng]
              : initialCenter ?? [-0.5, -90.5],
            zoom: mapInstance?.getZoom() ?? zoom,
            bounds: mapInstance ? {
              north: mapInstance.getBounds().getNorth(),
              south: mapInstance.getBounds().getSouth(),
              east: mapInstance.getBounds().getEast(),
              west: mapInstance.getBounds().getWest(),
            } : undefined,
          }}
          sourceMapElement={mapInstance?.getContainer() ?? null}
          selectedFeature={identify?.feature ?? focusFeature?.feature ?? null}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
function IdentifyPopup({ info, onClose }: { info: IdentifyInfo; onClose: () => void }) {
  const props = info.feature.properties || {};
  const entries = Object.entries(props);
  return (
    <div className="identify-popup" style={{ right: 12, top: 60 }}>
      <div className="identify-popup-head">
        <div>
          <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--muted-fg)" }}>{info.layerName}</div>
          <div className="ttl">{String(props.nombre || props.name || props.id || "Feature")}</div>
        </div>
        <button className="icon-btn" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="identify-popup-body">
        {entries.map(([k, v]) => (
          <div className="identify-row" key={k}>
            <span className="k">{k}</span>
            <span className="v" style={{ fontFamily: typeof v === "number" ? "var(--font-mono)" : "inherit" }}>
              {typeof v === "number" ? fmtNum(v) : String(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
function PointInspectPopup({ lat, lng, hits, onFocus, onClose }: {
  lat: number;
  lng: number;
  hits: PointHit[];
  onFocus: (h: PointHit) => void;
  onClose: () => void;
}) {
  const utm = toUTM(lat, lng);
  return (
    <div className="identify-popup point-inspect" style={{ left: 12, top: 60, width: 288 }}>
      <div className="identify-popup-head">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <MapPin size={14} />
          <div className="ttl">Punto consultado</div>
        </div>
        <button className="icon-btn" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="identify-popup-body">
        <div className="pi-coords">
          <div className="identify-row">
            <span className="k">Decimal</span>
            <span className="v" style={{ fontFamily: "var(--font-mono)" }}>{lat.toFixed(5)}°, {lng.toFixed(5)}°</span>
          </div>
          <div className="identify-row">
            <span className="k">DMS</span>
            <span className="v" style={{ fontFamily: "var(--font-mono)" }}>{toDMS(lat, "lat")} {toDMS(lng, "lng")}</span>
          </div>
          <div className="identify-row">
            <span className="k">UTM</span>
            <span className="v" style={{ fontFamily: "var(--font-mono)" }}>{formatUTM(utm)}</span>
          </div>
        </div>

        <div className="pi-section-title">
          Información geográfica{hits.length ? ` · ${hits.length}` : ""}
        </div>
        {hits.length === 0 && (
          <div style={{ fontSize: 11.5, color: "var(--muted-fg)", padding: "4px 0" }}>
            Ninguna capa cubre este punto.
          </div>
        )}
        {hits.map((h, i) => {
          const props = h.feature.properties || {};
          const name = String(props.nombre || props.name || props.id || "Feature");
          return (
            <div className="pi-hit" key={`${h.layerId}-${i}`}>
              <div className="pi-hit-head" onClick={() => onFocus(h)}>
                <span className="pi-hit-layer">{h.layerName}</span>
                <span className={"pi-hit-badge " + h.relation}>
                  {h.relation === "contiene" ? "contiene" : `cercano · ${formatDistance(h.distanceM ?? 0)}`}
                </span>
              </div>
              <div className="pi-hit-name">{name}</div>
              <div className="pi-hit-attrs">
                {Object.entries(props).map(([k, v]) => (
                  <div className="identify-row" key={k}>
                    <span className="k">{k}</span>
                    <span className="v" style={{ fontFamily: typeof v === "number" ? "var(--font-mono)" : "inherit" }}>
                      {typeof v === "number" ? fmtNum(v) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
function LegendCard({ layers, onClose }: { layers: GisLayer[]; onClose: () => void }) {
  return (
    <div className="legend-card">
      <div className="legend-head">
        <span className="ttl">Leyenda</span>
        <button className="icon-btn" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="legend-body">
        {layers.map((layer) => <LegendSection key={layer.id} layer={layer} />)}
      </div>
    </div>
  );
}

function LegendSection({ layer }: { layer: GisLayer }) {
  const swType = layer.geometry === "Point" ? "point" : layer.geometry === "LineString" ? "line" : "";

  if (layer.style.mode === "single") {
    return (
      <div className="legend-section">
        <div className="sn">{layer.name}</div>
        <div className="legend-entry">
          <span className={`sw ${swType}`} style={{ background: layer.style.color }} />
          <span className="lbl">{layer.name}</span>
          <span className="val">{layer.geojson.features.length}</span>
        </div>
      </div>
    );
  }

  if (layer.style.mode === "category" && layer.style.colorBy) {
    const colorBy = layer.style.colorBy;
    const palette = COLOR_RAMPS[layer.style.palette] || COLOR_RAMPS.categorical;
    const counts = categoryCounts(layer.geojson.features.map((f) => (f.properties || {})[colorBy]));
    return (
      <div className="legend-section">
        <div className="sn">{layer.name} · {colorBy}</div>
        {counts.slice(0, 8).map((c, i) => (
          <div className="legend-entry" key={c.label}>
            <span className={`sw ${swType}`} style={{ background: palette[i % palette.length] }} />
            <span className="lbl" title={c.label}>{c.label}</span>
            <span className="val">{c.count}</span>
          </div>
        ))}
      </div>
    );
  }

  if (layer.style.mode === "ramp" && layer.style.colorBy) {
    const colorBy = layer.style.colorBy;
    const ramp = COLOR_RAMPS[layer.style.ramp] || COLOR_RAMPS.greens;
    const classes = layer.style.classes;
    const values = layer.geojson.features.map((f) => (f.properties || {})[colorBy]).filter((v): v is number => typeof v === "number");
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0], max = sorted[sorted.length - 1];
    const breaks: number[] = [];
    if (layer.style.classification === "quantile" || layer.style.classification === "jenks") {
      for (let i = 1; i < classes; i++) breaks.push(sorted[Math.floor((sorted.length * i) / classes)]);
    } else {
      const step = (max - min) / classes;
      for (let i = 1; i < classes; i++) breaks.push(min + step * i);
    }
    const colors: string[] = [];
    for (let i = 0; i < classes; i++) {
      const t = classes === 1 ? 0 : i / (classes - 1);
      colors.push(ramp[Math.round(t * (ramp.length - 1))]);
    }
    const bounds = [min, ...breaks, max];
    return (
      <div className="legend-section">
        <div className="sn">{layer.name} · {colorBy}</div>
        {colors.map((c, i) => (
          <div className="legend-entry" key={i}>
            <span className={`sw ${swType}`} style={{ background: c }} />
            <span className="lbl">{fmtNum(bounds[i])} – {fmtNum(bounds[i + 1])}</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ────────────────────────────────────────────────────────────
function AttributeTablePanel({ layer, onClose, onSelect }: {
  layer: GisLayer;
  onClose: () => void;
  onSelect?: (f: import("geojson").Feature) => void;
}) {
  const schema = inferSchema(layer.geojson.features);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  let rows = layer.geojson.features.map((f, i) => ({ idx: i, f }));
  if (sort) {
    const { key, dir } = sort;
    rows = [...rows].sort((a, b) => {
      const va = (a.f.properties || {})[key] as never, vb = (b.f.properties || {})[key] as never;
      if (va < vb) return dir === "asc" ? -1 : 1;
      if (va > vb) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }

  return (
    <div className="attr-panel">
      <div className="attr-head">
        <div className="l">
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>Tabla de atributos</div>
          <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>
            {layer.name} · {layer.geojson.features.length} filas · {schema.length} columnas
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn" data-tip="Exportar CSV" onClick={() => toast.info("Exportación CSV disponible próximamente.")}><Download size={14} /></button>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
        </div>
      </div>
      <div className="attr-table-wrap">
        <table className="attr-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>#</th>
              {schema.map((col) => (
                <th key={col.key} onClick={() => setSort((s) => (s && s.key === col.key ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: col.key, dir: "asc" }))} style={{ cursor: "pointer" }}>
                  {col.key} <span className="col-type">{col.type}</span>
                  {sort?.key === col.key && (sort.dir === "asc" ? " ↑" : " ↓")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ idx, f }) => (
              <tr key={idx} className={selectedIdx === idx ? "selected" : ""} onClick={() => { setSelectedIdx(idx); onSelect?.(f); }}>
                <td style={{ color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>{idx + 1}</td>
                {schema.map((col) => {
                  const v = (f.properties || {})[col.key];
                  return (
                    <td key={col.key} className={col.type === "numeric" ? "attr-numeric" : ""}>
                      {typeof v === "number" ? fmtNum(v) : String(v ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
