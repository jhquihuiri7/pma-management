"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import * as shp from "shpjs";
import JSZip from "jszip";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { createRasterRemote, type RasterLayerManifest } from "./persistence";
import type { AddLayerInput, AddLayerResult, GisGeometry } from "./types";
import { apiErrorMessage } from "@/lib/api-client";

const RASTER_RE = /\.(tiff?)$/i;
const RASTER_SIDECAR_RE = /\.(tfw|wld|prj|ovr|cpg|tab|xml)$/i;

function geometryOf(features: Feature[]): GisGeometry {
  const t = features.find((f) => f.geometry)?.geometry?.type || "Polygon";
  if (t === "Point" || t === "MultiPoint") return "Point";
  if (t === "LineString" || t === "MultiLineString") return "LineString";
  return "Polygon";
}

interface ParsedCollection {
  name: string;
  fc: FeatureCollection;
}

// shpjs v6's built-in unzip ("but-unzip") throws on many real-world .zip files,
// so we unzip with JSZip and feed the .shp/.dbf/.prj buffers to shpjs directly.
async function parseZipWithJsZip(buffer: ArrayBuffer): Promise<ParsedCollection[]> {
  const zip = await JSZip.loadAsync(buffer);
  const groups: Record<string, Partial<Record<"shp" | "dbf" | "prj" | "cpg", JSZip.JSZipObject>>> = {};
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const m = /^(.*)\.(shp|dbf|prj|cpg)$/i.exec(path);
    if (!m) return;
    const base = m[1];
    const ext = m[2].toLowerCase() as "shp" | "dbf" | "prj" | "cpg";
    (groups[base] ||= {})[ext] = entry;
  });

  const out: ParsedCollection[] = [];
  for (const [base, g] of Object.entries(groups)) {
    if (!g.shp) continue;
    const shpBuf = await g.shp.async("arraybuffer");
    const prjStr = g.prj ? await g.prj.async("string") : undefined;
    const geometries = shp.parseShp(shpBuf, prjStr) as Geometry[];
    let properties: GeoJsonProperties[];
    if (g.dbf) {
      const dbfBuf = await g.dbf.async("arraybuffer");
      const cpgBuf = g.cpg ? await g.cpg.async("arraybuffer") : undefined;
      properties = shp.parseDbf(dbfBuf, cpgBuf as never);
    } else {
      properties = geometries.map(() => ({}));
    }
    const fc = shp.combine([geometries, properties]) as FeatureCollection;
    out.push({ name: base.split("/").pop() || base, fc });
  }
  return out;
}

// Shapefile zips are tiny; orthophoto zips are huge. Only load a zip into memory
// to inspect it when it's small enough that doing so is cheap — above this size a
// .zip is, in practice, never a shapefile, so route it straight to the raster
// channel (the server/worker rejects it cleanly if it isn't a GeoTIFF archive).
const ZIP_PEEK_MAX_BYTES = 50 * 1024 * 1024;

/** Decide whether a .zip is an orthophoto archive (contains a .tif) vs a shapefile. */
async function isRasterZip(file: File): Promise<boolean> {
  if (file.size > ZIP_PEEK_MAX_BYTES) return true;
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const names = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
    if (names.some((p) => RASTER_RE.test(p))) return true; // has a GeoTIFF → raster
    return false; // a .shp (or anything else) → handled as a shapefile
  } catch {
    return false;
  }
}

function humanSize(bytes: number): string {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + " KB";
  return bytes + " B";
}

