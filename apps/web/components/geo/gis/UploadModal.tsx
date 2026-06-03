"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import * as shp from "shpjs";
import JSZip from "jszip";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { createRasterRemote, type RasterLayerManifest } from "./persistence";
import type { AddLayerInput, GisGeometry } from "./types";

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

function humanSize(bytes: number): string {
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + " KB";
  return bytes + " B";
}

export default function UploadModal({ onClose, onAdd, mapId, onRasterUploaded }: {
  onClose: () => void;
  onAdd: (ds: AddLayerInput) => void | Promise<void>;
  mapId?: string;
  onRasterUploaded?: (m: RasterLayerManifest) => void;
}) {
  const [parsing, setParsing] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Route a selection: a .tif/.tiff (+ optional sidecars) goes to the raster
  // upload (streamed to the NAS, processed server-side); anything else is a
  // shapefile handled in the browser as before.
  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const main = files.find((f) => RASTER_RE.test(f.name));
    if (main) {
      if (!mapId || !onRasterUploaded) {
        toast.error("Guarda el mapa antes de subir ortofotos.");
        return;
      }
      const sidecars = files.filter((f) => f !== main && RASTER_SIDECAR_RE.test(f.name));
      const name = main.name.replace(RASTER_RE, "");
      setUploadPct(0);
      try {
        const manifest = await createRasterRemote(mapId, {
          name,
          files: [main, ...sidecars],
          onProgress: setUploadPct,
        });
        onRasterUploaded(manifest);
        toast.success("Ortofoto subida; procesando en segundo plano…");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo subir la ortofoto.");
        setUploadPct(null);
      }
      return;
    }
    await handleFile(files[0]);
  }

  async function handleFile(file: File) {
    if (!file) return;
    if (!/\.(zip|shp)$/i.test(file.name)) {
      toast.error("Formato no soportado. Sube un .zip con .shp + .shx + .dbf + .prj como mínimo, o un .shp.");
      return;
    }
    setParsing(file.name);
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
      let added = 0;
      for (const { name, fc } of collections) {
        const features = fc.features || [];
        if (features.length === 0) continue;
        await onAdd({
          name,
          filename: file.name,
          geometry: geometryOf(features),
          geojson: { type: "FeatureCollection", features },
          size: humanSize(file.size),
          crs: "EPSG:4326",
          sourceFile: file,
          sourceFormat,
        });
        added++;
      }

      if (added === 0) {
        toast.error("No se encontraron geometrías en el archivo.");
        setParsing(null);
        return;
      }
      toast.success(added === 1 ? "Capa cargada correctamente" : `${added} capas cargadas`);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("No se pudo leer el shapefile. Verifica que el .zip contenga .shp, .shx, .dbf y .prj como mínimo.");
      setParsing(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="h-title">Agregar capa</div>
            <div className="h-sub">Sube un shapefile (.zip con .shp + .shx + .dbf + .prj como mínimo) o una ortofoto</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={14} /></button>
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
                <div className="s">.zip / .shp (vector) · .tif / .tiff {mapId ? "+ sidecars (.tfw/.prj)" : ""} (ráster)</div>
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn subtle" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
