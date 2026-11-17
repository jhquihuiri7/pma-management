import type { Metadata } from "next";
import SimatShell from "@/components/simat/SimatShell";

export const metadata: Metadata = {
  title: "SIMAT-GAL | Monitoreo Hidrometeorológico",
  description:
    "Sistema Provincial de Monitoreo Hidrometeorológico y Alerta Temprana de Galápagos: lluvia, nivel del mar, mareas y riesgo por sector, con datos reales de las estaciones.",
};

// Public read (decision D2): the middleware lets visitors in. Configuring
// criteria and registering observed levels need a session with the `simat` app.
export default function SimatLayout({ children }: { children: React.ReactNode }) {
  return <SimatShell>{children}</SimatShell>;
}
