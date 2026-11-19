// SIMAT-GAL · Gráficos SVG sin dependencias, portados de la vista previa
// («SIMAT-GAL · Vista previa», graficos.js). Reglas: un solo eje Y por gráfico,
// marcas delgadas, rejilla tenue, etiquetas directas selectivas, tooltip con
// teclado. Cada función dibuja dentro de un contenedor y se redibuja al cambiar
// su ancho. Solo se llama desde efectos del cliente.

const X = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
export const nf = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("es-EC", { maximumFractionDigits: digits }).format(v);
const TZ = "Pacific/Galapagos";
const hhmm = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayShort = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, day: "2-digit", month: "short" });
const dayLong = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" });
const stamp = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });

export const COLORES = {
  rain: "#0d9488",
  rainStrong: "#115e59",
  rainWash: "rgba(13,148,136,.12)",
  cum: "#0f766e",
  sea: "#2a78d6",
  seaStrong: "#1c5cab",
  seaWash: "rgba(42,120,214,.12)",
  obs: "#eb6834",
  muted: "#94a3b8",
  spark: "#cbd5e1",
  critical: "#d03b3b",
  status: ["#0ca30c", "#fab219", "#ec835a", "#d03b3b"],
  prob: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf"],
};
const C = COLORES;

export interface RainSlot {
  t: number;
  v: number | null;
  q: string | null;
}
export interface TideExtreme {
  t: number;
  h: number;
  fase: string;
  ref: string;
}
export interface TidePoint {
  t: number;
  h: number;
}
export interface SeaPoint {
  time: number;
  level: number;
}
export interface ForecastHour {
  inicio: string;
  fin: string;
  mm: number | null;
  probabilidad: number | null;
}
interface TipRow {
  color?: string;
  shape?: string;
  value: string;
  label?: string;
}

