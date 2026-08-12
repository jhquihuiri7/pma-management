import {
  TOGGLE_IDS,
  type BuilderState,
  type TemplateId,
  type ToggleId,
} from "./types";

export interface MapExportTemplate {
  id: TemplateId;
  label: string;
  description: string;
  visible: readonly ToggleId[];
}

const BASIC_VISIBLE = [
  "map",
  "header",
  "hdr_logo",
  "hdr_titulo",
  "hdr_subtitulo",
  "hdr_norte",
  "legend",
  "scalebar",
  "scalenum",
] as const satisfies readonly ToggleId[];

const ANALYSIS_VISIBLE = [
  ...BASIC_VISIBLE,
  "indicators",
  "elevation",
  "landcover",
  "refsys",
  "techinfo",
  "docs",
  "doc_elaborado",
  "doc_fecha",
  "doc_fuente",
] as const satisfies readonly ToggleId[];

export const TEMPLATES: Readonly<Record<TemplateId, MapExportTemplate>> = {
  tecnica: {
    id: "tecnica",
    label: "Técnica completa",
    description: "Carta institucional con todos los módulos cartográficos.",
    visible: TOGGLE_IDS,
  },
  basica: {
    id: "basica",
    label: "Básica",
    description: "Encabezado, leyenda y escalas para una salida rápida.",
    visible: BASIC_VISIBLE,
  },
  analisis: {
    id: "analisis",
    label: "Análisis territorial",
    description: "Añade indicadores, análisis, referencia y documentación.",
    visible: ANALYSIS_VISIBLE,
  },
};

export const TEMPLATE_LIST: readonly MapExportTemplate[] = [
  TEMPLATES.tecnica,
  TEMPLATES.basica,
  TEMPLATES.analisis,
];

/** Returns a complete visibility record; the principal map is always enabled. */
export function templateVisibility(
  template: TemplateId,
): Record<ToggleId, boolean> {
  const enabled = new Set<ToggleId>(TEMPLATES[template].visible);
  enabled.add("map");

  return Object.fromEntries(
    TOGGLE_IDS.map((toggle) => [toggle, enabled.has(toggle)]),
  ) as Record<ToggleId, boolean>;
}

/** Pure reducer helper for applying a preset to the existing editor. */
export function applyTemplate(
  state: BuilderState,
  template: TemplateId,
): BuilderState {
  return {
    ...state,
    template,
    selected: null,
    visible: templateVisibility(template),
    overrides: {},
  };
}
