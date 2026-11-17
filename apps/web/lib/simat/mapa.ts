// SIMAT-GAL · Visor cartográfico sobre la capa base del IGM, portado de la
// vista previa («SIMAT-GAL · Vista previa», mapa.js). Canvas para la geometría
// de las islas y botones accesibles para las estaciones. Desplazamiento,
// acercamiento, escala y coordenadas al estilo del GIS del geoportal.
// Solo se llama desde efectos del cliente.

export interface GeoGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: GeoGeometry[];
}
export interface GeoFeature {
  type: string;
  properties?: Record<string, unknown> | null;
  geometry: GeoGeometry | null;
}
export interface MapaEstacion {
  id: string;
  nombre: string;
  isla: string;
  lat: number;
  lon: number;
  pasoMin: number;
  activa: boolean;
  fuente: string;
}
export interface MapaOpciones {
  variant: "hero" | "panel" | "visor";
  island: string;
  /** Polígonos IGM (public/simat/islas.json); null mientras cargan. */
  base: GeoFeature[] | null;
  stations: MapaEstacion[];
  selected: string | null;
  live: boolean;
  latest: string;
  latestShort: string;
  onStation?: (id: string) => void;
}

type Bbox = [number, number, number, number];
interface Poly {
  rings: Float64Array[];
  bbox: Bbox;
}
interface Label {
  name: string;
  lon: number;
  lat: number;
  area: number;
}
interface Prepared {
  polys: Poly[];
  labels: Label[];
}
interface Projection {
  scale: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
  lon0: number;
  lat0: number;
  x: (lon: number) => number;
  y: (lat: number) => number;
  lon: (px: number) => number;
  lat: (py: number) => number;
}
interface Theme {
  ocean: [string, string, string];
  dots: string;
  grid: string;
  gridText: string;
  land: [string, string];
  coast: string;
  glow: string;
  label: string;
  halo: string;
  station: string;
  inactive: string;
  ring: string;
}
interface MapState {
  el: HTMLElement;
  opts: MapaOpciones;
  canvas: HTMLCanvasElement;
  markers: HTMLElement;
  info: HTMLElement;
  coords: HTMLElement;
  hint: HTMLElement;
  focus: { x: number; y: number; w: number };
  P?: Projection;
  ro?: ResizeObserver;
  hintTimer?: ReturnType<typeof setTimeout>;
}