/* ---------- utilidades ---------- */
function nice(max: number, ticks = 4) {
  if (!(max > 0)) return { top: 1, step: 0.25 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  return { top: step * ticks, step };
}
/** Eje «redondo»: límites y paso de las marcas para un rango de valores. */
export function range(min: number, max: number, ticks = 4) {
  if (!(max > min)) {
    min -= 0.5;
    max += 0.5;
  }
  const raw = (max - min) / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  return { lo, hi, step };
}
function barTop(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return "";
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
const r1 = (v: number) => Math.round(v * 10) / 10;
function timeLabel(t: number, step: number) {
  return step >= 1440 ? dayShort.format(t) : hhmm.format(t);
}

/* ---------- tooltip compartido ---------- */
export const tip = (() => {
  let el: HTMLDivElement | null = null;
  let mode = "pointer";
  function node() {
    if (!el || !el.isConnected) {
      el = document.createElement("div");
      el.className = "chart-tip";
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
      // Dentro de .simat para que le apliquen los estilos aislados del módulo.
      (document.querySelector(".simat") ?? document.body).appendChild(el);
      addEventListener(
        "scroll",
        () => {
          if (mode === "pointer") hide();
        },
        { passive: true },
      );
    }
    return el;
  }
  function show(cx: number, cy: number, title: string, rows: TipRow[], source = "pointer") {
    mode = source;
    const box = node();
    box.replaceChildren();
    const head = document.createElement("div");
    head.className = "tip-title";
    head.textContent = title;
    box.append(head);
    for (const row of rows) {
      const line = document.createElement("div");
      line.className = "tip-row";
      const key = document.createElement("i");
      key.className = "tip-key " + (row.shape || "");
      key.style.setProperty("--c", row.color || C.muted);
      const value = document.createElement("strong");
      value.textContent = row.value;
      const label = document.createElement("span");
      label.textContent = row.label || "";
      line.append(key, value, label);
      box.append(line);
    }
    box.hidden = false;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let x = cx + 16;
    let y = cy - h - 14;
    if (x + w > innerWidth - 8) x = cx - w - 16;
    if (y < 8) y = cy + 18;
    if (y + h > innerHeight - 8) y = innerHeight - h - 8;
    box.style.transform = `translate(${Math.max(8, x)}px,${Math.max(8, y)}px)`;
  }
  function hide() {
    if (el) el.hidden = true;
  }
  return { show, hide };
})();

/* ---------- montaje adaptable ---------- */
const observers = new WeakMap<HTMLElement, ResizeObserver>();
const widths = new WeakMap<HTMLElement, number>();
export function mount(el: HTMLElement | null, draw: (width: number) => void) {
  if (!el) return;
  observers.get(el)?.disconnect();
  widths.set(el, 0);
  const run = () => {
    if (!el.isConnected) {
      observers.get(el)?.disconnect();
      return;
    }
    const width = Math.round(el.clientWidth);
    if (!width || width === widths.get(el)) return;
    widths.set(el, width);
    draw(width);
  };
  const ro = new ResizeObserver(run);
  ro.observe(el);
  observers.set(el, ro);
  run();
}
export function unmount(el: HTMLElement | null) {
  if (!el) return;
  observers.get(el)?.disconnect();
  observers.delete(el);
  tip.hide();
}

/* Interacción tipo cruz: puntero y teclado sobre un índice discreto */
function crosshair(
  svg: SVGSVGElement,
  opts: {
    count: number;
    xAt: (i: number) => number;
    top: number;
    bottom: number;
    describe: (i: number) => { title: string; rows: TipRow[] };
    onIndex?: (i: number) => void;
  },
) {
  const { count, xAt, top, bottom, describe, onIndex } = opts;
  const line = svg.querySelector<SVGLineElement>(".cross");
  if (!line) return;
  let index = -1;
  let keyboard = false;
  function place(i: number, client?: { x: number; y: number }) {
    index = Math.max(0, Math.min(count - 1, i));
    const x = xAt(index);
    line!.setAttribute("x1", String(x));
    line!.setAttribute("x2", String(x));
    line!.setAttribute("y1", String(top));
    line!.setAttribute("y2", String(bottom));
    line!.style.display = "";
    onIndex?.(index);
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    const cx = client ? client.x : box.left + x * scale;
    const cy = client ? client.y : box.top + top * scale + 24;
    const info = describe(index);
    tip.show(cx, cy, info.title, info.rows, client ? "pointer" : "keyboard");
  }
  const follow = () => {
    if (keyboard && index >= 0) place(index);
  };
  function clear() {
    line!.style.display = "none";
    index = -1;
    onIndex?.(-1);
    tip.hide();
  }
  const toIndex = (e: PointerEvent) => {
    const box = svg.getBoundingClientRect();
    const scale = svg.viewBox.baseVal.width / box.width;
    const x = (e.clientX - box.left) * scale;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < count; i++) {
      const d = Math.abs(xAt(i) - x);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  };
  svg.addEventListener("pointermove", (e) => {
    keyboard = false;
    place(toIndex(e), { x: e.clientX, y: e.clientY });
  });
  svg.addEventListener("pointerdown", (e) => {
    keyboard = false;
    place(toIndex(e), { x: e.clientX, y: e.clientY });
  });
  svg.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "touch" && !keyboard) clear();
  });
  svg.addEventListener("focus", () => addEventListener("scroll", follow, { passive: true }));
  svg.addEventListener("blur", () => {
    removeEventListener("scroll", follow);
    keyboard = false;
    clear();
  });
  svg.addEventListener("keydown", (e) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    const step = steps[e.key];
    if (e.key === "Escape") {
      clear();
      return;
    }
    if (step === undefined) return;
    e.preventDefault();
    keyboard = true;
    const start = index < 0 ? count - 1 : index;
    place(step === -Infinity ? 0 : step === Infinity ? count - 1 : start + step);
  });
  line.style.display = "none";
}

