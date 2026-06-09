"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { ApiError } from "@/lib/api-client"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  const router = useRouter()
  const params = useSearchParams()
  const { login } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError("")
    setLoading(true)
    try {
      const user = await login(email, password)
      const next = params.get("next")
      if (next && next.startsWith("/")) {
        router.push(next)
      } else if (user.apps.length === 1) {
        router.push(`/${user.apps[0]}/dashboard`)
      } else {
        router.push("/select-app")
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const message = "La contraseña es incorrecta"
        toast.error(message)
        return
      }

      const message = err instanceof ApiError ? err.message : "Error al iniciar sesión"
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      className={cn("flex flex-col gap-6", className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Inicia sesión en tu cuenta</h1>
          <p className="text-sm text-balance text-muted-foreground">
            Ingresa tus credenciales para acceder a la plataforma.
          </p>
        </div>
        <Field>
          <FieldLabel htmlFor="email">Correo electrónico</FieldLabel>
          <Input
            id="email"
            type="email"
            placeholder="usuario@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </Field>
        <Field>
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Contraseña</FieldLabel>
            <Link
              href="/forgot-password"
              className="ml-auto text-sm underline-offset-4 hover:underline"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="Ingresa tu contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        {error && <FieldError>{error}</FieldError>}
        <Field>
          <Button type="submit" disabled={loading} aria-busy={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? "Iniciando sesión..." : "Iniciar sesión"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
