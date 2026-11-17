"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SimatEstacion, SimatEstado, SimatSerieLluvia } from "@pma/types";
import { obtenerEstado, obtenerSerieLluvia } from "@/lib/simat/api";
import { apiErrorMessage } from "@/lib/api-client";

export const TODAS_LAS_ISLAS = "Todas las islas";

export interface Aviso {
  id: number;
  mensaje: string;
  tono: "" | "error";
}

interface SimatCtx {
  estado: SimatEstado | null;
  cargando: boolean;
  error: string | null;
  /** null mientras conecta; false si la última consulta falló. */
  enLinea: boolean | null;
  sincronizadoEn: number;
  auto: boolean;
  setAuto: (v: boolean) => void;
  refrescar: () => Promise<void>;
  /** Ámbito territorial compartido por todas las vistas (como en la vista previa). */
  isla: string;
  setIsla: (v: string) => void;
  estacionId: string | null;
  setEstacionId: (v: string) => void;
  estacionesAmbito: SimatEstacion[];
  estacion: SimatEstacion | undefined;
  /** Serie de lluvia de la estación seleccionada. */
  lluvia: SimatSerieLluvia | null;
  aviso: Aviso | null;
  notificar: (mensaje: string, tono?: "" | "error") => void;
}

const Contexto = createContext<SimatCtx | null>(null);

const AUTO_MS = 60_000;

/** Estación por defecto del ámbito: una con criterio, si no una activa con lluvia. */
function estacionPorDefecto(estado: SimatEstado, ambito: SimatEstacion[]): string | null {
  const conCriterio = new Set(estado.riesgo.map((r) => r.criterio.estacion));
  const elegida =
    ambito.find((e) => conCriterio.has(e.id)) ??
    ambito.find((e) => e.activa && e.variables.includes("precipitacion") && e.pasoMin < 1440) ??
    ambito[0];
  return elegida?.id ?? null;
}

export function SimatProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<SimatEstado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enLinea, setEnLinea] = useState<boolean | null>(null);
  const [sincronizadoEn, setSincronizadoEn] = useState(0);
  const [auto, setAutoState] = useState(false);
  const [isla, setIsla] = useState("Santa Cruz");
  const [estacionId, setEstacionId] = useState<string | null>(null);
  const [lluvia, setLluvia] = useState<SimatSerieLluvia | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const enVuelo = useRef<AbortController | null>(null);
  const avisoTimer = useRef<ReturnType<typeof setTimeout>>();

  const refrescar = useCallback(async () => {
    enVuelo.current?.abort();
    const ctrl = new AbortController();
    enVuelo.current = ctrl;
    setCargando(true);
    try {
      const data = await obtenerEstado(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setEstado(data);
      setError(null);
      setEnLinea(true);
      setSincronizadoEn(Date.now());
    } catch (err) {
      if (ctrl.signal.aborted || (err as Error)?.name === "AbortError") return;
      setError(apiErrorMessage(err, "No se pudo cargar la información de vigilancia."));
      setEnLinea(false);
    } finally {
      if (!ctrl.signal.aborted) setCargando(false);
    }
  }, []);

  useEffect(() => {
    try {
      setAutoState(localStorage.getItem("simat-auto") === "1");
    } catch {
      /* sin almacenamiento: Auto apagado */
    }
    void refrescar();
    return () => enVuelo.current?.abort();
  }, [refrescar]);

  const setAuto = useCallback((v: boolean) => {
    setAutoState(v);
    try {
      localStorage.setItem("simat-auto", v ? "1" : "0");
    } catch {
      /* sin almacenamiento */
    }
  }, []);

  useEffect(() => {
    if (!auto || enLinea === false) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !document.querySelector(".simat dialog[open]")) void refrescar();
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [auto, enLinea, refrescar]);

  const estacionesAmbito = useMemo(
    () => (estado ? (isla === TODAS_LAS_ISLAS ? estado.estaciones : estado.estaciones.filter((e) => e.isla === isla)) : []),
    [estado, isla],
  );

  // La estación seleccionada siempre pertenece al ámbito.
  useEffect(() => {
    if (!estado) return;
    if (!estacionesAmbito.some((e) => e.id === estacionId)) setEstacionId(estacionPorDefecto(estado, estacionesAmbito));
  }, [estado, estacionesAmbito, estacionId]);

  // Serie de lluvia de la estación, renovada en cada actualización del estado.
  useEffect(() => {
    if (!estacionId || !estado) {
      setLluvia(null);
      return;
    }
    const ctrl = new AbortController();
    obtenerSerieLluvia(estacionId, ctrl.signal).then(
      (s) => !ctrl.signal.aborted && setLluvia(s),
      () => !ctrl.signal.aborted && setLluvia(null),
    );
    return () => ctrl.abort();
  }, [estacionId, estado]);

  const notificar = useCallback((mensaje: string, tono: "" | "error" = "") => {
    setAviso({ id: Date.now(), mensaje, tono });
    clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(null), 4400);
  }, []);

  const estacion = estacionesAmbito.find((e) => e.id === estacionId);

  return (
    <Contexto.Provider
      value={{
        estado,
        cargando,
        error,
        enLinea,
        sincronizadoEn,
        auto,
        setAuto,
        refrescar,
        isla,
        setIsla,
        estacionId,
        setEstacionId,
        estacionesAmbito,
        estacion,
        lluvia: lluvia && lluvia.estacion === estacionId ? lluvia : null,
        aviso,
        notificar,
      }}
    >
      {children}
    </Contexto.Provider>
  );
}

export function useSimat(): SimatCtx {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSimat fuera de SimatProvider");
  return ctx;
}