/* ---------- 1. Precipitación: dos paneles alineados (intervalo y acumulado) ---------- */
export function rain(el: HTMLElement | null, { slots, step, compact = false }: { slots: RainSlot[]; step: number; compact?: boolean }) {
  mount(el, (width) => {
    if (!el) return;
    const n = slots.length;
    if (!n) {
      el.innerHTML = "";
      return;
    }
    const padL = 44;
    const padR = 16;
    const padT = 26;
    const h1 = compact ? 128 : 178;
    const gap = 34;
    const h2 = compact ? 74 : 104;
    const axis = 26;
    const plotW = width - padL - padR;
    const slot = plotW / n;
    const bw = Math.max(1, Math.min(24, slot - 2));
    const valid = slots.filter((s) => s.v != null);
    const max = Math.max(0, ...valid.map((s) => s.v as number));
    const ya = nice(max, compact ? 3 : 4);
    let total = 0;
    const cum = slots.map((s) => (total += s.v ?? 0));
    const yb = nice(total, 2);
    const t1 = padT;
    const b1 = padT + h1;
    const t2 = b1 + gap;
    const b2 = t2 + h2;
    const height = b2 + axis;
    const xc = (i: number) => padL + slot * (i + 0.5);
    const yA = (v: number) => b1 - (v / ya.top) * h1;
    const yB = (v: number) => b2 - (v / yb.top) * h2;
    const peak = valid.length
      ? slots.reduce((best, s, i) => (s.v != null && (best < 0 || s.v > (slots[best].v as number)) ? i : best), -1)
      : -1;
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" tabindex="0" aria-label="${X(
      `Precipitación por intervalo y acumulado. Máximo ${nf(max)} mm. Acumulado visible ${nf(total, 1)} mm. Usa las flechas para recorrer los intervalos.`,
    )}">`;
    svg += `<text class="panel-title" x="${padL}" y="12">mm por intervalo</text>`;
    for (let k = 0; k <= (compact ? 3 : 4); k++) {
      const v = ya.step * k;
      const y = r1(yA(v));
      svg += `<line class="${k ? "gl" : "base"}" x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}"/>`;
      svg += `<text class="tick" x="${padL - 8}" y="${y + 3.5}" text-anchor="end">${nf(v)}</text>`;
    }
    slots.forEach((s, i) => {
      const x = r1(padL + slot * i + (slot - bw) / 2);
      if (s.v == null) {
        svg += `<rect class="gap-band" x="${r1(padL + slot * i + 0.5)}" y="${t1}" width="${Math.max(1, r1(slot - 1))}" height="${h1}"/>`;
      } else if (s.v > 0) {
        const y = yA(s.v);
        svg += `<path class="bar" data-i="${i}" fill="${i === peak ? C.rainStrong : C.rain}" d="${barTop(x, r1(y), r1(bw), r1(b1 - y), bw > 6 ? 4 : 1)}"/>`;
      }
    });
    if (peak >= 0 && (slots[peak].v as number) > 0) {
      const px = xc(peak);
      const anchor = px > width - 90 ? "end" : px < padL + 50 ? "start" : "middle";
      svg += `<text class="lbl" x="${r1(px)}" y="${r1(yA(slots[peak].v as number) - 7)}" text-anchor="${anchor}">máx ${nf(slots[peak].v)} mm</text>`;
    }
    svg += `<text class="panel-title" x="${padL}" y="${t2 - 12}">Acumulado en la ventana visible (mm)</text>`;
    for (let k = 0; k <= 2; k++) {
      const v = yb.step * k;
      const y = r1(yB(v));
      svg += `<line class="${k ? "gl" : "base"}" x1="${padL}" x2="${width - padR}" y1="${y}" y2="${y}"/>`;
      svg += `<text class="tick" x="${padL - 8}" y="${y + 3.5}" text-anchor="end">${nf(v, 1)}</text>`;
    }
    let line = "";
    let area = "";
    cum.forEach((v, i) => {
      const p = `${r1(xc(i))},${r1(yB(v))}`;
      line += (i ? "L" : "M") + p;
      area += (i ? "L" : "M") + p;
    });
    area += `L${r1(xc(n - 1))},${b2}L${r1(xc(0))},${b2}Z`;
    svg += `<path d="${area}" fill="${C.rainWash}"/>`;
    svg += `<path d="${line}" fill="none" stroke="${C.cum}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    svg += `<circle cx="${r1(xc(n - 1))}" cy="${r1(yB(total))}" r="4" fill="${C.cum}" stroke="#fff" stroke-width="2"/>`;
    svg += `<text class="lbl" x="${r1(xc(n - 1) - 8)}" y="${r1(yB(total) - 9)}" text-anchor="end">${nf(total, 1)} mm</text>`;
    const labels = Math.min(width < 520 ? 3 : 6, n);
    for (let k = 0; k < labels; k++) {
      const i = labels === 1 ? n - 1 : Math.round((k * (n - 1)) / (labels - 1));
      const anchor = k === 0 ? "start" : k === labels - 1 ? "end" : "middle";
      const x = k === 0 ? padL : k === labels - 1 ? width - padR : xc(i);
      svg += `<text class="tick" x="${r1(x)}" y="${b2 + 17}" text-anchor="${anchor}">${X(timeLabel(slots[i].t, step))}</text>`;
    }
    svg += `<line class="cross" x1="0" x2="0" y1="0" y2="0"/>`;
    svg += `<rect class="hit" x="${padL}" y="0" width="${plotW}" height="${b2}"/></svg>`;
    el.innerHTML = svg;
    const node = el.querySelector("svg");
    if (!node) return;
    const bars = Array.from(node.querySelectorAll<SVGPathElement>(".bar"));
    crosshair(node, {
      count: n,
      xAt: xc,
      top: t1,
      bottom: b2,
      onIndex: (i) =>
        bars.forEach((b) => {
          b.style.opacity = i < 0 || Number(b.dataset.i) === i ? "" : ".45";
        }),
      describe: (i) => {
        const s = slots[i];
        const from = s.t - step * 60000;
        const title = step >= 1440 ? dayLong.format(s.t) : `${hhmm.format(from)} → ${hhmm.format(s.t)} · ${dayShort.format(s.t)}`;
        const rows: TipRow[] =
          s.v == null
            ? [{ color: C.muted, shape: "block", value: "Sin dato válido", label: s.q || "sin registro" }]
            : [
                { color: C.rain, shape: "block", value: `${nf(s.v)} mm`, label: "en el intervalo" },
                { color: C.rainStrong, value: `${nf((s.v * 60) / step)} mm/h`, label: "intensidad media" },
              ];
        rows.push({ color: C.cum, value: `${nf(cum[i], 1)} mm`, label: "acumulado visible" });
        return { title, rows };
      },
    });
  });
}

/* ---------- 2. Sparkline de indicador ---------- */
export function spark(el: HTMLElement | null, values: number[]) {
  mount(el, (width) => {
    if (!el) return;
    const pts = values.filter((v) => Number.isFinite(v));
    if (pts.length < 2) {
      el.innerHTML = "";
      return;
    }
    const h = 34;
    const pad = 4;
    const max = Math.max(...pts);
    const min = Math.min(0, ...pts);
    const x = (i: number) => pad + (i * (width - pad * 2)) / (values.length - 1);
    const y = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
    let d = "";
    let started = false;
    values.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        started = false;
        return;
      }
      d += (started ? "L" : "M") + r1(x(i)) + "," + r1(y(v));
      started = true;
    });
    const last = values.length - 1 - [...values].reverse().findIndex((v) => Number.isFinite(v));
    el.innerHTML =
      `<svg class="spark" viewBox="0 0 ${width} ${h}" aria-hidden="true">` +
      `<path d="${d}" fill="none" stroke="${C.spark}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${r1(x(last))}" cy="${r1(y(values[last]))}" r="4" fill="${C.rain}" stroke="#fff" stroke-width="2"/></svg>`;
  });
}

/* ---------- 3. Dial de nivel de riesgo (ordinal, 4 estados): geometría ---------- */
export function dialSegments(level: number) {
  const cx = 100;
  const cy = 100;
  const R = 86;
  const r = 58;
  const segments: { d: string; fill: string; opacity: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const a0 = Math.PI - (k * Math.PI) / 4 - (k ? 0.022 : 0);
    const a1 = Math.PI - ((k + 1) * Math.PI) / 4 + (k < 3 ? 0.022 : 0);
    const p = (rad: number, a: number) => `${r1(cx + rad * Math.cos(a))},${r1(cy - rad * Math.sin(a))}`;
    const d = `M${p(R, a0)}A${R},${R} 0 0 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 0 0 ${p(r, a0)}Z`;
    segments.push({ d, fill: C.status[k], opacity: level < 0 ? 0.22 : level === k ? 1 : 0.2 });
  }
  const a = Math.PI - ((level + 0.5) * Math.PI) / 4;
  const needle = level >= 0 ? { x2: r1(cx + 70 * Math.cos(a)), y2: r1(cy - 70 * Math.sin(a)) } : null;
  return { segments, needle };
}

/* ---------- 4. Curva de marea (predicción) con observaciones y umbral ---------- */
export function tide(
  el: HTMLElement | null,
  {
    extremes,
    observed = [],
    threshold = null,
    referencias = [],
    now = Date.now(),
  }: {
    extremes: TideExtreme[];
    observed?: TidePoint[];
    threshold?: number | null;
    /** Líneas de referencia (p. ej. percentiles de marea alta p90/p95/p99). */
    referencias?: { valor: number; etiqueta: string }[];
    now?: number;
  },
) {
  mount(el, (width) => {
    if (!el) return;
    if (extremes.length < 2) {
      el.innerHTML = "";
      return;
    }
    const narrow = width < 560;
    let start = Math.max(extremes[0].t, now - (narrow ? 4 : 8) * 3600e3);
    let end = Math.min(extremes[extremes.length - 1].t, now + (narrow ? 20 : 30) * 3600e3);
    if (end - start < 6 * 3600e3) {
      start = extremes[0].t;
      end = extremes[extremes.length - 1].t;
    }
    const level = (t: number) => {
      const i = extremes.findIndex((e) => e.t >= t);
      if (i <= 0) return i === 0 ? extremes[0].h : extremes[extremes.length - 1].h;
      const a = extremes[i - 1];
      const b = extremes[i];
      const f = (t - a.t) / (b.t - a.t);
      return (a.h + b.h) / 2 + ((a.h - b.h) / 2) * Math.cos(Math.PI * f);
    };
    const stepMs = 10 * 60000;
    const samples: TidePoint[] = [];
    for (let t = start; t <= end; t += stepMs) samples.push({ t, h: level(t) });
    const obs = observed.filter((o) => o.t >= start && o.t <= end);
    const values = samples.map((s) => s.h).concat(obs.map((o) => o.h), threshold != null ? [threshold] : [], referencias.map((r) => r.valor));
    const yr = range(Math.min(...values), Math.max(...values), 4);
    const padL = 50;
    const padR = 18;
    const padT = 30;
    const plotH = 210;
    const axis = 28;
    const height = padT + plotH + axis;
    const x = (t: number) => padL + ((t - start) / (end - start)) * (width - padL - padR);
    const y = (v: number) => padT + plotH - ((v - yr.lo) / (yr.hi - yr.lo)) * plotH;
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" tabindex="0" aria-label="${X(
      "Curva de marea estimada entre pleamares y bajamares publicadas. Usa las flechas para recorrerla.",
    )}">`;
    for (let v = yr.lo, k = 0; v <= yr.hi + 1e-9; v += yr.step, k++) {
      const yy = r1(y(v));
      svg += `<line class="${k ? "gl" : "base"}" x1="${padL}" x2="${width - padR}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="tick" x="${padL - 8}" y="${yy + 3.5}" text-anchor="end">${nf(v)} m</text>`;
    }
    const midnight = (t: number) => {
      const d = new Date(t - 6 * 3600e3);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime() + 6 * 3600e3;
    };
    for (let d = midnight(start) + 86400e3; d < end; d += 86400e3) {
      const xx = r1(x(d));
      svg += `<line class="day" x1="${xx}" x2="${xx}" y1="${padT}" y2="${padT + plotH}"/>`;
      svg += `<text class="tick-strong" x="${xx + 5}" y="${padT + 12}">${X(dayLong.format(d))}</text>`;
    }
    const tickCount = width < 560 ? 4 : 7;
    for (let k = 0; k <= tickCount; k++) {
      const t = start + ((end - start) * k) / tickCount;
      svg += `<text class="tick" x="${r1(x(t))}" y="${padT + plotH + 18}" text-anchor="${k === 0 ? "start" : k === tickCount ? "end" : "middle"}">${hhmm.format(t)}</text>`;
    }
    let d = "";
    let area = "";
    samples.forEach((s, i) => {
      const p = `${r1(x(s.t))},${r1(y(s.h))}`;
      d += (i ? "L" : "M") + p;
      area += (i ? "L" : "M") + p;
    });
    area += `L${r1(x(end))},${padT + plotH}L${r1(x(start))},${padT + plotH}Z`;
    svg += `<path d="${area}" fill="${C.seaWash}"/>`;
    svg += `<path d="${d}" fill="none" stroke="${C.sea}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    referencias.forEach((ref, k) => {
      const yy = r1(y(ref.valor));
      svg += `<line class="pct" x1="${padL}" x2="${width - padR}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="lbl pct-lbl" x="${padL + 6 + k * 92}" y="${yy - 5}">${X(ref.etiqueta)}</text>`;
    });
    if (threshold != null) {
      const yy = r1(y(threshold));
      svg += `<line class="threshold" x1="${padL}" x2="${width - padR}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="lbl" x="${width - padR}" y="${yy - 6}" text-anchor="end">Umbral de mar alto ${nf(threshold)} m</text>`;
    }
    if (now >= start && now <= end) {
      const xx = r1(x(now));
      svg += `<line class="now" x1="${xx}" x2="${xx}" y1="${padT - 8}" y2="${padT + plotH}"/>`;
      svg += `<text class="tick-strong" x="${xx}" y="${padT - 12}" text-anchor="middle">Ahora · ${hhmm.format(now)}</text>`;
    }
    const visible = extremes.filter((e) => e.t >= start && e.t <= end);
    const nextHigh = visible.find((e) => e.t >= now && e.fase === "Pleamar");
    const nextLow = visible.find((e) => e.t >= now && e.fase === "Bajamar");
    for (const e of visible) {
      svg += `<circle cx="${r1(x(e.t))}" cy="${r1(y(e.h))}" r="4" fill="${C.seaStrong}" stroke="#fff" stroke-width="2"/>`;
    }
    for (const e of [nextHigh, nextLow]) {
      if (!e) continue;
      const up = e.fase === "Pleamar";
      const nearNow = now >= start && now <= end && Math.abs(x(now) - x(e.t)) < 70;
      let xx = x(e.t);
      let anchor = xx > width - 120 ? "end" : xx < padL + 70 ? "start" : "middle";
      if (nearNow) {
        anchor = x(e.t) >= x(now) ? "start" : "end";
        xx += anchor === "start" ? 9 : -9;
      }
      const yy = y(e.h);
      let ly = up ? yy - 11 : yy + 19;
      if (up && ly < padT + 12) ly = yy + 19;
      if (!up && ly > padT + plotH - 6) ly = yy - 11;
      svg += `<text class="lbl" x="${r1(xx)}" y="${r1(ly)}" text-anchor="${anchor}">${up ? "Pleamar " : "Bajamar "}${hhmm.format(e.t)} · ${nf(e.h)} m</text>`;
    }
    for (const o of obs) {
      svg += `<circle cx="${r1(x(o.t))}" cy="${r1(y(o.h))}" r="4.5" fill="${C.obs}" stroke="#fff" stroke-width="2"/>`;
    }
    svg += `<line class="cross" x1="0" x2="0" y1="0" y2="0"/>`;
    svg += `<rect class="hit" x="${padL}" y="${padT}" width="${width - padL - padR}" height="${plotH}"/></svg>`;
    el.innerHTML = svg;
    const node = el.querySelector("svg");
    if (!node) return;
    crosshair(node, {
      count: samples.length,
      xAt: (i) => x(samples[i].t),
      top: padT,
      bottom: padT + plotH,
      describe: (i) => {
        const s = samples[i];
        const rows: TipRow[] = [{ color: C.sea, value: `${nf(s.h)} m`, label: "marea estimada" }];
        const near = extremes.find((e) => Math.abs(e.t - s.t) <= 15 * 60000);
        if (near) rows.push({ color: C.seaStrong, shape: "dot", value: `${nf(near.h)} m`, label: `${near.fase} publicada · ${hhmm.format(near.t)}` });
        const o = obs.find((v) => Math.abs(v.t - s.t) <= 15 * 60000);
        if (o) rows.push({ color: C.obs, shape: "dot", value: `${nf(o.h)} m`, label: "nivel observado" });
        if (threshold != null) rows.push({ color: C.critical, value: `${nf(threshold)} m`, label: "umbral del sector" });
        return { title: `${dayLong.format(s.t)} · ${hhmm.format(s.t)}`, rows };
      },
    });
  });
}

