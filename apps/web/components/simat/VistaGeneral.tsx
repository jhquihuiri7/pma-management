"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CloudRain, Gauge, TowerControl, Waves, Droplets } from "lucide-react";
import type { SimatEstacion, SimatNivelRiesgo, SimatSerieLluvia } from "@pma/types";
import { useSimat } from "./contexto";
import { GraficoLluvia } from "./Graficos";
import { obtenerSerieLluvia } from "@/lib/simat/api";
import { fechaHora, hace, numero } from "@/lib/simat/formato";

const MapaEstaciones = dynamic(() => import("./MapaEstaciones"), {
  ssr: false,
  loading: () => <div className="simat-leaflet bg-slate-100 animate-pulse" style={{ height: 320 }} />,
});

const ORDEN: SimatNivelRiesgo[] = ["Normal", "Precaución", "Alerta", "Emergencia"];
const CLASE_NIVEL: Record<string, string> = {
  Normal: "simat-nivel-normal",
  Precaución: "simat-nivel-precaucion",
  Alerta: "simat-nivel-alerta",
  Emergencia: "simat-nivel-emergencia",
};

function Kpi({ etiqueta, valor, detalle, Icono, tono }: { etiqueta: string; valor: string; detalle: string; Icono: typeof Gauge; tono: string }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{etiqueta}</span>
        <span className={`grid place-items-center w-8 h-8 rounded-lg ${tono}`}><Icono className="w-4 h-4" /></span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{valor}</div>
      <div className="mt-0.5 text-xs text-slate-500">{detalle}</div>
    </div>
  );
}

