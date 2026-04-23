"use client";

import { useRef, useState } from "react";
import {
  BarChart,
  Bar,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { toPng } from "html-to-image";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plan, PeriodCompliance, PlanItem } from "@/types";
import { getPlanPeriodsByMode, PeriodMode } from "@/lib/planPeriods";

interface PlanChartData {
  plan: Plan;
  itemCount: number;
  directionCounts: { name: string; value: number }[];
  items: Pick<PlanItem, "id" | "direccion">[];
  complianceRecords: PeriodCompliance[];
}

interface Props {
  planCharts: PlanChartData[];
  periodMode?: PeriodMode;
}

const CATEGORY_COLORS: Record<string, string> = {
  C: "#22c55e",
  "NC+": "#ef4444",
  "NC-": "#f87171",
  "N/A": "#eab308",
  "Sin definir": "#94a3b8",
};

const CATEGORY_ORDER = ["C", "NC+", "NC-", "N/A", "Sin definir"];

interface ChartEntry {
  name: string;
  value: number;
  fill: string;
}

const DIRECTION_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f97316",
  "#9333ea",
  "#0ea5e9",
  "#ef4444",
  "#84cc16",
  "#f59e0b",
  "#14b8a6",
  "#64748b",
];

function buildDirectionData(directionCounts: { name: string; value: number }[]): ChartEntry[] {
  return [...(directionCounts ?? [])]
    .filter((d) => (d?.value ?? 0) > 0)
    .map((d, idx) => ({ name: d.name, value: d.value, fill: DIRECTION_COLORS[idx % DIRECTION_COLORS.length] }));
}

function normalizeDireccion(raw: unknown): string {
  if (typeof raw !== "string") return "Sin dirección";
  const v = raw.trim();
  return v ? v : "Sin dirección";
}

function DireccionGauge({ label, valuePct }: { label: string; valuePct: number }) {
  const pct = Math.max(0, Math.min(100, valuePct));
  const pctRounded = Math.round(pct);
  const W = 220, H = 130, cx = W / 2, cy = 105, outerR = 82, innerR = 54;

  const polarXY = (r: number, p: number) => {
    const a = Math.PI * (1 - p / 100);
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  };

  const makeArc = (p1: number, p2: number) => {
    const o1 = polarXY(outerR, p1), o2 = polarXY(outerR, p2);
    const i1 = polarXY(innerR, p1), i2 = polarXY(innerR, p2);
    return [
      `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
      `A ${outerR} ${outerR} 0 0 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
      `L ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
      `A ${innerR} ${innerR} 0 0 0 ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
      "Z",
    ].join(" ");
  };

  const zones = [
    { p1: 0, p2: 50, fill: "#ef4444" },
    { p1: 50, p2: 75, fill: "#f59e0b" },
    { p1: 75, p2: 100, fill: "#84cc16" },
  ];
  const ticks = [0, 25, 50, 75, 100];
  const tickOutR = outerR + 7, labelR = outerR + 20;
  const needleA = Math.PI * (1 - pct / 100);
  const needleLen = outerR - 10;
  const tipX = cx + needleLen * Math.cos(needleA), tipY = cy - needleLen * Math.sin(needleA);
  const bw = 5;
  const b1x = cx + bw * Math.sin(needleA), b1y = cy + bw * Math.cos(needleA);
  const b2x = cx - bw * Math.sin(needleA), b2y = cy - bw * Math.cos(needleA);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold text-slate-700 truncate mb-1" title={label}>{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {zones.map((z, i) => (
          <path key={i} d={makeArc(z.p1, z.p2)} fill={z.fill} stroke="#ffffff" strokeWidth={2} />
        ))}
        {ticks.map((p) => {
          const inner = polarXY(outerR, p), outer = polarXY(tickOutR, p), lbl = polarXY(labelR, p);
          return (
            <g key={p}>
              <line x1={inner.x.toFixed(2)} y1={inner.y.toFixed(2)} x2={outer.x.toFixed(2)} y2={outer.y.toFixed(2)} stroke="#475569" strokeWidth={1.5} />
              <text x={lbl.x.toFixed(2)} y={lbl.y.toFixed(2)} textAnchor="middle" dominantBaseline="central" fontSize={9} fill="#64748b" fontWeight={600}>{p}%</text>
            </g>
          );
        })}
        <polygon points={`${tipX.toFixed(2)},${tipY.toFixed(2)} ${b1x.toFixed(2)},${b1y.toFixed(2)} ${b2x.toFixed(2)},${b2y.toFixed(2)}`} fill="#0f172a" />
        <circle cx={cx} cy={cy} r={8} fill="#0f172a" />
        <circle cx={cx} cy={cy} r={4} fill="#ffffff" />
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize={13} fontWeight={700} fill="#0f172a">{pctRounded}%</text>
      </svg>
    </div>
  );
}

const renderPieLabel = (props: {
  cx?: number; cy?: number; midAngle?: number;
  innerRadius?: number; outerRadius?: number; value?: number; percent?: number;
}) => {
  const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, value = 0, percent = 0 } = props;
  if (value === 0) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {value} ({(percent * 100).toFixed(0)}%)
    </text>
  );
};