/* ---------- 5. Nivel del mar observado (mareógrafo) ---------- */
export function sea(el: HTMLElement | null, { points, recentFrom }: { points: SeaPoint[]; recentFrom?: number }) {
  mount(el, (width) => {
    if (!el) return;
    if (points.length < 2) {
      el.innerHTML = "";
      return;
    }
    const first = points[0].time;
    const last = points[points.length - 1].time;
    const yr = range(Math.min(...points.map((p) => p.level)), Math.max(...points.map((p) => p.level)), 4);
    const padL = 58;
    const padR = 18;
    const padT = 16;
    const plotH = 200;
    const axis = 28;
    const height = padT + plotH + axis;
    const x = (t: number) => padL + ((t - first) / (last - first || 1)) * (width - padL - padR);
    const y = (v: number) => padT + plotH - ((v - yr.lo) / (yr.hi - yr.lo || 1)) * plotH;
    const end = points[points.length - 1];
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" tabindex="0" aria-label="${X(
      `Nivel del mar observado en metros. Última lectura ${nf(end.level, 3)} m. Usa las flechas para recorrer la serie.`,
    )}">`;
    for (let v = yr.lo, k = 0; v <= yr.hi + 1e-9; v += yr.step, k++) {
      const yy = r1(y(v));
      svg += `<line class="${k ? "gl" : "base"}" x1="${padL}" x2="${width - padR}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="tick" x="${padL - 8}" y="${yy + 3.5}" text-anchor="end">${nf(v)} m</text>`;
    }
    const ticks = width < 540 ? 2 : 4;
    for (let k = 0; k <= ticks; k++) {
      const t = first + ((last - first) * k) / ticks;
      svg += `<text class="tick" x="${r1(x(t))}" y="${padT + plotH + 18}" text-anchor="${k === 0 ? "start" : k === ticks ? "end" : "middle"}">${hhmm.format(t)}</text>`;
    }
    const pieces: SeaPoint[][] = [];
    let current: SeaPoint[] = [];
    points.forEach((p, i) => {
      if (i && p.time - points[i - 1].time > 180000) {
        pieces.push(current);
        current = [];
      }
      current.push(p);
    });
    pieces.push(current);
    for (const part of pieces) {
      if (part.length < 2) continue;
      const d = part.map((p, i) => (i ? "L" : "M") + r1(x(p.time)) + "," + r1(y(p.level))).join("");
      const area = `${d}L${r1(x(part[part.length - 1].time))},${padT + plotH}L${r1(x(part[0].time))},${padT + plotH}Z`;
      svg += `<path d="${area}" fill="${C.seaWash}"/>`;
      svg += `<path d="${d}" fill="none" stroke="${C.sea}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    if (recentFrom) {
      const recent = points.filter((p) => p.time >= recentFrom);
      if (recent.length > 1) {
        svg += `<path d="${recent.map((p, i) => (i ? "L" : "M") + r1(x(p.time)) + "," + r1(y(p.level))).join("")}" fill="none" stroke="${C.seaStrong}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
    }
    svg += `<circle cx="${r1(x(end.time))}" cy="${r1(y(end.level))}" r="4.5" fill="${C.seaStrong}" stroke="#fff" stroke-width="2"/>`;
    svg += `<text class="lbl" x="${r1(x(end.time) - 9)}" y="${r1(y(end.level) - 10)}" text-anchor="end">${nf(end.level, 3)} m</text>`;
    svg += `<line class="cross" x1="0" x2="0" y1="0" y2="0"/>`;
    svg += `<rect class="hit" x="${padL}" y="${padT}" width="${width - padL - padR}" height="${plotH}"/></svg>`;
    el.innerHTML = svg;
    const stride = Math.max(1, Math.floor(points.length / 600));
    const sample = points.filter((p, i) => i % stride === 0 || i === points.length - 1);
    const node = el.querySelector("svg");
    if (!node) return;
    crosshair(node, {
      count: sample.length,
      xAt: (i) => x(sample[i].time),
      top: padT,
      bottom: padT + plotH,
      describe: (i) => ({ title: stamp.format(sample[i].time), rows: [{ color: C.sea, value: `${nf(sample[i].level, 3)} m`, label: "nivel observado" }] }),
    });
  });
}

