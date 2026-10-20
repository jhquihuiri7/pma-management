import type { Metadata } from "next";
import PanelResultados from "@/components/riesgos/PanelResultados";

export const metadata: Metadata = {
  title: "Administración | Gestión de Riesgos",
};

export default function AdminRiesgosPage() {
  return <PanelResultados />;
}
