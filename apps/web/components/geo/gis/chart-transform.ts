import type { Feature } from "geojson";
import type { GeoChartAggregation, GeoChartFieldBinding, GeoLayerVisualization, GeoVisualizationDraft } from "@pma/types/geo";

export interface CategoryDatum { label: string; value: number; [series: string]: string | number }
export interface CategoryChartData { kind: "category"; rows: CategoryDatum[]; series: string[] }
export interface KpiChartData { kind: "kpi"; value: number; count: number }
export interface HistogramChartData { kind: "histogram"; rows: Array<{ label: string; value: number }> }
export interface ScatterChartData { kind: "scatter"; rows: Array<{ x: number; y: number; z?: number; group?: string }> }
export interface SankeyChartData { kind: "sankey"; nodes: Array<{ name: string }>; links: Array<{ source: number; target: number; value: number }> }
export interface TableChartData { kind: "table"; columns: string[]; rows: Array<Record<string, string | number>> }
export type VisualizationData = CategoryChartData | KpiChartData | HistogramChartData | ScatterChartData | SankeyChartData | TableChartData;

type Config = GeoVisualizationDraft | GeoLayerVisualization;

function binding(config: Config, role: GeoChartFieldBinding["role"]): GeoChartFieldBinding | undefined {
  return config.bindings.find((item) => item.role === role);
}

function bindings(config: Config, role: GeoChartFieldBinding["role"]): GeoChartFieldBinding[] {
  return config.bindings.filter((item) => item.role === role);
}

function raw(feature: Feature, field: string): unknown {
  return feature.properties?.[field];
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function labelOf(value: unknown, fieldBinding?: GeoChartFieldBinding): string {
  if (isMissing(value)) return "Sin dato";
  if (fieldBinding?.dateGrain && typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getUTCFullYear();
      if (fieldBinding.dateGrain === "year") return String(year);
      if (fieldBinding.dateGrain === "quarter") return `${year}-T${Math.floor(date.getUTCMonth() / 3) + 1}`;
      if (fieldBinding.dateGrain === "month") return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }
  }
  return String(value);
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function aggregate(values: unknown[], aggregation: GeoChartAggregation = "sum"): number {
  if (aggregation === "count") return values.length;
  if (aggregation === "distinctCount") return new Set(values.filter((value) => !isMissing(value)).map(String)).size;
  const numbers = values.map(numeric).filter((value): value is number => value !== null);
  if (!numbers.length) return 0;
  if (aggregation === "avg") return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0);
}

function filtered(features: Feature[], fields: string[], includeNulls = false): Feature[] {
  return includeNulls ? features : features.filter((feature) => fields.every((field) => !isMissing(raw(feature, field))));
}

function categoryData(features: Feature[], config: Config): CategoryChartData {
  const dimension = binding(config, "dimension")!;
  const measure = binding(config, "measure");
  const seriesBinding = binding(config, "series");
  const fields = [dimension.field, ...(measure ? [measure.field] : []), ...(seriesBinding ? [seriesBinding.field] : [])];
  const groups = new Map<string, { label: string; series: string; values: unknown[] }>();
  for (const feature of filtered(features, fields, config.options.includeNulls)) {
    const label = labelOf(raw(feature, dimension.field), dimension);
    const series = seriesBinding ? labelOf(raw(feature, seriesBinding.field), seriesBinding) : "value";
    const key = JSON.stringify([label, series]);
    const group = groups.get(key) ?? { label, series, values: [] };
    group.values.push(measure ? raw(feature, measure.field) : 1);
    groups.set(key, group);
  }
  const rowsByLabel = new Map<string, CategoryDatum>();
  const series = new Set<string>();
  for (const group of Array.from(groups.values())) {
    const value = measure ? aggregate(group.values, measure.aggregation ?? "sum") : group.values.length;
    const row: CategoryDatum = rowsByLabel.get(group.label) ?? { label: group.label, value: 0 };
    if (seriesBinding) row[group.series] = value;
    row.value += value;
    rowsByLabel.set(group.label, row);
    if (seriesBinding) series.add(group.series);
  }
  let rows = Array.from(rowsByLabel.values());
  const sort = config.type === "line" || config.type === "area" ? (config.options.sort === "none" ? "none" : "asc") : config.options.sort;
  if (sort === "asc") rows.sort((a, b) => config.type === "line" || config.type === "area" ? a.label.localeCompare(b.label) : a.value - b.value);
  if (sort === "desc") rows.sort((a, b) => b.value - a.value);
  const topN = config.options.topN ?? 12;
  if (topN > 0 && rows.length > topN) {
    const kept = rows.slice(0, topN);
    const other: CategoryDatum = { label: "Otros", value: 0 };
    for (const row of rows.slice(topN)) {
      other.value += row.value;
      for (const key of Array.from(series)) other[key] = Number(other[key] ?? 0) + Number(row[key] ?? 0);
    }
    rows = [...kept, other];
  }
  return { kind: "category", rows, series: seriesBinding ? Array.from(series).slice(0, 12) : ["value"] };
}

