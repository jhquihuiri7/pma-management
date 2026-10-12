"use client";

import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deTotal, formatPct, formatUsd } from "@/lib/pg2030";
import type { Pg2030Dashboard, Pg2030DashboardInstitucion, Pg2030EstadoReporte, Pg2030Semaforo } from "@/types";
import { Cuadro, Estado, Tile, VerTabla } from "./comunes";
import { AlineacionChart, AvanceFisicoChart, CoherenciaChart, DineroChart } from "./graficos";

export const ESTADO_REPORTE: Record<Pg2030EstadoReporte, { label: string; color: string }> = {
  cumplio: { label: "Cumplió", color: "#0ca30c" },
  parcial: { label: "Cumplimiento parcial", color: "#fab219" },
  no_cumplio: { label: "No cumplió", color: "#d03b3b" },
  no_obligada: { label: "Sin metas a reportar", color: "#8a8985" },
};

type Props = { d: Pg2030Dashboard; onSelect: (id: string) => void };

function Sigla({ i, onSelect }: { i: Pg2030DashboardInstitucion; onSelect: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onSelect(i.institucion.id)} title={i.institucion.nombre}
      className="text-left font-medium text-teal-700 underline-offset-2 hover:underline">
      {i.institucion.sigla}
    </button>
  );
}

function EstadoSemaforo({ d, semaforo }: { d: Pg2030Dashboard; semaforo: Pg2030Semaforo | null }) {
  return semaforo ? <Estado {...d.leyenda.semaforo[semaforo]} /> : <span className="text-xs text-slate-400">No aplica</span>;
}

/** Cuadro 2: who was called to plan the year and what came back. */
export function CuadroPlanificacion({ d }: { d: Pg2030Dashboard }) {
  const p = d.planificacion;
  return (
    <Cuadro numero={2} titulo="Planificación del año"
      descripcion="Instituciones convocadas y su respuesta. El filtro de eje no cambia estos conteos.">
      <div className="grid grid-cols-2 gap-3">
        <Tile label="Instituciones convocadas" value={p.convocadas} />
        <Tile label="Con metas planificadas" value={deTotal(p.conMetas, p.convocadas)} />
        <Tile label="Sin acciones vinculadas" value={deTotal(p.sinAcciones, p.convocadas)} />
        <Tile label="Sin respuesta" value={deTotal(p.sinRespuesta, p.convocadas)} />
        <Tile label="Metas institucionales" value={p.metas} />
        <Tile label="Metas con presupuesto" value={deTotal(p.metasConPresupuesto, p.metas)} />
      </div>
      {p.institucionesSinRespuesta.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500">Instituciones sin respuesta</p>
          <p className="mt-1 text-sm text-slate-700">
            {p.institucionesSinRespuesta.map((i) => `${i.sigla} (${i.nombre})`).join(" · ")}
          </p>
        </div>
      )}
    </Cuadro>
  );
}

