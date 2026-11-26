import type { Metadata } from "next";
import CoeReporteShell from "@/components/coe-reporte/CoeReporteShell";

export const metadata: Metadata = {
  title: "Reporte territorial | COE Provincial de Galápagos",
  description: "Programación (08h00) y resultados (19h00) de las actividades territoriales del COE Provincial de Galápagos.",
};

export default function CoeReporteLayout({ children }: { children: React.ReactNode }) {
  return <CoeReporteShell>{children}</CoeReporteShell>;
}