const CENTERS: Record<string, [number, number, number]> = {
  "Santa Cruz": [-90.37, -0.61, 1.52],
  "San Cristóbal": [-89.47, -0.83, 2],
  Isabela: [-91.36, -0.42, 1.81],
  Floreana: [-90.47, -1.29, 1.28],
  "Todas las islas": [-90.56, -0.65, 3.12],
};
const SCHEMA: number[][][] = [
  [[-91.65, 0.03], [-91.52, 0.12], [-91.35, 0.01], [-91.29, -0.18], [-91.11, -0.3], [-91.05, -0.5], [-91.14, -0.56], [-91.02, -0.69], [-90.95, -0.83], [-91.12, -1.03], [-91.39, -1.02], [-91.51, -0.86], [-91.4, -0.64], [-91.48, -0.48], [-91.63, -0.35], [-91.58, -0.23], [-91.67, -0.1]],
  [[-91.66, -0.29], [-91.49, -0.34], [-91.52, -0.52], [-91.68, -0.52], [-91.78, -0.44]],
  [[-90.62, -0.52], [-90.43, -0.46], [-90.24, -0.51], [-90.15, -0.63], [-90.25, -0.75], [-90.42, -0.77], [-90.57, -0.68]],
  [[-90.93, -0.15], [-90.79, -0.14], [-90.67, -0.27], [-90.75, -0.36], [-90.93, -0.32], [-91.0, -0.23]],
  [[-90.38, -0.42], [-90.27, -0.42], [-90.25, -0.51], [-90.36, -0.51]],
  [[-90.54, -1.21], [-90.39, -1.21], [-90.39, -1.35], [-90.51, -1.38], [-90.59, -1.3]],
  [[-89.69, -0.91], [-89.56, -0.81], [-89.44, -0.74], [-89.32, -0.71], [-89.25, -0.79], [-89.43, -0.91], [-89.62, -0.97]],
  [[-89.75, -1.32], [-89.62, -1.33], [-89.6, -1.4], [-89.76, -1.43]],
  [[-90.04, -0.55], [-90.0, -0.56], [-89.98, -0.62], [-90.07, -0.64]],
];
const SCHEMA_LABELS: [string, number, number][] = [
  ["Isabela", -91.35, -0.18],
  ["Santa Cruz", -90.4, -0.6],
  ["Floreana", -90.48, -1.29],
  ["San Cristóbal", -89.47, -0.83],
  ["Santiago", -90.83, -0.24],
];
const NAMES: Record<string, string> = { "San Cristobal": "San Cristóbal", "Santa Fé": "Santa Fe", Rabida: "Rábida", Bartolome: "Bartolomé" };
const THEMES: Record<"oscuro" | "claro", Theme> = {
  oscuro: {
    ocean: ["#0d4b46", "#072f2c", "#041e1c"],
    dots: "rgba(204,251,241,.075)",
    grid: "rgba(153,246,228,.075)",
    gridText: "rgba(204,251,241,.5)",
    land: ["#2d5a52", "#21463f"],
    coast: "rgba(94,234,212,.8)",
    glow: "rgba(45,212,191,.16)",
    label: "rgba(240,253,250,.92)",
    halo: "rgba(4,30,28,.9)",
    station: "#199e70",
    inactive: "#94a3b8",
    ring: "#ffffff",
  },
  claro: {
    ocean: ["#eef8f6", "#e1f1ed", "#d3e8e3"],
    dots: "rgba(15,118,110,.06)",
    grid: "rgba(15,118,110,.09)",
    gridText: "rgba(15,94,89,.6)",
    land: ["#fbfcf8", "#eef3ea"],
    coast: "rgba(15,118,110,.6)",
    glow: "rgba(13,148,136,.09)",
    label: "#134e4a",
    halo: "rgba(255,255,255,.92)",
    station: "#0d9488",
    inactive: "#94a3b8",
    ring: "#ffffff",
  },
};

const view: { zoom: number; dx: number; dy: number; theme: "oscuro" | "claro" } = { zoom: 1, dx: 0, dy: 0, theme: "oscuro" };
let themeLoaded = false;
let prepared: { key: string; data: Prepared } | null = null;
let map: MapState | null = null;
let pendingInfo: string | null = null;
let lastIsland: string | null = null;
let entered = false;
let raf = 0;

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  layers:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const nf = (v: number, d = 2) => new Intl.NumberFormat("es-EC", { maximumFractionDigits: d }).format(v);

