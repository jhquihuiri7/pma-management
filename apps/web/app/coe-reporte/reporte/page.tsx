import type { Metadata } from "next";
import ReporteVista from "@/components/coe-reporte/ReporteVista";

export const metadata: Metadata = {
  title: "Reporte territorial diario | COE Provincial de Galápagos",
};

export default function ReporteCoePage() {
  return <ReporteVista />;
}
