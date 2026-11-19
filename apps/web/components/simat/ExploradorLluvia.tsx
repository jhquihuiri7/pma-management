"use client";

// Explorador interactivo de lluvia (canvas), portado de la vista previa
// (risk-ui.js: rainfallHistory / drawRainExplorer) y ampliado con el riesgo del
// sector: sobre las barras de intensidad se dibuja la marea astronómica del
// puerto (eje derecho) y los umbrales del criterio, y de fondo se pinta el nivel
// de la escala de riesgo (Normal, Vigilancia, Preparación, Respuesta) que resulta
// en cada momento. Puede seguir con el pronóstico horario de lluvia para ver los
// momentos de riesgo previstos. Puntero, flechas del teclado, periodo visible y
// salto al máximo.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SimatCriterio, SimatEstacion, SimatPronosticoHora, SimatSerieLluvia } from "@pma/types";
import { range, type TideExtreme, type TidePoint } from "@/lib/simat/graficos";
import { nivelMarea } from "@/lib/simat/marinos";
import { duracion, fechaDia, fechaHora, medida, numero } from "@/lib/simat/formato";
import { Icono } from "./iconos";
import { ESCALA, indiceLluvia, nivelConMar, type NivelEscala } from "./matriz";

const TZ = "Pacific/Galapagos";
const ejeHora = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ejeDiaHora = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ejeDia = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const altura = new Intl.NumberFormat("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MIN = 60000;
const HORA = 3600e3;
/** Igual que la API (ventanas.ts): una ventana necesita el 90 % de las lecturas esperadas. */
const COBERTURA_MINIMA = 0.9;

/** Colores de los niveles: los de .simat .normal/.caution/.alert/.emergency. */
const COLOR: Record<NivelEscala["code"], { bg: string; stroke: string }> = {
  normal: { bg: "#ecf9ee", stroke: "#0ca30c" },
  caution: { bg: "#fff2c9", stroke: "#fab219" },
  alert: { bg: "#fde3d5", stroke: "#ec835a" },
  emergency: { bg: "#fbd9d9", stroke: "#d03b3b" },
};
const C = {
  barra: "#0d9488",
  pico: "#115e59",
  previsto: "rgba(13,148,136,.30)",
  ventana: "#0f172a",
  marea: "#2a78d6",
  mareaArea: "rgba(42,120,214,.12)",
  extremo: "#1c5cab",
  percentil: "#7c3aed",
  observado: "#eb6834",
  umbralMar: "#1c5cab",
  texto: "#94a3b8",
  texto2: "#64748b",
};

type Muestra = SimatSerieLluvia["recent"][number];
interface Fila {
  inicio: number;
  fin: number;
  record?: Muestra;
  /** mm/h del intervalo (observado o previsto). */
  intensity: number | null;
  previsto: boolean;
  probabilidad?: number | null;
  /** mm/h promedio en la ventana del criterio que termina en `fin`. */
  ventana?: number | null;
}
interface Tramo {
  desde: number;
  hasta: number;
  nivel: NivelEscala;
  previsto: boolean;
}

export interface MareaExplorador {
  extremos: TideExtreme[];
  /** Niveles observados en el mismo datum que la predicción. */
  observados: TidePoint[];
  /** Percentiles de marea alta del puerto, si son comparables con la predicción. */
  percentiles?: { p90: number; p95: number; p99: number; confirmado: boolean } | null;
}

function etiquetaIntervalo(f: Fila, step: number) {
  return step === 1440 && !f.previsto ? fechaDia(new Date(f.fin).toISOString()) : `${fechaHora(new Date(f.inicio).toISOString())} → ${fechaHora(new Date(f.fin).toISOString())}`;
}

function rangoTramo(z: Tramo) {
  const mismoDia = ejeDia.format(z.desde) === ejeDia.format(z.hasta);
  return `${ejeDiaHora.format(z.desde)} → ${mismoDia ? ejeHora.format(z.hasta) : ejeDiaHora.format(z.hasta)}`;
}

/** Marea más alta en [a, b]: los dos bordes y cualquier pleamar publicada entre ellos. */
function mareaMaxima(extremos: TideExtreme[], a: number, b: number): number | null {
  const valores = [nivelMarea(extremos, a), nivelMarea(extremos, b)].concat(extremos.filter((e) => e.t >= a && e.t <= b).map((e) => e.h));
  const validos = valores.filter((v): v is number => v != null);
  return validos.length ? Math.max(...validos) : null;
}

/**
 * Nivel de la escala en un instante: el de la lluvia en la ventana y, si el
 * sector tiene umbral de mar comparable, uno más donde la marea lo alcanza
 * (sin dato de marea queda el de la lluvia, como en la API).
 */
function nivelDe(ventana: number | null | undefined, mar: number | null, criterio: SimatCriterio, conMar: boolean): NivelEscala | null {
  if (ventana == null) return null;
  const indice = indiceLluvia(ventana, criterio.lluvia);
  return conMar && criterio.marM != null && mar != null ? nivelConMar(indice, mar >= criterio.marM) : ESCALA[indice];
}

function ChipNivel({ nivel }: { nivel: NivelEscala }) {
  return (
    <span className={`nivel-chip ${nivel.code}`}>
      <Icono nombre={nivel.icon} />
      {nivel.name}
    </span>
  );
}

export default function ExploradorLluvia({
  estacion,
  lluvia,
  criterio = null,
  marea = null,
  pronostico = null,
}: {
  estacion: SimatEstacion;
  lluvia: SimatSerieLluvia;
  criterio?: SimatCriterio | null;
  marea?: MareaExplorador | null;
  pronostico?: SimatPronosticoHora[] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const escala = useRef<{ left: number; right: number; t0: number; t1: number } | null>(null);
  const step = estacion.pasoMin;
  const stepMs = step * MIN;
  const horaria = step < 1440;
  const records = lluvia.recent;
  const end = Date.parse(records[records.length - 1].time);
  const start = Date.parse(records[0].time);
  const span = (end - start) / MIN + step;

  const periodos = useMemo(() => {
    const w: [number, string][] = !horaria
      ? [
          [10080, "7 días"],
          [43200, "30 días"],
        ]
      : ([
          [60, "1 hora"],
          [180, "3 horas"],
          [360, "6 horas"],
          [1440, "24 horas"],
        ] as [number, string][]).filter(([m], i) => m >= step && (i === 0 || m <= span));
    if (!w.length) w.push([step, duracion(step)]);
    return w;
  }, [horaria, step, span]);
  const [periodo, setPeriodo] = useState(periodos[periodos.length - 1][0]);
  useEffect(() => {
    if (!periodos.some(([m]) => m === periodo)) setPeriodo(periodos[periodos.length - 1][0]);
  }, [periodos, periodo]);

  const hayPronostico = horaria && !!pronostico?.some((h) => Date.parse(h.fin) > end);
  const [conPronostico, setConPronostico] = useState(true);
  const mostrarPronostico = hayPronostico && conPronostico;

  // Marea y criterio: las zonas solo se pintan si el umbral de mar está en el
  // mismo datum que la predicción publicada.
  const hayMarea = horaria && !!marea && marea.extremos.length >= 2;
  const refMarea = hayMarea ? (marea?.extremos[0]?.ref ?? "") : "";
  const datumCompatible = !!criterio && hayMarea && criterio.datum.trim().toLowerCase() === refMarea.toLowerCase();
  const conCriterio = horaria && !!criterio;
  // Las zonas salen de la lluvia; el mar solo cuenta con umbral y datum comparable.
  const conZonas = conCriterio;
  const marAplica = conCriterio && criterio?.marM != null && datumCompatible;
  const ventanaMin = criterio?.ventanaMin ?? step;

  // Intervalos observados de toda la serie: cada lectura cierra un intervalo y
  // los huecos de la cadencia quedan como intervalos sin registro.
  const observadas = useMemo(() => {
    const filas: Fila[] = [];
    let previo: number | null = null;
    for (const r of records) {
      const t = Date.parse(r.time);
      if (!Number.isFinite(t)) continue;
      if (previo !== null) {
        for (let hueco = previo + stepMs, n = 0; t - hueco > stepMs / 2 && n < 2000; hueco += stepMs, n++) {
          filas.push({ inicio: hueco - stepMs, fin: hueco, intensity: null, previsto: false });
          previo = hueco;
        }
      }
      const inicio = previo !== null && t - previo < stepMs * 1.5 ? previo : t - stepMs;
      filas.push({ inicio, fin: t, record: r, intensity: r.quality === "válido" ? (r.value * 60) / step : null, previsto: false });
      previo = t;
    }
    return filas;
  }, [records, step, stepMs]);

  const filas = useMemo(() => {
    const desde = end - periodo * MIN;
    const futuras: Fila[] = mostrarPronostico
      ? (pronostico ?? [])
          .filter((h) => Date.parse(h.fin) > end)
          .map((h) => ({ inicio: Math.max(Date.parse(h.inicio), end), fin: Date.parse(h.fin), intensity: h.mm, previsto: true, probabilidad: h.probabilidad }))
      : [];
    const todas = observadas.filter((f) => f.fin > desde).concat(futuras);
    if (!conCriterio) return todas;

    // Lluvia promedio en la ventana del criterio que termina en T: lo observado
    // con la regla de cobertura de la API y, después del último dato, lo previsto.
    const lecturas = records.map((r) => ({ t: Date.parse(r.time), r }));
    const ventanaMs = ventanaMin * MIN;
    const intensidadVentana = (T: number): number | null => {
      const a = T - ventanaMs;
      let total = 0;
      if (a < end) {
        const hasta = Math.min(T, end);
        const dentro = lecturas.filter((l) => l.t > a && l.t <= hasta);
        const esperados = Math.max(1, Math.round((hasta - a) / stepMs));
        if (dentro.some((l) => l.r.quality !== "válido") || dentro.length < Math.ceil(esperados * COBERTURA_MINIMA)) return null;
        total += dentro.reduce((s, l) => s + l.r.value, 0);
      }
      if (T > end) {
        const desdePrevisto = Math.max(a, end);
        let cubierto = 0;
        for (const f of futuras) {
          const solape = Math.min(T, f.fin) - Math.max(desdePrevisto, f.inicio);
          if (solape <= 0) continue;
          if (f.intensity == null) return null;
          total += (f.intensity * solape) / HORA;
          cubierto += solape;
        }
        if (cubierto < (T - desdePrevisto) * COBERTURA_MINIMA) return null;
      }
      return (total * 60) / ventanaMin;
    };
    return todas.map((f) => ({ ...f, ventana: intensidadVentana(f.fin) }));
  }, [observadas, records, periodo, end, stepMs, mostrarPronostico, pronostico, conCriterio, ventanaMin]);

  // Tramos continuos de cada nivel de la matriz: la lluvia es la del intervalo
  // que contiene el instante y el mar, la curva de marea en ese instante.
  const tramos = useMemo<Tramo[]>(() => {
    if (!conZonas || !criterio || !filas.length) return [];
    const t0 = filas[0].inicio;
    const t1 = filas[filas.length - 1].fin;
    const paso = Math.max(MIN, Math.round((t1 - t0) / 1500));
    const res: Tramo[] = [];
    let j = 0;
    for (let t = t0; t < t1; t += paso) {
      while (j < filas.length - 1 && filas[j].fin <= t) j++;
      const f = filas[j];
      const mar = marAplica && marea ? mareaMaxima(marea.extremos, t, t + paso) : null;
      const nivel = f.inicio <= t && t < f.fin ? nivelDe(f.ventana, mar, criterio, marAplica) : null;
      if (!nivel) continue;
      const previsto = t >= end;
      const hasta = Math.min(t + paso, t1);
      const ultimo = res[res.length - 1];
      if (ultimo && ultimo.nivel === nivel && ultimo.previsto === previsto && ultimo.hasta === t) ultimo.hasta = hasta;
      else res.push({ desde: t, hasta, nivel, previsto });
    }
    return res;
  }, [conZonas, marAplica, criterio, marea, filas, end]);
  const riesgosos = tramos.filter((z) => z.nivel.code !== "normal");

  const { picos, maximo } = useMemo(() => {
    const validas = filas.filter((r) => !r.previsto && r.intensity !== null);
    const maximo = validas.length ? Math.max(...validas.map((r) => r.intensity as number)) : null;
    const picos = new Set(filas.flatMap((r, i) => (!r.previsto && maximo !== null && r.intensity === maximo ? [i] : [])));
    return { picos, maximo };
  }, [filas]);

  const ultimoObservado = filas.reduce((u, f, i) => (f.previsto ? u : i), filas.length - 1);
  const ultimoPico = Array.from(picos).pop();
  const [indice, setIndice] = useState(ultimoPico ?? ultimoObservado);
  useEffect(() => {
    setIndice(ultimoPico ?? ultimoObservado);
  }, [filas, ultimoPico, ultimoObservado]);

  // Dibujo
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !filas.length) return;
    const dibujar = () => {
      if (!canvas.isConnected || !canvas.clientWidth) return;
      const ratio = devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const left = 54;
      const right = w - (hayMarea ? 56 : 18);
      const top = conZonas ? 40 : 24;
      const bottom = h - 32;
      const t0 = filas[0].inicio;
      const t1 = filas[filas.length - 1].fin;
      const x = (t: number) => left + ((t - t0) / (t1 - t0 || 1)) * (right - left);
      escala.current = { left, right, t0, t1 };

      // Escala de lluvia (incluye el umbral del criterio para poder compararlo).
      const max = 1.12 * Math.max(0, ...filas.map((r) => Math.max(r.intensity ?? 0, r.ventana ?? 0)), conCriterio && criterio ? criterio.lluvia.respuesta : 0);
      const power = 10 ** Math.floor(Math.log10((max || 1) / 5));
      const tick = ([0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].find((n) => n * power >= (max || 1) / 5) ?? 10) * power;
      const marcas = Math.max(2, Math.ceil((max || 1) / tick - 1e-9));
      const ceiling = tick * marcas;
      const y = (v: number) => bottom - (v / ceiling) * (bottom - top);

      // Escala de la marea (eje derecho): curva estimada entre las pleamares y
      // bajamares publicadas, que pasa exactamente por ellas.
      const mar = (() => {
        if (!hayMarea || !marea) return null;
        const extremos = marea.extremos.filter((e) => e.t >= t0 && e.t <= t1);
        const curva: TidePoint[] = extremos.map((e) => ({ t: e.t, h: e.h }));
        const paso = Math.max(MIN, (t1 - t0) / 400);
        for (let t = t0; t <= t1; t += paso) {
          const nivel = nivelMarea(marea.extremos, t);
          if (nivel != null) curva.push({ t, h: nivel });
        }
        const fin = nivelMarea(marea.extremos, t1);
        if (fin != null) curva.push({ t: t1, h: fin });
        curva.sort((a, b) => a.t - b.t);
        const obs = marea.observados.filter((o) => o.t >= t0 && o.t <= t1);
        const pct = marea.percentiles ?? null;
        const valores = curva.map((p) => p.h).concat(obs.map((o) => o.h), marAplica && criterio?.marM != null ? [criterio.marM] : [], pct ? [pct.p90, pct.p95, pct.p99] : []);
        if (!valores.length) return null;
        const bajo = Math.min(...valores);
        const alto = Math.max(...valores);
        const yr = range(bajo, alto + (alto - bajo) * 0.15, 4);
        const ym = (v: number) => bottom - ((v - yr.lo) / (yr.hi - yr.lo)) * (bottom - top);
        return { extremos, curva, obs, yr, ym, pct, ultimo: marea.extremos[marea.extremos.length - 1] };
      })();

      // 1 · zonas de la escala y cinta superior
      for (const z of tramos) {
        const x0 = x(z.desde);
        const ancho = Math.max(1, x(z.hasta) - x0);
        ctx.globalAlpha = z.previsto ? 0.6 : 1;
        ctx.fillStyle = COLOR[z.nivel.code].bg;
        ctx.fillRect(x0, top, ancho, bottom - top);
        ctx.globalAlpha = 1;
        ctx.fillStyle = COLOR[z.nivel.code].stroke;
        ctx.fillRect(x0, top - 12, ancho, 7);
      }
      if (conZonas) {
        ctx.font = "600 10px Inter, system-ui, sans-serif";
        ctx.fillStyle = C.texto2;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText("Nivel", left - 6, top - 8.5);
      }

      // 2 · intervalos observados sin dato válido
      ctx.fillStyle = "rgba(148,163,184,.16)";
      for (const r of filas) if (!r.previsto && r.intensity === null) ctx.fillRect(x(r.inicio) + 0.5, top, Math.max(1, x(r.fin) - x(r.inicio) - 1), bottom - top);

      // 3 · rejilla y eje de lluvia
      ctx.font = "500 10.5px Inter, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      for (let i = 0; i <= marcas; i++) {
        const level = i * tick;
        ctx.strokeStyle = i ? "rgba(203,213,225,.55)" : "#cbd5e1";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y(level)) + 0.5);
        ctx.lineTo(right, Math.round(y(level)) + 0.5);
        ctx.stroke();
        ctx.fillStyle = C.texto;
        ctx.fillText(numero(level), left - 8, y(level));
      }
      ctx.textAlign = "left";
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.fillStyle = C.texto2;
      ctx.fillText("Lluvia (mm/h)", 10, 9);

      // 3b · área bajo la curva de marea
      if (mar && mar.curva.length > 1) {
        ctx.fillStyle = C.mareaArea;
        ctx.beginPath();
        mar.curva.forEach((p, i) => (i ? ctx.lineTo(x(p.t), mar.ym(p.h)) : ctx.moveTo(x(p.t), mar.ym(p.h))));
        ctx.lineTo(x(mar.curva[mar.curva.length - 1].t), bottom);
        ctx.lineTo(x(mar.curva[0].t), bottom);
        ctx.closePath();
        ctx.fill();
      }

      // 4 · barras (observadas y previstas)
      filas.forEach((row, i) => {
        if (row.intensity === null || row.intensity <= 0) return;
        const x0 = x(row.inicio);
        const ancho = x(row.fin) - x0;
        const barWidth = Math.max(1, Math.min(24, ancho - 2));
        const bx = x0 + (ancho - barWidth) / 2;
        const height = bottom - y(row.intensity);
        const r = Math.min(4, barWidth / 2, height);
        ctx.beginPath();
        if (ctx.roundRect && barWidth > 6) ctx.roundRect(bx, bottom - height, barWidth, height, [r, r, 0, 0]);
        else ctx.rect(bx, bottom - height, barWidth, height);
        if (row.previsto) {
          ctx.fillStyle = C.previsto;
          ctx.fill();
          ctx.strokeStyle = C.barra;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = picos.has(i) ? C.pico : C.barra;
          if (indice >= 0 && i !== indice) ctx.globalAlpha = 0.6;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      });

      // 5 · lluvia en la ventana del criterio (si no coincide con la cadencia)
      if (conCriterio && ventanaMin !== step) {
        ctx.strokeStyle = C.ventana;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let abierto = false;
        for (const r of filas) {
          if (r.ventana == null) {
            abierto = false;
            continue;
          }
          const yy = y(r.ventana);
          if (!abierto) ctx.moveTo(x(r.inicio), yy);
          else ctx.lineTo(x(r.inicio), yy);
          ctx.lineTo(x(r.fin), yy);
          abierto = true;
        }
        ctx.stroke();
      }

      // 6 · umbrales de lluvia de la escala (vigilancia, preparación, respuesta)
      if (conCriterio && criterio) {
        const umbrales: [number, NivelEscala][] = [
          [criterio.lluvia.vigilancia, ESCALA[1]],
          [criterio.lluvia.preparacion, ESCALA[2]],
          [criterio.lluvia.respuesta, ESCALA[3]],
        ];
        ctx.font = "600 10.5px Inter, system-ui, sans-serif";
        ctx.textAlign = "left";
        let ultimaEtiqueta = Infinity;
        for (const [valor, nivel] of umbrales) {
          const yy = Math.round(y(valor)) + 0.5;
          ctx.strokeStyle = COLOR[nivel.code].stroke;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(left, yy);
          ctx.lineTo(right, yy);
          ctx.stroke();
          ctx.setLineDash([]);
          // Etiqueta sobre la línea; si choca con la anterior o con el borde, debajo.
          const debajo = yy - 16 < top || ultimaEtiqueta - yy < 14;
          ctx.textBaseline = debajo ? "top" : "bottom";
          const ly = debajo ? yy + 4 : yy - 3;
          const texto = `${nivel.name} ≥ ${medida(valor)} mm/h`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(255,255,255,.9)";
          ctx.strokeText(texto, left + 6, ly);
          ctx.fillStyle = COLOR[nivel.code].stroke === "#fab219" ? "#a16207" : COLOR[nivel.code].stroke;
          ctx.fillText(texto, left + 6, ly);
          ultimaEtiqueta = yy;
        }
      }

      // 7 · marea (eje derecho): umbral de mar alto, curva, pleamares y
      // bajamares publicadas con su hora y altura, y niveles observados
      if (mar) {
        const { yr, ym } = mar;
        ctx.font = "500 10.5px Inter, system-ui, sans-serif";
        ctx.fillStyle = C.marea;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        for (let v = yr.lo; v <= yr.hi + 1e-9; v += yr.step) ctx.fillText(numero(v), right + 8, ym(v));
        ctx.font = "600 11px Inter, system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`${w < 560 ? "Marea" : "Marea prevista"} (m, ${refMarea || "—"})`, w - 6, 9);
        if (marAplica && criterio?.marM != null) {
          const yy = Math.round(ym(criterio.marM)) + 0.5;
          ctx.strokeStyle = C.umbralMar;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(left, yy);
          ctx.lineTo(right, yy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = "600 10.5px Inter, system-ui, sans-serif";
          ctx.fillStyle = C.umbralMar;
          ctx.textAlign = "right";
          const debajo = yy - 16 < top;
          ctx.textBaseline = debajo ? "top" : "bottom";
          ctx.fillText(`Mar alto ≥ ${medida(criterio.marM)} m`, right - 6, debajo ? yy + 4 : yy - 3);
        }
        // Percentiles de marea alta (referencia de monitoreo, no cambian el nivel).
        if (mar.pct) {
          const lineas: [string, number][] = [
            ["p90", mar.pct.p90],
            ["p95", mar.pct.p95],
            ["p99", mar.pct.p99],
          ];
          ctx.font = "600 10px Inter, system-ui, sans-serif";
          ctx.textAlign = "right";
          let previa = -Infinity;
          for (const [nombre, valor] of lineas) {
            const yy = Math.round(ym(valor)) + 0.5;
            ctx.strokeStyle = C.percentil;
            ctx.globalAlpha = 0.8;
            ctx.lineWidth = 1.2;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(left, yy);
            ctx.lineTo(right, yy);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            // Las etiquetas muy juntas (p95 y p99 iguales) se escriben una vez.
            if (Math.abs(yy - previa) >= 11) {
              const texto = `${nombre} ${altura.format(valor)} m`;
              ctx.textBaseline = "bottom";
              ctx.lineWidth = 3;
              ctx.strokeStyle = "rgba(255,255,255,.92)";
              ctx.strokeText(texto, right - 4, yy - 2);
              ctx.fillStyle = C.percentil;
              ctx.fillText(texto, right - 4, yy - 2);
              previa = yy;
            }
          }
        }

        ctx.strokeStyle = C.marea;
        ctx.lineWidth = 2.25;
        ctx.lineJoin = "round";
        ctx.beginPath();
        mar.curva.forEach((p, i) => (i ? ctx.lineTo(x(p.t), ym(p.h)) : ctx.moveTo(x(p.t), ym(p.h))));
        ctx.stroke();

        // Después de la última predicción publicada no se extrapola.
        if (mar.ultimo.t < t1 && x(t1) - x(mar.ultimo.t) > 90) {
          const cx = (x(Math.max(mar.ultimo.t, t0)) + right) / 2;
          const cy = top + (bottom - top) * 0.45;
          ctx.font = "italic 500 10.5px Inter, system-ui, sans-serif";
          ctx.fillStyle = C.texto2;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("Sin predicción", cx, cy);
          ctx.fillText("de marea publicada", cx, cy + 14);
        }

        for (const o of mar.obs) {
          ctx.beginPath();
          ctx.arc(x(o.t), ym(o.h), 2.6, 0, Math.PI * 2);
          ctx.fillStyle = C.observado;
          ctx.fill();
        }

        const angosto = w < 560;
        ctx.font = "600 10.5px Inter, system-ui, sans-serif";
        ctx.textAlign = "left";
        for (const e of mar.extremos) {
          const px = x(e.t);
          const py = ym(e.h);
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fillStyle = C.extremo;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
          const pleamar = e.fase === "Pleamar";
          const texto = angosto ? `${pleamar ? "PM" : "BM"} ${altura.format(e.h)}` : `${e.fase} ${ejeHora.format(e.t)} · ${altura.format(e.h)} m`;
          const ancho = ctx.measureText(texto).width;
          const lx = Math.max(left + 2, Math.min(right - ancho - 2, px - ancho / 2));
          let arriba = pleamar;
          if (arriba && py - 9 - 12 < top) arriba = false;
          if (!arriba && py + 9 + 12 > bottom) arriba = true;
          ctx.textBaseline = arriba ? "bottom" : "top";
          const ly = arriba ? py - 8 : py + 8;
          ctx.lineWidth = 3;
          ctx.lineJoin = "round";
          ctx.strokeStyle = "rgba(255,255,255,.92)";
          ctx.strokeText(texto, lx, ly);
          ctx.fillStyle = C.extremo;
          ctx.fillText(texto, lx, ly);
        }
      }

      // 8 · separación entre lo observado y lo previsto
      if (mostrarPronostico && end > t0 && end < t1) {
        const xx = Math.round(x(end)) + 0.5;
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xx, top);
        ctx.lineTo(xx, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "600 10.5px Inter, system-ui, sans-serif";
        ctx.fillStyle = "#475569";
        ctx.textBaseline = "top";
        ctx.textAlign = "right";
        ctx.fillText("Observado", xx - 5, top + 5);
        ctx.textAlign = "left";
        ctx.fillText("Pronóstico", xx + 5, top + 5);
      }

      // 9 · intervalo seleccionado
      const sel = filas[indice];
      if (sel) {
        const x0 = x(sel.inicio);
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 1, top + 1, Math.max(1, x(sel.fin) - x0 - 2), bottom - top - 2);
      }

      // 10 · eje de tiempo
      const labels = w < 530 ? 3 : 6;
      const largo = t1 - t0 > 20 * HORA;
      ctx.font = "500 10.5px Inter, system-ui, sans-serif";
      ctx.fillStyle = C.texto;
      ctx.textBaseline = "middle";
      for (let i = 0; i < labels; i++) {
        const t = t0 + ((t1 - t0) * i) / (labels - 1);
        ctx.textAlign = i === 0 ? "left" : i === labels - 1 ? "right" : "center";
        const label = !horaria ? fechaDia(new Date(t).toISOString()).slice(5) : largo ? ejeDiaHora.format(t) : ejeHora.format(t);
        ctx.fillText(label, x(t), bottom + 18);
      }
    };
    dibujar();
    const ro = new ResizeObserver(dibujar);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [filas, tramos, picos, indice, step, horaria, hayMarea, marea, refMarea, datumCompatible, marAplica, conCriterio, conZonas, criterio, ventanaMin, mostrarPronostico, end]);

  const seleccionar = (i: number) => setIndice(Math.max(0, Math.min(filas.length - 1, i)));
  const filaEn = (t: number) => {
    const dentro = filas.findIndex((f) => f.inicio <= t && t < f.fin);
    if (dentro >= 0) return dentro;
    let mejor = 0;
    filas.forEach((f, i) => {
      if (Math.abs((f.inicio + f.fin) / 2 - t) < Math.abs((filas[mejor].inicio + filas[mejor].fin) / 2 - t)) mejor = i;
    });
    return mejor;
  };
  const desdePuntero = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = escala.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;
    const px = e.clientX - canvas.getBoundingClientRect().left;
    if (px < g.left || px > g.right) return;
    const i = filaEn(g.t0 + ((px - g.left) / (g.right - g.left)) * (g.t1 - g.t0));
    if (i !== indice) seleccionar(i);
  };
  const fila = filas[indice];
  const picoFila = ultimoPico !== undefined ? filas[ultimoPico] : undefined;
  const marFila = fila && hayMarea && marea ? nivelMarea(marea.extremos, fila.fin) : null;
  const nivelFila = fila && conZonas && criterio ? nivelDe(fila.ventana, marFila, criterio, marAplica) : null;

  return (
    <>
      <div className="rain-tools">
        <label>
          Periodo visible
          <select value={periodo} onChange={(e) => setPeriodo(Number(e.target.value))}>
            {periodos.map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>
        {hayPronostico ? (
          <label className="auto-toggle rain-forecast-toggle" title="Añadir las próximas 24 horas del pronóstico de lluvia (Open-Meteo)">
            <input type="checkbox" checked={conPronostico} onChange={(e) => setConPronostico(e.target.checked)} />
            <span className="switch" aria-hidden="true" />
            <span>Pronóstico 24 h</span>
          </label>
        ) : null}
        <div className="rain-peak">
          <small>Máximo observado</small>
          <strong>{maximo === null ? "Sin datos válidos" : `${medida(maximo)} mm/h`}</strong>
          <span>{picoFila ? `${picos.size > 1 ? `${picos.size} intervalos empatados · último: ` : ""}${etiquetaIntervalo(picoFila, step)}` : ""}</span>
        </div>
        <button type="button" className="button secondary" disabled={maximo === null} onClick={() => ultimoPico !== undefined && seleccionar(ultimoPico)}>
          Ir al máximo
        </button>
      </div>
      <p className="meta rain-hint" id="rain-help">
        Pasa el cursor o toca una barra. También puedes recorrer los intervalos con las flechas del teclado.
      </p>
      <canvas
        ref={canvasRef}
        className={`rain-interactive-chart${hayMarea ? " con-marea" : ""}`}
        tabIndex={0}
        aria-label={hayMarea ? "Gráfica interactiva de lluvia en milímetros por hora, marea y niveles de la escala de riesgo" : "Gráfica interactiva de lluvia en milímetros por hora"}
        aria-describedby="rain-help rain-selection"
        onPointerMove={(e) => (e.pointerType === "mouse" || e.pointerType === "pen") && desdePuntero(e)}
        onPointerUp={desdePuntero}
        onKeyDown={(e) => {
          const offset = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
          if (offset) {
            e.preventDefault();
            seleccionar(indice + offset);
          }
        }}
      />
      <div className="chart-legend rain-legend">
        <span>
          <i style={{ "--c": C.barra } as CSSProperties} />
          Intensidad observada
        </span>
        {mostrarPronostico ? (
          <span>
            <i className="previsto" />
            Lluvia prevista
          </span>
        ) : null}
        {conCriterio && ventanaMin !== step ? (
          <span>
            <i className="line" style={{ "--c": C.ventana } as CSSProperties} />
            Promedio en {duracion(ventanaMin)}
          </span>
        ) : null}
        {hayMarea ? (
          <span>
            <i className="line" style={{ "--c": C.marea, height: 3 } as CSSProperties} />
            Marea prevista · curva estimada ({refMarea})
          </span>
        ) : null}
        {hayMarea ? (
          <span>
            <i className="dot" style={{ "--c": C.extremo } as CSSProperties} />
            Pleamar (PM) y bajamar (BM) publicadas · INOCAR
          </span>
        ) : null}
        {hayMarea && marea?.percentiles ? (
          <span>
            <i className="pct" />
            Percentiles de marea alta (p90 · p95 · p99){marea.percentiles.confirmado ? "" : " · datum MLWS no confirmado"}
          </span>
        ) : null}
        {hayMarea && marea?.observados.length ? (
          <span>
            <i className="dot" style={{ "--c": C.observado } as CSSProperties} />
            Nivel observado
          </span>
        ) : null}
        {conCriterio ? (
          <span>
            <i className="umbral" style={{ "--c": COLOR.alert.stroke } as CSSProperties} />
            Umbrales de lluvia (vigilancia · preparación · respuesta)
          </span>
        ) : null}
        {marAplica ? (
          <span>
            <i className="umbral punteado" style={{ "--c": C.umbralMar } as CSSProperties} />
            Umbral de mar
          </span>
        ) : null}
        <span>
          <i className="gap" />
          Sin dato válido
        </span>
      </div>
      {conZonas ? (
        <div className="chart-legend rain-legend zonas-legend">
          <span className="meta">Zonas de la escala:</span>
          {ESCALA.map((n) => (
            <span key={n.code}>
              <i style={{ "--c": COLOR[n.code].bg, boxShadow: `inset 0 3px 0 ${COLOR[n.code].stroke}` } as CSSProperties} />
              {n.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="riesgo-notas">
        {!horaria ? null : !criterio ? (
          <p className="meta">Este sector no tiene criterio configurado: se muestran la lluvia y la marea, sin zonas de riesgo.</p>
        ) : (
          <>
            {!criterio.activo || criterio.estadoValidacion === "experimental" ? (
              <p className="riesgo-provisional">
                <Icono nombre="alert" />
                Umbrales {criterio.estadoValidacion === "experimental" ? "experimentales" : "sin activar"} del sector {criterio.sector}: las zonas son orientativas, no un nivel oficial.
              </p>
            ) : null}
            <p className="meta">
              Cada zona compara la lluvia promedio en {duracion(ventanaMin)} con los umbrales del sector: vigilancia desde {medida(criterio.lluvia.vigilancia)}, preparación desde {medida(criterio.lluvia.preparacion)} y respuesta
              desde {medida(criterio.lluvia.respuesta)} mm/h.{" "}
              {criterio.marM == null
                ? "El sector no tiene umbral de mar: la marea se muestra como referencia y no cambia el nivel."
                : !hayMarea
                  ? "El puerto no tiene predicción de marea en el periodo: el nivel queda solo por la lluvia."
                  : !datumCompatible
                    ? `El umbral de mar está en «${criterio.datum}» y la marea en «${refMarea}»: no se comparan y el nivel queda solo por la lluvia.`
                    : `Donde la marea prevista por INOCAR alcanza ${medida(criterio.marM)} m ${criterio.datum}, el nivel sube uno. La evaluación del sector usa el nivel del mar observado.`}
            </p>
          </>
        )}
      </div>
      {conZonas ? (
        <div className="riesgo-tramos">
          <strong>Momentos de riesgo en el periodo</strong>
          {riesgosos.length ? (
            <ul>
              {riesgosos.map((z) => (
                <li key={`${z.desde}-${z.nivel.code}`}>
                  <button type="button" onClick={() => seleccionar(filaEn(z.desde))}>
                    <ChipNivel nivel={z.nivel} />
                    <span>{rangoTramo(z)}</span>
                    {z.previsto ? <em>previsto</em> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">Sin precaución, alerta ni emergencia en el periodo visible.</p>
          )}
        </div>
      ) : null}
      <div className="rain-inspector">
        <div id="rain-selection" role="status">
          {fila ? (
            <>
              <strong>
                {etiquetaIntervalo(fila, step)}
                {fila.previsto ? " · pronóstico" : ""}
              </strong>
              <p data-rain-detail="">
                {fila.previsto ? (
                  fila.intensity === null ? (
                    "Sin precipitación prevista para esta hora."
                  ) : (
                    <>
                      <b>{medida(fila.intensity)} mm/h</b> previstos{fila.probabilidad != null ? ` · probabilidad ${medida(fila.probabilidad)} %` : ""} · Open-Meteo
                    </>
                  )
                ) : fila.intensity === null ? (
                  fila.record ? (
                    `Dato sin validar · ${fila.record.quality}`
                  ) : (
                    "Sin registro en este intervalo."
                  )
                ) : (
                  <>
                    <b>{medida(fila.intensity)} mm/h</b> · {medida(fila.record?.value)} mm acumulados · {fila.record?.source}
                  </>
                )}
              </p>
              {conCriterio ? (
                <p className="riesgo-fila">
                  {ventanaMin !== step ? (
                    <>
                      Promedio en {duracion(ventanaMin)}: <b>{fila.ventana == null ? "sin dato completo" : `${medida(Math.round(fila.ventana * 100) / 100)} mm/h`}</b>
                      {" · "}
                    </>
                  ) : null}
                  {hayMarea ? (
                    <>
                      Marea al cierre: <b>{marFila == null ? "—" : `${medida(Math.round(marFila * 100) / 100)} m ${refMarea}`}</b>
                    </>
                  ) : null}
                  {nivelFila ? <ChipNivel nivel={nivelFila} /> : conZonas ? <span className="meta"> · nivel no determinable</span> : null}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="toolbar">
          <button type="button" className="icon-button" aria-label="Intervalo anterior" disabled={indice <= 0} onClick={() => seleccionar(indice - 1)}>
            <Icono nombre="left" />
          </button>
          <button type="button" className="icon-button" aria-label="Intervalo siguiente" disabled={indice >= filas.length - 1} onClick={() => seleccionar(indice + 1)}>
            <Icono nombre="right" />
          </button>
        </div>
      </div>
    </>
  );
}