/* ---------- geometría ---------- */
function prepare(features: GeoFeature[]): Prepared {
  const key = `igm|${features.length}`;
  if (prepared?.key === key) return prepared.data;
  const polys: Poly[] = [];
  const named = new Map<string, Label>();
  const bboxOf = (arr: Float64Array): Bbox => {
    let a = Infinity;
    let b = Infinity;
    let c = -Infinity;
    let d = -Infinity;
    for (let i = 0; i < arr.length; i += 2) {
      const x = arr[i];
      const y = arr[i + 1];
      if (x < a) a = x;
      if (x > c) c = x;
      if (y < b) b = y;
      if (y > d) d = y;
    }
    return [a, b, c, d];
  };
  const flat = (coords: number[][]) => {
    const out = new Float64Array(coords.length * 2);
    coords.forEach((p, i) => {
      out[i * 2] = p[0];
      out[i * 2 + 1] = p[1];
    });
    return out;
  };
  const ringStats = (r: Float64Array) => {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i + 3 < r.length; i += 2) {
      const c = r[i] * r[i + 3] - r[i + 2] * r[i + 1];
      a += c;
      cx += (r[i] + r[i + 2]) * c;
      cy += (r[i + 1] + r[i + 3]) * c;
    }
    a /= 2;
    return a ? { area: Math.abs(a), x: cx / (6 * a), y: cy / (6 * a) } : { area: 0, x: r[0], y: r[1] };
  };
  const walk = (g: GeoGeometry | null, props: Record<string, unknown>) => {
    if (!g) return;
    if (g.type === "Polygon") {
      const rings = (g.coordinates as number[][][]).map(flat);
      if (!rings.length) return;
      polys.push({ rings, bbox: bboxOf(rings[0]) });
      if (typeof props.nombre === "string" && props.tipo === "Isla") {
        const s = ringStats(rings[0]);
        const name = NAMES[props.nombre] || props.nombre;
        const prev = named.get(name);
        if (!prev || prev.area < s.area) named.set(name, { name, lon: s.x, lat: s.y, area: s.area });
      }
    } else if (g.type === "MultiPolygon") {
      (g.coordinates as number[][][][]).forEach((part) => walk({ type: "Polygon", coordinates: part }, props));
    } else if (g.type === "GeometryCollection") {
      g.geometries?.forEach((part) => walk(part, props));
    }
  };
  for (const f of features) walk(f.geometry, f.properties || {});
  const data = { polys, labels: Array.from(named.values()).sort((a, b) => b.area - a.area) };
  prepared = { key, data };
  return data;
}

function projection(w: number, h: number): Projection {
  const m = map as MapState;
  const [lon0, lat0, span] = CENTERS[m.opts.island] || CENTERS["Todas las islas"];
  const f = m.focus;
  const scale = Math.min((w * f.w) / span, h / (span * 0.62)) * view.zoom;
  const cx = lon0 + view.dx;
  const cy = lat0 + view.dy;
  const ox = w * f.x;
  const oy = h * f.y;
  return {
    scale,
    ox,
    oy,
    w,
    h,
    lon0,
    lat0,
    x: (lon) => ox + (lon - cx) * scale,
    y: (lat) => oy - (lat - cy) * scale,
    lon: (px) => cx + (px - ox) / scale,
    lat: (py) => cy - (py - oy) / scale,
  };
}

function inView(b: Bbox, P: Projection) {
  return P.x(b[2]) >= -40 && P.x(b[0]) <= P.w + 40 && P.y(b[1]) >= -40 && P.y(b[3]) <= P.h + 40;
}

function addRing(path: Path2D, r: Float64Array, P: Projection, close: boolean) {
  const n = r.length;
  if (n < 4) return;
  const x0 = P.x(r[0]);
  const y0 = P.y(r[1]);
  path.moveTo(x0, y0);
  let lx = x0;
  let ly = y0;
  for (let i = 2; i < n; i += 2) {
    const x = P.x(r[i]);
    const y = P.y(r[i + 1]);
    if (i < n - 2 && Math.abs(x - lx) + Math.abs(y - ly) < 0.75) continue;
    path.lineTo(x, y);
    lx = x;
    ly = y;
  }
  if (close) path.closePath();
}

/* ---------- formato ---------- */
function dms(value: number, pos: string, neg: string, seconds = true) {
  const sign = value < 0 ? neg : pos;
  let v = Math.abs(value);
  const d = Math.floor(v);
  v = (v - d) * 60;
  const m = Math.floor(v);
  const s = Math.round((v - m) * 60);
  if (!seconds) return `${d}°${String(Math.round((Math.abs(value) - d) * 60)).padStart(2, "0")}′ ${sign}`;
  return `${d}°${String(m).padStart(2, "0")}′${String(s === 60 ? 59 : s).padStart(2, "0")}″ ${sign}`;
}

