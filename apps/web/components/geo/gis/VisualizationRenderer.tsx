"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Sankey, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import type { Feature } from "geojson";
import type { GeoLayerVisualization, GeoVisualizationDraft } from "@pma/types/geo";
import { COLOR_RAMPS } from "./gis-data";
import { formatNumber, transformVisualization } from "./chart-transform";

type Config = GeoVisualizationDraft | GeoLayerVisualization;

export default function VisualizationRenderer({ config, features, compact = false }: {
  config: Config;
  features: Feature[];
  compact?: boolean;
}) {
  const data = transformVisualization(features, config);
  const palette = COLOR_RAMPS[config.options.palette || "categorical"] || COLOR_RAMPS.categorical;
  const height = compact ? 190 : 300;
  const common = { fontSize: 10, fill: "var(--muted-fg)" };

  if (data.kind === "kpi") return (
    <div className="viz-kpi" style={{ minHeight: compact ? 130 : 220 }}>
      <strong>{formatNumber(data.value)}</strong>
      <span>{data.count} registros considerados</span>
    </div>
  );

  if (data.kind === "table") return (
    <div className="viz-table-wrap" style={{ maxHeight: height }}>
      <table className="viz-table">
        <thead><tr>{data.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{data.rows.map((row, index) => (
          <tr key={index}>{data.columns.map((column) => <td key={column}>{typeof row[column] === "number" ? formatNumber(row[column] as number) : row[column]}</td>)}</tr>
        ))}</tbody>
      </table>
      {!data.rows.length && <div className="empty">Sin datos compatibles</div>}
    </div>
  );

  if (data.kind === "sankey") {
    if (!data.links.length) return <div className="empty">Sin flujos compatibles</div>;
    return (
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <Sankey
            data={{ nodes: data.nodes, links: data.links }}
            nodePadding={18}
            nodeWidth={10}
            linkCurvature={0.55}
            iterations={32}
            margin={{ top: 10, right: 70, bottom: 10, left: 70 }}
          >
            <Tooltip formatter={(value) => formatNumber(Number(value))} />
          </Sankey>
        </ResponsiveContainer>
      </div>
    );
  }

  if (data.kind === "scatter") return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 12, bottom: 10, left: compact ? -18 : 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis type="number" dataKey="x" tick={common} />
          <YAxis type="number" dataKey="y" tick={common} />
          <ZAxis type="number" dataKey="z" range={[35, 240]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={data.rows} fill={palette[0]} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );

  if (data.kind === "histogram") return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data.rows} margin={{ top: 8, right: 8, bottom: compact ? 28 : 45, left: compact ? -22 : 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={common} angle={-25} textAnchor="end" interval="preserveStartEnd" />
          <YAxis tick={common} />
          <Tooltip />
          <Bar dataKey="value" name="Frecuencia" fill={palette[0]} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );

  if (data.kind !== "category" || !data.rows.length) return <div className="empty">Sin datos compatibles</div>;

  if (config.type === "donut") return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data.rows} dataKey="value" nameKey="label" innerRadius="48%" outerRadius="76%" paddingAngle={1}>
            {data.rows.map((row, index) => <Cell key={row.label} fill={palette[index % palette.length]} />)}
          </Pie>
          <Tooltip formatter={(value) => formatNumber(Number(value))} />
          {config.options.showLegend !== false && <Legend wrapperStyle={{ fontSize: 10 }} />}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );

  if (config.type === "line" || config.type === "area") {
    const Chart = config.type === "line" ? LineChart : AreaChart;
    return (
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <Chart data={data.rows} margin={{ top: 8, right: 10, bottom: compact ? 25 : 35, left: compact ? -20 : 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={common} angle={-20} textAnchor="end" interval="preserveStartEnd" />
            <YAxis tick={common} />
            <Tooltip />
            {config.options.showLegend !== false && data.series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
            {data.series.map((series, index) => config.type === "line"
              ? <Line key={series} type="monotone" dataKey={series} stroke={palette[index % palette.length]} dot={false} strokeWidth={2} />
              : <Area key={series} type="monotone" dataKey={series} stroke={palette[index % palette.length]} fill={palette[index % palette.length]} fillOpacity={0.22} />)}
          </Chart>
        </ResponsiveContainer>
      </div>
    );
  }

  const horizontal = config.options.orientation === "horizontal";
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data.rows} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 10, bottom: horizontal ? 5 : 35, left: horizontal ? 18 : -15 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          {horizontal ? <><XAxis type="number" tick={common} /><YAxis type="category" dataKey="label" tick={common} width={75} /></> : <><XAxis dataKey="label" tick={common} angle={-20} textAnchor="end" interval="preserveStartEnd" /><YAxis tick={common} /></>}
          <Tooltip />
          {config.options.showLegend !== false && data.series.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {data.series.map((series, index) => <Bar key={series} dataKey={series} stackId={config.type === "stackedBar" ? "stack" : undefined} fill={palette[index % palette.length]} radius={config.type === "stackedBar" ? 0 : [3, 3, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
