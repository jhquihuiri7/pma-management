"use client";

import { createContext, useContext } from "react";
import type { OperacionLimpieza, RegistroLimpieza } from "@pma/types/protocolo-limpieza";
import type { Unidad } from "@/lib/protocolo-limpieza/acumulacion";
import type { EstadoBarrios } from "@/lib/protocolo-limpieza/barrios";

/**
 * What the three views share: the module's layout reads the reports once and
 * keeps them fresh, and owns the report and detail dialogs, so the dashboard,
 * the records and the protocol work on the same data and open the same form.
 */
export interface ContextoProtocoloLimpieza {
  records: RegistroLimpieza[];
  /** False until the first read answers, whether it succeeded or not. */
  loaded: boolean;
  /** Why the last read failed, or "" while the module is in sync. */
  status: string;
  unit: Unidad;
  setUnit(unit: Unidad): void;
  /** The Geoportal's neighbourhood layer, once read (null while loading). */
  barrios: EstadoBarrios | null;
  /** Neighbourhoods to choose from: the layer's, or the protocol's list when the layer cannot be read. */
  nombresBarrios: string[];
  refresh(): Promise<void>;
  /** A new report of `kind`, or an edit of `row`. */
  openReport(kind?: OperacionLimpieza, row?: RegistroLimpieza | null): void;
  showDetail(row: RegistroLimpieza): void;
  /** Opens Registros filtered to one route, like a click on the route in the flow. */
  showRouteRecords(route: string): void;
}

export const ContextoLimpieza = createContext<ContextoProtocoloLimpieza | null>(null);

export function useProtocoloLimpieza(): ContextoProtocoloLimpieza {
  const contexto = useContext(ContextoLimpieza);
  if (!contexto) throw new Error("useProtocoloLimpieza must be used inside the module's layout");
  return contexto;
}