/* ---------- dibujo ---------- */
function draw() {
  if (!map) return;
  const { canvas, el, opts } = map;
  if (!el.isConnected) {
    destroy();
    return;
  }
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!w || !h) return;
  const ratio = devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const T = THEMES[view.theme];
  el.classList.toggle("is-light", view.theme === "claro");
  map.focus = opts.variant === "hero" && w > 860 ? { x: 0.64, y: 0.44, w: 0.6 } : { x: 0.5, y: 0.5, w: 1 };
  const P = projection(w, h);
  map.P = P;

  // océano
  const g = ctx.createRadialGradient(P.ox, P.oy, 0, P.ox, P.oy, Math.max(w, h) * 0.85);
  g.addColorStop(0, T.ocean[0]);
  g.addColorStop(0.55, T.ocean[1]);
  g.addColorStop(1, T.ocean[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (opts.variant === "hero" || opts.variant === "visor") {
    ctx.fillStyle = T.dots;
    for (let y = 15; y < h; y += 30) for (let x = 15; x < w; x += 30) ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
  }

  // retícula geográfica
  const steps = [2, 1, 0.5, 0.25, 1 / 6, 1 / 12, 1 / 30, 1 / 60];
  const step =
    steps.find((s) => s * P.scale < 170 && s * P.scale >= 70) || [...steps].reverse().find((s) => s * P.scale >= 70) || steps[0];
  ctx.strokeStyle = T.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const lonA = Math.floor(P.lon(0) / step) * step;
  const lonB = P.lon(w);
  for (let lon = lonA; lon <= lonB; lon += step) {
    const x = Math.round(P.x(lon)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  const latA = Math.floor(P.lat(h) / step) * step;
  const latB = P.lat(0);
  for (let lat = latA; lat <= latB; lat += step) {
    const y = Math.round(P.y(lat)) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.fillStyle = T.gridText;
  ctx.font = "500 10px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const hero = opts.variant === "hero";
  const labelTop = hero ? 10 : 50;
  const minX = hero && w > 860 ? Math.min(w * 0.42, 470) : 30;
  for (let lon = lonA; lon <= lonB; lon += step) {
    const x = P.x(lon);
    if (x > minX && x < w - 120) ctx.fillText(dms(lon, "E", "O", false), x + 4, labelTop);
  }
  if (!hero) {
    ctx.textBaseline = "bottom";
    for (let lat = latA; lat <= latB; lat += step) {
      const y = P.y(lat);
      if (y > 70 && y < h - 60) ctx.fillText(dms(lat, "N", "S", false), 6, y - 3);
    }
  }

  // tierra: capa IGM o contornos esquemáticos
  const land = new Path2D();
  let labels: Label[];
  const base = opts.base;
  if (base) {
    const prep = prepare(base);
    for (const poly of prep.polys) {
      if (!inView(poly.bbox, P)) continue;
      const b = poly.bbox;
      if ((b[2] - b[0]) * P.scale < 0.6 && (b[3] - b[1]) * P.scale < 0.6) continue;
      for (const ring of poly.rings) addRing(land, ring, P, true);
    }
    labels = prep.labels;
  } else {
    for (const ring of SCHEMA) addRing(land, new Float64Array(ring.flat()), P, true);
    labels = SCHEMA_LABELS.map(([name, lon, lat]) => ({ name, lon, lat, area: 1 }));
  }
  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = T.glow;
  ctx.lineWidth = 7;
  ctx.stroke(land);
  ctx.lineWidth = 3.5;
  ctx.stroke(land);
  const lg = ctx.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, T.land[0]);
  lg.addColorStop(1, T.land[1]);
  ctx.fillStyle = lg;
  ctx.fill(land, "evenodd");
  ctx.strokeStyle = T.coast;
  ctx.lineWidth = 1;
  ctx.stroke(land);
  ctx.restore();

  // nombres de islas
  const spacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  if ("letterSpacing" in ctx) spacing.letterSpacing = ".08em";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const placed: Bbox[] = [];
  for (const l of labels) {
    const px = l.area * P.scale * P.scale;
    if (base && px < 260) continue;
    const x = P.x(l.lon);
    const y = P.y(l.lat);
    if (x < 20 || x > w - 20 || y < 20 || y > h - 20) continue;
    const text = l.name.toUpperCase();
    const tw = ctx.measureText(text).width + 10;
    const box: Bbox = [x - tw / 2, y - 9, x + tw / 2, y + 9];
    if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
    placed.push(box);
    ctx.strokeStyle = T.halo;
    ctx.lineWidth = 3.5;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = T.label;
    ctx.fillText(text, x, y);
  }
  if ("letterSpacing" in ctx) spacing.letterSpacing = "0px";

  placeMarkers(P, T, ctx);
  updateScale(P);
}

/* Marcadores accesibles. Los que coinciden en pantalla se abren en abanico con
   una línea guía hacia su posición real, para que todos sigan visibles. */
function placeMarkers(P: Projection, T: Theme, ctx: CanvasRenderingContext2D) {
  if (!map) return;
  const items: { node: HTMLElement; x: number; y: number; color: string }[] = [];
  for (const child of Array.from(map.markers.children)) {
    const node = child as HTMLElement;
    const x = P.x(Number(node.dataset.lon));
    const y = P.y(Number(node.dataset.lat));
    const off = x < -20 || y < -20 || x > P.w + 20 || y > P.h + 20;
    node.hidden = off;
    const color = node.dataset.inactive === "1" ? T.inactive : T.station;
    node.style.setProperty("--c", color);
    node.style.setProperty("--ring", T.ring);
    if (!off) items.push({ node, x, y, color });
  }
  const spread = (n: number) => (n > 1 ? 12 + n * 5 : 9);
  type Group = { x: number; y: number; items: typeof items };
  const centre = (g: Group) => {
    g.x = g.items.reduce((sum, i) => sum + i.x, 0) / g.items.length;
    g.y = g.items.reduce((sum, i) => sum + i.y, 0) / g.items.length;
  };
  const groups: Group[] = items.map((item) => ({ x: item.x, y: item.y, items: [item] }));
  for (let merged = true, pass = 0; merged && pass < 12; pass++) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < spread(a.items.length) + spread(b.items.length) + 8) {
          a.items.push(...b.items);
          centre(a);
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  for (const group of groups) {
    const n = group.items.length;
    if (n === 1) {
      const it = group.items[0];
      it.node.style.transform = `translate(${it.x - 15}px,${it.y - 15}px)`;
      it.node.classList.toggle("label-left", it.x > P.w - 200);
      continue;
    }
    const radius = spread(n);
    group.items.forEach((it, k) => {
      const angle = -Math.PI / 2 + (k * 2 * Math.PI) / n;
      const px = group.x + radius * Math.cos(angle);
      const py = group.y + radius * Math.sin(angle);
      ctx.strokeStyle = view.theme === "oscuro" ? "rgba(240,253,250,.55)" : "rgba(15,23,42,.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(it.x, it.y);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.arc(it.x, it.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      it.node.style.transform = `translate(${px - 15}px,${py - 15}px)`;
      it.node.classList.toggle("label-left", Math.cos(angle) < -0.2 || px > P.w - 200);
    });
  }
}

function updateScale(P: Projection) {
  if (!map) return;
  const kmPerPx = 111.32 / P.scale;
  const options = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  const km = [...options].reverse().find((v) => v / kmPerPx <= 140) || options[0];
  const bar = map.el.querySelector(".map-scale");
  const i = bar?.querySelector("i");
  const span = bar?.querySelector("span");
  if (!i || !span) return;
  i.style.width = `${Math.round(km / kmPerPx)}px`;
  span.textContent = km < 1 ? `${nf(km * 1000, 0)} m` : `${nf(km, 0)} km`;
}

function schedule() {
  if (!raf)
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
}

/* ---------- interacción ---------- */
function zoomAt(factor: number, px: number, py: number) {
  const P = map?.P;
  if (!P) return;
  const lon = P.lon(px);
  const lat = P.lat(py);
  const next = Math.min(16, Math.max(0.6, view.zoom * factor));
  if (next === view.zoom) return;
  view.zoom = next;
  const Q = projection(P.w, P.h);
  view.dx = lon - (px - Q.ox) / Q.scale - Q.lon0;
  view.dy = lat + (py - Q.oy) / Q.scale - Q.lat0;
  schedule();
}

function infoCard(o: { color: string; title: string; subtitle?: string; rows?: [string, string][]; actionLabel?: string | null; onAction?: () => void }) {
  if (!map) return;
  const box = map.info;
  box.replaceChildren();
  const close = document.createElement("button");
  close.type = "button";
  close.className = "map-info-close";
  close.setAttribute("aria-label", "Cerrar ficha");
  close.innerHTML = ICON.x;
  close.onclick = () => {
    box.hidden = true;
  };
  const h = document.createElement("h3");
  const dot = document.createElement("i");
  dot.style.setProperty("--c", o.color);
  h.append(dot, document.createTextNode(o.title));
  box.append(close, h);
  if (o.subtitle) {
    const p = document.createElement("p");
    p.textContent = o.subtitle;
    box.append(p);
  }
  if (o.rows?.length) {
    const dl = document.createElement("dl");
    for (const [k, v] of o.rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    }
    box.append(dl);
  }
  if (o.actionLabel && o.onAction) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "button small secondary";
    b.textContent = o.actionLabel;
    b.onclick = o.onAction;
    box.append(b);
  }
  box.hidden = false;
}

function stationInfo(s: MapaEstacion) {
  if (!map) return;
  const T = THEMES[view.theme];
  const opts = map.opts;
  const selected = s.id === opts.selected;
  const rows: [string, string][] = [
    ["Coordenadas", `${nf(s.lat, 4)}, ${nf(s.lon, 4)}`],
    ["Resolución", s.pasoMin >= 1440 ? "Diaria" : `${s.pasoMin} min`],
    ["Fuente", s.fuente],
    ["Estado", s.activa ? "Activa" : "Inactiva"],
  ];
  if (selected && opts.latest) rows.push(["Último dato", opts.latest]);
  infoCard({
    color: s.activa ? T.station : T.inactive,
    title: s.nombre,
    subtitle: `Estación ${s.id} · ${s.isla}`,
    rows,
    actionLabel: !selected && opts.onStation ? "Ver serie de esta estación" : null,
    onAction: () => {
      pendingInfo = s.id;
      opts.onStation?.(s.id);
    },
  });
}

function bind() {
  if (!map) return;
  const m = map;
  const { canvas, el } = m;
  let drag: { x: number; y: number; dx: number; dy: number; moved: boolean; passive?: boolean } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (m.opts.variant === "hero" && e.pointerType === "touch") {
      drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false, passive: true };
      return;
    }
    drag = { x: e.clientX, y: e.clientY, dx: view.dx, dy: view.dy, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const box = canvas.getBoundingClientRect();
    if (e.pointerType === "mouse" && m.P) {
      const lon = m.P.lon(e.clientX - box.left);
      const lat = m.P.lat(e.clientY - box.top);
      m.coords.textContent = `${dms(lat, "N", "S")}  ${dms(lon, "E", "O")}`;
    }
    if (!drag || drag.passive || !m.P) return;
    const mx = e.clientX - drag.x;
    const my = e.clientY - drag.y;
    if (!drag.moved && Math.abs(mx) + Math.abs(my) < 4) return;
    drag.moved = true;
    canvas.classList.add("is-dragging");
    view.dx = drag.dx - mx / m.P.scale;
    view.dy = drag.dy + my / m.P.scale;
    schedule();
  });
  const end = (e: PointerEvent) => {
    if (!drag) return;
    const was = drag;
    drag = null;
    canvas.classList.remove("is-dragging");
    if (was.moved) return;
    if (Math.abs(e.clientX - was.x) + Math.abs(e.clientY - was.y) > 6) return;
    if (e.pointerType !== "touch") m.info.hidden = true;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", () => {
    drag = null;
    canvas.classList.remove("is-dragging");
  });
  canvas.addEventListener("pointerleave", () => {
    m.coords.textContent = "";
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (m.opts.variant === "hero" && !(e.ctrlKey || e.metaKey)) {
        m.hint.classList.add("is-on");
        clearTimeout(m.hintTimer);
        m.hintTimer = setTimeout(() => m.hint.classList.remove("is-on"), 1300);
        return;
      }
      e.preventDefault();
      const box = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - box.left, e.clientY - box.top);
    },
    { passive: false },
  );
  canvas.addEventListener("dblclick", (e) => {
    const box = canvas.getBoundingClientRect();
    zoomAt(1.8, e.clientX - box.left, e.clientY - box.top);
  });
  canvas.addEventListener("keydown", (e) => {
    const P = m.P;
    if (!P) return;
    const pan = 60 / P.scale;
    const keys: Record<string, [number, number]> = { ArrowLeft: [-pan, 0], ArrowRight: [pan, 0], ArrowUp: [0, pan], ArrowDown: [0, -pan] };
    if (keys[e.key]) {
      e.preventDefault();
      view.dx += keys[e.key][0];
      view.dy += keys[e.key][1];
      schedule();
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomAt(1.35, P.w * m.focus.x, P.h * m.focus.y);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomAt(1 / 1.35, P.w * m.focus.x, P.h * m.focus.y);
    } else if (e.key === "0") {
      e.preventDefault();
      reset();
      schedule();
    }
  });
  el.querySelector(".map-tools")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-map]");
    if (!b || !m.P) return;
    const P = m.P;
    const cx = P.w * m.focus.x;
    const cy = P.h * m.focus.y;
    if (b.dataset.map === "in") zoomAt(1.35, cx, cy);
    if (b.dataset.map === "out") zoomAt(1 / 1.35, cx, cy);
    if (b.dataset.map === "reset") {
      reset();
      schedule();
    }
    if (b.dataset.map === "theme") {
      view.theme = view.theme === "oscuro" ? "claro" : "oscuro";
      try {
        localStorage.setItem("simat-mapa-tema", view.theme);
      } catch {
        /* sin almacenamiento: el tema dura la sesión */
      }
      themeButton();
      legend();
      draw();
    }
  });
  m.markers.addEventListener("click", (e) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>(".mk");
    if (!node) return;
    const s = m.opts.stations.find((row) => row.id === node.dataset.id);
    if (s) stationInfo(s);
  });
  m.ro = new ResizeObserver(schedule);
  m.ro.observe(el);
}

