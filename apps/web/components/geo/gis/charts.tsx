"use client";

import type { Feature } from "geojson";
import { COLOR_RAMPS } from "./gis-data";
import type { ColumnType, SchemaColumn } from "./types";

// ────────────────────────────────────────────────────────────
// Column-type inference — drives which chart is picked
// ────────────────────────────────────────────────────────────
export function inferColumnType(values: unknown[]): ColumnType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "empty";

  const dateRe = /^\d{4}-\d{2}-\d{2}/;
  if (nonNull.every((v) => typeof v === "string" && dateRe.test(v))) return "date";

  if (nonNull.every((v) => typeof v === "boolean")) return "boolean";

  if (nonNull.every((v) => typeof v === "number" && !Number.isNaN(v))) {
    return "numeric";
  }

  return "categorical";
}

export function inferSchema(features: Feature[]): SchemaColumn[] {
  if (!features || features.length === 0) return [];
  // A valid GeoJSON collection may introduce an attribute after the first
  // feature. Keep insertion order while profiling the union of every row.
  const keys = Array.from(new Set(features.flatMap((feature) => Object.keys(feature.properties || {}))));
  return keys.map((key) => {
    const values = features.map((f) => (f.properties || {})[key]);
    const present = values.filter((value) => value !== null && value !== undefined && value !== "");
    return {
      key,
      type: inferColumnType(values),
      values,
      nullCount: values.length - present.length,
      uniqueCount: new Set(present.map((value) => typeof value === "object" ? JSON.stringify(value) : String(value))).size,
      sample: present.slice(0, 5),
    };
  });
}

// ────────────────────────────────────────────────────────────
// Stats helpers
// ────────────────────────────────────────────────────────────
export interface NumStats {
  count: number; min: number; max: number; mean: number; median: number; sum: number;
}

