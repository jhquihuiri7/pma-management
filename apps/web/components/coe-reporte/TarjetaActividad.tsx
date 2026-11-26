"use client";

import { useState } from "react";
import { apiErrorMessage } from "@/lib/api-client";
import { COLOR_ESTADO, INSIGNIA_ESTADO, coeApi, formatoMetricas, nombreEquipo, nuevoId } from "@/lib/coeReporte";
import type { CoeActividad, CoeCatalogos } from "@/types";
import CamposResultado, { leerResultado, resultadoVacio } from "./CamposResultado";
import { boton, botonSecundario } from "./estilos";

const fechaCorta = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function Insignia({ actividad, catalogos }: { actividad: CoeActividad; catalogos: CoeCatalogos | null }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${INSIGNIA_ESTADO[actividad.estado]}`}>
      {catalogos?.estados[actividad.estado] ?? actividad.estado}
    </span>
  );
}

/**
 * One activity. On the board (`tablero`) it leads with the event and the
 * institution; in the reporter's own list, with the event code, and a pending
 * activity offers to record its result.
 */
export default function TarjetaActividad({
  actividad,
  catalogos,
  eventos,
  tablero = false,
  codigo,
  onActualizada,
  avisar,
}: {
  actividad: CoeActividad;
  catalogos: CoeCatalogos | null;
  eventos: Map<string, string>;
  tablero?: boolean;
  codigo?: string;
  onActualizada?: (actividad: CoeActividad) => void;
  avisar?: (mensaje: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [envio, setEnvio] = useState("");
  const [resultado, setResultado] = useState(resultadoVacio(actividad.metas));
  const [guardando, setGuardando] = useState(false);
  const r = actividad;
  const titulo = eventos.get(r.evento) ?? r.evento;
  const fecha = Date.parse(`${r.dia}T00:00:00Z`);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const leido = leerResultado(resultado, r.metas, false);
    if (typeof leido === "string") {
      avisar?.(leido);
      return;
    }
    if (!codigo || leido.estado === "extra") return;
    setGuardando(true);
    try {
      const actualizada = await coeApi.guardarResultado(r.id, { envio, ...leido, estado: leido.estado }, codigo);
      setEditando(false);
      onActualizada?.(actualizada);
      avisar?.("Resultado guardado en tu historial.");
    } catch (err) {
      avisar?.(apiErrorMessage(err, "No se pudo guardar el resultado."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <article className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm" style={{ borderLeft: `4px solid ${COLOR_ESTADO[r.estado]}` }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        {tablero ? (
          <div className="min-w-0">
            <h4 className="font-semibold text-slate-900">{titulo}</h4>
            <p className="text-sm text-slate-500">{r.institucion}</p>
          </div>
        ) : (
          <span className="font-mono text-xs font-medium text-teal-700">{r.evento}</span>
        )}
        <Insignia actividad={r} catalogos={catalogos} />
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {(tablero
          ? [r.isla, r.sector, Number.isNaN(fecha) ? r.dia : fechaCorta.format(fecha), r.equipo]
          : [r.sector, r.isla, r.equipo, r.dia]
        ).filter(Boolean).join(" · ")}
      </p>

      <button type="button" className="mt-2 text-sm font-medium text-teal-700 underline-offset-4 hover:underline" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {abierto ? "Ocultar detalles" : "Ver detalles"}
      </button>
      {abierto && (
        <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          {tablero ? <p className="font-mono text-xs text-slate-500">{r.evento}</p> : (
            <>
              <h3 className="font-semibold text-slate-900">{titulo}</h3>
              <p className="text-slate-600">{r.institucion}</p>
            </>
          )}
          <p className="text-slate-600">{nombreEquipo(r, catalogos)}</p>
          <p className="whitespace-pre-wrap">{r.descripcion}</p>
          {r.metas.length > 0 && <p className="text-slate-600">Metas · {formatoMetricas(r.metas)}</p>}
          {r.resultado && <p className="whitespace-pre-wrap">Resultado · {r.resultado}</p>}
          {r.motivo && <p className="whitespace-pre-wrap">Motivo · {r.motivo}</p>}
          {r.numeros.length > 0 && <p className="text-slate-600">{formatoMetricas(r.numeros)}</p>}
        </div>
      )}

      {!tablero && r.estado === "pending" && !editando && (
        <button
          type="button"
          className={`${botonSecundario} mt-3`}
          onClick={() => { setEnvio(nuevoId()); setResultado(resultadoVacio(r.metas)); setEditando(true); }}
        >
          Registrar resultado
        </button>
      )}
      {editando && (
        <form onSubmit={guardar} className="mt-4 space-y-4 border-t border-slate-100 pt-4">
          <CamposResultado valor={resultado} onChange={setResultado} metas={r.metas} esExtra={false} />
          <div className="flex flex-wrap gap-2">
            <button className={boton} disabled={guardando}>Guardar resultado</button>
            <button type="button" className={botonSecundario} onClick={() => setEditando(false)}>Cancelar</button>
          </div>
        </form>
      )}
    </article>
  );
}
