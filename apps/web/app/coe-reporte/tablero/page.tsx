import type { Metadata } from "next";
import TableroVista from "@/components/coe-reporte/TableroVista";

export const metadata: Metadata = {
  title: "Tablero | Reporte territorial COE",
};

export default function TableroCoePage() {
  return <TableroVista />;
}
