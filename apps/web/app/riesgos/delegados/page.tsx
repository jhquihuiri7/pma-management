import type { Metadata } from "next";
import FormularioDelegados from "@/components/riesgos/FormularioDelegados";

export const metadata: Metadata = {
  title: "Delegados al COE Provincial | Gestión de Riesgos",
};

export default function DelegadosPage() {
  return <FormularioDelegados />;
}
