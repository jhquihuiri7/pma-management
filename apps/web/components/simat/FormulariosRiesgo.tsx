"use client";

import { useState } from "react";
import type { SimatCriterio, SimatEstado } from "@pma/types";
import { guardarCriterio, registrarNivelObservado } from "@/lib/simat/api";
import { apiErrorMessage } from "@/lib/api-client";

const VENTANAS = [5, 15, 30, 60, 180, 360, 720];

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs text-slate-600 flex flex-col gap-1">
      {label}
      {children}
    </label>
  );
}

const inputCls = "rounded-lg border px-2 py-1.5 text-sm";

export function CriterioForm({
  estado,
  isla,
  puerto,
  criterio,
  onListo,
  onCancelar,
}: {
  estado: SimatEstado;
  isla: string;
  puerto: string;
  criterio: SimatCriterio | null;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const estaciones = estado.estaciones.filter((e) => e.isla === isla && e.variables.includes("precipitacion") && e.pasoMin < 1440);
  const [form, setForm] = useState({
    estacion: criterio?.estacion ?? estaciones[0]?.id ?? "",
    datum: criterio?.datum ?? "MLWS",
    sector: criterio?.sector ?? "",
    respaldo: criterio?.respaldo ?? "",
    ventanaMin: criterio?.ventanaMin ?? 60,
    vigenciaMin: criterio?.vigenciaMin ?? 60,
    desfaseMin: criterio?.desfaseMin ?? 30,
    lluviaMmH: criterio?.lluviaMmH ?? 10,
    marM: criterio?.marM ?? 2,
    activo: criterio?.activo ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await guardarCriterio({ ...form, puerto });
      onListo();
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo guardar el criterio."));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800 mb-3">{criterio ? "Editar criterio" : "Configurar criterio"} · {puerto}</h2>
      <form onSubmit={enviar} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Campo label="Estación de lluvia">
          <select value={form.estacion} onChange={(e) => set("estacion", e.target.value)} className={inputCls} required>
            {estaciones.length === 0 && <option value="">Sin estación en la isla</option>}
            {estaciones.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {e.pasoMin} min</option>)}
          </select>
        </Campo>
        <Campo label="Sector costero"><input value={form.sector} onChange={(e) => set("sector", e.target.value)} className={inputCls} required maxLength={120} /></Campo>
        <Campo label="Datum / referencia"><input value={form.datum} onChange={(e) => set("datum", e.target.value)} className={inputCls} required maxLength={80} /></Campo>
        <Campo label="Ventana de lluvia">
          <select value={form.ventanaMin} onChange={(e) => set("ventanaMin", Number(e.target.value))} className={inputCls}>
            {VENTANAS.map((v) => <option key={v} value={v}>{v >= 60 ? `${v / 60} h` : `${v} min`}</option>)}
          </select>
        </Campo>
        <Campo label="Umbral de lluvia (mm/h)"><input type="number" step="0.1" value={form.lluviaMmH} onChange={(e) => set("lluviaMmH", Number(e.target.value))} className={inputCls} required /></Campo>
        <Campo label="Umbral de mar (m)"><input type="number" step="0.01" value={form.marM} onChange={(e) => set("marM", Number(e.target.value))} className={inputCls} required /></Campo>
        <Campo label="Vigencia máx. (min)"><input type="number" value={form.vigenciaMin} onChange={(e) => set("vigenciaMin", Number(e.target.value))} className={inputCls} required /></Campo>
        <Campo label="Desfase máx. (min)"><input type="number" value={form.desfaseMin} onChange={(e) => set("desfaseMin", Number(e.target.value))} className={inputCls} required /></Campo>
        <Campo label="Respaldo técnico"><input value={form.respaldo} onChange={(e) => set("respaldo", e.target.value)} className={inputCls} maxLength={500} /></Campo>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2 lg:col-span-3">
          <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} className="accent-teal-600" />
          Habilitar evaluación automática
        </label>
        {error && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-3">{error}</p>}
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
          <button type="submit" disabled={guardando} className="rounded-lg bg-teal-600 px-4 py-2 text-sm text-white hover:bg-teal-700 disabled:opacity-50">
            {guardando ? "Guardando…" : "Guardar criterio"}
          </button>
          <button type="button" onClick={onCancelar} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">Cancelar</button>
        </div>
      </form>

      <NivelForm puerto={puerto} datum={form.datum} onListo={onListo} />
    </section>
  );
}

function NivelForm({ puerto, datum, onListo }: { puerto: string; datum: string; onListo: () => void }) {
  const [valor, setValor] = useState("");
  const [instante, setInstante] = useState("");
  const [referencia, setReferencia] = useState(datum);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await registrarNivelObservado({
        puerto,
        // The observer's local clock is Galápagos time (UTC−6).
        instante: instante ? `${instante}:00-06:00` : new Date().toISOString(),
        valor: Number(valor),
        unidad: "m",
        referencia: referencia || datum,
        calidad: "validado",
      });
      setValor("");
      setInstante("");
      onListo();
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo registrar el nivel."));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="mt-4 border-t pt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
      <p className="text-xs font-semibold text-slate-700 sm:col-span-2 lg:col-span-4">Registrar nivel observado validado ({puerto})</p>
      <Campo label="Nivel (m)"><input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className={inputCls} required /></Campo>
      <Campo label="Hora (Galápagos)"><input type="datetime-local" value={instante} onChange={(e) => setInstante(e.target.value)} className={inputCls} required /></Campo>
      <Campo label="Referencia / datum"><input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inputCls} required /></Campo>
      <button type="submit" disabled={guardando} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
        {guardando ? "Registrando…" : "Registrar nivel"}
      </button>
      {error && <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">{error}</p>}
    </form>
  );
}
