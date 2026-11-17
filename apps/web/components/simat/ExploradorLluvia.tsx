"use client";

// Explorador interactivo de intensidad de lluvia (canvas), portado de la vista
// previa (risk-ui.js: rainfallHistory / drawRainExplorer). Puntero, flechas
// del teclado, periodo visible y salto al máximo.

import { useEffect, useMemo, useRef, useState } from "react";
import type { SimatEstacion, SimatSerieLluvia } from "@pma/types";
import { duracion, fechaDia, fechaHora, medida, numero } from "@/lib/simat/formato";
import { Icono } from "./iconos";

const ejeHora = new Intl.DateTimeFormat("es-EC", { timeZone: "Pacific/Galapagos", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

type Muestra = SimatSerieLluvia["recent"][number];
interface Fila {
  time: number;
  record: Muestra | undefined;
  intensity: number | null;
}

function etiquetaIntervalo(time: number, step: number) {
  return step === 1440 ? fechaDia(new Date(time).toISOString()) : `${fechaHora(new Date(time - step * 60000).toISOString())} → ${fechaHora(new Date(time).toISOString())}`;
}

export default function ExploradorLluvia({ estacion, lluvia }: { estacion: SimatEstacion; lluvia: SimatSerieLluvia }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometria = useRef<{ left: number; size: number } | null>(null);
  const step = estacion.pasoMin;
  const records = lluvia.recent;
  const end = Date.parse(records[records.length - 1].time);
  const start = Date.parse(records[0].time);
  const span = (end - start) / 60000 + step;

  const periodos = useMemo(() => {
    const w: [number, string][] =
      step === 1440
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
  }, [step, span]);
  const [periodo, setPeriodo] = useState(periodos[periodos.length - 1][0]);
  useEffect(() => {
    if (!periodos.some(([m]) => m === periodo)) setPeriodo(periodos[periodos.length - 1][0]);
  }, [periodos, periodo]);

  const muestras = useMemo(() => new Map(records.map((r) => [Date.parse(r.time), r])), [records]);
  const { filas, picos, maximo } = useMemo(() => {
    const count = Math.max(1, Math.floor(periodo / step));
    const stepMs = step * 60000;
    const desde = Math.max(start, end - (count - 1) * stepMs);
    const filas: Fila[] = [];
    for (let time = desde; time <= end; time += stepMs) {
      const record = muestras.get(time);
      filas.push({ time, record, intensity: record?.quality === "válido" ? (record.value * 60) / step : null });
    }
    const validas = filas.filter((r) => r.intensity !== null);
    const maximo = validas.length ? Math.max(...validas.map((r) => r.intensity as number)) : null;
    const picos = new Set(filas.flatMap((r, i) => (maximo !== null && r.intensity === maximo ? [i] : [])));
    return { filas, picos, maximo };
  }, [periodo, step, start, end, muestras]);

  const ultimoPico = Array.from(picos).pop();
  const [indice, setIndice] = useState(ultimoPico ?? filas.length - 1);
  useEffect(() => {
    setIndice(ultimoPico ?? filas.length - 1);
  }, [filas, ultimoPico]);

  // Dibujo
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
      const left = 58;
      const right = w - 18;
      const top = 18;
      const bottom = h - 32;
      const size = (right - left) / filas.length;
      geometria.current = { left, size };
      const max = Math.max(0, ...filas.map((r) => r.intensity ?? 0));
      const power = 10 ** Math.floor(Math.log10(max || 1));
      const tick = ([0.2, 0.25, 0.5, 1, 2.5, 5, 10].find((n) => n * power >= (max || 1) / 4) ?? 10) * power;
      const ceiling = tick * 4;
      const y = (v: number) => bottom - (v / ceiling) * (bottom - top);
      ctx.font = "500 10.5px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const level = i * tick;
        ctx.strokeStyle = i ? "#eef2f6" : "#cbd5e1";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y(level)) + 0.5);
        ctx.lineTo(right, Math.round(y(level)) + 0.5);
        ctx.stroke();
        ctx.fillText(numero(level), left - 8, y(level));
      }
      ctx.textAlign = "left";
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#64748b";
      ctx.fillText("mm/h", 12, 9);
      ctx.font = "500 10.5px Inter, system-ui, sans-serif";
      const barWidth = Math.max(1, Math.min(24, size - 2));
      filas.forEach((row, i) => {
        const x = left + i * size;
        if (row.intensity === null) {
          ctx.fillStyle = "#f1f5f9";
          ctx.fillRect(x + 0.5, top, Math.max(1, size - 1), bottom - top);
        } else if (row.intensity > 0) {
          ctx.fillStyle = picos.has(i) ? "#115e59" : "#0d9488";
          if (indice >= 0 && i !== indice) ctx.globalAlpha = 0.55;
          const height = bottom - y(row.intensity);
          const bx = x + (size - barWidth) / 2;
          const r = Math.min(4, barWidth / 2, height);
          ctx.beginPath();
          if (ctx.roundRect && barWidth > 6) ctx.roundRect(bx, bottom - height, barWidth, height, [r, r, 0, 0]);
          else ctx.rect(bx, bottom - height, barWidth, height);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      });
      if (indice >= 0) {
        const x = left + indice * size;
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, top + 1, Math.max(1, size - 2), bottom - top - 2);
      }
      const labels = Math.min(w < 530 ? 3 : 6, filas.length);
      ctx.fillStyle = "#94a3b8";
      for (let i = 0; i < labels; i++) {
        const j = labels === 1 ? 0 : Math.round((i * (filas.length - 1)) / (labels - 1));
        const time = filas[j].time;
        ctx.textAlign = i === 0 ? "left" : i === labels - 1 ? "right" : "center";
        const label = step === 1440 ? fechaDia(new Date(time).toISOString()).slice(5) : ejeHora.format(time);
        ctx.fillText(label, left + (j + 0.5) * size, bottom + 18);
      }
    };
    dibujar();
    const ro = new ResizeObserver(dibujar);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [filas, picos, indice, step]);

  const seleccionar = (i: number) => setIndice(Math.max(0, Math.min(filas.length - 1, i)));
  const desdePuntero = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = geometria.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;
    const i = Math.floor((e.clientX - canvas.getBoundingClientRect().left - g.left) / g.size);
    if (i >= 0 && i < filas.length && i !== indice) seleccionar(i);
  };
  const fila = filas[indice];
  const picoFila = ultimoPico !== undefined ? filas[ultimoPico] : undefined;

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
        <div className="rain-peak">
          <small>Máximo visible</small>
          <strong>{maximo === null ? "Sin datos válidos" : `${medida(maximo)} mm/h`}</strong>
          <span>{picoFila ? `${picos.size > 1 ? `${picos.size} intervalos empatados · último: ` : ""}${etiquetaIntervalo(picoFila.time, step)}` : ""}</span>
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
        className="rain-interactive-chart"
        tabIndex={0}
        aria-label="Gráfica interactiva de lluvia en milímetros por hora"
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
          <i style={{ "--c": "#0d9488" } as React.CSSProperties} />
          Intensidad media
        </span>
        <span>
          <i style={{ "--c": "#115e59" } as React.CSSProperties} />
          Máximo visible
        </span>
        <span>
          <i className="gap" />
          Sin dato válido
        </span>
      </div>
      <div className="rain-inspector">
        <div id="rain-selection" role="status">
          {fila ? (
            <>
              <strong>{etiquetaIntervalo(fila.time, step)}</strong>
              <p data-rain-detail="">
                {fila.intensity === null ? (
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
