import type { Metadata } from "next";
import ProtocoloLimpiezaShell from "@/components/protocolo-limpieza/ProtocoloLimpiezaShell";

export const metadata: Metadata = {
  title: "Protocolo de limpieza | SIGTAR",
  description: "Trazabilidad de residuos y escombros de Santa Cruz a Guayaquil: reportes, registros e indicadores por ruta.",
};

// Fully protected: middleware.ts sends visitors without a session to /login,
// and every API call needs the protocolo_limpieza app.
export default function ProtocoloLimpiezaLayout({ children }: { children: React.ReactNode }) {
  return <ProtocoloLimpiezaShell>{children}</ProtocoloLimpiezaShell>;
}
