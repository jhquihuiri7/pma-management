"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, ArrowRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Plan } from "@/types";
import { formatDateOnly } from "@/lib/dateOnly";

export default function PlansPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isViewer = session?.user?.role === "VIEWER";
  const [plans, setPlans] = useState<Plan[]>([]);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", tipo: "", fase: "", enfoque: "", report_per: "6 meses", start_date: "" });
  const [editForm, setEditForm] = useState({ title: "", description: "", tipo: "", fase: "", enfoque: "", report_per: "6 meses", start_date: "" });

  async function loadPlans() {
    const res = await fetch("/pma/api/plans");
    if (res.ok) setPlans(await res.json());
  }

  useEffect(() => {
    loadPlans();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const res = await fetch("/pma/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setLoading(false);

    if (res.ok) {
      toast.success("Plan created successfully");
      setForm({ title: "", description: "", tipo: "", fase: "", enfoque: "", report_per: "6 meses", start_date: "" });
      setOpen(false);
      loadPlans();
    } else {
      const data = await res.json();
      toast.error(data.error || "Failed to create plan");
    }
  }

  function openEdit(plan: Plan) {
    setEditingPlan(plan);
    setEditForm({
      title: plan.title,
      description: plan.description || "",
      tipo: plan.tipo || "",
      fase: plan.fase || "",
      enfoque: plan.enfoque || "",
      report_per: plan.report_per ?? "6 meses",
      start_date: plan.start_date || "",
    });
    setEditOpen(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPlan) return;
    setLoading(true);

    const res = await fetch(`/pma/api/plans/${editingPlan.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });

    setLoading(false);

    if (res.ok) {
      toast.success("Plan actualizado correctamente");
      setEditOpen(false);
      setEditingPlan(null);
      loadPlans();
    } else {
      const data = await res.json();
      toast.error(data.error || "Error al actualizar el plan");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">
            {isAdmin ? "Planes" : "Mis Planes"}
          </h1>
          <p className="text-muted-foreground">
            {isAdmin
              ? "Gestionar planes ambientales"
              : "Planes asignados a ti"}
          </p>
          {isViewer && (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 mt-1">
              Solo lectura
            </span>
          )}
        </div>

        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>
              <Plus className="w-4 h-4 mr-2" />
              Crear Plan
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crear Nuevo Plan</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Título</Label>
                  <Input
                    id="title"
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Descripción</Label>
                  <textarea
                    id="description"
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tipo">Tipo</Label>
                  <select
                    id="tipo"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.tipo}
                    onChange={(e) =>
                      setForm({ ...form, tipo: e.target.value })
                    }
                    required
                  >
                    <option value="" disabled>Seleccionar tipo...</option>
                    <option value="Licencia">Licencia</option>
                    <option value="Registro Ambiental">Registro Ambiental</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fase">Fase</Label>
                  <select
                    id="fase"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.fase}
                    onChange={(e) => setForm({ ...form, fase: e.target.value })}
                    required
                  >
                    <option value="" disabled>Seleccionar fase...</option>
                    <option value="Planificación">Planificación</option>
                    <option value="Construcción">Construcción</option>
                    <option value="Operación">Operación</option>
                    <option value="Cierre">Cierre</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="enfoque">Enfoque clave</Label>
                  <select
                    id="enfoque"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.enfoque}
                    onChange={(e) => setForm({ ...form, enfoque: e.target.value })}
                    required
                  >
                    <option value="" disabled>Seleccionar enfoque...</option>
                    <option value="Prevenir impactos">Prevenir impactos</option>
                    <option value="Controlar impactos">Controlar impactos</option>
                    <option value="Monitorear y optimizar">Monitorear y optimizar</option>
                    <option value="Restaurar el ambiente">Restaurar el ambiente</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reporte">Reporte</Label>
                  <select
                    id="reporte"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.report_per}
                    onChange={(e) =>
                      setForm({ ...form, report_per: e.target.value })
                    }
                  >
                    <option value="6 meses">6 meses</option>
                    <option value="1 año">1 año</option>
                    <option value="2 años">2 años</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="start_date">Fecha de Inicio</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={form.start_date}
                    onChange={(e) =>
                      setForm({ ...form, start_date: e.target.value })
                    }
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creando..." : "Crear Plan"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {isAdmin
                ? "Sin planes aún. Crea uno para comenzar."
                : "Aún no tienes planes asignados."
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <Card key={plan.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-base">{plan.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                  {plan.description || "Sin descripción"}
                </p>
                <div className="space-y-1.5 mb-4">
                  {plan.tipo && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Tipo:</span>
                      <span className="text-xs font-medium bg-slate-100 px-2 py-0.5 rounded">
                        {plan.tipo}
                      </span>
                    </div>
                  )}
                  {plan.fase && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Fase:</span>
                      <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        {plan.fase}
                      </span>
                    </div>
                  )}
                  {plan.enfoque && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Enfoque:</span>
                      <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded">
                        {plan.enfoque}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Reporte:</span>
                    <span className="text-xs font-medium bg-slate-100 px-2 py-0.5 rounded">
                      {plan.report_per ?? "6 meses"}
                    </span>
                  </div>
                  {plan.start_date && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Fecha inicio:</span>
                      <span className="text-xs font-medium bg-slate-100 px-2 py-0.5 rounded">
                        {formatDateOnly(plan.start_date)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Creado:</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(plan.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span />
                  <div className="flex items-center gap-1">
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(plan)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    <Link href={`/pma/plans/${plan.id}`}>
                      <Button variant="ghost" size="sm">
                        Ver <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Plan Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Plan</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Título</Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(e) =>
                  setEditForm({ ...editForm, title: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Descripción</Label>
              <textarea
                id="edit-description"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-tipo">Tipo</Label>
              <select
                id="edit-tipo"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editForm.tipo}
                onChange={(e) =>
                  setEditForm({ ...editForm, tipo: e.target.value })
                }
                required
              >
                <option value="" disabled>Seleccionar tipo...</option>
                <option value="Licencia">Licencia</option>
                <option value="Registro Ambiental">Registro Ambiental</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-fase">Fase</Label>
              <select
                id="edit-fase"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editForm.fase}
                onChange={(e) => setEditForm({ ...editForm, fase: e.target.value })}
                required
              >
                <option value="" disabled>Seleccionar fase...</option>
                <option value="Planificación">Planificación</option>
                <option value="Construcción">Construcción</option>
                <option value="Operación">Operación</option>
                <option value="Cierre">Cierre</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-enfoque">Enfoque clave</Label>
              <select
                id="edit-enfoque"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editForm.enfoque}
                onChange={(e) => setEditForm({ ...editForm, enfoque: e.target.value })}
                required
              >
                <option value="" disabled>Seleccionar enfoque...</option>
                <option value="Prevenir impactos">Prevenir impactos</option>
                <option value="Controlar impactos">Controlar impactos</option>
                <option value="Monitorear y optimizar">Monitorear y optimizar</option>
                <option value="Restaurar el ambiente">Restaurar el ambiente</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-reporte">Reporte</Label>
              <select
                id="edit-reporte"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editForm.report_per}
                onChange={(e) =>
                  setEditForm({ ...editForm, report_per: e.target.value })
                }
              >
                <option value="6 meses">6 meses</option>
                <option value="1 año">1 año</option>
                <option value="2 años">2 años</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-start_date">Fecha de Inicio</Label>
              <Input
                id="edit-start_date"
                type="date"
                value={editForm.start_date}
                onChange={(e) =>
                  setEditForm({ ...editForm, start_date: e.target.value })
                }
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Guardando..." : "Guardar cambios"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
