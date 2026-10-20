"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api-client";
import { descargarTabla } from "@/lib/riesgos";
import { Button } from "@/components/ui/button";
import type { RiesgosTabla } from "@/types";

/** CSV and Excel of the rows the current filters select, built from one API sheet. */
export default function BotonesExportar({ ruta, nombre }: { ruta: string; nombre: string }) {
  const [pendiente, setPendiente] = useState(false);

  async function exportar(formato: "csv" | "xlsx") {
    setPendiente(true);
    try {
      const tabla = await api.get<RiesgosTabla>(ruta);
      if (!tabla.filas.length) {
        toast.info("No hay registros con estos filtros");
        return;
      }
      descargarTabla(tabla, nombre, formato);
    } catch (err) {
      toast.error(apiErrorMessage(err, "No se pudo exportar"));
    } finally {
      setPendiente(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pendiente} onClick={() => exportar("csv")}>
        <Download /> CSV
      </Button>
      <Button type="button" size="sm" disabled={pendiente} onClick={() => exportar("xlsx")}>
        <Download /> Excel
      </Button>
    </div>
  );
}
