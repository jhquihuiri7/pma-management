// One place that turns a layer's style into what is drawn: the map (GisMap),
// the on-screen legend (GisEditor), the export legend (geo-export-data) and the
// style editor all read classes and symbols from here, so their colors and
// order can't drift apart.
//
// A LayerStyle keeps its original fields (mode, color, palette, …). The optional
// extras below get closer to a QGIS/SLD style: per-value symbols with their own
// legend label, outline color, fill opacity, dashes, a casing under lines, marker
// shapes with a backdrop, and label color/halo/minimum zoom. A style without
// extras draws exactly as before.
//
// Pixel values in the extras are exact (as in an SLD): `strokeWidth` is the
// outline or line width, `size` and `haloSize` are marker diameters. The layer's
// `opacity` still fades everything (fill, outline, line, marker, backdrop).
import { COLOR_RAMPS } from "./gis-data";
import type { GisGeometry, LayerStyle } from "./types";

export const MARKER_SHAPES = ["circle", "square", "triangle", "diamond"] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

export interface SymbolSpec {
  /** Fill (polygons, points) or line color. Ignored at layer level: the mode sets it. */
  color?: string;
  /** 0–1, polygons and points. */
  fillOpacity?: number;
  /** Polygon or marker outline; null draws none. */
  strokeColor?: string | null;
  /** Outline width (polygons, points) or line width, in px. */
  strokeWidth?: number;
  /** Dash pattern in px, as SVG stroke-dasharray ("4 2"); null is solid. */
  dash?: string | null;
  /** Lines: a wider stroke drawn under every line of the layer (road casing). */
  casingColor?: string | null;
  casingWidth?: number;
  marker?: MarkerShape;
  /** Marker diameter in px. */
  size?: number;
  /** Points: a circle drawn behind the marker. */
  haloColor?: string | null;
  haloOpacity?: number;
  haloSize?: number;
}

export interface StyleCategory extends SymbolSpec {
  /** The attribute value, as text ("" matches empty values). */
  value: string;
  /** Legend text; the value when absent. */
  label?: string | null;
  /** Features of this class get no label. */
  noLabel?: boolean;
}

export interface OtherSymbol extends SymbolSpec {
  label?: string | null;
}

export interface LabelStyle {
  color?: string;
  haloColor?: string | null;
  haloWidth?: number;
  size?: number;
  bold?: boolean;
  /** Labels show from this zoom level on; null always. */
  minZoom?: number | null;
}

/** The optional fields a LayerStyle may carry on top of the original ones. */
export interface StyleExtras {
  symbol?: SymbolSpec | null;
  categories?: StyleCategory[] | null;
  otherSymbol?: OtherSymbol | null;
  labelStyle?: LabelStyle | null;
}

export interface ResolvedSymbol {
  geometry: GisGeometry;
  color: string;
  fillOpacity: number;
  strokeColor: string | null;
  strokeOpacity: number;
  strokeWidth: number;
  dash: string | null;
  casingColor: string | null;
  casingWidth: number;
  marker: MarkerShape;
  size: number;
  haloColor: string | null;
  haloOpacity: number;
  haloSize: number;
  /** False when the class asks for no labels. */
  labeled: boolean;
}

export interface SymbolClass {
  key: string;
  label: string;
  count: number;
  symbol: ResolvedSymbol;
  /** The class for values no category lists. */
  other?: boolean;
}

export interface ResolvedLabelStyle {
  color: string;
  haloColor: string | null;
  haloWidth: number;
  size: number;
  bold: boolean;
  minZoom: number | null;
}

export interface Symbolizer {
  field: string | null;
  classes: SymbolClass[];
  symbolFor(props: Record<string, unknown> | null | undefined): ResolvedSymbol;
}

type StyledLayer = { geometry: GisGeometry; style: LayerStyle; name?: string; geojson: { features: Array<{ properties?: Record<string, unknown> | null }> } };

export const EMPTY_VALUE_LABEL = "(sin valor)";
export const OTHER_VALUES_LABEL = "Otros valores";
const OTHER_COLOR = "#b0b0b0";
const NO_VALUE_COLOR = "#888888";

