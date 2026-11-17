"use client";

import { useEffect, useMemo, useState } from "react";
import { Settings, Waves, Gauge, CloudRain } from "lucide-react";
import type { SimatEstacion, SimatEvaluacion, SimatMareografo, SimatNivelMar, SimatPronostico, SimatSerieLluvia } from "@pma/types";
import { useSimat } from "./contexto";
import { DialRiesgo, GraficoLluvia, GraficoMareografo, GraficoPronostico } from "./Graficos";
import { CriterioForm } from "./FormulariosRiesgo";
import { obtenerMareas, obtenerMareografo, obtenerPronostico, obtenerSerieLluvia } from "@/lib/simat/api";
import { fechaHora, hace, horaPublicada, numero } from "@/lib/simat/formato";

const GAUGE: Record<string, string> = { "Isla Santa Cruz": "sant", "Isla Baltra": "balt" };

export default function VistaRiesgo() {
  const { estado, cargando, error, refrescar } = useSimat();
  const [isla, setIsla] = useState<string>("");
  const [puerto, setPuerto] = useState<string>("");
  const [sector, setSector] = useState<string>("");
  const [mareografo, setMareografo] = useState<SimatMareografo | null>(null);
  const [mareas, setMareas] = useState<SimatNivelMar[]>([]);
  const [serie, setSerie] = useState<SimatSerieLluvia | null>(null);
  const [pronostico, setPronostico] = useState<SimatPronostico | null>(null);
  const [editando, setEditando] = useState(false);

  const islas = estado?.islas ?? [];
  useEffect(() => {
    if (!isla && islas.length) setIsla("Santa Cruz");
  }, [islas, isla]);

  const puertos = useMemo(() => Object.entries(estado?.puertos?.[isla] ?? {}), [estado, isla]);
  useEffect(() => {
    if (puertos.length) setPuerto((p) => (puertos.some(([c]) => c === p) ? p : puertos[0][0]));
    else setPuerto("");
  }, [puertos]);

  const evaluaciones = useMemo<SimatEvaluacion[]>(
    () => (estado?.riesgo ?? []).filter((r) => r.criterio.puerto === puerto),
    [estado, puerto]
  );
  useEffect(() => {
    setSector((s) => (evaluaciones.some((e) => e.criterio.sector === s) ? s : evaluaciones[0]?.criterio.sector ?? ""));
  }, [evaluaciones]);

  const evaluacion = evaluaciones.find((e) => e.criterio.sector === sector) ?? null;
  const criterio = evaluacion?.criterio ?? null;

  // Gauge + tides for the selected port.
  useEffect(() => {
    const code = GAUGE[puerto];
    if (!code) { setMareografo(null); return; }
    const ctrl = new AbortController();
    obtenerMareografo(code, ctrl.signal).then((m) => !ctrl.signal.aborted && setMareografo(m), () => setMareografo(null));
    return () => ctrl.abort();
  }, [puerto, estado]);

  useEffect(() => {
    if (!puerto) return;
    const ctrl = new AbortController();
    obtenerMareas(puerto, ctrl.signal).then((m) => !ctrl.signal.aborted && setMareas(m), () => setMareas([]));
    return () => ctrl.abort();
  }, [puerto, estado]);

  // Rain + forecast for the criterion's station (or a default on the island).
  const estacionLluvia = useMemo<SimatEstacion | undefined>(() => {
    const porId = new Map((estado?.estaciones ?? []).map((e) => [e.id, e]));
    if (criterio && porId.has(criterio.estacion)) return porId.get(criterio.estacion);
    return (estado?.estaciones ?? []).find((e) => e.isla === isla && e.variables.includes("precipitacion") && e.pasoMin < 1440 && e.activa);
  }, [estado, criterio, isla]);

  useEffect(() => {
    if (!estacionLluvia) { setSerie(null); setPronostico(null); return; }
    const ctrl = new AbortController();
    obtenerSerieLluvia(estacionLluvia.id, ctrl.signal).then((s) => !ctrl.signal.aborted && setSerie(s), () => setSerie(null));
    obtenerPronostico(estacionLluvia.id, ctrl.signal).then((p) => !ctrl.signal.aborted && setPronostico(p), () => setPronostico(null));
    return () => ctrl.abort();
  }, [estacionLluvia, estado]);

  if (cargando && !estado) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (error && !estado) return <p className="text-sm text-red-600">{error}</p>;
  if (!estado) return null;

  const sea = evaluacion?.mar;
  const comparableMar = criterio && sea && sea.unidad === "m" && String(sea.referencia).toLowerCase() === criterio.datum.toLowerCase();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Riesgo por lluvia y mar</h1>
          <p className="text-sm text-slate-500">Nivel, mediciones y criterio de decisión por sector costero.</p>
        </div>
        {estado.puedeEditar && (
          <button type="button" onClick={() => setEditando((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm text-white hover:bg-teal-700">
            <Settings className="w-4 h-4" /> {criterio ? "Editar criterio" : "Configurar criterio"}
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-3">
        <label className="text-sm">Isla
          <select value={isla} onChange={(e) => setIsla(e.target.value)} className="ml-2 rounded-lg border px-2 py-1">
            {islas.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <label className="text-sm">Puerto
          <select value={puerto} onChange={(e) => setPuerto(e.target.value)} className="ml-2 rounded-lg border px-2 py-1" disabled={!puertos.length}>
            {puertos.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        {evaluaciones.length > 0 && (
          <label className="text-sm">Sector
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="ml-2 rounded-lg border px-2 py-1">
              {evaluaciones.map((e) => <option key={e.criterio.id} value={e.criterio.sector}>{e.criterio.sector}</option>)}
            </select>
          </label>
        )}
      </div>

      {editando && estado.puedeEditar && (
        <CriterioForm
          estado={estado}
          isla={isla}
          puerto={puerto}
          criterio={criterio}
          onListo={async () => { setEditando(false); await refrescar(); }}
          onCancelar={() => setEditando(false)}
        />
      )}

      <section className="rounded-xl border bg-white p-4 shadow-sm grid md:grid-cols-[260px_1fr] gap-4 items-center">
        <DialRiesgo nivel={evaluacion?.nivel ?? null} />
        <div>
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Gauge className="w-4 h-4" /> Evaluación del sector</h2>
          {!criterio ? (
            <p className="mt-2 text-sm text-slate-500">No hay un criterio configurado para este puerto. {estado.puedeEditar ? "Usa «Configurar criterio»." : "Un técnico debe configurarlo."}</p>
          ) : evaluacion?.nivel ? (
            <p className="mt-2 text-sm text-slate-600">Sector <strong>{criterio.sector}</strong>: la matriz evalúa <strong>{evaluacion.nivel}</strong> con la lluvia observada y el nivel del mar validado.</p>
          ) : (
            <div className="mt-2 text-sm text-slate-600">
              <p>Sin nivel automático todavía. Motivos:</p>
              <ul className="list-disc ml-5 mt-1 text-xs text-slate-500">
                {evaluacion?.motivos.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {criterio && (
            <p className="mt-2 text-[11px] text-slate-400">
              Ventana {criterio.ventanaMin} min · umbral lluvia {numero(criterio.lluviaMmH)} mm/h · umbral mar {numero(criterio.marM)} m ({criterio.datum}) · actualizado por {criterio.actualizadoPor}
            </p>
          )}
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><CloudRain className="w-4 h-4 text-teal-600" /> Precipitación {estacionLluvia ? `· ${estacionLluvia.nombre}` : ""}</h2>
          {serie ? <div className="mt-2"><GraficoLluvia serie={serie} altura={180} /></div> : <p className="mt-2 text-sm text-slate-500">Sin serie de lluvia.</p>}
          {evaluacion && (
            <p className="mt-2 text-xs text-slate-500">
              Intensidad ({criterio?.ventanaMin ?? 60} min): <strong>{evaluacion.lluvia.valor != null ? `${numero(evaluacion.lluvia.valor)} mm/h` : "sin dato"}</strong>
              {evaluacion.lluvia.fecha ? ` · ${fechaHora(evaluacion.lluvia.fecha)}` : ""}
            </p>
          )}
        </section>

        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Waves className="w-4 h-4 text-sky-600" /> Nivel del mar</h2>
          {mareografo ? (
            <>
              <div className="mt-2"><GraficoMareografo mareografo={mareografo} umbral={comparableMar ? criterio?.marM : null} /></div>
              <p className="mt-1 text-xs text-slate-500">
                Último: <strong>{numero(mareografo.valor)} m</strong> · {hace(mareografo.fecha)} · {mareografo.calidad}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No hay mareógrafo para este puerto.</p>
          )}
          {sea && (
            <p className="mt-1 text-xs text-slate-500">
              Nivel observado validado: {numero(sea.valor)} {sea.unidad} · {sea.referencia} · {hace(sea.instante)}
            </p>
          )}
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800">Pronóstico de lluvia (Open-Meteo, modelo)</h2>
          {pronostico ? <div className="mt-2"><GraficoPronostico pronostico={pronostico} /></div> : <p className="mt-2 text-sm text-slate-500">Sin pronóstico.</p>}
        </section>
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800">Mareas (INOCAR)</h2>
          {mareas.length ? (
            <table className="w-full text-sm mt-2">
              <tbody className="divide-y">
                {mareas.slice(0, 8).map((m) => (
                  <tr key={m.id}>
                    <td className="py-1.5 text-slate-500">{horaPublicada(m.instante)}</td>
                    <td className="py-1.5">{m.fase}</td>
                    <td className="py-1.5 text-right font-medium">{numero(m.valor)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-sm text-slate-500">Sin predicciones para este puerto.</p>
          )}
        </section>
      </div>
    </div>
  );
}
