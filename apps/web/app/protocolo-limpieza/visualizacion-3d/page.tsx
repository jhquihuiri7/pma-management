import type { Metadata } from "next";
import { Suspense } from "react";
import VisualizacionVista from "@/components/protocolo-limpieza/nubes/VisualizacionVista";

export const metadata: Metadata = {
  title: "Visualización 3D | Protocolo de limpieza",
};

// The view reads ?sitio= and ?nube= from the URL, which needs a Suspense boundary.
export default function VisualizacionPage() {
  return (
    <Suspense fallback={null}>
      <VisualizacionVista />
    </Suspense>
  );
}