export function numStats(values: unknown[]): NumStats | null {
  const v = values.filter((x): x is number => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const sum = v.reduce((s, x) => s + x, 0);
  const mid = Math.floor(v.length / 2);
  return {
    count: v.length,
    min: v[0],
    max: v[v.length - 1],
    mean: sum / v.length,
    median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2,
    sum,
  };
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "k";
  if (abs >= 10) return n.toFixed(0);
  if (abs >= 1) return n.toFixed(1);
  return n.toFixed(2);
}

export function categoryCounts(values: unknown[]): { label: string; count: number }[] {
  const map = new Map<string, number>();
  values.forEach((v) => {
    if (v === null || v === undefined || v === "") return;
    const k = String(v);
    map.set(k, (map.get(k) || 0) + 1);
  });
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

function EmptyState() {
  return <div className="empty">Sin datos</div>;
}

// ────────────────────────────────────────────────────────────
// Histogram (numeric)
// ────────────────────────────────────────────────────────────
function Histogram({ values, color = "#3f7c5f", bins = 8 }: { values: unknown[]; color?: string; bins?: number }) {
  const nums = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (nums.length === 0) return <EmptyState />;
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min || 1;
  const binW = range / bins;
  const counts = Array(bins).fill(0);
  nums.forEach((v) => {
    const i = Math.min(bins - 1, Math.floor((v - min) / binW));
    counts[i]++;
  });
  const maxCount = Math.max(...counts);

  const W = 280, H = 110, padL = 28, padR = 8, padT = 6, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const bw = innerW / bins;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dash-chart">
      {[0, 0.5, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e7e5e1" strokeWidth="1" />
            <text x={padL - 4} y={y + 3} textAnchor="end" className="axis-label">{Math.round(maxCount * t)}</text>
          </g>
        );
      })}
      {counts.map((c, i) => {
        const h = (c / maxCount) * innerH;
        return <rect key={i} x={padL + i * bw + 1.5} y={padT + innerH - h} width={bw - 3} height={h} fill={color} rx="1.5" />;
      })}
      <text x={padL} y={H - 6} className="axis-label">{fmtNum(min)}</text>
      <text x={W - padR} y={H - 6} className="axis-label" textAnchor="end">{fmtNum(max)}</text>
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
// Horizontal bar chart (categorical)
// ────────────────────────────────────────────────────────────
function CategoryBars({ values, palette }: { values: unknown[]; palette: string[] }) {
  const counts = categoryCounts(values);
  if (counts.length === 0) return <EmptyState />;
  const shown = counts.slice(0, 8);
  const max = Math.max(...shown.map((c) => c.count));

  return (
    <div className="cat-bars">
      {shown.map((c, i) => {
        const pct = (c.count / max) * 100;
        const color = palette[i % palette.length];
        return (
          <div key={c.label} className="cat-row">
            <div className="cat-label" title={c.label}>{c.label}</div>
            <div className="cat-track"><div className="cat-fill" style={{ width: pct + "%", background: color }} /></div>
            <div className="cat-val">{c.count}</div>
          </div>
        );
      })}
      {counts.length > shown.length && <div className="cat-more">+ {counts.length - shown.length} más</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Donut (small categorical, ≤6 unique)
// ────────────────────────────────────────────────────────────
function Donut({ values, palette }: { values: unknown[]; palette: string[] }) {
  const counts = categoryCounts(values);
  if (counts.length === 0) return <EmptyState />;
  const total = counts.reduce((s, c) => s + c.count, 0);
  const R = 42, r = 26, cx = 60, cy = 60;
  let acc = 0;
  const arcs = counts.map((c, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += c.count;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const p = (a: number, rad: number): [number, number] => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x1, y1] = p(start, R), [x2, y2] = p(end, R);
    const [x3, y3] = p(end, r), [x4, y4] = p(start, r);
    return {
      d: `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${large} 0 ${x4} ${y4} Z`,
      color: palette[i % palette.length], label: c.label, count: c.count, pct: c.count / total,
    };
  });

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 120 120" className="donut">
        {arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} />)}
        <text x="60" y="58" textAnchor="middle" className="donut-num">{total}</text>
        <text x="60" y="72" textAnchor="middle" className="donut-sub">total</text>
      </svg>
      <div className="donut-legend">
        {arcs.slice(0, 6).map((a, i) => (
          <div key={i} className="legend-row">
            <span className="legend-sw" style={{ background: a.color }} />
            <span className="legend-label" title={a.label}>{a.label}</span>
            <span className="legend-val">{Math.round(a.pct * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Time series (date column → line)
// ────────────────────────────────────────────────────────────
function TimeSeries({ values, color = "#3f7c5f" }: { values: unknown[]; color?: string }) {
  const yearMap = new Map<string, number>();
  values.forEach((v) => {
    if (!v) return;
    const y = String(v).slice(0, 4);
    yearMap.set(y, (yearMap.get(y) || 0) + 1);
  });
  const data = Array.from(yearMap.entries()).sort().map(([y, c]) => ({ y, c }));
  if (data.length === 0) return <EmptyState />;

  const W = 280, H = 110, padL = 24, padR = 8, padT = 8, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.c));
  const sx = (i: number) => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const sy = (c: number) => padT + innerH - (c / max) * innerH;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${sx(i)} ${sy(d.c)}`).join(" ");
  const area = path + ` L ${sx(data.length - 1)} ${padT + innerH} L ${sx(0)} ${padT + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dash-chart">
      {[0, 0.5, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        return <line key={t} x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e7e5e1" />;
      })}
      <path d={area} fill={color} fillOpacity="0.16" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" />
      {data.map((d, i) => <circle key={i} cx={sx(i)} cy={sy(d.c)} r="2.5" fill={color} />)}
      {data.map((d, i) =>
        i % Math.ceil(data.length / 5) === 0 || i === data.length - 1 ? (
          <text key={i} x={sx(i)} y={H - 6} textAnchor="middle" className="axis-label">{d.y}</text>
        ) : null
      )}
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
// Stat summary card (one big number)
// ────────────────────────────────────────────────────────────
function StatCard({ stats, color }: { stats: NumStats | null; color?: string }) {
  if (!stats) return <EmptyState />;
  return (
    <div className="stat-card">
      <div className="stat-main">
        <div className="stat-big" style={{ color }}>{fmtNum(stats.mean)}</div>
        <div className="stat-sub">promedio</div>
      </div>
      <div className="stat-grid">
        <div><span>mín</span><b>{fmtNum(stats.min)}</b></div>
        <div><span>máx</span><b>{fmtNum(stats.max)}</b></div>
        <div><span>mediana</span><b>{fmtNum(stats.median)}</b></div>
        <div><span>suma</span><b>{fmtNum(stats.sum)}</b></div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Auto-pick the right chart for a column
// ────────────────────────────────────────────────────────────
export function AutoChart({ column, palette = COLOR_RAMPS.categorical, accent = "#3f7c5f" }: { column: SchemaColumn; palette?: string[]; accent?: string }) {
  const { type, values } = column;
  if (type === "numeric") {
    return (
      <div className="dash-stack">
        <StatCard stats={numStats(values)} color={accent} />
        <Histogram values={values} color={accent} />
      </div>
    );
  }
  if (type === "categorical") {
    const uniq = new Set(values.filter((v) => v !== null && v !== "")).size;
    return uniq <= 5 ? <Donut values={values} palette={palette} /> : <CategoryBars values={values} palette={palette} />;
  }
  if (type === "date") return <TimeSeries values={values} color={accent} />;
  return <EmptyState />;
}
