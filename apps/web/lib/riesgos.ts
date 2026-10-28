"use client";

import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { ApiError, api, apiErrorMessage } from "@/lib/api-client";
import type { RiesgosCampoInvalido, RiesgosCatalogos, RiesgosTabla } from "@/types";

/** The module's lists (`GET /riesgos/public/catalogos`), shared by every tab. */
export function useRiesgosCatalogos() {
  const [catalogos, setCatalogos] = useState<RiesgosCatalogos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<RiesgosCatalogos>("/riesgos/public/catalogos")
      .then((data) => {
        if (!cancelled) setCatalogos(data);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, "No se pudieron cargar los catálogos del formulario"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { catalogos, error };
}

/**
 * Id of a new submission, created when the form opens so a retry after a
 * dropped connection lands on the same record. `crypto.randomUUID` needs a
 * secure context, which plain-http LAN access to the dev server is not.
 */
export function nuevoId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The fields a public form had rejected, keyed by the same paths the form uses. */
export function erroresDeCampos(error: unknown): Record<string, string> | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  const body = error.details as { details?: { campos?: RiesgosCampoInvalido[] } } | undefined;
  const campos = body?.details?.campos;
  if (!Array.isArray(campos)) return null;
  return Object.fromEntries(campos.map((c) => [c.campo, c.mensaje]));
}

export const correoValido = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
export const telefonoValido = (value: string) => /^\d{7,15}$/.test(value);
export const soloDigitos = (value: string) => value.replace(/\D/g, "").slice(0, 15);

const fecha = new Intl.DateTimeFormat("es-EC", { timeZone: "Pacific/Galapagos", dateStyle: "medium" });

export function formatoFecha(iso: string): string {
  return fecha.format(new Date(iso));
}

/** Write a sheet from the API as CSV (Excel opens it with `;`) or as .xlsx. */
export function descargarTabla(tabla: RiesgosTabla, nombre: string, formato: "csv" | "xlsx"): void {
  const filas = [tabla.encabezados, ...tabla.filas];
  if (formato === "xlsx") {
    const libro = XLSX.utils.book_new();
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    hoja["!cols"] = tabla.encabezados.map(() => ({ wch: 22 }));
    hoja["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: tabla.encabezados.length - 1 } }),
    };
    XLSX.utils.book_append_sheet(libro, hoja, "Datos");
    XLSX.writeFile(libro, `${nombre}.xlsx`);
    return;
  }
  const celda = (value: string | number) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = `﻿${filas.map((fila) => fila.map(celda).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `${nombre}.csv`;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
