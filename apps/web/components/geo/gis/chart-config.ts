import type {
  GeoChartAggregation,
  GeoChartFieldRole,
  GeoChartType,
  GeoLayerVisualization,
  GeoVisualizationDraft,
} from "@pma/types/geo";
import type { ColumnType, SchemaColumn } from "./types";

export type FieldKind = "any" | "dimension" | "numeric" | "date";

export interface ChartRoleDefinition {
  role: GeoChartFieldRole;
  label: string;
  kind: FieldKind;
  min: number;
  max: number;
  aggregations?: GeoChartAggregation[];
  hint: string;
}
export interface ChartDefinition {
  type: GeoChartType;
  name: string;
  description: string;
  icon: string;
  roles: ChartRoleDefinition[];
}

const MEASURE_AGGREGATIONS: GeoChartAggregation[] = ["sum", "avg", "min", "max", "count", "distinctCount"];

export const CHART_DEFINITIONS: ChartDefinition[] = [
  { type: "kpi", name: "Indicador", description: "Un valor agregado destacado", icon: "123", roles: [
    { role: "value", label: "Valor", kind: "numeric", min: 1, max: 1, aggregations: MEASURE_AGGREGATIONS, hint: "Columna numérica a resumir" },
  ] },
  { type: "bar", name: "Barras", description: "Comparar categorías", icon: "▥", roles: [
    { role: "dimension", label: "Categoría", kind: "dimension", min: 1, max: 1, hint: "Eje de categorías" },
    { role: "measure", label: "Valor", kind: "numeric", min: 0, max: 1, aggregations: MEASURE_AGGREGATIONS, hint: "Vacío para contar registros" },
  ] },
  { type: "stackedBar", name: "Barras apiladas", description: "Comparar categorías y grupos", icon: "▤", roles: [
    { role: "dimension", label: "Categoría", kind: "dimension", min: 1, max: 1, hint: "Eje de categorías" },
    { role: "series", label: "Agrupar por", kind: "dimension", min: 1, max: 1, hint: "Segmentos de cada barra" },
    { role: "measure", label: "Valor", kind: "numeric", min: 0, max: 1, aggregations: MEASURE_AGGREGATIONS, hint: "Vacío para contar registros" },
  ] },
  { type: "line", name: "Línea", description: "Evolución o secuencia", icon: "⌁", roles: [
    { role: "dimension", label: "Eje temporal/categoría", kind: "any", min: 1, max: 1, hint: "Orden de los puntos" },
    { role: "measure", label: "Valor", kind: "numeric", min: 0, max: 1, aggregations: MEASURE_AGGREGATIONS, hint: "Vacío para contar registros" },
    { role: "series", label: "Serie", kind: "dimension", min: 0, max: 1, hint: "Líneas adicionales" },
  ] },
  { type: "area", name: "Área", description: "Evolución con volumen", icon: "◒", roles: [
    { role: "dimension", label: "Eje temporal/categoría", kind: "any", min: 1, max: 1, hint: "Orden de los puntos" },
    { role: "measure", label: "Valor", kind: "numeric", min: 0, max: 1, aggregations: MEASURE_AGGREGATIONS, hint: "Vacío para contar registros" },
  ] },
  { type: "donut", name: "Donut", description: "Participación por categoría", icon: "◉", roles: [
    { role: "dimension", label: "Categoría", kind: "dimension", min: 1, max: 1, hint: "Secciones del anillo" },
    { role: "measure", label: "Valor", kind: "numeric", min: 0, max: 1, aggregations: MEASURE_AGGREGATIONS, hint: "Vacío para contar registros" },
  ] },
  { type: "histogram", name: "Histograma", description: "Distribución numérica", icon: "▥", roles: [
    { role: "value", label: "Valor", kind: "numeric", min: 1, max: 1, hint: "Columna que se distribuirá" },
  ] },
  { type: "scatter", name: "Dispersión", description: "Relación entre dos medidas", icon: "∴", roles: [
    { role: "x", label: "Eje X", kind: "numeric", min: 1, max: 1, hint: "Primera medida" },
    { role: "y", label: "Eje Y", kind: "numeric", min: 1, max: 1, hint: "Segunda medida" },
    { role: "size", label: "Tamaño", kind: "numeric", min: 0, max: 1, hint: "Tamaño opcional de burbuja" },
    { role: "series", label: "Color", kind: "dimension", min: 0, max: 1, hint: "Agrupación opcional" },
  ] },
  { type: "sankey", name: "Sankey", description: "Flujos entre dos o más niveles", icon: "⇝", roles: [
    { role: "level", label: "Niveles del flujo", kind: "dimension", min: 2, max: 5, hint: "Orden: origen → intermedios → destino" },
    { role: "weight", label: "Peso", kind: "numeric", min: 0, max: 1, aggregations: ["sum", "avg", "min", "max"], hint: "Vacío para contar rutas" },
  ] },
  { type: "table", name: "Tabla resumen", description: "Agrupar y resumir registros", icon: "▦", roles: [
    { role: "dimension", label: "Agrupar por", kind: "dimension", min: 1, max: 3, hint: "Una o más dimensiones" },
    { role: "measure", label: "Valor", kind: "numeric", min: 0, max: 3, aggregations: MEASURE_AGGREGATIONS, hint: "Vacío para contar registros" },
  ] },
];

