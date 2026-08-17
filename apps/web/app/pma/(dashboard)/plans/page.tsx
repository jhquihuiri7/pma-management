"use client";

import { api, apiErrorMessage, requirePersistedEntity } from "@/lib/api-client";
import { useConfirmedMutation } from "@/lib/use-confirmed-mutation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
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
import { Plus, ArrowRight, Pencil, Map } from "lucide-react";
import { toast } from "sonner";
import { Plan, PLAN_TIPO_VALUES, PLAN_FASE_VALUES, PLAN_ENFOQUE_VALUES, PLAN_REPORTE_VALUES } from "@/types";
import { formatDateOnly } from "@/lib/dateOnly";

export default function PlansPage() {
  const { user: session} = useAuth();
  const isAdmin = session?.role === "ADMIN";
  const isViewer = session?.role === "VIEWER";
  // VIEWERs can edit plans they're assigned to, but cannot create or delete them.
  const canEdit = isAdmin || isViewer;
  const [plans, setPlans] = useState<Plan[]>([]);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState({ title: "", description: "", tipo: "", fase: "", enfoque: "", report_per: "6 meses", start_date: "", visualization_url: "" });
  const [editForm, setEditForm] = useState({ title: "", description: "", tipo: "", fase: "", enfoque: "", report_per: "6 meses", start_date: "", visualization_url: "" });
  const plansLoadGenerationRef = useRef(0);

  async function loadPlans() {
    const generation = ++plansLoadGenerationRef.current;
    try {
      const loaded = await api.get<Plan[]>("/pma/api/plans");
      if (generation === plansLoadGenerationRef.current) setPlans(loaded);
    } catch (error) {
      if (generation === plansLoadGenerationRef.current) {
        toast.error(apiErrorMessage(error, "No se pudieron cargar los planes"));
      }
    }
  }

  useEffect(() => {
    void loadPlans();
  }, []);

  const createMutation = useConfirmedMutation<typeof form, Plan>({
    mutation: async (payload, signal) => requirePersistedEntity<Plan>(
      await api.post<unknown>("/pma/api/plans", payload, { signal }),
      "El servidor no confirmó la creación del plan"
    ),
    successMessage: "Plan creado correctamente",
    errorMessage: "Error al crear el plan",
    onConfirmed: (created) => {
      plansLoadGenerationRef.current += 1;
      setPlans((current) => [created, ...current]);
      setForm({ title: "", description: "", tipo: "", fase: "", enfoque: "", report_per: "6 meses", start_date: "", visualization_url: "" });
      setOpen(false);
    },
  });

  const editMutation = useConfirmedMutation<{ id: string; payload: typeof editForm }, Plan>({
    mutation: async ({ id, payload }, signal) => requirePersistedEntity<Plan>(
      await api.put<unknown>(`/pma/api/plans/${id}`, payload, { signal }),
      "El servidor no confirmó la actualización del plan",
      id
    ),
    successMessage: "Plan actualizado correctamente",
    errorMessage: "Error al actualizar el plan",
    onConfirmed: (updated) => {
      plansLoadGenerationRef.current += 1;
      setPlans((current) => current.map((plan) => plan.id === updated.id ? updated : plan));
      setEditOpen(false);
      setEditingPlan(null);
    },
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await createMutation.mutate(form);
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
      visualization_url: plan.visualization_url || "",
    });
    setEditOpen(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPlan) return;
    await editMutation.mutate({ id: editingPlan.id, payload: editForm });
  }

  return (
    <div className="-m-8 min-h-screen">
      <div className="relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-700 px-6 pb-24 pt-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Ccircle cx='30' cy='30' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />
        <div className="relative z-10 mx-auto flex max-w-7xl items-start justify-between gap-6">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Map className="h-6 w-6 text-teal-200" />
              <span className="text-sm font-medium uppercase tracking-widest text-teal-200">
                Planes de Manejo
              </span>
            </div>
            <h1 className="mb-2 text-3xl font-bold text-white">Catálogo de Planes</h1>
            <p className="max-w-xl text-base text-teal-100">
              {isAdmin
                ? "Gestiona y consulta los planes ambientales disponibles."
                : "Consulta los planes ambientales que tienes asignados."}
            </p>
          </div>

        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button className="border border-white/40 bg-white text-teal-800 shadow-lg hover:bg-teal-50" />}>
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
                    {PLAN_TIPO_VALUES.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
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
                    {PLAN_FASE_VALUES.map(fase => <option key={fase} value={fase}>{fase}</option>)}
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
                    {PLAN_ENFOQUE_VALUES.map(enfoque => <option key={enfoque} value={enfoque}>{enfoque}</option>)}
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
                    {PLAN_REPORTE_VALUES.map(reporte => <option key={reporte} value={reporte}>{reporte}</option>)}
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
                <div className="space-y-2">
                  <Label htmlFor="visualization_url">URL de Visualización (Opcional)</Label>
                  <Input
                    id="visualization_url"
                    type="url"
                    placeholder="https://ejemplo.com"
                    value={form.visualization_url}
                    onChange={(e) =>
                      setForm({ ...form, visualization_url: e.target.value })
                    }
                  />
                </div>
                <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creando..." : "Crear Plan"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>

      <div className="relative z-10 mx-auto -mt-12 max-w-7xl px-6 pb-16">
      {plans.length === 0 ? (
        <Card className="rounded-2xl border border-slate-100 bg-white shadow-xl ring-0">
          <CardContent className="py-12 text-center">
            <p className="text-slate-500">
              {isAdmin
                ? "Sin planes aún. Crea uno para comenzar."
                : "Aún no tienes planes asignados."
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id} className="gap-0 overflow-hidden rounded-2xl border border-slate-100 bg-white py-0 shadow-sm ring-0 transition-shadow hover:shadow-lg">
              <CardHeader className="relative flex h-32 justify-end overflow-hidden bg-gradient-to-br from-teal-600 via-teal-500 to-emerald-600 p-5">
                <div
                  className="pointer-events-none absolute inset-0 opacity-10"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)",
                    backgroundSize: "60px 60px",
                  }}
                />
                <Map className="absolute right-5 top-5 h-10 w-10 text-white/30" />
                {plan.fase && (
                  <span className="absolute left-5 top-4 rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-teal-800 shadow-sm">
                    {plan.fase}
                  </span>
                )}
                <CardTitle className="relative line-clamp-2 text-base font-semibold text-white">{plan.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4 p-5">
                <p className="line-clamp-2 min-h-10 text-sm leading-relaxed text-slate-500">
                  {plan.description || "Sin descripción"}
                </p>
                <div className="space-y-1.5">
                  {plan.tipo && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Tipo:</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {plan.tipo}
                      </span>
                    </div>
                  )}
                  {plan.fase && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Fase:</span>
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                        {plan.fase}
                      </span>
                    </div>
                  )}
                  {plan.enfoque && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Enfoque:</span>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {plan.enfoque}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Reporte:</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {plan.report_per ?? "6 meses"}
                    </span>
                  </div>
                  {plan.start_date && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Fecha inicio:</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {formatDateOnly(plan.start_date)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Creado:</span>
                    <span className="text-xs text-slate-500">
                      {new Date(plan.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4">
                  <span />
                  <div className="flex items-center gap-1">
                    {plan.visualization_url && (
                      <Button
                        className="bg-slate-700 text-white hover:bg-slate-800"
                        size="sm"
                        onClick={() => {
                          if (plan.visualization_url) window.open(plan.visualization_url, "_blank");
                        }}
                      >
                        <Map className="w-4 h-4 mr-1" />
                        Visualizar
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(plan)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    <Link href={`/pma/plans/${plan.id}`}>
                      <Button size="sm" className="bg-teal-600 text-white hover:bg-teal-700">
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
      </div>

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
                {PLAN_TIPO_VALUES.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
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
                {PLAN_FASE_VALUES.map(fase => <option key={fase} value={fase}>{fase}</option>)}
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
                {PLAN_ENFOQUE_VALUES.map(enfoque => <option key={enfoque} value={enfoque}>{enfoque}</option>)}
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
                {PLAN_REPORTE_VALUES.map(reporte => <option key={reporte} value={reporte}>{reporte}</option>)}
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
            <div className="space-y-2">
              <Label htmlFor="edit-visualization_url">URL de Visualización (Opcional)</Label>
              <Input
                id="edit-visualization_url"
                type="url"
                placeholder="https://ejemplo.com"
                value={editForm.visualization_url}
                onChange={(e) =>
                  setEditForm({ ...editForm, visualization_url: e.target.value })
                }
              />
            </div>
            <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={editMutation.isPending}>
              {editMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