/** Cuadro 3: whether the institutions reported the cutoff's months. */
export function CuadroCumplimiento({ d, onSelect }: Props) {
  const c = d.cumplimiento;
  const obligadas = d.instituciones.filter((i) => i.estadoReporte !== "no_obligada");
  return (
    <Cuadro numero={3} titulo="Cumplimiento del reporte"
      descripcion="Una meta cumple cuando reportó todos los meses del corte que tenía planificados.">
      <div className="grid grid-cols-2 gap-3">
        <Tile label="Cumplieron" value={deTotal(c.cumplio, c.obligadas)} />
        <Tile label="Cumplimiento parcial" value={deTotal(c.parcial, c.obligadas)} />
        <Tile label="No cumplieron" value={deTotal(c.noCumplio, c.obligadas)} />
        <Tile label="Metas reportadas" value={deTotal(c.reportadas, c.aReportar)}
          hint={c.aReportar > 0 ? formatPct(c.reportadas / c.aReportar) : undefined} />
      </div>
      {obligadas.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Institución</TableHead>
              <TableHead className="text-right">Metas reportadas</TableHead>
              <TableHead className="text-right">Cumplimiento</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {obligadas.map((i) => (
              <TableRow key={i.institucion.id}>
                <TableCell><Sigla i={i} onSelect={onSelect} /></TableCell>
                <TableCell className="text-right tabular-nums">{deTotal(i.reportadas, i.aReportar)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPct(i.cumplimiento)}</TableCell>
                <TableCell><Estado {...ESTADO_REPORTE[i.estadoReporte]} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Cuadro>
  );
}

/** Cuadro 4: how the goals align with the Plan, by axis, as the AI classified them. */
export function CuadroAlineacion({ d }: { d: Pg2030Dashboard }) {
  const { categorias, porEje } = d.alineacion;
  return (
    <Cuadro numero={4} titulo="Alineación de las metas con el Plan"
      descripcion="Metas reportadas por eje, según la clasificación automática con IA. Nadie la edita.">
      {porEje.length === 0 ? <SinDatos /> : (
        <>
          <AlineacionChart
            filas={porEje.map((e) => ({ eje: e.eje.codigo, total: e.total, porCategoria: e.porCategoria }))}
            categorias={categorias}
            leyenda={d.leyenda}
          />
          <VerTabla>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Eje</TableHead>
                  {categorias.map((c) => <TableHead key={c} className="text-right">{c}</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porEje.map((e) => (
                  <TableRow key={e.eje.id}>
                    <TableCell title={e.eje.nombre}>{e.eje.codigo} — {e.eje.nombre}</TableCell>
                    {categorias.map((c) => <TableCell key={c} className="text-right tabular-nums">{e.porCategoria[c] ?? 0}</TableCell>)}
                    <TableCell className="text-right font-medium tabular-nums">{e.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </VerTabla>
        </>
      )}
    </Cuadro>
  );
}

/** Cuadro 5: physical progress per institution and overall. */
export function CuadroAvanceFisico({ d, onSelect }: Props) {
  const filas = d.instituciones
    .filter((i) => i.cuenta && i.fisico.valor !== null && i.fisico.semaforo !== null)
    .sort((a, b) => b.fisico.valor! - a.fisico.valor! || a.institucion.sigla.localeCompare(b.institucion.sigla));
  return (
    <Cuadro numero={5} titulo="Avance físico"
      descripcion="Promedio de las metas reportadas de cada institución; el total es el promedio de las instituciones. Toca una barra para ver sus metas."
      accion={<AvanceHeadline valor={d.avanceFisico.valor} semaforo={d.avanceFisico.semaforo} d={d} />}>
      {filas.length === 0 ? <SinDatos /> : (
        <>
          <AvanceFisicoChart
            filas={filas.map((i) => ({ id: i.institucion.id, sigla: i.institucion.sigla, valor: i.fisico.valor!, semaforo: i.fisico.semaforo! }))}
            promedio={d.avanceFisico.valor}
            leyenda={d.leyenda}
            onSelect={onSelect}
          />
          <VerTabla>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Institución</TableHead>
                  <TableHead className="text-right">Metas reportadas</TableHead>
                  <TableHead className="text-right">Avance físico</TableHead>
                  <TableHead>Semáforo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((i) => (
                  <TableRow key={i.institucion.id}>
                    <TableCell><Sigla i={i} onSelect={onSelect} /></TableCell>
                    <TableCell className="text-right tabular-nums">{i.metas.filter((m) => m.cuenta).length}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPct(i.fisico.valor)}</TableCell>
                    <TableCell><EstadoSemaforo d={d} semaforo={i.fisico.semaforo} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </VerTabla>
        </>
      )}
    </Cuadro>
  );
}

function AvanceHeadline({ d, valor, semaforo }: { d: Pg2030Dashboard; valor: number | null; semaforo: Pg2030Semaforo | null }) {
  return (
    <div className="text-right">
      <p className="text-2xl font-semibold text-slate-900">{formatPct(valor)}</p>
      <EstadoSemaforo d={d} semaforo={semaforo} />
    </div>
  );
}

/** Cuadro 6: budget progress in dollars, capped per goal at what it planned. */
export function CuadroPresupuesto({ d }: { d: Pg2030Dashboard }) {
  const p = d.presupuesto;
  const fuentes = p.porFuente.filter((f) => f.dinero.planificado > 0 || f.dinero.devengado > 0);
  const semaforos = [
    ...(Object.keys(d.leyenda.semaforo) as Pg2030Semaforo[]).map((k) => ({ ...d.leyenda.semaforo[k], n: p.institucionesPorSemaforo[k] })),
    { label: "Sin presupuesto planificado", color: "#b5b4ae", n: p.institucionesPorSemaforo.sin_presupuesto },
  ];
  return (
    <Cuadro numero={6} titulo="Avance presupuestario"
      descripcion="Devengado sobre planificado al corte, en dólares. En cada meta el devengado cuenta hasta lo planificado."
      accion={<AvanceHeadline valor={p.total.avance} semaforo={p.total.semaforo} d={d} />}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Planificado al corte" value={formatUsd(p.total.planificado)} />
        <Tile label="Devengado computable" value={formatUsd(p.total.computable)}
          hint={p.total.devengado !== p.total.computable ? `Reportado: ${formatUsd(p.total.devengado)}` : undefined} />
        <Tile label="Metas con presupuesto reportadas" value={deTotal(p.metasConPresupuestoReportadas, p.metasAReportarConPresupuesto)} />
        <Tile label="Presupuesto sin reporte" value={formatUsd(p.presupuestoSinReporte.planificado)}
          hint={p.presupuestoSinReporte.proporcion !== null ? `${formatPct(p.presupuestoSinReporte.proporcion)} de lo planificado` : undefined} />
      </div>
      {fuentes.length === 0 ? <SinDatos /> : (
        <DineroChart
          filas={fuentes.map((f) => ({ nombre: f.fuente, planificado: f.dinero.planificado, computable: f.dinero.computable, avance: f.dinero.avance }))}
          leyenda={d.leyenda}
        />
      )}
      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">Instituciones por semáforo presupuestario</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {semaforos.map((s) => <Estado key={s.label} color={s.color} label={`${s.label}: ${s.n}`} />)}
        </div>
      </div>
      {fuentes.length > 0 && (
        <VerTabla>
          <TablaDinero filas={fuentes.map((f) => ({ nombre: f.fuente, dinero: f.dinero }))} etiqueta="Fuente" d={d} />
        </VerTabla>
      )}
    </Cuadro>
  );
}

function TablaDinero({ filas, etiqueta, d }: {
  filas: Array<{ nombre: string; dinero: Pg2030Dashboard["presupuesto"]["total"] }>;
  etiqueta: string;
  d: Pg2030Dashboard;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{etiqueta}</TableHead>
          <TableHead className="text-right">Metas</TableHead>
          <TableHead className="text-right">Planificado</TableHead>
          <TableHead className="text-right">Devengado computable</TableHead>
          <TableHead className="text-right">Avance</TableHead>
          <TableHead>Semáforo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filas.map((f) => (
          <TableRow key={f.nombre}>
            <TableCell>{f.nombre}</TableCell>
            <TableCell className="text-right tabular-nums">{f.dinero.metas}</TableCell>
            <TableCell className="text-right tabular-nums">{formatUsd(f.dinero.planificado)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatUsd(f.dinero.computable)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPct(f.dinero.avance)}</TableCell>
            <TableCell><EstadoSemaforo d={d} semaforo={f.dinero.semaforo} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Cuadro 7: whether physical and budget progress move together (±5 points). */
export function CuadroCoherencia({ d, onSelect }: Props) {
  const puntos = d.instituciones.filter(
    (i) => i.cuenta && i.coherencia !== "no_aplica" && i.fisico.valor !== null && i.presupuesto.valor !== null,
  );
  const sinPresupuesto = d.instituciones.filter((i) => i.cuenta && i.presupuesto.sinPresupuesto);
  return (
    <Cuadro numero={7} titulo="Coherencia entre avance físico y presupuestario"
      descripcion="Coherente cuando ambos avances difieren en 5 puntos o menos. Toca un punto para ver las metas de la institución.">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(["coherente", "sin_financiamiento", "incoherencia_brecha"] as const).map((k) => (
          <Estado key={k} color={d.leyenda.coherencia[k].color} label={`${d.leyenda.coherencia[k].label}: ${d.coherenciaConteo[k]}`} />
        ))}
      </div>
      {puntos.length === 0 ? <SinDatos /> : (
        <>
          <CoherenciaChart
            puntos={puntos.map((i) => ({
              id: i.institucion.id,
              sigla: i.institucion.sigla,
              fisico: i.fisico.valor!,
              presupuesto: i.presupuesto.valor!,
              coherencia: i.coherencia,
            }))}
            leyenda={d.leyenda}
            onSelect={onSelect}
          />
          <VerTabla>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Institución</TableHead>
                  <TableHead className="text-right">Avance físico</TableHead>
                  <TableHead className="text-right">Avance presupuestario</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead>Coherencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {puntos.map((i) => (
                  <TableRow key={i.institucion.id}>
                    <TableCell><Sigla i={i} onSelect={onSelect} /></TableCell>
                    <TableCell className="text-right tabular-nums">{formatPct(i.fisico.valor)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPct(i.presupuesto.valor)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(Math.abs(i.fisico.valor! - i.presupuesto.valor!) * 100).toLocaleString("es-EC", { maximumFractionDigits: 2 })} puntos
                    </TableCell>
                    <TableCell><Estado {...d.leyenda.coherencia[i.coherencia]} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </VerTabla>
        </>
      )}
      {sinPresupuesto.length > 0 && (
        <p className="text-xs text-slate-600">
          <span className="font-medium">Sin presupuesto planificado al corte</span> (no se evalúa su coherencia):{" "}
          {sinPresupuesto.map((i) => i.institucion.sigla).join(", ")}.
        </p>
      )}
    </Cuadro>
  );
}

/** Cuadro 8: budget by investment type, as the AI classified each goal. */
export function CuadroInversion({ d }: { d: Pg2030Dashboard }) {
  const [fuente, setFuente] = useState<string>("todas");
  const fuentes = d.presupuesto.porFuente.filter((f) => f.dinero.planificado > 0 || f.dinero.devengado > 0).map((f) => f.fuente);
  const filas = d.inversion
    .map((t) => ({
      nombre: t.tipo,
      dinero: fuente === "todas" ? t.total : t.porFuente.find((f) => f.fuente === fuente)?.dinero,
    }))
    .filter((f): f is { nombre: string; dinero: Pg2030Dashboard["presupuesto"]["total"] } =>
      !!f.dinero && (f.dinero.planificado > 0 || f.dinero.devengado > 0));
  return (
    <Cuadro numero={8} titulo="Presupuesto por tipo de inversión"
      descripcion="Planificado y devengado computable por tipo de inversión, según la clasificación automática con IA."
      accion={fuentes.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Fuente de financiamiento">
          {["todas", ...fuentes].map((f) => (
            <button key={f} type="button" onClick={() => setFuente(f)} aria-pressed={fuente === f}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${fuente === f
                ? "border-teal-600 bg-teal-50 text-teal-800"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
              {f === "todas" ? "Todas las fuentes" : f}
            </button>
          ))}
        </div>
      )}>
      {filas.length === 0 ? <SinDatos /> : (
        <>
          <DineroChart
            filas={filas.map((f) => ({ nombre: f.nombre, planificado: f.dinero.planificado, computable: f.dinero.computable, avance: f.dinero.avance }))}
            leyenda={d.leyenda}
          />
          <VerTabla>
            <TablaDinero filas={filas} etiqueta="Tipo de inversión" d={d} />
          </VerTabla>
        </>
      )}
    </Cuadro>
  );
}

function SinDatos() {
  return <p className="py-6 text-center text-sm text-slate-500">No hay metas reportadas que cuenten en este corte.</p>;
}
