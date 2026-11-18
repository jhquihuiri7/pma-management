import { redirect } from "next/navigation";

/** La antigua pestaña de riesgo ahora es una sección del panel único. */
export default function SimatRiesgoPage() {
  redirect("/simat#riesgo-sector");
}
