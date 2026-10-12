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