const renderCountOnlyPieLabel = (props: {
  cx?: number; cy?: number; midAngle?: number;
  innerRadius?: number; outerRadius?: number; value?: number;
}) => {
  const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, value = 0 } = props;
  if (value === 0) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {value}
    </text>
  );
};

const renderBarLabel = (total: number) => {
  const BarLabel = (props: { x?: number; y?: number; width?: number; value?: number }) => {
    const { x = 0, y = 0, width = 0, value = 0 } = props;
    if (value === 0) return null;
    const pct = total > 0 ? ((value / total) * 100).toFixed(0) : "0";
    return (
      <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill="#475569">
        {value} ({pct}%)
      </text>
    );
  };
  return BarLabel;
};

export default function GeneralComplianceChart({ planCharts, periodMode = "block" }: Props) {
  // Collect all unique periods from all plans (union)
  const allPeriods: { key: string; label: string }[] = [];
  for (const { plan } of planCharts) {
    for (const p of getPlanPeriodsByMode(plan, periodMode)) {
      if (!allPeriods.some((ap) => ap.key === p.key)) {
        allPeriods.push(p);
      }
    }
  }

  const defaultPeriod = allPeriods.length > 0 ? allPeriods[allPeriods.length - 1].key : "";
  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod);

  const barRef = useRef<HTMLDivElement>(null);
  const pieRef = useRef<HTMLDivElement>(null);
  const dirRef = useRef<HTMLDivElement>(null);
  const gaugesRef = useRef<HTMLDivElement>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Aggregate data across all plans
  const totalItemCount = planCharts.reduce((s, c) => s + c.itemCount, 0);

  const allComplianceRecords = planCharts.flatMap((c) => c.complianceRecords);
  const allItems = planCharts.flatMap((c) => c.items);

  // Aggregate direction counts
  const dirMap = new Map<string, number>();
  for (const { directionCounts } of planCharts) {
    for (const d of directionCounts) {
      dirMap.set(d.name, (dirMap.get(d.name) ?? 0) + d.value);
    }
  }
  const aggregatedDirectionCounts = Array.from(dirMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  // Build chart data for selected period
  const periodRecords = allComplianceRecords.filter((r) => r.periodKey === selectedPeriod);
  const definedItemIds = new Set(periodRecords.map((r) => r.planItemId));
  const counts: Record<string, number> = { C: 0, "NC+": 0, "NC-": 0, "N/A": 0 };
  for (const r of periodRecords) {
    if (r.status in counts) counts[r.status]++;
  }
  const sinDefinir = Math.max(0, totalItemCount - definedItemIds.size);
  const chartData: ChartEntry[] = CATEGORY_ORDER.map((cat) => ({
    name: cat,
    value: cat === "Sin definir" ? sinDefinir : counts[cat] ?? 0,
    fill: CATEGORY_COLORS[cat],
  }));

  const total = chartData.reduce((s, d) => s + d.value, 0);
  const maxValue = Math.max(...chartData.map((d) => d.value), 1);

  const cumplido = chartData.find((d) => d.name === "C")?.value ?? 0;
  const noCumplido =
    (chartData.find((d) => d.name === "NC+")?.value ?? 0) +
    (chartData.find((d) => d.name === "NC-")?.value ?? 0);
  const pieTotal = cumplido + noCumplido;
  const pieData: ChartEntry[] = [
    { name: "Cumplido", value: cumplido, fill: "#22c55e" },
    { name: "No cumplido", value: noCumplido, fill: "#ef4444" },
  ].filter((d) => d.value > 0);

  const directionData = buildDirectionData(aggregatedDirectionCounts);
  const directionTotal = directionData.reduce((s, d) => s + d.value, 0);

  // Gauges by direction for selected period
  const statusByItem = new Map(
    periodRecords.map((r) => [r.planItemId, r.status] as const)
  );
  const direccionTotals = new Map<string, { total: number; c: number }>();
  for (const it of allItems) {
    const dir = normalizeDireccion(it?.direccion);
    const cur = direccionTotals.get(dir) ?? { total: 0, c: 0 };
    cur.total += 1;
    if (statusByItem.get(it.id) === "C") cur.c += 1;
    direccionTotals.set(dir, cur);
  }
  const gauges = Array.from(direccionTotals.entries())
    .map(([direccion, v]) => ({ direccion, pct: v.total > 0 ? (v.c / v.total) * 100 : 0, total: v.total, c: v.c }))
    .sort((a, b) => b.pct - a.pct || b.total - a.total || a.direccion.localeCompare(b.direccion));

  async function downloadSection(ref: React.RefObject<HTMLDivElement | null>, id: string, filename: string) {
    if (!ref.current) return;
    setDownloadingId(id);
    try {
      const dataUrl = await toPng(ref.current, { cacheBust: true, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = filename;
      link.href = dataUrl;
      link.click();
    } catch {
      // silent
    } finally {
      setDownloadingId(null);
    }
  }

  if (planCharts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No hay planes disponibles.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold">
            Todos los planes ({planCharts.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalItemCount} ítem{totalItemCount !== 1 ? "s" : ""} en total
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {allPeriods.length > 0 ? (
            <select
              className="flex h-8 rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-[160px]"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
            >
              {allPeriods.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-muted-foreground">Sin períodos</span>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="bg-white pt-2">
          {allPeriods.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">
              Sin datos de períodos disponibles
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Bar chart */}
              <div ref={barRef} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between mb-1 px-1">
                  <p className="text-[10px] text-muted-foreground font-medium">Distribución por categoría</p>
                  <Button
                    size="sm" variant="ghost"
                    className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                    title="Descargar gráfico"
                    disabled={downloadingId !== null}
                    onClick={() => downloadSection(barRef, "bar", `dist_categoria_general_${selectedPeriod}.png`)}
                  >
                    <Download className="w-3 h-3" />
                  </Button>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 20, right: 8, left: 0, bottom: 4 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} domain={[0, Math.ceil(maxValue * 1.4)]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                    <Tooltip
                      cursor={{ fill: "#f8fafc" }}
                      formatter={(value) => {
                        const v = Number(value);
                        const pct = total > 0 ? ((v / total) * 100).toFixed(0) : "0";
                        return [`${v} ítem${v !== 1 ? "s" : ""} (${pct}%)`, ""];
                      }}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={52}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                      {/* @ts-expect-error recharts content prop accepts custom component */}
                      <LabelList dataKey="value" content={renderBarLabel(total)} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Pie chart */}
              <div ref={pieRef} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between mb-1 px-1">
                  <p className="text-[10px] text-muted-foreground font-medium">Cumplido vs No cumplido</p>
                  <Button
                    size="sm" variant="ghost"
                    className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                    title="Descargar gráfico"
                    disabled={downloadingId !== null}
                    onClick={() => downloadSection(pieRef, "pie", `cumplido_vs_no_general_${selectedPeriod}.png`)}
                  >
                    <Download className="w-3 h-3" />
                  </Button>
                </div>
                {pieTotal === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground text-center px-2">
                    Sin C / NC+ / NC- registrados
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="45%" outerRadius={68} dataKey="value" labelLine={false} label={renderPieLabel}>
                        {pieData.map((entry, index) => (
                          <Cell key={`pie-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => {
                          const v = Number(value);
                          const pct = pieTotal > 0 ? ((v / pieTotal) * 100).toFixed(0) : "0";
                          return [`${v} ítem${v !== 1 ? "s" : ""} (${pct}%)`, ""];
                        }}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                      />
                      <Legend iconType="circle" iconSize={8} formatter={(value) => <span style={{ fontSize: 10 }}>{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Direction pie chart */}
              <div ref={dirRef} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between mb-1 px-1">
                  <p className="text-[10px] text-muted-foreground font-medium">Ítems por Dirección</p>
                  <Button
                    size="sm" variant="ghost"
                    className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                    title="Descargar gráfico"
                    disabled={downloadingId !== null}
                    onClick={() => downloadSection(dirRef, "dir", `items_por_direccion_general_${selectedPeriod}.png`)}
                  >
                    <Download className="w-3 h-3" />
                  </Button>
                </div>
                {directionTotal === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground text-center px-2">
                    Sin direcciones registradas
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={directionData} cx="50%" cy="45%" outerRadius={68} dataKey="value" labelLine={false} label={renderCountOnlyPieLabel}>
                        {directionData.map((entry, index) => (
                          <Cell key={`dir-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => {
                          const v = Number(value);
                          return [`${v} ítem${v !== 1 ? "s" : ""}`, ""];
                        }}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                      />
                      <Legend iconType="circle" iconSize={8} formatter={(value) => <span style={{ fontSize: 10 }}>{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}
        </div>

        {allPeriods.length > 0 && (
          <div ref={gaugesRef} className="bg-white pb-2">
            <div className="flex items-center justify-between mt-3 mb-2">
              <p className="text-[10px] text-muted-foreground font-medium">
                % de ítems con cumplimiento &quot;C&quot; por Dirección
              </p>
              <div className="flex items-center gap-2">
                <p className="text-[10px] text-muted-foreground">
                  periodo: {selectedPeriod || "—"}
                </p>
                <Button
                  size="sm" variant="ghost"
                  className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                  title="Descargar velocímetros"
                  disabled={downloadingId !== null || gauges.length === 0}
                  onClick={() => downloadSection(gaugesRef, "gauges", `velocimetros_general_${selectedPeriod}.png`)}
                >
                  <Download className="w-3 h-3" />
                </Button>
              </div>
            </div>
            {gauges.length === 0 ? (
              <div className="flex items-center justify-center h-[120px] text-xs text-muted-foreground text-center px-2">
                Sin ítems para calcular por Dirección
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {gauges.map((g) => (
                  <div key={g.direccion} title={`C: ${g.c}/${g.total}`}>
                    <DireccionGauge label={g.direccion} valuePct={g.pct} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-1 text-right">
          {totalItemCount} ítem{totalItemCount !== 1 ? "s" : ""} en total · periodo: {selectedPeriod || "—"}
        </p>
      </CardContent>
    </Card>
  );
}
