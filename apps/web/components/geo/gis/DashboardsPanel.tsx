"use client";

import { useState } from "react";
import { COLOR_RAMPS } from "./gis-data";
import { inferSchema, AutoChart, numStats, categoryCounts } from "./charts";
import type { GisLayer, SchemaColumn } from "./types";

function DashCard({ column, accent, palette }: { column: SchemaColumn; accent: string; palette: string[] }) {
  const typeLabel = column.type === "numeric" ? "numérico" : column.type === "categorical" ? "categoría" : column.type === "date" ? "fecha" : "—";
  const stats = column.type === "numeric" ? numStats(column.values) : null;
  const uniq = column.type === "categorical" ? categoryCounts(column.values).length : null;
  const dateRange = column.type === "date"
    ? (() => {
        const vs = column.values.filter(Boolean).map((v) => String(v).slice(0, 10)).sort();
        return vs.length ? `${vs[0].slice(0, 4)} → ${vs[vs.length - 1].slice(0, 4)}` : "—";
      })()
    : null;

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div className="dh-l">
          <div className="dh-title">{column.key}</div>
          <div className="dh-sub">
            {stats && <span>{stats.count} valores</span>}
            {uniq !== null && <span>{uniq} categorías</span>}
            {dateRange && <span>{dateRange}</span>}
          </div>
        </div>
        <div className={`type-pill t-${column.type}`}>{typeLabel}</div>
      </div>
      <div className="dash-card-body">
        <AutoChart column={column} palette={palette} accent={accent} />
      </div>
    </div>
  );
}

function ColumnsView({ schema }: { schema: SchemaColumn[] }) {
  const thStyle: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--muted-fg)", fontWeight: 600, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 };
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--background)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left" }}>Columna</th>
            <th style={{ ...thStyle, textAlign: "left" }}>Tipo</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Únicos</th>
          </tr>
        </thead>
        <tbody>
          {schema.map((c) => {
            const uniq = new Set(c.values.filter((v) => v !== null && v !== "")).size;
            return (
              <tr key={c.key}>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-mono)" }}>{c.key}</td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)" }}><span className={`type-pill t-${c.type}`}>{c.type}</span></td>
                <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", textAlign: "right", fontFamily: "var(--font-mono)" }}>{uniq}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MetadataView({ layer, schema }: { layer: GisLayer; schema: SchemaColumn[] }) {
  const rows: [string, string | number][] = [
    ["Nombre", layer.name],
    ["Archivo", layer.filename || "—"],
    ["Geometría", layer.geometry],
    ["Features", layer.geojson.features.length],
    ["Columnas", schema.length],
    ["CRS", layer.crs || "EPSG:4326"],
    ["Tamaño", layer.size || "—"],
    ["Cargado", new Date(layer.loadedAt || Date.now()).toLocaleString("es-EC")],
  ];
  return (
    <div style={{ fontSize: 11.5 }}>
      <div className="dash-card">
        <div className="dash-card-head"><div className="dh-l"><div className="dh-title">Información de capa</div></div></div>
        <div className="dash-card-body">
          {rows.map(([k, v]) => (
            <div key={k} className="identify-row">
              <span className="k">{k}</span>
              <span className="v" style={{ fontFamily: typeof v === "string" && /^\d/.test(v) ? "var(--font-mono)" : "inherit" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardsPanel({ layer }: { layer: GisLayer | undefined }) {
  const [tab, setTab] = useState<"dashboards" | "columns" | "metadata">("dashboards");

  if (!layer) {
    return (
      <div className="right-rail">
        <div className="rail-header">
          <div>
            <div className="rail-title">Dashboards</div>
            <div className="rail-sub">Selecciona una capa para ver visualizaciones</div>
          </div>
        </div>
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted-fg)", fontSize: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 8, color: "var(--border-strong)" }}>◇</div>
          Carga una capa y selecciónala desde el panel izquierdo para generar dashboards automáticos según el tipo de cada columna.
        </div>
      </div>
    );
  }

  const schema = inferSchema(layer.geojson.features);
  const accent = layer.style.color || "#3f7c5f";
  const palette = COLOR_RAMPS[layer.style.palette || "categorical"] || COLOR_RAMPS.categorical;

  return (
    <div className="right-rail">
      <div className="dash-source">
        <div className="ds-name">
          <span className="geom-dot" style={{ background: layer.style.color }} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{layer.name}</span>
          <span className="type-pill" style={{ textTransform: "none", letterSpacing: 0 }}>{layer.geometry}</span>
        </div>
        <div className="ds-meta">
          <span>{layer.geojson.features.length} features</span>
          <span>{schema.length} cols</span>
          <span>{layer.crs || "EPSG:4326"}</span>
        </div>
      </div>

      <div className="dash-tabs">
        <button className={"dash-tab" + (tab === "dashboards" ? " active" : "")} onClick={() => setTab("dashboards")}>Dashboards</button>
        <button className={"dash-tab" + (tab === "columns" ? " active" : "")} onClick={() => setTab("columns")}>Columnas</button>
        <button className={"dash-tab" + (tab === "metadata" ? " active" : "")} onClick={() => setTab("metadata")}>Metadata</button>
      </div>

      <div className="dash-body">
        {tab === "dashboards" && schema.filter((c) => c.type !== "empty").map((col) => (
          <DashCard key={col.key} column={col} accent={accent} palette={palette} />
        ))}
        {tab === "columns" && <ColumnsView schema={schema} />}
        {tab === "metadata" && <MetadataView layer={layer} schema={schema} />}
      </div>
    </div>
  );
}