function themeButton() {
  const b = map?.el.querySelector<HTMLElement>("[data-map=theme]");
  if (!b) return;
  const dark = view.theme === "oscuro";
  b.innerHTML = dark ? ICON.sun : ICON.moon;
  b.setAttribute("aria-label", dark ? "Cambiar a mapa claro" : "Cambiar a mapa oscuro");
  b.title = dark ? "Mapa claro" : "Mapa oscuro";
}

function markersHtml(opts: MapaOpciones) {
  let html = "";
  for (const s of opts.stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const selected = s.id === opts.selected;
    html +=
      `<button type="button" class="mk mk-station${selected ? " is-selected" : ""}${selected && opts.live ? " is-live" : ""}" data-kind="station" data-id="${esc(s.id)}" data-lat="${esc(s.lat)}" data-lon="${esc(s.lon)}" data-inactive="${s.activa ? "0" : "1"}" aria-label="${esc(`Estación ${s.nombre} · ${s.id}`)}"${selected ? ' aria-current="true"' : ""}>` +
      (selected ? `<span class="mk-label">${esc(s.nombre)}${opts.latestShort ? ` <b>${esc(opts.latestShort)}</b>` : ""}</span>` : "") +
      "</button>";
  }
  return html;
}

function legend() {
  if (!map) return;
  const T = THEMES[view.theme];
  const inactive = map.opts.stations.some((s) => !s.activa);
  const box = map.el.querySelector(".map-legend");
  if (!box) return;
  box.innerHTML =
    `<span><i class="lg" style="--c:${T.station}"></i>Estación activa</span>` +
    (inactive ? `<span><i class="lg" style="--c:${T.inactive}"></i>Estación inactiva</span>` : "");
}