export default function UploadModal({ onClose, onAdd, mapId, onRasterUploaded }: {
  onClose: () => void;
  onAdd: (ds: AddLayerInput) => AddLayerResult | Promise<AddLayerResult>;
  mapId?: string;
  onRasterUploaded?: (m: RasterLayerManifest) => void;
}) {
  const [parsing, setParsing] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rasterAbortRef = useRef<AbortController | null>(null);
  const processingRef = useRef(false);

  function closeModal() {
    if (parsing) return;
    rasterAbortRef.current?.abort();
    onClose();
  }

  // Stream a .tif (+ optional sidecars) or a .zip holding an orthophoto to the
  // NAS for server-side COG processing.
  async function uploadRaster(name: string, files: File[]) {
    if (!mapId || !onRasterUploaded) {
      toast.error("Guarda el mapa antes de subir ortofotos.");
      return;
    }
    if (rasterAbortRef.current) return;
    const controller = new AbortController();
    rasterAbortRef.current = controller;
    setUploadPct(0);
    try {
      const manifest = await createRasterRemote(mapId, {
        name,
        files,
        onProgress: setUploadPct,
        signal: controller.signal,
      });
      onRasterUploaded(manifest);
      toast.success(manifest.status === "processing"
        ? "Ortofoto guardada; procesamiento iniciado"
        : "Ortofoto guardada y en cola de procesamiento");
      onClose();
    } catch (err) {
      if (!controller.signal.aborted) {
        toast.error(apiErrorMessage(err, "No se pudo subir la ortofoto"));
      }
      setUploadPct(null);
    } finally {
      if (rasterAbortRef.current === controller) rasterAbortRef.current = null;
    }
  }

  // Route a selection: a loose .tif/.tiff (+ optional sidecars) — or a .zip that
  // contains a .tif — goes to the raster upload (streamed to the NAS, processed
  // server-side); any other .zip/.shp is a shapefile handled in the browser.
  async function handleFiles(fileList: FileList | File[]) {
    if (processingRef.current) return;
    processingRef.current = true;
    const files = Array.from(fileList);
    if (files.length === 0) {
      processingRef.current = false;
      return;
    }

    try {
      const main = files.find((f) => RASTER_RE.test(f.name));
      if (main) {
        const sidecars = files.filter((f) => f !== main && RASTER_SIDECAR_RE.test(f.name));
        await uploadRaster(main.name.replace(RASTER_RE, ""), [main, ...sidecars]);
        return;
      }

      // A single .zip might be an orthophoto archive (.tif inside) rather than a
      // shapefile — peek inside to decide.
      const zip = files.length === 1 && /\.zip$/i.test(files[0].name) ? files[0] : null;
      if (zip && (await isRasterZip(zip))) {
        await uploadRaster(zip.name.replace(/\.zip$/i, ""), [zip]);
        return;
      }

      await handleFile(files[0]);
    } finally {
      processingRef.current = false;
    }
  }

  async function handleFile(file: File) {
    if (!file) return;
    if (!/\.(zip|shp)$/i.test(file.name)) {
      toast.error("Formato no soportado. Sube un .zip con .shp + .shx + .dbf + .prj como mínimo, o un .shp.");
      return;
    }
    setParsing(file.name);
    let persistedAdded = 0;
    let temporaryAdded = 0;
    try {
      const buffer = await file.arrayBuffer();
      let collections: ParsedCollection[] = [];

      if (/\.zip$/i.test(file.name)) {
        collections = await parseZipWithJsZip(buffer);
        // Fallback to shpjs' own loader if no shapefile groups were found.
        if (collections.length === 0) {
          const result = await shp.getShapefile(buffer);
          collections = (Array.isArray(result) ? result : [result]).map((fc, i) => ({
            name: `${file.name.replace(/\.zip$/i, "")}${Array.isArray(result) && result.length > 1 ? ` (${i + 1})` : ""}`,
            fc: fc as FeatureCollection,
          }));
        }
      } else {
        // Bare .shp (no attribute table) — geometry only.
        const geometries = shp.parseShp(buffer) as import("geojson").Geometry[];
        const fc = shp.combine([geometries, geometries.map(() => ({}))]) as FeatureCollection;
        collections = [{ name: file.name.replace(/\.shp$/i, ""), fc }];
      }

      const sourceFormat = /\.zip$/i.test(file.name) ? "shapefile" : file.name.replace(/.*\./, "").toLowerCase();
      for (const { name, fc } of collections) {
        const features = fc.features || [];
        if (features.length === 0) continue;
        const result = await onAdd({
          name,
          filename: file.name,
          geometry: geometryOf(features),
          geojson: { type: "FeatureCollection", features },
          size: humanSize(file.size),
          crs: "EPSG:4326",
          sourceFile: file,
          sourceFormat,
        });
        if (result.persisted) persistedAdded++;
        else temporaryAdded++;
      }

      const added = persistedAdded + temporaryAdded;
      if (added === 0) {
        toast.error("No se encontraron geometrías en el archivo.");
        setParsing(null);
        return;
      }
      if (persistedAdded > 0) {
        toast.success(persistedAdded === 1
          ? "Capa guardada correctamente"
          : `${persistedAdded} capas guardadas correctamente`);
      }
      if (temporaryAdded > 0) {
        toast.warning(temporaryAdded === 1
          ? "Se agregó una capa temporal; no está guardada"
          : `${temporaryAdded} capas son temporales y no están guardadas`);
      }
      onClose();
    } catch (err) {
      if (persistedAdded > 0) {
        toast.warning(`${persistedAdded} capas quedaron guardadas antes del fallo`);
      }
      toast.error(apiErrorMessage(err, "No se pudo leer o guardar el shapefile"));
      setParsing(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="h-title">Agregar capa</div>
            <div className="h-sub">Sube un shapefile (.zip con .shp + .shx + .dbf + .prj como mínimo) o una ortofoto (.tif/.tiff o .zip que la contenga)</div>
          </div>
          <button className="icon-btn" onClick={closeModal} disabled={!!parsing}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {parsing ? (
            <div style={{ padding: "10px 4px 24px" }}>
              <div style={{ fontSize: 12.5, marginBottom: 14 }}>
                <b>Procesando shapefile…</b>
                <div style={{ color: "var(--muted-fg)", fontFamily: "var(--font-mono)", fontSize: 11, marginTop: 6 }}>{parsing}</div>
              </div>
              <div style={{ background: "var(--muted)", height: 6, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: "70%", background: "var(--foreground)", animation: "gis-fade-in 0.4s ease" }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 8, fontFamily: "var(--font-mono)" }}>
                Leyendo geometría y tabla de atributos…
              </div>
            </div>
          ) : uploadPct !== null ? (
            <div style={{ padding: "10px 4px 24px" }}>
              <div style={{ fontSize: 12.5, marginBottom: 14 }}>
                <b>Subiendo ortofoto…</b>
                <div style={{ color: "var(--muted-fg)", fontFamily: "var(--font-mono)", fontSize: 11, marginTop: 6 }}>{uploadPct}%</div>
              </div>
              <div style={{ background: "var(--muted)", height: 6, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${uploadPct}%`, background: "var(--foreground)", transition: "width 0.2s ease" }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-fg)", marginTop: 8, fontFamily: "var(--font-mono)" }}>
                No cierres esta ventana. El COG se generará en segundo plano.
              </div>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".zip,.shp,.tif,.tiff,.tfw,.wld,.prj,.ovr,.cpg"
                multiple
                style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ""; }}
              />
              <div
                className={"upload-drop" + (dragOver ? " drag-over" : "")}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); }}
              >
                <div className="ic">⤓</div>
                <div className="t">Arrastra un shapefile o una ortofoto</div>
                <div className="s">.zip / .shp (vector) · .tif / .tiff / .zip {mapId ? "+ sidecars (.tfw/.prj)" : ""} (ráster)</div>
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn subtle" onClick={closeModal}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
