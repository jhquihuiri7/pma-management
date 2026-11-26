"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPct, formatUsd } from "@/lib/pg2030";
import type { Pg2030Coherencia, Pg2030Leyenda, Pg2030Semaforo } from "@/types";
import { INK, Leyenda, tooltipStyle } from "./comunes";

const axisTick = { fill: INK.secondary, fontSize: 11 };
const UNO = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 });

/** Axis dollars: "$75 k", "$1,2 M" (Intl's compact notation mixes "K" and "k" in es-EC). */
function usdCorto(v: number): string {
  if (Math.abs(v) >= 1e6) return `$${UNO.format(v / 1e6)}\u00a0M`;
  if (Math.abs(v) >= 1e3) return `$${UNO.format(v / 1e3)}\u00a0k`;
  return `$${UNO.format(v)}`;
}
const pctTick = (v: number) => `${v}\u00a0%`;

/** Chart 5: one thin bar per institution, colored by its traffic light, with the average line. */
export function AvanceFisicoChart({
  filas,
  promedio,
  leyenda,
  onSelect,
  estatico = false,
}: {
  filas: Array<{ id: string; sigla: string; valor: number; semaforo: Pg2030Semaforo }>;
  promedio: number | null;
  leyenda: Pg2030Leyenda;
  onSelect: (id: string) => void;
  /** No animation: the Word report captures the chart as soon as it is drawn. */
  estatico?: boolean;
}) {
  const data = filas.map((f) => ({ ...f, pct: f.valor * 100 }));
  const height = Math.max(160, data.length * 34 + 60);
  return (
    <div className="space-y-2">
      <Leyenda items={Object.values(leyenda.semaforo).map((s) => ({ label: s.label, color: s.color }))} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 18, right: 72, left: 8, bottom: 8 }}>
            <CartesianGrid horizontal={false} stroke={INK.grid} />
            <XAxis type="number" domain={[0, 100]} tick={axisTick} tickFormatter={pctTick} axisLine={{ stroke: INK.grid }} tickLine={false} />
            <YAxis type="category" dataKey="sigla" width={96} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip
              {...tooltipStyle}
              cursor={{ fill: "#f1f5f9" }}
              formatter={(_v, _n, item) => [formatPct(item.payload.valor), leyenda.semaforo[item.payload.semaforo as Pg2030Semaforo].label]}
            />
            <Bar dataKey="pct" barSize={18} radius={[0, 4, 4, 0]} onClick={(d) => onSelect((d as unknown as { id: string }).id)} cursor="pointer"
              isAnimationActive={!estatico}>
              {data.map((d) => <Cell key={d.id} fill={leyenda.semaforo[d.semaforo].color} />)}
              <LabelList dataKey="valor" position="right" formatter={(v) => formatPct(Number(v))} style={{ fill: INK.primary, fontSize: 11 }} />
            </Bar>
            {promedio !== null && (
              <ReferenceLine
                x={promedio * 100}
                stroke={INK.secondary}
                strokeWidth={1}
                label={{ value: `Promedio ${formatPct(promedio)}`, position: "top", fill: INK.secondary, fontSize: 11 }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Chart 4: goals per axis, stacked by contribution category; the 2px white stroke is the surface gap. */
export function AlineacionChart({
  filas,
  categorias,
  leyenda,
  estatico = false,
}: {
  filas: Array<{ eje: string; total: number; porCategoria: Record<string, number> }>;
  categorias: string[];
  leyenda: Pg2030Leyenda;
  estatico?: boolean;
}) {
  const colores = new Map(leyenda.contribucion.map((c) => [c.key, c.color]));
  const data = filas.map((f) => ({ eje: f.eje, ...f.porCategoria }));
  return (
    <div className="space-y-2">
      <Leyenda items={categorias.map((c) => ({ label: c, color: colores.get(c) ?? INK.muted }))} />
      <div style={{ height: Math.max(180, data.length * 38 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid horizontal={false} stroke={INK.grid} />
            <XAxis type="number" allowDecimals={false} tick={axisTick} axisLine={{ stroke: INK.grid }} tickLine={false} />
            <YAxis type="category" dataKey="eje" width={56} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip {...tooltipStyle} cursor={{ fill: "#f1f5f9" }} />
            {categorias.map((c) => (
              <Bar key={c} dataKey={c} stackId="a" fill={colores.get(c) ?? INK.muted} stroke={INK.surface} strokeWidth={2} barSize={20}
                isAnimationActive={!estatico} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Charts 6 and 8: planned vs computable accrued, in dollars, per category. */
export function DineroChart({
  filas,
  leyenda,
  estatico = false,
}: {
  filas: Array<{ nombre: string; planificado: number; computable: number; avance: number | null }>;
  leyenda: Pg2030Leyenda;
  estatico?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Leyenda items={[
        { label: "Planificado", color: leyenda.serie.planificado },
        { label: "Devengado", color: leyenda.serie.devengado },
      ]} />
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={filas} margin={{ top: 20, right: 16, left: 8, bottom: 8 }} barGap={2}>
            <CartesianGrid vertical={false} stroke={INK.grid} />
            <XAxis dataKey="nombre" tick={axisTick} axisLine={{ stroke: INK.grid }} tickLine={false} interval={0} />
            <YAxis tick={axisTick} tickFormatter={(v) => usdCorto(Number(v))} axisLine={false} tickLine={false} width={64} />
            <Tooltip
              {...tooltipStyle}
              cursor={{ fill: "#f1f5f9" }}
              formatter={(v, n) => [formatUsd(Number(v)), n === "planificado" ? "Planificado" : "Devengado"]}
            />
            {/* The computable accrued never exceeds the plan, so the pair's progress sits centered above the planned bar. */}
            <Bar dataKey="planificado" fill={leyenda.serie.planificado} barSize={22} radius={[4, 4, 0, 0]} isAnimationActive={!estatico}>
              <LabelList dataKey="avance" content={(props) => {
                const { x, y, width, value } = props;
                if (value === null || value === undefined) return null;
                return (
                  <text x={Number(x) + Number(width) + 1} y={Number(y) - 6} textAnchor="middle" fill={INK.primary} fontSize={11}>
                    {formatPct(Number(value))}
                  </text>
                );
              }} />
            </Bar>
            <Bar dataKey="computable" fill={leyenda.serie.devengado} barSize={22} radius={[4, 4, 0, 0]} isAnimationActive={!estatico} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Closest two dots may sit, in percentage points (≈ the width of an acronym at the chart's size). */
const SEPARACION = 6;

type Lado = "arriba" | "derecha" | "izquierda";

/**
 * Jitter that never stacks: dots closer than SEPARACION push each other apart
 * just enough, inside 0–100, so every acronym can be read. Identical points
 * split along the diagonal, keeping a coherent pair on the line. Deterministic,
 * so the panel and the Word show the same picture. Each label goes on the side
 * away from its nearest neighbour.
 */
export function separarPuntos(puntos: Array<{ x: number; y: number }>): Array<{ x: number; y: number; lado: Lado; movido: boolean }> {
  const pos = puntos.map((p) => ({ x: p.x, y: p.y }));
  const dentro = (v: number) => Math.min(100, Math.max(0, v));
  for (let vuelta = 0; vuelta < 200; vuelta++) {
    let tocan = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        let dx = pos[j].x - pos[i].x;
        let dy = pos[j].y - pos[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= SEPARACION - 1e-6) continue;
        tocan = true;
        if (d < 1e-6) {
          // Same spot: the later one goes down the diagonal (up it at the origin).
          const s = pos[i].x + pos[i].y > 100 ? -1 : 1;
          [dx, dy, d] = [s, s, Math.SQRT2];
        }
        const empuje = (SEPARACION - d) / 2 + 0.01;
        const ux = dx / d;
        const uy = dy / d;
        pos[i] = { x: dentro(pos[i].x - ux * empuje), y: dentro(pos[i].y - uy * empuje) };
        pos[j] = { x: dentro(pos[j].x + ux * empuje), y: dentro(pos[j].y + uy * empuje) };
      }
    }
    if (!tocan) break;
  }
  return pos.map((p, i) => {
    let vecino: { x: number; y: number } | null = null;
    let cerca = SEPARACION * 2;
    pos.forEach((q, j) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (j !== i && d < cerca) [vecino, cerca] = [q, d];
    });
    const v = vecino as { x: number; y: number } | null;
    let lado: Lado = !v ? "arriba" : v.x < p.x || (v.x === p.x && v.y < p.y) ? "derecha" : "izquierda";
    // At the edges a side label would hit the Y axis ticks or be cut off.
    if (lado === "izquierda" && p.x < 8) lado = "derecha";
    if (lado === "derecha" && p.x > 92) lado = "arriba";
    return { ...p, lado, movido: Math.hypot(p.x - puntos[i].x, p.y - puntos[i].y) > 0.05 };
  });
}

/** Chart 7: physical vs budget progress per institution, with the ±5-point coherence band. */
export function CoherenciaChart({
  puntos,
  leyenda,
  onSelect,
}: {
  puntos: Array<{ id: string; sigla: string; fisico: number; presupuesto: number; coherencia: Pg2030Coherencia }>;
  leyenda: Pg2030Leyenda;
  onSelect: (id: string) => void;
}) {
  const banda = Array.from({ length: 21 }, (_, i) => {
    const x = i * 5;
    return { x, banda: [Math.max(0, x - 5), Math.min(100, x + 5)], diagonal: x };
  });
  const separados = separarPuntos(puntos.map((p) => ({ x: p.fisico * 100, y: p.presupuesto * 100 })));
  const data = puntos.map((p, i) => ({ ...p, x: separados[i].x, y: separados[i].y, lado: separados[i].lado }));
  const hayMovidos = separados.some((s) => s.movido);
  return (
    <div className="space-y-2">
      {/* The coherence colors are named by the counts row above the chart; this adds the guides. */}
      <Leyenda items={[
        { label: "Franja de ±5 puntos (coherente)", color: "#ccfbf1" },
        { label: "Mismo avance físico y presupuestario", color: INK.muted },
      ]} />
      <div style={{ height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={banda} margin={{ top: 24, right: 44, left: 8, bottom: 24 }}>
            <CartesianGrid stroke={INK.grid} />
            <XAxis type="number" dataKey="x" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={axisTick} tickFormatter={pctTick}
              label={{ value: "Avance físico", position: "insideBottom", offset: -14, fill: INK.secondary, fontSize: 11 }} />
            <YAxis type="number" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={axisTick} tickFormatter={pctTick} width={56}
              label={{ value: "Avance presupuestario", angle: -90, position: "insideLeft", fill: INK.secondary, fontSize: 11 }} />
            <Area dataKey="banda" fill="#ccfbf1" fillOpacity={0.6} stroke="none" isAnimationActive={false} activeDot={false} />
            <Line dataKey="diagonal" stroke={INK.muted} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
            <Tooltip
              {...tooltipStyle}
              cursor={false}
              content={({ active, payload }) => {
                const p = payload?.find((e) => (e.payload as { sigla?: string }).sigla)?.payload as (typeof data)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                    <p className="font-semibold text-slate-900">{p.sigla}</p>
                    <p className="text-slate-600">Físico <span className="font-semibold text-slate-900">{formatPct(p.fisico)}</span></p>
                    <p className="text-slate-600">Presupuesto <span className="font-semibold text-slate-900">{formatPct(p.presupuesto)}</span></p>
                    <p className="text-slate-600">{leyenda.coherencia[p.coherencia].label}</p>
                  </div>
                );
              }}
            />
            <Scatter data={data} dataKey="y" isAnimationActive={false} onClick={(d) => onSelect((d as unknown as { id: string }).id)} cursor="pointer"
              shape={(props: { cx?: number; cy?: number; payload?: (typeof data)[number] }) => {
                const { cx = 0, cy = 0, payload } = props;
                const lado = payload?.lado ?? "arriba";
                const texto =
                  lado === "arriba" ? { x: cx, y: cy - 9, textAnchor: "middle" as const }
                  : lado === "derecha" ? { x: cx + 9, y: cy + 3.5, textAnchor: "start" as const }
                  : { x: cx - 9, y: cy + 3.5, textAnchor: "end" as const };
                return (
                  <g>
                    {/* A transparent 24px hit area around the 10px dot. */}
                    <circle cx={cx} cy={cy} r={12} fill="transparent" />
                    <circle cx={cx} cy={cy} r={5} fill={payload ? leyenda.coherencia[payload.coherencia].color : INK.muted}
                      stroke={INK.surface} strokeWidth={2} />
                    {payload && <text {...texto} fill={INK.secondary} fontSize={10}>{payload.sigla}</text>}
                  </g>
                );
              }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {hayMovidos && (
        <p className="text-[11px] text-slate-500">Los puntos muy cercanos se separan ligeramente para que se lean las siglas; los valores exactos están en la tabla.</p>
      )}
    </div>
  );
}
