"use client";

import SubsystemUsersPage from "@/components/users/SubsystemUsersPage";
import { useAuth } from "@/lib/auth-context";

export default function RgdpUsersPage() {
  const { user, status } = useAuth();
  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">Verificando permisos...</p>;
  }
  if (user?.role !== "ADMIN") {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        No tienes permisos para administrar usuarios de RGDP.
      </div>
    );
  }
  return (
    <SubsystemUsersPage
      appLabel="Registro Generador de Desechos Peligrosos"
      apiPrefix="/rgdp"
    />
  );
}