/* ---------- 6. Pronóstico por hora: lámina prevista + franja de probabilidad ---------- */
export function forecast(el: HTMLElement | null, { hours }: { hours: ForecastHour[] }) {
  mount(el, (width) => {
    if (!el) return;
    const n = hours.length;
    if (!n) {
      el.innerHTML = "";
      return;
    }
    const padL = 44;
    const padR = 16;
    const padT = 22;
    const plotH = 130;
    const stripGap = 12;
    const stripH = 16;
    const axis = 26;
    const plotW = width - padL - padR;
    const slot = plotW / n;
    const bw = Math.max(2, Math.min(24, slot - 2));
    const max = Math.max(0, ...hours.map((h) => h.mm ?? 0));
    const ya = nice(max || 0.5, 3);
    const top = padT;
    const bottom = padT + plotH;
    const sy = bottom + stripGap;
    const height = sy + stripH + axis;
    const xc = (i: number) => padL + slot * (i + 0.5);
    const y = (v: number) => bottom - (v / ya.top) * plotH;
    const probColor = (p: number | null) => (p == null ? null : C.prob[Math.min(4, Math.floor(p / 20))]);
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" tabindex="0" aria-label="${X(
      "Pronóstico por hora de las próximas 24 horas: precipitación prevista y probabilidad. Usa las flechas para recorrer las horas.",
    )}">`;
    svg += `<text class="panel-title" x="${padL}" y="10">mm por hora</text>`;
    for (let k = 0; k <= 3; k++) {
      const v = ya.step * k;
      const yy = r1(y(v));
      svg += `<line class="${k ? "gl" : "base"}" x1="${padL}" x2="${width - padR}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="tick" x="${padL - 8}" y="${yy + 3.5}" text-anchor="end">${nf(v)}</text>`;
    }
    let peak = -1;
    hours.forEach((h, i) => {
      if (h.mm != null && (peak < 0 || h.mm > (hours[peak].mm as number))) peak = i;
    });
    hours.forEach((h, i) => {
      const x = r1(padL + slot * i + (slot - bw) / 2);
      if (h.mm != null && h.mm > 0) {
        svg += `<path class="bar" data-i="${i}" fill="${i === peak ? C.rainStrong : C.rain}" d="${barTop(x, r1(y(h.mm)), r1(bw), r1(bottom - y(h.mm)), bw > 6 ? 4 : 1)}"/>`;
      }
      const pc = probColor(h.probabilidad);
      svg += `<rect x="${r1(padL + slot * i + 1)}" y="${sy}" width="${Math.max(1, r1(slot - 2))}" height="${stripH}" rx="3" fill="${pc || "#f1f5f9"}"/>`;
    });
    if (peak >= 0 && (hours[peak].mm as number) > 0) {
      const px = xc(peak);
      svg += `<text class="lbl" x="${r1(px)}" y="${r1(y(hours[peak].mm as number) - 7)}" text-anchor="${px > width - 80 ? "end" : px < padL + 40 ? "start" : "middle"}">${nf(hours[peak].mm)} mm</text>`;
    }
    svg += `<text class="tick" x="${padL - 8}" y="${sy + 11.5}" text-anchor="end">prob.</text>`;
    const labels = Math.min(width < 520 ? 4 : 7, n);
    for (let k = 0; k < labels; k++) {
      const i = Math.round((k * (n - 1)) / Math.max(1, labels - 1));
      svg += `<text class="tick" x="${r1(xc(i))}" y="${sy + stripH + 17}" text-anchor="${k === 0 ? "start" : k === labels - 1 ? "end" : "middle"}">${hhmm.format(Date.parse(hours[i].inicio))}</text>`;
    }
    svg += `<line class="cross" x1="0" x2="0" y1="0" y2="0"/>`;
    svg += `<rect class="hit" x="${padL}" y="0" width="${plotW}" height="${sy + stripH}"/></svg>`;
    el.innerHTML = svg;
    const node = el.querySelector("svg");
    if (!node) return;
    const bars = Array.from(node.querySelectorAll<SVGPathElement>(".bar"));
    crosshair(node, {
      count: n,
      xAt: xc,
      top,
      bottom: sy + stripH,
      onIndex: (i) =>
        bars.forEach((b) => {
          b.style.opacity = i < 0 || Number(b.dataset.i) === i ? "" : ".45";
        }),
      describe: (i) => {
        const h = hours[i];
        return {
          title: `${hhmm.format(Date.parse(h.inicio))} → ${hhmm.format(Date.parse(h.fin))} · ${dayShort.format(Date.parse(h.fin))}`,
          rows: [
            { color: C.rain, shape: "block", value: h.mm == null ? "—" : `${nf(h.mm)} mm`, label: "precipitación prevista" },
            { color: probColor(h.probabilidad) || C.muted, shape: "block", value: h.probabilidad == null ? "—" : `${nf(h.probabilidad, 0)} %`, label: "probabilidad" },
          ],
        };
      },
    });
  });
}
