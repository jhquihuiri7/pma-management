import type { Metadata } from "next";
import RiesgosShell from "@/components/riesgos/RiesgosShell";

export const metadata: Metadata = {
  title: "Gestión de Riesgos | SIGTAR",
  description: "Sistema interinstitucional de gestión de riesgos para el COE Provincial y el Comité Territorial de Galápagos.",
};

export default function RiesgosLayout({ children }: { children: React.ReactNode }) {
  return <RiesgosShell>{children}</RiesgosShell>;
}
