import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import SimatShell from "@/components/simat/SimatShell";

export const metadata: Metadata = {
  title: "SIMAT-GAL | Monitoreo Hidrometeorológico",
  description:
    "Sistema Provincial de Monitoreo Hidrometeorológico y Alerta Temprana de Galápagos: lluvia, nivel del mar, mareas y riesgo por sector, con datos reales de las estaciones.",
};

// Tipografía de la vista previa. next/font la descarga al compilar y la sirve
// desde SIGTAR: el navegador no consulta a Google.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jbmono", display: "swap" });

// Public read (decision D2): the middleware lets visitors in. Configuring
// criteria and registering observed levels need a session with the `simat` app.
export default function SimatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${mono.variable}`}>
      <SimatShell>{children}</SimatShell>
    </div>
  );
}
