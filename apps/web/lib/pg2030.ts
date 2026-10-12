"use client";

import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "@/lib/api-client";
import type { Pg2030Me } from "@/types";

/**
 * The caller's PG2030 role and institution (`GET /pg2030/me`). `null` while
 * loading; a failed load surfaces as `error` so pages can say why.
 */
export function usePg2030Me() {
  const [me, setMe] = useState<Pg2030Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Pg2030Me>("/pg2030/me")
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, "No se pudo cargar tu perfil de PG2030"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { me, error };
}

const USD = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$101.377.000,00": the single money format PG2030 uses (plan §9.8). */
export function formatUsd(value: number): string {
  return USD.format(value);
}

/** Human labels for the project fields an import conflict can name. */
export const PG2030_CAMPO_LABELS: Record<string, string> = {
  nombre: "Nombre",
  tipo: "Tipo",
  plazo: "Plazo",
  presupuesto_referencial: "Presupuesto referencial",
  tipo_entidad_responsable: "Tipo de entidad responsable",
  responsables_plan: "Responsables según el plan",
  entidades_ejecutoras: "Entidades ejecutoras",
  hito_2023: "Hito 2023",
  hito_2030: "Hito 2030",
};

export const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const NUM = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 4 });

/** Physical progress: up to 4 decimals, es-EC separators. */
export function formatNumero(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : NUM.format(value);
}

/** "2026-11-30" → "30/11/2026". */
export function formatFecha(fecha: string | null | undefined): string {
  if (!fecha) return "—";
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export const ESTADO_CORTE: Record<string, { label: string; className: string }> = {
  no_habilitado: { label: "No habilitado", className: "border-slate-200 bg-slate-50 text-slate-500" },
  abierto: { label: "Abierto", className: "border-green-300 bg-green-50 text-green-700" },
  en_carga: { label: "En carga inicial", className: "border-sky-300 bg-sky-50 text-sky-700" },
  cerrado: { label: "Cerrado", className: "border-slate-300 bg-slate-100 text-slate-700" },
};

export const ESTADO_INSTITUCION: Record<string, { label: string; className: string }> = {
  con_metas: { label: "Con metas", className: "border-green-300 bg-green-50 text-green-700" },
  sin_acciones: { label: "Sin acciones vinculadas", className: "border-slate-300 bg-slate-50 text-slate-600" },
  sin_respuesta: { label: "Sin respuesta", className: "border-amber-300 bg-amber-50 text-amber-700" },
  no_convocada: { label: "No convocada", className: "border-slate-200 bg-white text-slate-400" },
};

/** The same rule the API applies (plan §6): executed with nothing planned, or at twice the plan. */
export function pareceAcumulado(planificado: number, ejecutado: number): boolean {
  if (ejecutado <= 0) return false;
  if (planificado <= 0) return true;
  return ejecutado >= 2 * planificado;
}

/** Parse a decimal typed with either "," or "." ("1.234,5" is not accepted: no thousands separators). */
export function parseDecimal(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return 0;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const PCT = new Intl.NumberFormat("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A 0–1 fraction as "59,69 %" (plan §9.8); null reads "No aplica". A no-break space keeps "%" on the number's line. */
export function formatPct(fraccion: number | null | undefined, vacio = "No aplica"): string {
  return fraccion === null || fraccion === undefined ? vacio : `${PCT.format(fraccion * 100)}\u00a0%`;
}

/** "3 de 4": counts always carry their total (plan §9.8). */
export function deTotal(n: number, total: number): string {
  return `${n} de ${total}`;
}