export function reset() {
  view.zoom = 1;
  view.dx = 0;
  view.dy = 0;
}

function destroy() {
  if (!map) return;
  map.ro?.disconnect();
  clearTimeout(map.hintTimer);
  map = null;
}

/** Desmonta el mapa si `el` es el que está activo. */
export function desmontarMapa(el: HTMLElement | null) {
  if (map && map.el === el) destroy();
}

export function montarMapa(el: HTMLElement | null, opts: MapaOpciones) {
  if (!el) return;
  if (!themeLoaded) {
    themeLoaded = true;
    try {
      if (localStorage.getItem("simat-mapa-tema") === "claro") view.theme = "claro";
    } catch {
      /* sin almacenamiento: tema oscuro */
    }
  }
  const same = map && map.el === el;
  if (!same) {
    destroy();
    el.classList.add("map", `is-${opts.variant}`);
    if (!entered) {
      el.classList.add("map-enter");
      entered = true;
    }
    el.innerHTML =
      '<canvas class="map-canvas" tabindex="0" role="img" aria-label="Mapa de Galápagos. Arrastra para desplazarte, usa los botones o las teclas más y menos para acercar o alejar."></canvas>' +
      '<div class="map-markers"></div>' +
      `<div class="map-tag">${ICON.layers}<span></span></div>` +
      `<div class="map-tools"><div class="tool-card"><button type="button" data-map="in" aria-label="Acercar" title="Acercar">${ICON.plus}</button><button type="button" data-map="out" aria-label="Alejar" title="Alejar">${ICON.minus}</button><button type="button" data-map="reset" aria-label="Restablecer la vista" title="Restablecer la vista">${ICON.reset}</button></div><div class="tool-card"><button type="button" data-map="theme"></button></div></div>` +
      '<div class="map-legend"></div>' +
      '<div class="map-info" role="status" hidden></div>' +
      '<div class="map-attr"></div>' +
      '<div class="map-foot" aria-hidden="true"><div class="map-coords"></div><div class="map-scale"><i></i><span></span></div></div>' +
      '<div class="map-hint" aria-hidden="true">Mantén Ctrl (o ⌘) y usa la rueda para acercar</div>';
    map = {
      el,
      opts,
      canvas: el.querySelector("canvas") as HTMLCanvasElement,
      markers: el.querySelector(".map-markers") as HTMLElement,
      info: el.querySelector(".map-info") as HTMLElement,
      coords: el.querySelector(".map-coords") as HTMLElement,
      hint: el.querySelector(".map-hint") as HTMLElement,
      focus: { x: 0.5, y: 0.5, w: 1 },
    };
    bind();
    setTimeout(() => el.classList.remove("map-enter"), 1000);
  } else if (map) {
    map.opts = opts;
  }
  if (lastIsland !== opts.island) {
    if (lastIsland !== null) reset();
    lastIsland = opts.island;
  }
  const official = !!opts.base;
  const tag = el.querySelector(".map-tag span");
  if (tag) tag.textContent = official ? "IGM · Islas Galápagos · ODbL" : "Base esquemática · WGS84";
  const attr = el.querySelector(".map-attr");
  if (attr) attr.textContent = official ? "Cartografía base: IGM · ODbL 1.0" : "Contornos esquemáticos de referencia";
  if (map) {
    map.markers.innerHTML = markersHtml(opts);
    legend();
    themeButton();
    draw();
    if (pendingInfo) {
      const s = opts.stations.find((row) => row.id === pendingInfo);
      pendingInfo = null;
      if (s) stationInfo(s);
    }
  }
}
