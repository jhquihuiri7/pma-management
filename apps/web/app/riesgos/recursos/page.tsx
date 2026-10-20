import type { Metadata } from "next";
import FormularioRecursos from "@/components/riesgos/FormularioRecursos";

export const metadata: Metadata = {
  title: "Registro de recursos | Gestión de Riesgos",
};

export default function RecursosPage() {
  return <FormularioRecursos />;
}