// ── validation ─────────────────────────────────────────────────────────────
// Styles come from the server as free JSON and end up in SVG attributes and
// HTML, so every extra is checked: colors are #rgb/#rrggbb, dashes are numbers.

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const DASH = /^\d+(?:\.\d+)?(?:[ ,]+\d+(?:\.\d+)?){0,7}$/;
const MAX_CATEGORIES = 200;

class StyleError extends Error {}

type Reader = { strict: boolean; where: string };

function fail(r: Reader, what: string): undefined {
  if (r.strict) throw new StyleError(`${what} de ${r.where} no es válido`);
  return undefined;
}

function readColor(v: unknown, r: Reader, what: string, nullable = false): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return nullable ? null : fail(r, what);
  return typeof v === "string" && HEX.test(v) ? v : fail(r, what);
}

function readNumber(v: unknown, r: Reader, what: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fail(r, what);
}

function readText(v: unknown, r: Reader, what: string, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return typeof v === "string" && v.length <= max ? v : fail(r, what);
}

function readObject(v: unknown, r: Reader, what: string): Record<string, unknown> | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  return typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(r, what);
}

function onlyKeys(o: Record<string, unknown>, keys: readonly string[], r: Reader, what: string): void {
  if (r.strict && Object.keys(o).some((k) => !keys.includes(k))) throw new StyleError(`${what} de ${r.where} contiene campos no permitidos`);
}

const SPEC_KEYS = [
  "color", "fillOpacity", "strokeColor", "strokeWidth", "dash", "casingColor", "casingWidth",
  "marker", "size", "haloColor", "haloOpacity", "haloSize",
] as const;

function readSpec(o: Record<string, unknown>, r: Reader): SymbolSpec {
  const out: SymbolSpec = {};
  const color = readColor(o.color, r, "El color");
  if (color) out.color = color;
  const fillOpacity = readNumber(o.fillOpacity, r, "La opacidad del relleno", 0, 1);
  if (fillOpacity !== undefined) out.fillOpacity = fillOpacity;
  const strokeColor = readColor(o.strokeColor, r, "El color del borde", true);
  if (strokeColor !== undefined) out.strokeColor = strokeColor;
  const strokeWidth = readNumber(o.strokeWidth, r, "El grosor del borde", 0, 30);
  if (strokeWidth !== undefined) out.strokeWidth = strokeWidth;
  if (o.dash !== undefined) {
    if (o.dash === null || o.dash === "") out.dash = null;
    else if (typeof o.dash === "string" && DASH.test(o.dash.trim())) out.dash = o.dash.trim().replace(/[ ,]+/g, " ");
    else fail(r, "El patrón de guiones");
  }
  const casingColor = readColor(o.casingColor, r, "El color del contorno de la línea", true);
  if (casingColor !== undefined) out.casingColor = casingColor;
  const casingWidth = readNumber(o.casingWidth, r, "El grosor del contorno de la línea", 0, 40);
  if (casingWidth !== undefined) out.casingWidth = casingWidth;
  if (o.marker !== undefined) {
    if (typeof o.marker === "string" && (MARKER_SHAPES as readonly string[]).includes(o.marker)) out.marker = o.marker as MarkerShape;
    else fail(r, "La forma del símbolo");
  }
  const size = readNumber(o.size, r, "El tamaño del símbolo", 0, 100);
  if (size !== undefined) out.size = size;
  const haloColor = readColor(o.haloColor, r, "El color del fondo del símbolo", true);
  if (haloColor !== undefined) out.haloColor = haloColor;
  const haloOpacity = readNumber(o.haloOpacity, r, "La opacidad del fondo del símbolo", 0, 1);
  if (haloOpacity !== undefined) out.haloOpacity = haloOpacity;
  const haloSize = readNumber(o.haloSize, r, "El tamaño del fondo del símbolo", 0, 120);
  if (haloSize !== undefined) out.haloSize = haloSize;
  return out;
}

