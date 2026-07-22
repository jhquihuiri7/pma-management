"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2 } from "lucide-react";
import { auth, apiErrorMessage } from "@/lib/api-client";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setSubmitting(true);

    try {
      await auth.forgot(email);
      setSent(true);
    } catch (requestError) {
      setError(apiErrorMessage(requestError, "Ocurrió un error. Inténtalo de nuevo."));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Plan de Manejo Ambiental</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Plataforma de Gestión Ambiental</p>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <h2 className="text-lg font-semibold text-slate-800">Solicitud recibida</h2>
              <p className="text-sm text-muted-foreground">
                Si existe una cuenta con ese correo, el enlace para restablecer tu contraseña será enviado en los próximos minutos. El enlace expira en <strong>24 horas</strong>.
              </p>
              <Button className="mt-2 w-full" variant="outline" onClick={() => router.push("/login")}>
                Volver al inicio de sesión
              </Button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground mb-6">
                Ingresa tu correo. Si existe una cuenta asociada, enviaremos un enlace de recuperación.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Correo electrónico</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="tu@correo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    "Enviar enlace de recuperación"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => router.push("/login")}
                >
                  Volver al inicio de sesión
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
