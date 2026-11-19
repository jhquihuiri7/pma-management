import type { Metadata } from "next";
import localFont from "next/font/local";
import SimatShell from "@/components/simat/SimatShell";

export const metadata: Metadata = {
  title: "SIMAT-GAL | Monitoreo Hidrometeorológico",
  description:
    "Sistema Provincial de Monitoreo Hidrometeorológico y Alerta Temprana de Galápagos: lluvia, nivel del mar, mareas y riesgo por sector, con datos reales de las estaciones.",
};

// Tipografía de la vista previa (Inter y JetBrains Mono, licencia SIL OFL 1.1,
// ver fuentes/OFL-*.txt), guardada en el proyecto: antes next/font/google la
// descargaba al compilar y la red del servidor cortaba esas descargas
// (ETIMEDOUT), lo que hacía fallar la compilación. Son las versiones variables
// del subconjunto latino que servía Google Fonts (Inter 400–800, JetBrains
// Mono 400–600); el navegador tampoco consulta a Google.
const inter = localFont({ src: "./fuentes/inter-latin-var.woff2", weight: "400 800", variable: "--font-inter", display: "swap" });
const mono = localFont({ src: "./fuentes/jetbrains-mono-latin-var.woff2", weight: "400 600", variable: "--font-jbmono", display: "swap" });

// Public read (decision D2): the middleware lets visitors in. Configuring
// criteria and registering observed levels need a session with the `simat` app.
export default function SimatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${mono.variable}`}>
      <SimatShell>{children}</SimatShell>
    </div>
  );
}