function readExtras(style: Record<string, unknown>, strict: boolean, where: string): StyleExtras {
  const r: Reader = { strict, where };
  const out: StyleExtras = {};
  const symbol = readObject(style.symbol, r, "El símbolo");
  if (symbol) {
    onlyKeys(symbol, SPEC_KEYS, r, "El símbolo");
    out.symbol = readSpec(symbol, r);
  } else if (symbol === null) out.symbol = null;

  if (style.categories !== undefined && style.categories !== null) {
    if (!Array.isArray(style.categories) || style.categories.length > MAX_CATEGORIES) {
      fail(r, "La lista de categorías");
    } else {
      const categories: StyleCategory[] = [];
      for (const item of style.categories) {
        const o = readObject(item, r, "Una categoría");
        if (!o) continue;
        onlyKeys(o, [...SPEC_KEYS, "value", "label", "noLabel"], r, "Una categoría");
        const value = readText(o.value, r, "El valor de una categoría", 500);
        if (typeof value !== "string") { if (strict) fail(r, "El valor de una categoría"); continue; }
        const cat: StyleCategory = { ...readSpec(o, r), value };
        const label = readText(o.label, r, "La etiqueta de una categoría", 200);
        if (label !== undefined) cat.label = label;
        if (o.noLabel !== undefined) {
          if (typeof o.noLabel === "boolean") cat.noLabel = o.noLabel;
          else fail(r, "La opción sin etiqueta de una categoría");
        }
        categories.push(cat);
      }
      out.categories = categories;
    }
  } else if (style.categories === null) out.categories = null;

  const other = readObject(style.otherSymbol, r, "El símbolo de otros valores");
  if (other) {
    onlyKeys(other, [...SPEC_KEYS, "label"], r, "El símbolo de otros valores");
    const spec: OtherSymbol = readSpec(other, r);
    const label = readText(other.label, r, "La etiqueta de otros valores", 200);
    if (label !== undefined) spec.label = label;
    out.otherSymbol = spec;
  } else if (other === null) out.otherSymbol = null;

  const label = readObject(style.labelStyle, r, "El estilo de etiquetas");
  if (label) {
    onlyKeys(label, ["color", "haloColor", "haloWidth", "size", "bold", "minZoom"], r, "El estilo de etiquetas");
    const ls: LabelStyle = {};
    const color = readColor(label.color, r, "El color de las etiquetas");
    if (color) ls.color = color;
    const haloColor = readColor(label.haloColor, r, "El halo de las etiquetas", true);
    if (haloColor !== undefined) ls.haloColor = haloColor;
    const haloWidth = readNumber(label.haloWidth, r, "El grosor del halo de las etiquetas", 0, 10);
    if (haloWidth !== undefined) ls.haloWidth = haloWidth;
    const size = readNumber(label.size, r, "El tamaño de las etiquetas", 6, 40);
    if (size !== undefined) ls.size = size;
    if (label.bold !== undefined) {
      if (typeof label.bold === "boolean") ls.bold = label.bold;
      else fail(r, "La negrita de las etiquetas");
    }
    if (label.minZoom === null) ls.minZoom = null;
    else {
      const minZoom = readNumber(label.minZoom, r, "El zoom mínimo de las etiquetas", 0, 22);
      if (minZoom !== undefined) ls.minZoom = minZoom;
    }
    out.labelStyle = ls;
  } else if (label === null) out.labelStyle = null;
  return out;
}

/** The extras of a style, dropping whatever is malformed (for drawing). */
export function styleExtras(style: LayerStyle): StyleExtras {
  return readExtras(style as unknown as Record<string, unknown>, false, "la capa");
}

/** The extras of a style, or an error naming what is wrong (for imports). */
export function parseStyleExtras(style: Record<string, unknown>, where: string): StyleExtras {
  try {
    return readExtras(style, true, where);
  } catch (err) {
    if (err instanceof StyleError) throw new Error(err.message);
    throw err;
  }
}

export const STYLE_EXTRA_KEYS = ["symbol", "categories", "otherSymbol", "labelStyle"] as const;

// ── resolution ─────────────────────────────────────────────────────────────

function clamp01(v: unknown, fallback = 1): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