export default function VistaGeneral() {
  const { estado, cargando, error } = useSimat();
  const [estacionId, setEstacionId] = useState<string | null>(null);
  const [serie, setSerie] = useState<SimatSerieLluvia | null>(null);

  const estacionesLluvia = useMemo<SimatEstacion[]>(
    () => (estado?.estaciones ?? []).filter((e) => e.variables.includes("precipitacion") && e.pasoMin < 1440),
    [estado]
  );

  useEffect(() => {
    if (!estacionId && estacionesLluvia.length) {
      setEstacionId(estacionesLluvia.find((e) => e.activa)?.id ?? estacionesLluvia[0].id);
    }
  }, [estacionesLluvia, estacionId]);

  useEffect(() => {
    if (!estacionId) return;
    const ctrl = new AbortController();
    obtenerSerieLluvia(estacionId, ctrl.signal).then(
      (s) => !ctrl.signal.aborted && setSerie(s),
      () => {}
    );
    return () => ctrl.abort();
  }, [estacionId, estado]);

  if (cargando && !estado) return <p className="text-sm text-slate-500">Cargando la situación territorial…</p>;
  if (error && !estado) return <p className="text-sm text-red-600">{error}</p>;
  if (!estado) return null;

  const evaluadas = estado.riesgo.filter((r) => r.nivel);
  const nivelMax = ORDEN.filter((n) => evaluadas.some((r) => r.nivel === n)).at(-1) ?? null;
  const activas = estado.estaciones.filter((e) => e.activa);
  const conectoresOk = estado.conectores.filter((c) => c.habilitado && c.fallosSeguidos === 0 && c.ultimoExito).length;
  const conectoresTot = estado.conectores.filter((c) => c.habilitado).length;
  const estacion = estacionesLluvia.find((e) => e.id === estacionId);
  const win24 = serie?.windows.find((w) => w.minutes === 1440);

  return (
    <div className="space-y-6">
      <section className="simat-hero p-6 sm:p-8">
        <p className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-emerald-100">
          <Waves className="w-4 h-4" /> Vigilancia hidrometeorológica
        </p>
        <h1 className="mt-2 text-2xl sm:text-3xl font-semibold">Panel de vigilancia</h1>
        <p className="mt-1 text-sm text-teal-50/90 max-w-2xl">
          Sistema Provincial de Monitoreo Hidrometeorológico y Alerta Temprana de Galápagos. Datos reales de lluvia, nivel del mar y estaciones.
        </p>
        <p className="mt-3 text-xs text-teal-50/80">Actualizado {hace(estado.generadoEn)} · {activas.length} estaciones activas</p>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi etiqueta="Nivel de riesgo" valor={nivelMax ?? "Sin alerta"} detalle={`${evaluadas.length} sector(es) evaluados`} Icono={Gauge} tono="bg-amber-50 text-amber-600" />
        <Kpi etiqueta="Estaciones activas" valor={String(activas.length)} detalle={`${estado.estaciones.length} en inventario`} Icono={TowerControl} tono="bg-sky-50 text-sky-600" />
        <Kpi
          etiqueta="Lluvia 24 h"
          valor={win24?.total != null ? `${numero(win24.total)} mm` : "—"}
          detalle={estacion ? estacion.nombre : "Sin estación"}
          Icono={CloudRain}
          tono="bg-violet-50 text-violet-600"
        />
        <Kpi etiqueta="Conectores" valor={`${conectoresOk}/${conectoresTot}`} detalle="Fuentes en línea" Icono={Droplets} tono="bg-teal-50 text-teal-600" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Estaciones de la red</h2>
          <MapaEstaciones estaciones={estado.estaciones} alto="340px" />
        </section>
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-1">Riesgo por sector</h2>
          {estado.riesgo.length ? (
            <ul className="space-y-2 mt-2">
              {estado.riesgo.map((r) => (
                <li key={r.criterio.id} className={`rounded-lg border px-3 py-2 ${CLASE_NIVEL[r.nivel ?? ""] ?? "simat-nivel-sindato"}`}>
                  <div className="flex items-center justify-between">
                    <strong className="text-sm">{r.criterio.sector}</strong>
                    <span className="text-xs font-semibold">{r.nivel ?? "Sin evaluación"}</span>
                  </div>
                  <p className="text-[11px] opacity-80">{r.criterio.puerto}</p>
                  {!r.nivel && r.motivos[0] && <p className="text-[11px] opacity-70 mt-0.5">{r.motivos[0]}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2 text-sm text-slate-500">
              <p>Aún no hay criterios de riesgo configurados.</p>
              <p className="mt-1 text-xs">Un técnico los define en «Riesgo y nivel del mar» para que la matriz evalúe automáticamente.</p>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><CloudRain className="w-4 h-4 text-teal-600" /> Precipitación reciente</h2>
          {estacionesLluvia.length > 0 && (
            <select
              value={estacionId ?? ""}
              onChange={(e) => setEstacionId(e.target.value)}
              className="rounded-lg border px-2 py-1 text-sm"
            >
              {estacionesLluvia.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre} · {e.isla}</option>
              ))}
            </select>
          )}
        </div>
        {serie ? (
          <>
            <GraficoLluvia serie={serie} />
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {serie.windows.filter((w) => [60, 180, 360, 1440].includes(w.minutes)).map((w) => (
                <div key={w.minutes} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-slate-500">{w.minutes >= 60 ? `${w.minutes / 60} h` : `${w.minutes} min`}</div>
                  <div className="font-semibold text-slate-800">{w.total != null ? `${numero(w.total)} mm` : "—"}</div>
                  <div className="text-slate-400">{w.total != null ? `${numero(w.intensity)} mm/h` : w.reason}</div>
                </div>
              ))}
            </div>
            {serie.latest && (
              <p className="mt-2 text-xs text-slate-500">Último dato: {fechaHora(serie.latest.time)} · {serie.latest.source}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">Selecciona una estación para ver su serie.</p>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Fuentes: IERSE (U. del Azuay), INOCAR/IOC, INAMHI, Fundación Charles Darwin, Open-Meteo (CC BY 4.0), NOAA. Cada valor indica su procedencia.
      </p>
    </div>
  );
}