function kpiData(features: Feature[], config: Config): KpiChartData {
  const value = binding(config, "value")!;
  const values = filtered(features, [value.field], config.options.includeNulls).map((feature) => raw(feature, value.field));
  return { kind: "kpi", value: aggregate(values, value.aggregation ?? "sum"), count: values.length };
}

function histogramData(features: Feature[], config: Config): HistogramChartData {
  const valueBinding = binding(config, "value")!;
  const values = features.map((feature) => numeric(raw(feature, valueBinding.field))).filter((value): value is number => value !== null);
  if (!values.length) return { kind: "histogram", rows: [] };
  const min = Math.min(...values), max = Math.max(...values);
  const count = Math.max(3, Math.min(30, config.options.bins ?? 8));
  const width = (max - min || 1) / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    label: `${formatNumber(min + index * width)}–${formatNumber(min + (index + 1) * width)}`,
    value: 0,
  }));
  for (const value of values) bins[Math.min(count - 1, Math.floor((value - min) / width))].value += 1;
  return { kind: "histogram", rows: bins };
}

function scatterData(features: Feature[], config: Config): ScatterChartData {
  const x = binding(config, "x")!, y = binding(config, "y")!;
  const size = binding(config, "size"), series = binding(config, "series");
  return {
    kind: "scatter",
    rows: features.flatMap((feature) => {
      const xv = numeric(raw(feature, x.field)), yv = numeric(raw(feature, y.field));
      if (xv === null || yv === null) return [];
      const z = size ? numeric(raw(feature, size.field)) ?? undefined : undefined;
      return [{ x: xv, y: yv, z, group: series ? labelOf(raw(feature, series.field), series) : undefined }];
    }).slice(0, 5_000),
  };
}

function sankeyData(features: Feature[], config: Config): SankeyChartData {
  const levels = bindings(config, "level");
  const weight = binding(config, "weight");
  const nodeIndex = new Map<string, number>();
  const nodes: Array<{ name: string }> = [];
  const linkWeights = new Map<string, { source: number; target: number; values: unknown[] }>();
  const fields = [...levels.map((level) => level.field), ...(weight ? [weight.field] : [])];
  for (const feature of filtered(features, fields, config.options.includeNulls)) {
    const ids = levels.map((level, index) => {
      const label = labelOf(raw(feature, level.field), level);
      const id = `${index}:${label}`;
      if (!nodeIndex.has(id)) {
        nodeIndex.set(id, nodes.length);
        nodes.push({ name: label });
      }
      return nodeIndex.get(id)!;
    });
    for (let index = 0; index < ids.length - 1; index += 1) {
      const key = `${ids[index]}>${ids[index + 1]}`;
      const link = linkWeights.get(key) ?? { source: ids[index], target: ids[index + 1], values: [] };
      link.values.push(weight ? raw(feature, weight.field) : 1);
      linkWeights.set(key, link);
    }
  }
  const links = Array.from(linkWeights.values()).map((link) => ({
    source: link.source,
    target: link.target,
    value: weight ? Math.max(0, aggregate(link.values, weight.aggregation ?? "sum")) : link.values.length,
  })).filter((link) => link.value > 0);
  return { kind: "sankey", nodes, links };
}

function tableData(features: Feature[], config: Config): TableChartData {
  const dimensions = bindings(config, "dimension"), measures = bindings(config, "measure");
  const groups = new Map<string, { labels: string[]; values: unknown[][]; count: number }>();
  for (const feature of filtered(features, dimensions.map((item) => item.field), config.options.includeNulls)) {
    const labels = dimensions.map((item) => labelOf(raw(feature, item.field), item));
    const key = JSON.stringify(labels);
    const group = groups.get(key) ?? { labels, values: measures.map(() => []), count: 0 };
    measures.forEach((measure, index) => group.values[index].push(raw(feature, measure.field)));
    group.count += 1;
    groups.set(key, group);
  }
  const measureNames = measures.length ? measures.map((item) => `${item.aggregation ?? "sum"}(${item.field})`) : ["Conteo"];
  const columns = [...dimensions.map((item) => item.field), ...measureNames];
  let rows = Array.from(groups.values()).map((group) => Object.fromEntries([
    ...dimensions.map((item, index) => [item.field, group.labels[index]] as const),
    ...(measures.length
      ? measures.map((item, index) => [measureNames[index], aggregate(group.values[index], item.aggregation ?? "sum")] as const)
      : [["Conteo", group.count] as const]),
  ]));
  rows = rows.slice(0, Math.max(1, config.options.topN ?? 20));
  return { kind: "table", columns, rows };
}

export function transformVisualization(features: Feature[], config: Config): VisualizationData {
  if (config.type === "kpi") return kpiData(features, config);
  if (config.type === "histogram") return histogramData(features, config);
  if (config.type === "scatter") return scatterData(features, config);
  if (config.type === "sankey") return sankeyData(features, config);
  if (config.type === "table") return tableData(features, config);
  return categoryData(features, config);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 }).format(value);
}