function finite(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** What a style without extras draws (the Geoportal's historic look). */
function baseSymbol(geometry: GisGeometry, style: LayerStyle, color: string): ResolvedSymbol {
  const opacity = clamp01(style.opacity);
  const common = {
    geometry, color, dash: null, casingColor: null, casingWidth: 0, marker: "circle" as MarkerShape,
    haloColor: null, haloOpacity: opacity, haloSize: 0, labeled: true,
  };
  if (geometry === "Point") {
    return { ...common, fillOpacity: opacity, strokeColor: "#ffffff", strokeOpacity: opacity, strokeWidth: 1.5, size: finite(style.size, 6) * 2 };
  }
  if (geometry === "LineString") {
    return { ...common, fillOpacity: 0, strokeColor: null, strokeOpacity: opacity, strokeWidth: finite(style.strokeWidth, 1) + 1.5, size: 0 };
  }
  return { ...common, fillOpacity: opacity * 0.78, strokeColor: "#333333", strokeOpacity: opacity, strokeWidth: finite(style.strokeWidth, 1), size: 0 };
}

function applySpec(sym: ResolvedSymbol, spec: SymbolSpec | null | undefined, opacity: number, withColor: boolean): ResolvedSymbol {
  if (!spec) return sym;
  const out = { ...sym };
  if (withColor && spec.color) out.color = spec.color;
  if (spec.fillOpacity !== undefined) out.fillOpacity = clamp01(spec.fillOpacity) * opacity;
  if (spec.strokeColor !== undefined) out.strokeColor = spec.strokeColor;
  if (spec.strokeWidth !== undefined) out.strokeWidth = spec.strokeWidth;
  if (spec.dash !== undefined) out.dash = spec.dash;
  if (spec.casingColor !== undefined) out.casingColor = spec.casingColor;
  if (spec.casingWidth !== undefined) out.casingWidth = spec.casingWidth;
  if (spec.marker) out.marker = spec.marker;
  if (spec.size !== undefined) out.size = spec.size;
  if (spec.haloColor !== undefined) out.haloColor = spec.haloColor;
  if (spec.haloOpacity !== undefined) out.haloOpacity = clamp01(spec.haloOpacity) * opacity;
  if (spec.haloSize !== undefined) out.haloSize = spec.haloSize;
  return out;
}

/** The text key of an attribute value: "" for empty, else its string form. */
export function categoryKey(raw: unknown): string {
  return raw === null || raw === undefined || raw === "" ? "" : String(raw);
}

function rampBreaks(sorted: number[], classes: number, classification: LayerStyle["classification"]): number[] {
  const breaks: number[] = [];
  if (classification === "quantile" || classification === "jenks") {
    for (let i = 1; i < classes; i++) breaks.push(sorted[Math.floor((sorted.length * i) / classes)]);
  } else {
    const min = sorted[0], max = sorted[sorted.length - 1];
    const step = (max - min) / classes;
    for (let i = 1; i < classes; i++) breaks.push(min + step * i);
  }
  return breaks;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 }).format(n);
}

