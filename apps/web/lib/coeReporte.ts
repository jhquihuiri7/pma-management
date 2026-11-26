"use client";

import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api-client";
import type {
  CoeActividad,
  CoeActividadEntrada,
  CoeCatalogos,
  CoeEstado,
  CoeEvento,
  CoeMetrica,
  CoeResultadoEntrada,
} from "@/types";

// Reporte territorial COE. Reporting is public: each browser keeps a random
// history code (the same key as the original app, so a code saved there is
// still accepted) and sends it in X-Codigo-Historial.

const CLAVE_CODIGO = "coe.historial.codigo.v1";
export const PATRON_CODIGO = /^[A-Za-z0-9_-]{43}$/;
export const ZONA = "Pacific/Galapagos";

let codigoEnMemoria: string | null = null;

function codigoAleatorio(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...Array.from(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** This browser's history code, created on first use. */
export function codigoHistorial(): string {
  try {
    const guardado = localStorage.getItem(CLAVE_CODIGO);
    if (guardado && PATRON_CODIGO.test(guardado)) return guardado;
  } catch {
    // Private mode without storage: keep it for this page only.
  }
  codigoEnMemoria ??= codigoAleatorio();
  try {
    localStorage.setItem(CLAVE_CODIGO, codigoEnMemoria);
  } catch {
    // ignore
  }
  return codigoEnMemoria;
}

export function usarCodigoHistorial(codigo: string): void {
  codigoEnMemoria = codigo;
  try {
    localStorage.setItem(CLAVE_CODIGO, codigo);
  } catch {
    // ignore
  }
}

const cabecera = (codigo: string) => ({ headers: { "X-Codigo-Historial": codigo } });

export const coeApi = {
  catalogos: () => api.get<CoeCatalogos>("/coe-reporte/public/catalogos"),
  eventos: () => api.get<CoeEvento[]>("/coe-reporte/public/eventos"),
  crearEvento: (titulo: string, codigo: string) =>
    api.post<CoeEvento>("/coe-reporte/public/eventos", { titulo }, cabecera(codigo)),
  misActividades: (codigo: string) => api.get<CoeActividad[]>("/coe-reporte/public/mis-actividades", cabecera(codigo)),
  guardarActividad: (actividad: CoeActividadEntrada, codigo: string) =>
    api.post<CoeActividad>("/coe-reporte/public/actividades", actividad, cabecera(codigo)),
  guardarResultado: (id: string, resultado: CoeResultadoEntrada, codigo: string) =>
    api.post<CoeActividad>(`/coe-reporte/public/actividades/${id}/resultado`, resultado, cabecera(codigo)),
};

/** The module's lists, shared by both pages. */
export function useCoeCatalogos() {
  const [catalogos, setCatalogos] = useState<CoeCatalogos | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelado = false;
    coeApi
      .catalogos()
      .then((data) => !cancelado && setCatalogos(data))
      .catch((err) => !cancelado && setError(apiErrorMessage(err, "No se pudieron cargar los catálogos del formulario")));
    return () => {
      cancelado = true;
    };
  }, []);
  return { catalogos, error };
}

/**
 * Id of a new record, created when the form opens so a retry lands on the
 * same row. `crypto.randomUUID` needs a secure context, which plain-http LAN
 * access to the dev server is not.
 */
export function nuevoId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Today in Galápagos as YYYY-MM-DD. */
export function hoyGalapagos(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format();
}

export const ORDEN_ESTADOS: CoeEstado[] = ["done", "pending", "partial", "missed", "extra"];

/** Colors of the original board (style.css), one per state. */
export const COLOR_ESTADO: Record<CoeEstado, string> = {
  done: "#086b61",
  pending: "#ab610b",
  partial: "#225aa1",
  missed: "#a3334c",
  extra: "#5c4d87",
};

export const ETIQUETA_TABLERO: Record<CoeEstado, string> = {
  done: "Cumplidas",
  pending: "Pendientes de reporte",
  partial: "Con avance parcial",
  missed: "No ejecutadas",
  extra: "No programadas",
};

export const formatoMetricas = (items: CoeMetrica[] = []) =>
  items.map((m) => `${m.indicador} · ${m.cantidad} ${m.unidad}`).join(" | ");

/** "MTT 3 · Servicios básicos esenciales", or the direct-action label. */
export function nombreEquipo(a: Pick<CoeActividad, "instancia" | "equipo">, catalogos: CoeCatalogos | null): string {
  if (!a.equipo) return "Acción institucional directa";
  const [tipo, numero] = a.equipo.split(" ");
  const nombre = catalogos?.equipos[tipo as "MTT" | "GT"]?.[Number(numero) - 1];
  return nombre ? `${a.equipo} · ${nombre}` : a.equipo;
}

/** Same grouping key as the original board: case and spacing insensitive. */
export const claveInstitucion = (valor: string) =>
  (valor || "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

export function ordenarActividades(items: CoeActividad[]): CoeActividad[] {
  return [...items].sort((a, b) => b.dia.localeCompare(a.dia) || b.creadoEn.localeCompare(a.creadoEn));
}

/** CSV with BOM, protected against formula injection, as in the original. */
export function descargarCsv(
  filas: CoeActividad[],
  eventos: Map<string, string>,
  catalogos: CoeCatalogos | null,
): void {
  const encabezados = [
    "Código", "Evento", "Fecha", "Isla", "Sector", "Institución", "Mesa o grupo", "Actividad",
    "Metas", "Estado", "Resultado", "Motivo", "Resultados numéricos",
  ];
  const datos = filas.map((r) => [
    r.evento, eventos.get(r.evento) ?? "", r.dia, r.isla, r.sector, r.institucion, nombreEquipo(r, catalogos),
    r.descripcion, formatoMetricas(r.metas), catalogos?.estados[r.estado] ?? r.estado, r.resultado, r.motivo,
    formatoMetricas(r.numeros),
  ]);
  const citar = (valor: unknown) => {
    let s = String(valor ?? "");
    if (/^\s*[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const contenido = "﻿" + [encabezados, ...datos].map((fila) => fila.map(citar).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([contenido], { type: "text/csv;charset=utf-8" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `COE_Galapagos_${hoyGalapagos()}.csv`;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
