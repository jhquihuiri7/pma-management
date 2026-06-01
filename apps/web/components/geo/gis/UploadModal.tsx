"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import * as shp from "shpjs";
import JSZip from "jszip";
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { SAMPLE_DATASETS } from "./gis-data";
import GeomGlyph from "./GeomGlyph";
import type { AddLayerInput, GisGeometry } from "./types";

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

export default function UploadModal({ onClose, onAdd, alreadyAdded }: {
  onClose: () => void;
  onAdd: (ds: AddLayerInput) => void | Promise<void>;
  alreadyAdded: string[];
}) {
  const [parsing, setParsing] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
            <div className="h-sub">Sube un shapefile (.zip con .shp + .shx + .dbf + .prj como mínimo) o selecciona del catálogo</div>
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
          ) : (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".zip,.shp"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
              <div
                className={"upload-drop" + (dragOver ? " drag-over" : "")}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              >
                <div className="ic">⤓</div>
                <div className="t">Arrastra .shp / .zip aquí</div>
                <div className="s">.zip con .shp + .shx + .dbf + .prj como mínimo · máx 50 MB</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 10px" }}>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>O ELIGE UNA MUESTRA</span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <div className="sample-list">
                {SAMPLE_DATASETS.map((ds) => (
                  <div
                    key={ds.id}
                    className={"sample-item" + (alreadyAdded.includes(ds.id) ? " added" : "")}
                    onClick={async () => {
                      setParsing(ds.name);
                      try {
                        await onAdd({ id: ds.id, name: ds.name, filename: ds.filename, geometry: ds.geometry, geojson: ds.geojson, size: ds.size, crs: ds.crs, sourceFormat: "sample" });
                        onClose();
                      } catch {
                        setParsing(null);
                      }
                    }}
                  >
                    <div className="geom-glyph"><GeomGlyph type={ds.geometry} color="#525252" /></div>
                    <div>
                      <div className="sample-name">{ds.name}</div>
                      <div className="sample-meta">{ds.filename} · {ds.feature_count} feat · {ds.geometry} · {ds.crs}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted-fg)", fontFamily: "var(--font-mono)" }}>
                      {alreadyAdded.includes(ds.id) ? "Agregado ✓" : ds.size}
                    </div>
                  </div>
                ))}
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
