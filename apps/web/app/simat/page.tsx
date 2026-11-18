import VistaGeneral from "@/components/simat/VistaGeneral";
import VistaRiesgo from "@/components/simat/VistaRiesgo";

/** Panel único de SIMAT-GAL: vista general y riesgo por sector en una sola página. */
export default function SimatPage() {
  return <VistaGeneral riesgo={<VistaRiesgo />} />;
}
