import type { Metadata } from "next";
import TableroVista from "@/components/protocolo-limpieza/TableroVista";

export const metadata: Metadata = {
  title: "Tablero | Protocolo de limpieza",
};

export default function TableroPage() {
  return <TableroVista />;
}
