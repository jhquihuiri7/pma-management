import type { Metadata } from "next";
import ProtocoloVista from "@/components/protocolo-limpieza/ProtocoloVista";

export const metadata: Metadata = {
  title: "Protocolo | Protocolo de limpieza",
};

export default function ProtocoloPage() {
  return <ProtocoloVista />;
}
