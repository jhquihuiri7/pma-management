import type { Metadata } from "next";
import { Suspense } from "react";
import RegistrosVista from "@/components/protocolo-limpieza/RegistrosVista";

export const metadata: Metadata = {
  title: "Registros | Protocolo de limpieza",
};

// The view reads ?ruta= from the URL, which needs a Suspense boundary.
export default function RegistrosPage() {
  return (
    <Suspense fallback={null}>
      <RegistrosVista />
    </Suspense>
  );
}
