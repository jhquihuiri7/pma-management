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
import { Plan, PeriodCompliance } from "@/types";
import { getPlanPeriods } from "@/lib/planPeriods";

interface Props {
  plan: Plan;
  itemCount: number;
  complianceRecords: PeriodCompliance[];
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

function buildChartData(
  complianceRecords: PeriodCompliance[],
  periodKey: string,
  itemCount: number
): ChartEntry[] {
  const periodRecords = complianceRecords.filter((r) => r.periodKey === periodKey);
  const definedItemIds = new Set(periodRecords.map((r) => r.planItemId));

  const counts: Record<string, number> = { C: 0, "NC+": 0, "NC-": 0, "N/A": 0 };
  for (const r of periodRecords) {
    if (r.status in counts) counts[r.status]++;
  }

  const sinDefinir = Math.max(0, itemCount - definedItemIds.size);

  return CATEGORY_ORDER.map((cat) => ({
    name: cat,
    value: cat === "Sin definir" ? sinDefinir : counts[cat] ?? 0,
    fill: CATEGORY_COLORS[cat],
  }));
}

// Custom label for pie slices: "N (X%)"
const renderPieLabel = (props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  value?: number;
  percent?: number;
}) => {
  const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, value = 0, percent = 0 } = props;
  if (value === 0) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={700}
    >
      {value} ({(percent * 100).toFixed(0)}%)
    </text>
  );
};

// Custom bar label: "N (X%)"
const renderBarLabel = (total: number) =>
  // eslint-disable-next-line react/display-name
  (props: {
    x?: number;
    y?: number;
    width?: number;
    value?: number;
  }) => {
    const { x = 0, y = 0, width = 0, value = 0 } = props;
    if (value === 0) return null;
    const pct = total > 0 ? ((value / total) * 100).toFixed(0) : "0";
    return (
      <text
        x={x + width / 2}
        y={y - 5}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill="#475569"
      >
        {value} ({pct}%)
      </text>
    );
  };

export default function PlanComplianceChart({ plan, itemCount, complianceRecords }: Props) {
  const periods = getPlanPeriods(plan);
  const defaultPeriod = periods.length > 0 ? periods[periods.length - 1].key : "";
  const [selectedPeriod, setSelectedPeriod] = useState(defaultPeriod);
  const chartRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const chartData = buildChartData(complianceRecords, selectedPeriod, itemCount);
  const total = chartData.reduce((s, d) => s + d.value, 0);
  const maxValue = Math.max(...chartData.map((d) => d.value), 1);

  // Pie chart: only C vs NC+ + NC-
  const cumplido = chartData.find((d) => d.name === "C")?.value ?? 0;
  const noCumplido =
    (chartData.find((d) => d.name === "NC+")?.value ?? 0) +
    (chartData.find((d) => d.name === "NC-")?.value ?? 0);
  const pieTotal = cumplido + noCumplido;

  const pieData: ChartEntry[] = [
    { name: "Cumplido", value: cumplido, fill: "#22c55e" },
    { name: "No cumplido", value: noCumplido, fill: "#ef4444" },
  ].filter((d) => d.value > 0);

  async function handleDownload() {
    if (!chartRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(chartRef.current, {
        cacheBust: true,
        backgroundColor: "#ffffff",
      });
      const link = document.createElement("a");
      link.download = `cumplimiento_${plan.title}_${selectedPeriod}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      // silent
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold truncate" title={plan.title}>
            {plan.title}
          </CardTitle>
          {plan.tipo && (
            <p className="text-xs text-muted-foreground mt-0.5">{plan.tipo}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {periods.length > 0 ? (
            <select
              className="flex h-8 rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-[160px]"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-muted-foreground">Sin períodos</span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={downloading || periods.length === 0}
            title="Descargar gráfico"
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div ref={chartRef} className="bg-white pt-2">
          {periods.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground">
              Sin datos de períodos disponibles
            </div>
          ) : (
            <div className="flex gap-2">
              {/* Bar chart */}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-center text-muted-foreground mb-1 font-medium">
                  Distribución por categoría
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 20, right: 8, left: 0, bottom: 4 }}
                    barCategoryGap="30%"
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#f1f5f9"
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fontWeight: 600 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      domain={[0, Math.ceil(maxValue * 1.4)]}
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={24}
                    />
                    <Tooltip
                      cursor={{ fill: "#f8fafc" }}
                      formatter={(value) => {
                        const v = Number(value);
                        const pct = total > 0 ? ((v / total) * 100).toFixed(0) : "0";
                        return [`${v} ítem${v !== 1 ? "s" : ""} (${pct}%)`, ""];
                      }}
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                      }}
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
              <div className="w-[180px] shrink-0">
                <p className="text-[10px] text-center text-muted-foreground mb-1 font-medium">
                  Cumplido vs No cumplido
                </p>
                {pieTotal === 0 ? (
                  <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground text-center px-2">
                    Sin C / NC+ / NC- registrados
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="45%"
                        outerRadius={68}
                        dataKey="value"
                        labelLine={false}
                        label={renderPieLabel}
                      >
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
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 8,
                          border: "1px solid #e2e8f0",
                        }}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        formatter={(value) => (
                          <span style={{ fontSize: 10 }}>{value}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 text-right">
          {itemCount} ítem{itemCount !== 1 ? "s" : ""} en total · periodo: {selectedPeriod || "—"}
        </p>
      </CardContent>
    </Card>
  );
}
