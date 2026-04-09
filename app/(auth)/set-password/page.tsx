"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

type PageState = "loading" | "valid" | "invalid" | "success";

export default function SetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [pageState, setPageState] = useState<PageState>("loading");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPageState("invalid");
      return;
    }

    fetch(`/api/auth/set-password?token=${token}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        setUserName(data.name);
        setUserEmail(data.email);
        setPageState("valid");
      })
      .catch(() => setPageState("invalid"));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    setSubmitting(true);

    const res = await fetch("/api/auth/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    setSubmitting(false);

    if (res.ok) {
      setPageState("success");
    } else {
      const data = await res.json();
      setError(data.error || "Error al establecer la contraseña");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Plan de Manejo Ambiental</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Plataforma de Gestión Ambiental
          </p>
        </CardHeader>
        <CardContent>
          {pageState === "loading" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
              <p className="text-sm text-muted-foreground">Verificando enlace...</p>
            </div>
          )}

          {pageState === "invalid" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <XCircle className="w-12 h-12 text-red-400" />
              <h2 className="text-lg font-semibold text-slate-800">Enlace inválido o expirado</h2>
              <p className="text-sm text-muted-foreground">
                Este enlace ya fue utilizado o ha expirado (válido por 24 horas).
                Solicita al administrador que te reenvíe la invitación.
              </p>
            </div>
          )}

          {pageState === "success" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <h2 className="text-lg font-semibold text-slate-800">¡Contraseña establecida!</h2>
              <p className="text-sm text-muted-foreground">
                Tu cuenta está lista. Ya puedes iniciar sesión.
              </p>
              <Button className="mt-2 w-full" onClick={() => router.push("/login")}>
                Ir al inicio de sesión
              </Button>
            </div>
          )}

          {pageState === "valid" && (
            <div>
              <div className="mb-6 p-4 bg-slate-50 rounded-lg border">
                <p className="text-sm font-medium text-slate-700">{userName}</p>
                <p className="text-sm text-muted-foreground">{userEmail}</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nueva contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Repite tu contraseña"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={6}
                    required
                  />
                </div>
                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    "Establecer contraseña"
                  )}
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
