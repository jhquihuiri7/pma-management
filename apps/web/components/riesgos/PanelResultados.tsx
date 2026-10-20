"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRiesgosCatalogos } from "@/lib/riesgos";
import { Skeleton } from "@/components/ui/skeleton";
import ResumenVista from "./ResumenVista";
import RecursosVista from "./RecursosVista";
import FichasVista from "./FichasVista";
import DelegadosVista from "./DelegadosVista";

// components/ui/tabs is written for Tailwind v4 variants (data-horizontal:,
// data-active:) that this app's Tailwind 3 does not generate, so the views use
// their own tab bar.
const VISTAS = [
  { clave: "resumen", etiqueta: "Resumen" },
  { clave: "recursos", etiqueta: "Recursos" },
  { clave: "fichas", etiqueta: "Fichas" },
  { clave: "delegados", etiqueta: "Delegados COE" },
] as const;

type Vista = (typeof VISTAS)[number]["clave"];

/** Administración: everything the two public forms collected. */
export default function PanelResultados() {
  const { user, status } = useAuth();
  const { catalogos, error } = useRiesgosCatalogos();
  const [vista, setVista] = useState<Vista>("resumen");

  if (status === "loading") return <Skeleton className="h-96 w-full" />;
  if (!user) {
    return (
      <p className="text-sm text-muted-foreground">
        Inicie sesión para ver los resultados.{" "}
        <a href="/login?next=/riesgos/admin" className="font-medium text-teal-700 underline-offset-4 hover:underline">
          Ingresar
        </a>
      </p>
    );
  }
  if (user.role !== "ADMIN" && !user.apps.includes("riesgos")) {
    return (
      <p className="text-sm text-muted-foreground">
        Su usuario no tiene acceso a Gestión de Riesgos. Solicite el acceso a un administrador de SIGTAR.{" "}
        <Link href="/select-app" className="font-medium text-teal-700 underline-offset-4 hover:underline">Volver</Link>
      </p>
    );
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!catalogos) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Resultados" className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1">
        {VISTAS.map((v) => (
          <button
            key={v.clave}
            type="button"
            role="tab"
            id={`vista-${v.clave}`}
            aria-selected={vista === v.clave}
            aria-controls={`panel-${v.clave}`}
            onClick={() => setVista(v.clave)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              vista === v.clave ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {v.etiqueta}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${vista}`} aria-labelledby={`vista-${vista}`}>
        {vista === "resumen" && <ResumenVista catalogos={catalogos} />}
        {vista === "recursos" && <RecursosVista catalogos={catalogos} />}
        {vista === "fichas" && <FichasVista catalogos={catalogos} esAdmin={user.role === "ADMIN"} />}
        {vista === "delegados" && <DelegadosVista catalogos={catalogos} />}
      </div>
    </div>
  );
}
