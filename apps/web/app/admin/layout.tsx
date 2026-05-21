"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import SidebarAdmin from "@/components/layout/SidebarAdmin";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated" && user?.role !== "ADMIN") {
      router.replace("/select-app");
    }
  }, [status, user, router]);

  if (status === "loading" || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  if (user.role !== "ADMIN") return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <SidebarAdmin />
      <div className="ml-64 min-h-screen">
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
