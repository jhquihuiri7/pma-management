"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SimatMareografo, SimatNivelRiesgo, SimatPronostico, SimatSerieLluvia } from "@pma/types";
import { horaCorta, numero } from "@/lib/simat/formato";

const TEAL = "#0f766e";
const SKY = "#0284c7";

const NIVELES: Record<SimatNivelRiesgo, { color: string; grados: number }> = {
  Normal: { color: "#059669", grados: -67.5 },
  Precaución: { color: "#d97706", grados: -22.5 },
  Alerta: { color: "#ea580c", grados: 22.5 },
  Emergencia: { color: "#dc2626", grados: 67.5 },
};
const SEGMENTOS: Array<{ nivel: SimatNivelRiesgo; color: string }> = [
  { nivel: "Normal", color: "#059669" },
  { nivel: "Precaución", color: "#d97706" },
  { nivel: "Alerta", color: "#ea580c" },
  { nivel: "Emergencia", color: "#dc2626" },
];

function arco(inicio: number, fin: number, r = 80, cx = 100, cy = 100): string {
  const pol = (ang: number) => {
    const a = ((ang - 180) * Math.PI) / 180;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  };
  return `M ${pol(inicio)} A ${r} ${r} 0 0 1 ${pol(fin)}`;
}

/** Semicircular risk gauge with four segments and a needle. */
export function DialRiesgo({ nivel }: { nivel: SimatNivelRiesgo | null }) {
  const activo = nivel ? NIVELES[nivel] : null;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 120" className="w-full max-w-[260px]" role="img" aria-label={`Nivel: ${nivel ?? "sin evaluación"}`}>
        {SEGMENTOS.map((s, i) => (
          <path
            key={s.nivel}
            d={arco(i * 45, (i + 1) * 45)}
            fill="none"
            stroke={s.color}
            strokeWidth={16}
            strokeLinecap="butt"
            opacity={nivel === s.nivel || !nivel ? 1 : 0.28}
          />
        ))}
        {activo && (
          <g transform={`rotate(${activo.grados} 100 100)`}>
            <line x1="100" y1="100" x2="100" y2="34" stroke="#0f172a" strokeWidth={3} strokeLinecap="round" />
          </g>
        )}
        <circle cx="100" cy="100" r="6" fill="#0f172a" />
      </svg>
      <p className="mt-1 text-lg font-semibold" style={{ color: activo?.color ?? "#475569" }}>
        {nivel ?? "Sin evaluación"}
      </p>
    </div>
  );
}

export function GraficoLluvia({ serie, altura = 200 }: { serie: SimatSerieLluvia; altura?: number }) {
  const data = serie.recent.map((r) => ({
    hora: horaCorta(r.time),
    mm: r.quality === "válido" ? r.value : null,
  }));
  if (!data.length) return <p className="text-sm text-slate-500">Sin lecturas recientes.</p>;
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="hora" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={{ fontSize: 11 }} width={40} unit=" mm" />
        <Tooltip formatter={(value) => [`${numero(Number(value))} mm`, "Lluvia"]} labelStyle={{ color: "#0f172a" }} />
        <Bar dataKey="mm" fill={TEAL} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GraficoMareografo({ mareografo, umbral }: { mareografo: SimatMareografo; umbral?: number | null }) {
  const data = mareografo.serie.map((p) => ({ hora: horaCorta(p.fecha), nivel: p.valor }));
  if (!data.length) return <p className="text-sm text-slate-500">Sin serie del mareógrafo.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="hora" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={40} />
        <YAxis tick={{ fontSize: 11 }} width={44} unit=" m" domain={["auto", "auto"]} />
        <Tooltip formatter={(value) => [`${numero(Number(value))} m`, "Nivel"]} />
        {umbral != null && Number.isFinite(umbral) && (
          <ReferenceLine y={umbral} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `Umbral ${numero(umbral)} m`, fontSize: 10, fill: "#dc2626", position: "insideTopRight" }} />
        )}
        <Line type="monotone" dataKey="nivel" stroke={SKY} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GraficoPronostico({ pronostico }: { pronostico: SimatPronostico }) {
  const data = pronostico.pronostico.map((h) => ({ hora: horaCorta(h.fin), mm: h.mm ?? 0, prob: h.probabilidad }));
  if (!data.length) return <p className="text-sm text-slate-500">Sin pronóstico disponible.</p>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="simatPron" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SKY} stopOpacity={0.5} />
            <stop offset="100%" stopColor={SKY} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="hora" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={30} />
        <YAxis tick={{ fontSize: 11 }} width={40} unit=" mm" />
        <Tooltip formatter={(value) => [`${numero(Number(value))} mm`, "Lluvia"]} />
        <Area type="monotone" dataKey="mm" stroke={SKY} strokeWidth={2} fill="url(#simatPron)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
