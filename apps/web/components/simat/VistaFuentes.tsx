"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, CircleSlash, ExternalLink, RefreshCw } from "lucide-react";
import type { SimatConector } from "@pma/types";
import { useSimat } from "./contexto";
import { sincronizarConector } from "@/lib/simat/api";
import { fechaHora, hace, horaCorta } from "@/lib/simat/formato";

function EstadoConector({ ok, habilitado }: { ok: boolean; habilitado: boolean }) {
  if (!habilitado) return <span className="inline-flex items-center gap-1 text-slate-400"><CircleSlash className="w-4 h-4" /> Desactivado</span>;
  if (ok) return <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-4 h-4" /> En línea</span>;
  return <span className="inline-flex items-center gap-1 text-red-600"><CircleAlert className="w-4 h-4" /> Con fallos</span>;
}

export default function VistaFuentes() {
  const { estado, cargando, error, refrescar } = useSimat();
  const [sincronizando, setSincronizando] = useState<SimatConector | null>(null);

  if (cargando && !estado) return <p className="text-sm text-slate-500">Cargando fuentes…</p>;
  if (error && !estado) return <p className="text-sm text-red-600">{error}</p>;
  if (!estado) return null;

  const sincronizar = async (c: SimatConector) => {
    setSincronizando(c);
    try {
      await sincronizarConector(c);
      await refrescar();
    } finally {
      setSincronizando(null);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Estaciones y fuentes</h1>
        <p className="text-sm text-slate-500">Estado de cada conexión, su último dato y su último error.</p>
      </header>

      <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <h2 className="px-4 py-3 text-sm font-semibold text-slate-800 border-b">Conectores</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Fuente</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="text-left px-4 py-2">Último éxito</th>
                <th className="text-left px-4 py-2">Resultado</th>
                {estado.puedeEditar && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {estado.conectores.map((c) => (
                <tr key={c.conector}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800">{c.nombre}</div>
                    <div className="text-xs text-slate-400">{c.descripcion}</div>
                  </td>
                  <td className="px-4 py-2"><EstadoConector ok={c.fallosSeguidos === 0 && !!c.ultimoExito} habilitado={c.habilitado} /></td>
                  <td className="px-4 py-2 text-slate-600">{c.ultimoExito ? hace(c.ultimoExito) : "—"}</td>
                  <td className="px-4 py-2 text-xs text-slate-500 max-w-[280px]">
                    {c.error ? <span className="text-red-600">{c.error}</span> : c.resultado ?? "—"}
                  </td>
                  {estado.puedeEditar && (
                    <td className="px-4 py-2 text-right">
                      {c.habilitado && (
                        <button
                          type="button"
                          onClick={() => void sincronizar(c.conector)}
                          disabled={sincronizando === c.conector}
                          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${sincronizando === c.conector ? "animate-spin" : ""}`} /> Sincronizar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <h2 className="px-4 py-3 text-sm font-semibold text-slate-800 border-b">Estaciones ({estado.estaciones.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Estación</th>
                <th className="text-left px-4 py-2">Fuente</th>
                <th className="text-left px-4 py-2">Isla</th>
                <th className="text-left px-4 py-2">Estado</th>
                <th className="text-left px-4 py-2">Variables</th>
                <th className="text-left px-4 py-2">Última transmisión</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {estado.estaciones.map((e) => {
                const ultimo = e.ultimoDato
                  .map((u) => (u.instante ? new Date(u.instante).getTime() : 0))
                  .reduce((a, b) => Math.max(a, b), 0);
                return (
                  <tr key={e.id}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{e.nombre}</div>
                      <div className="text-xs text-slate-400">{e.codigo} · {e.propietario}</div>
                    </td>
                    <td className="px-4 py-2">{e.fuente}</td>
                    <td className="px-4 py-2">{e.isla}</td>
                    <td className="px-4 py-2">
                      <span className={e.activa ? "text-emerald-600" : "text-slate-400"}>{e.activa ? "Activa" : e.estado || "Inactiva"}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{e.variables.length ? e.variables.join(", ") : "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{ultimo ? fechaHora(new Date(ultimo).toISOString()) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Inventario de fuentes</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {estado.fuentes.map((f) => (
            <div key={f.nombre} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <strong className="text-sm text-slate-800">{f.nombre}</strong>
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-teal-600"><ExternalLink className="w-4 h-4" /></a>
              </div>
              <p className="text-xs text-slate-500 mt-1">{f.cobertura} · {f.descripcion}</p>
              <p className="text-[11px] text-amber-700 mt-1">Pendiente: {f.pendiente}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{f.licencia}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
