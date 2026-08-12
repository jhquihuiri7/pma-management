/** Physical paper format used by the cartographic sheet. */
export type Format = "A4" | "A3";

/** `h` is horizontal (landscape) and `v` is vertical (portrait). */
export type Orientation = "h" | "v";

export type Mode = "auto" | "custom";
export type TemplateId = "tecnica" | "basica" | "analisis";

export const BLOCK_IDS = [
  "header",
  "map",
  "legend",
  "locator",
  "indicators",
  "elevation",
  "landcover",
  "scalebar",
  "scalenum",
  "refsys",
  "techinfo",
  "docs",
] as const;

export type BlockId = (typeof BLOCK_IDS)[number];

export const CHILD_TOGGLE_IDS = [
  "hdr_logo",
  "hdr_titulo",
  "hdr_subtitulo",
  "hdr_norte",
  "map_coords",
  "doc_elaborado",
  "doc_revisado",
  "doc_fecha",
  "doc_fuente",
  "doc_precision",
  "doc_notas",
] as const;

export type ChildToggleId = (typeof CHILD_TOGGLE_IDS)[number];
export type ToggleId = BlockId | ChildToggleId;

export const TOGGLE_IDS: readonly ToggleId[] = [
  ...BLOCK_IDS,
  ...CHILD_TOGGLE_IDS,
];

export const BLOCK_NAMES: Readonly<Record<BlockId, string>> = {
  header: "Encabezado",
  map: "Mapa principal",
  legend: "Leyenda",
  locator: "Mapa de ubicación",
  indicators: "Indicadores territoriales",
  elevation: "Perfil de elevación",
  landcover: "Cobertura del suelo",
  scalebar: "Escala gráfica",
  scalenum: "Escala numérica",
  refsys: "Sistema de referencia",
  techinfo: "Información técnica",
  docs: "Bloque documental",
};

const TOGGLE_PARENTS: Readonly<Record<ToggleId, BlockId>> = {
  header: "header",
  hdr_logo: "header",
  hdr_titulo: "header",
  hdr_subtitulo: "header",
  hdr_norte: "header",
  map: "map",
  map_coords: "map",
  legend: "legend",
  locator: "locator",
  indicators: "indicators",
  elevation: "elevation",
  landcover: "landcover",
  scalebar: "scalebar",
  scalenum: "scalenum",
  refsys: "refsys",
  techinfo: "techinfo",
  docs: "docs",
  doc_elaborado: "docs",
  doc_revisado: "docs",
  doc_fecha: "docs",
  doc_fuente: "docs",
  doc_precision: "docs",
  doc_notas: "docs",
};

/** Maps a panel toggle (including child toggles) to its selectable canvas block. */
export function parentBlock(toggle: ToggleId): BlockId {
  return TOGGLE_PARENTS[toggle];
}

export function isBlockId(value: string): value is BlockId {
  return (BLOCK_IDS as readonly string[]).includes(value);
}

/** Rectangle in millimetres relative to the top-left corner of the sheet. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TitleAlignment = "left" | "center" | "right";
export type LocatorLevel = "ecuador" | "galapagos" | "santacruz";
export type ScaleBarStyle = "barras" | "linea" | "bloque";
export type GridDensity = "baja" | "media" | "alta";

export interface IndicatorVisibility {
  escala: boolean;
  area: boolean;
  precision: boolean;
  hoja: boolean;
}

export interface BuilderOptions {
  titleSize: number;
  titleAlign: TitleAlignment;
  titleBold: boolean;
  logoSize: number;
  legendColumns: 1 | 2;
  legendExcludedLayerIds: string[];
  locatorLevels: LocatorLevel[];
  locatorLabels: boolean;
  locatorBorder: boolean;
  indicators: IndicatorVisibility;
  elevationHasData: boolean;
  scaleStyle: ScaleBarStyle;
  gridDensity: GridDensity;
}

/** Creates fresh nested values so reducer state never shares mutable arrays. */
export function createDefaultBuilderOptions(): BuilderOptions {
  return {
    titleSize: 21,
    titleAlign: "center",
    titleBold: true,
    logoSize: 14,
    legendColumns: 1,
    legendExcludedLayerIds: [],
    locatorLevels: ["ecuador", "galapagos", "santacruz"],
    locatorLabels: true,
    locatorBorder: true,
    indicators: {
      escala: true,
      area: true,
      precision: true,
      hoja: true,
    },
    elevationHasData: true,
    scaleStyle: "barras",
    gridDensity: "media",
  };
}

export interface BuilderState {
  format: Format;
  orientation: Orientation;
  mode: Mode;
  /** Multiplier applied on top of the fit-to-workspace scale. */
  zoom: number;
  selected: ToggleId | null;
  template: TemplateId;
  showMargins: boolean;
  visible: Record<ToggleId, boolean>;
  /** User geometry exists only in custom mode. The map is never overridden. */
  overrides: Partial<Record<BlockId, Rect>>;
  texts: Record<string, string>;
  options: BuilderOptions;
  extent: "actual" | "capas" | "seleccion" | "geometria";
}

/** Geometry returned by the layout engine: map is mandatory, modules are conditional. */
export type LayoutRects = { map: Rect } & Partial<
  Record<Exclude<BlockId, "map">, Rect>
>;
