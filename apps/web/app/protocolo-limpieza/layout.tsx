import type { Metadata } from "next";
import ProtocoloLimpiezaShell from "@/components/protocolo-limpieza/ProtocoloLimpiezaShell";

export const metadata: Metadata = {
  title: "Gestión de residuos | SIGTAR",
  description: "Gestión y trazabilidad de residuos y desechos de Santa Cruz a Guayaquil (ENOS 2026-2027): reportes, registros e indicadores por ruta.",
};

// Public in read-only mode since 2026-11-15 (middleware.ts lets visitors in):
// reporting, editing and uploading need a session with the protocolo_limpieza
// app, here and on the API, and only users with it see who reported.
export default function ProtocoloLimpiezaLayout({ children }: { children: React.ReactNode }) {
  return <ProtocoloLimpiezaShell>{children}</ProtocoloLimpiezaShell>;
}
