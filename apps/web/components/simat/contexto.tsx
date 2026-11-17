"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { SimatEstado } from "@pma/types";
import { obtenerEstado } from "@/lib/simat/api";
import { apiErrorMessage } from "@/lib/api-client";

interface SimatCtx {
  estado: SimatEstado | null;
  cargando: boolean;
  error: string | null;
  sincronizadoEn: number;
  auto: boolean;
  setAuto: (v: boolean) => void;
  refrescar: () => Promise<void>;
}

const Contexto = createContext<SimatCtx | null>(null);

const AUTO_MS = 60_000;

export function SimatProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<SimatEstado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sincronizadoEn, setSincronizadoEn] = useState(0);
  const [auto, setAuto] = useState(false);
  const enVuelo = useRef<AbortController | null>(null);

  const refrescar = useCallback(async () => {
    enVuelo.current?.abort();
    const ctrl = new AbortController();
    enVuelo.current = ctrl;
    try {
      const data = await obtenerEstado(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setEstado(data);
      setError(null);
      setSincronizadoEn(Date.now());
    } catch (err) {
      if (ctrl.signal.aborted || (err as Error)?.name === "AbortError") return;
      setError(apiErrorMessage(err, "No se pudo cargar la situación."));
    } finally {
      if (!ctrl.signal.aborted) setCargando(false);
    }
  }, []);

  useEffect(() => {
    void refrescar();
    return () => enVuelo.current?.abort();
  }, [refrescar]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => void refrescar(), AUTO_MS);
    return () => clearInterval(id);
  }, [auto, refrescar]);

  return (
    <Contexto.Provider value={{ estado, cargando, error, sincronizadoEn, auto, setAuto, refrescar }}>
      {children}
    </Contexto.Provider>
  );
}

export function useSimat(): SimatCtx {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useSimat fuera de SimatProvider");
  return ctx;
}