export function buildSymbolizer(layer: StyledLayer): Symbolizer {
  const { style, geometry } = layer;
  const extras = styleExtras(style);
  const opacity = clamp01(style.opacity);
  const features = layer.geojson.features;
  const make = (color: string, spec?: SymbolSpec | null, noLabel?: boolean): ResolvedSymbol => {
    const sym = applySpec(applySpec(baseSymbol(geometry, style, color), extras.symbol, opacity, false), spec, opacity, true);
    return noLabel ? { ...sym, labeled: false } : sym;
  };
  const field = style.mode !== "single" && style.colorBy ? style.colorBy : null;

  if (style.mode === "category" && field) {
    const counts = new Map<string, number>();
    for (const f of features) {
      const k = categoryKey((f.properties || {})[field]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    if (extras.categories && extras.categories.length) {
      const byKey = new Map<string, SymbolClass>();
      const classes: SymbolClass[] = [];
      for (const c of extras.categories) {
        if (byKey.has(c.value)) continue; // first rule wins, as in an SLD
        const cls: SymbolClass = {
          key: c.value,
          label: c.label || (c.value === "" ? EMPTY_VALUE_LABEL : c.value),
          count: counts.get(c.value) ?? 0,
          symbol: make(c.color ?? style.color, c, c.noLabel),
        };
        byKey.set(c.value, cls);
        classes.push(cls);
      }
      const otherCount = Array.from(counts.entries()).reduce((n, [k, v]) => (byKey.has(k) ? n : n + v), 0);
      const other: SymbolClass = {
        key: "\u0000other",
        label: extras.otherSymbol?.label || OTHER_VALUES_LABEL,
        count: otherCount,
        symbol: make(extras.otherSymbol?.color ?? OTHER_COLOR, extras.otherSymbol),
        other: true,
      };
      if (otherCount > 0) classes.push(other);
      return {
        field,
        classes,
        symbolFor: (props) => (byKey.get(categoryKey((props || {})[field])) ?? other).symbol,
      };
    }
    // Palette: colors by first appearance in the data.
    const palette = COLOR_RAMPS[style.palette] || COLOR_RAMPS.categorical;
    const classes: SymbolClass[] = [];
    const byKey = new Map<string, SymbolClass>();
    for (const f of features) {
      const k = categoryKey((f.properties || {})[field]);
      if (byKey.has(k)) continue;
      const cls: SymbolClass = {
        key: k, label: k === "" ? EMPTY_VALUE_LABEL : k, count: counts.get(k) ?? 0,
        symbol: make(palette[byKey.size % palette.length]),
      };
      byKey.set(k, cls);
      classes.push(cls);
    }
    const fallback = make(NO_VALUE_COLOR);
    return { field, classes, symbolFor: (props) => byKey.get(categoryKey((props || {})[field]))?.symbol ?? fallback };
  }

  if (style.mode === "ramp" && field) {
    const values = features.map((f) => (f.properties || {})[field]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const fallback = make(NO_VALUE_COLOR);
    if (values.length) {
      const ramp = COLOR_RAMPS[style.ramp] || COLOR_RAMPS.greens;
      const sorted = [...values].sort((a, b) => a - b);
      const n = Math.max(1, Math.round(finite(style.classes, 5)));
      const breaks = rampBreaks(sorted, n, style.classification);
      const bounds = [sorted[0], ...breaks, sorted[sorted.length - 1]];
      const classes: SymbolClass[] = Array.from({ length: n }, (_, i) => {
        const t = n === 1 ? 0 : i / (n - 1);
        return { key: String(i), label: `${fmt(bounds[i])} – ${fmt(bounds[i + 1])}`, count: 0, symbol: make(ramp[Math.round(t * (ramp.length - 1))]) };
      });
      const classOf = (v: number) => { let i = 0; while (i < breaks.length && v > breaks[i]) i++; return i; };
      for (const v of values) classes[classOf(v)].count++;
      return {
        field,
        classes,
        symbolFor: (props) => {
          const v = (props || {})[field];
          return typeof v === "number" && Number.isFinite(v) ? classes[classOf(v)].symbol : fallback;
        },
      };
    }
  }

  const single = make(style.color);
  return {
    field: null,
    classes: [{ key: "", label: layer.name ?? "", count: features.length, symbol: single }],
    symbolFor: () => single,
  };
}

export function resolveLabelStyle(style: LayerStyle): ResolvedLabelStyle {
  const ls = styleExtras(style).labelStyle ?? {};
  return {
    color: ls.color ?? "#1a1a1a",
    haloColor: ls.haloColor === undefined ? "#ffffff" : ls.haloColor,
    haloWidth: ls.haloWidth ?? 3,
    size: ls.size ?? 10.5,
    bold: ls.bold ?? true,
    minZoom: ls.minZoom ?? null,
  };
}

/** True when some class of the layer draws a casing under its lines. */
export function hasCasing(sym: Symbolizer): boolean {
  return sym.classes.some((c) => c.symbol.casingColor && c.symbol.casingWidth > 0);
}

// ── geometry helpers ───────────────────────────────────────────────────────

type Pos = number[];

function ringArea(ring: Pos[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

function ringCentroid(ring: Pos[]): [number, number] | null {
  const a = ringArea(ring);
  if (!a) {
    if (!ring.length) return null;
    const s = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [s[0] / ring.length, s[1] / ring.length];
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

function lineLength(line: Pos[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return d;
}

/** Where a feature's label goes, as [lat, lng]: the point, the centroid of the largest polygon, the middle of the longest line. */
export function labelAnchor(geometry: { type: string; coordinates?: unknown } | null | undefined): [number, number] | null {
  if (!geometry || !("coordinates" in geometry)) return null;
  const c = geometry.coordinates as unknown;
  let lngLat: number[] | null = null;
  if (geometry.type === "Point") lngLat = c as Pos;
  else if (geometry.type === "MultiPoint") lngLat = (c as Pos[])[0] ?? null;
  else if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const polys = (geometry.type === "Polygon" ? [c] : c) as Pos[][][];
    let best: Pos[] | null = null, bestArea = -1;
    for (const p of polys) {
      const outer = p[0];
      if (!outer?.length) continue;
      const a = Math.abs(ringArea(outer));
      if (a > bestArea) { bestArea = a; best = outer; }
    }
    lngLat = best ? ringCentroid(best) : null;
  } else if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    const lines = (geometry.type === "LineString" ? [c] : c) as Pos[][];
    let best: Pos[] | null = null, bestLen = -1;
    for (const l of lines) {
      const len = lineLength(l);
      if (l.length && len > bestLen) { bestLen = len; best = l; }
    }
    lngLat = best ? best[Math.floor(best.length / 2)] : null;
  }
  if (!lngLat || !Number.isFinite(lngLat[0]) || !Number.isFinite(lngLat[1])) return null;
  return [lngLat[1], lngLat[0]];
}

// ── markers ────────────────────────────────────────────────────────────────

const num = (n: number) => Math.round(n * 100) / 100;

function shapePath(shape: MarkerShape, cx: number, cy: number, d: number): string {
  const r = d / 2;
  switch (shape) {
    case "square":
      return `<rect x="${num(cx - r)}" y="${num(cy - r)}" width="${num(d)}" height="${num(d)}"`;
    case "diamond":
      return `<polygon points="${num(cx)},${num(cy - r)} ${num(cx + r)},${num(cy)} ${num(cx)},${num(cy + r)} ${num(cx - r)},${num(cy)}"`;
    case "triangle": {
      // Equilateral, pointing up, centred on its centroid (as QGIS draws it).
      const h = d * 0.866;
      return `<polygon points="${num(cx)},${num(cy - (2 * h) / 3)} ${num(cx + r)},${num(cy + h / 3)} ${num(cx - r)},${num(cy + h / 3)}"`;
    }
    default:
      return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"`;
  }
}

/** SVG markup of a point symbol (colors are validated hex), and its box size in px. */
export function markerSvg(sym: ResolvedSymbol): { svg: string; box: number } {
  const stroke = sym.strokeColor && sym.strokeWidth > 0 ? sym.strokeWidth : 0;
  const halo = sym.haloColor && sym.haloSize > 0 ? sym.haloSize : 0;
  const box = Math.ceil(Math.max(sym.size + stroke * 2, halo, 4));
  const c = num(box / 2);
  const parts: string[] = [];
  if (halo) parts.push(`<circle cx="${c}" cy="${c}" r="${num(halo / 2)}" fill="${sym.haloColor}" fill-opacity="${num(sym.haloOpacity)}"/>`);
  const strokeAttrs = stroke
    ? ` stroke="${sym.strokeColor}" stroke-width="${num(stroke)}" stroke-opacity="${num(sym.strokeOpacity)}" stroke-linejoin="round"`
    : "";
  parts.push(`${shapePath(sym.marker, c, c, sym.size)} fill="${sym.color}" fill-opacity="${num(sym.fillOpacity)}"${strokeAttrs}/>`);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">${parts.join("")}</svg>`, box };
}

/** Escapes text for HTML (labels come from attribute values). */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

/** Shallow helpers for the style editor. */
export function withExtras(style: LayerStyle, patch: Partial<StyleExtras>): LayerStyle {
  const next = { ...style, ...patch } as LayerStyle & StyleExtras;
  for (const k of STYLE_EXTRA_KEYS) if (next[k] === undefined || next[k] === null) delete next[k];
  return next;
}