export const CHART_BY_TYPE = Object.fromEntries(CHART_DEFINITIONS.map((definition) => [definition.type, definition])) as Record<GeoChartType, ChartDefinition>;

export function acceptsColumn(kind: FieldKind, type: ColumnType): boolean {
  if (kind === "numeric") return type === "numeric";
  if (kind === "date") return type === "date";
  if (kind === "dimension") return type === "categorical" || type === "date" || type === "boolean" || type === "numeric";
  return type !== "empty";
}

export function chartAvailable(definition: ChartDefinition, schema: SchemaColumn[]): boolean {
  return definition.roles.every((role) => {
    if (role.min === 0) return true;
    const compatible = schema.filter((column) => acceptsColumn(role.kind, column.type)).length;
    return compatible >= role.min;
  });
}

export function defaultVisualization(type: GeoChartType, position: number): GeoVisualizationDraft {
  const definition = CHART_BY_TYPE[type];
  return {
    type,
    title: definition.name,
    position,
    bindings: [],
    options: { palette: "categorical", sort: "desc", topN: 12, showLegend: true, showLabels: false, bins: 8 },
    version: 1,
  };
}

export function validateVisualization(config: GeoVisualizationDraft | GeoLayerVisualization, schema: SchemaColumn[]): string[] {
  const definition = CHART_BY_TYPE[config.type];
  if (!definition) return ["El tipo de visualización no está disponible"];
  const byKey = new Map(schema.map((column) => [column.key, column]));
  const errors: string[] = [];
  for (const role of definition.roles) {
    const bindings = config.bindings.filter((binding) => binding.role === role.role);
    if (bindings.length < role.min) errors.push(`${role.label}: agrega ${role.min === 1 ? "un campo" : `al menos ${role.min} campos`}`);
    if (bindings.length > role.max) errors.push(`${role.label}: admite máximo ${role.max}`);
    for (const binding of bindings) {
      const column = byKey.get(binding.field);
      if (!column) errors.push(`La columna “${binding.field}” ya no existe`);
      else if (!acceptsColumn(role.kind, column.type)) errors.push(`“${binding.field}” no es compatible con ${role.label}`);
      if (binding.aggregation && role.aggregations && !role.aggregations.includes(binding.aggregation)) {
        errors.push(`La agregación de “${binding.field}” no es válida`);
      }
    }
  }
  if (!config.title.trim()) errors.push("Escribe un título");
  return errors;
}
