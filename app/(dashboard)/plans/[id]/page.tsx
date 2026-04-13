"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, ExternalLink, Trash2, Plus, Users, CheckCircle2, AlertTriangle, XCircle, Pencil, Download } from "lucide-react";
import { toast } from "sonner";
import { Plan, Evidence, User, PlanItem, ItemAssignmentCategory, EvidenceValidationStatus } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const EMPTY_ITEM_FORM = {
  item: "",
  type: "",
  subplan: "",
  environmental_activity: "",
  identified_environmental_impact: "",
  proposed_measure: "",
  indicator: "",
  verification_method: "",
  periodicity: "",
  budget: "",
  report_per: "6 meses",
};

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isViewer = session?.user?.role === "VIEWER";

  const [plan, setPlan] = useState<Plan | null>(null);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [allReporters, setAllReporters] = useState<User[]>([]);
  const [allViewers, setAllViewers] = useState<User[]>([]);
  const [assignedViewerIds, setAssignedViewerIds] = useState<string[]>([]);
  const [assignViewerOpen, setAssignViewerOpen] = useState(false);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [savingItem, setSavingItem] = useState(false);
  const [assignItemOpen, setAssignItemOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PlanItem | null>(null);
  const [pendingAssign, setPendingAssign] = useState<{ reporter: User; category: ItemAssignmentCategory } | null>(null);
  const [obsItem, setObsItem] = useState<PlanItem | null>(null);
  const [obsText, setObsText] = useState("");
  const [savingObs, setSavingObs] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanItem | null>(null);
  const [calUpload, setCalUpload] = useState<{ item: PlanItem; month: Date } | null>(null);
  const [uploadingCal, setUploadingCal] = useState(false);
  const [selectedReportPeriods, setSelectedReportPeriods] = useState<Record<string, string>>({});
  const [downloadingPeriod, setDownloadingPeriod] = useState<string | null>(null);

  const loadPlan = useCallback(async () => {
    const res = await fetch(`/api/plans/${id}`);
    if (res.ok) {
      const data = await res.json();
      setPlan(data.plan);
      setEvidences(data.evidences);
      if (Array.isArray(data.assignedUsers)) {
        setAssignedViewerIds(data.assignedUsers);
      }
    }
  }, [id]);

  const loadItems = useCallback(async () => {
    const res = await fetch(`/api/plans/${id}/items`);
    if (res.ok) setPlanItems(await res.json());
  }, [id]);

  useEffect(() => {
    loadPlan();
    loadItems();
  }, [loadPlan, loadItems]);

  useEffect(() => {
    if (isAdmin) {
      fetch("/api/users")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setAllReporters(data.filter((u: User) => u.role === "REPORTER"));
            setAllViewers(data.filter((u: User) => u.role === "VIEWER"));
          }
        });
    }
  }, [isAdmin]);

  async function handleAssignViewer(viewerId: string) {
    const res = await fetch(`/api/plans/${id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: viewerId }),
    });
    if (res.ok) {
      setAssignedViewerIds((prev) => [...prev, viewerId]);
      toast.success("Visualizador asignado al plan");
    } else {
      toast.error("Error al asignar visualizador");
    }
  }

  async function handleUnassignViewer(viewerId: string) {
    const res = await fetch(`/api/plans/${id}/assign`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: viewerId }),
    });
    if (res.ok) {
      setAssignedViewerIds((prev) => prev.filter((vid) => vid !== viewerId));
      toast.success("Visualizador desasignado del plan");
    } else {
      toast.error("Error al desasignar visualizador");
    }
  }

  async function handleValidationChange(evidenceId: string, status: EvidenceValidationStatus) {
    const res = await fetch(`/api/evidences?id=${evidenceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ validationStatus: status }),
    });

    if (res.ok) {
      setEvidences((prev) =>
        prev.map((ev) => (ev.id === evidenceId ? { ...ev, validationStatus: status } : ev))
      );
      toast.success("Validación actualizada");
    } else {
      toast.error("Error al actualizar validación");
    }
  }

  async function handleDeleteEvidence(evidenceId: string) {
    if (!confirm("¿Eliminar esta evidencia?")) return;
    const res = await fetch(`/api/evidences?id=${evidenceId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      toast.success("Evidencia eliminada");
      loadPlan();
    } else {
      toast.error("Error al eliminar");
    }
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    setSavingItem(true);

    if (editingItem) {
      const res = await fetch(`/api/plans/${id}/items/${editingItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...itemForm, budget: Number(itemForm.budget) }),
      });
      setSavingItem(false);
      if (res.ok) {
        toast.success("Ítem actualizado correctamente");
        setEditingItem(null);
        setItemForm(EMPTY_ITEM_FORM);
        setAddItemOpen(false);
        loadItems();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error al actualizar ítem");
      }
      return;
    }

    const res = await fetch(`/api/plans/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...itemForm, budget: Number(itemForm.budget) }),
    });

    setSavingItem(false);

    if (res.ok) {
      toast.success("Ítem agregado correctamente");
      setItemForm(EMPTY_ITEM_FORM);
      setAddItemOpen(false);
      loadItems();
    } else {
      const data = await res.json();
      toast.error(data.error || "Error al agregar ítem");
    }
  }

  async function handleAssignToItem(userId: string, category: ItemAssignmentCategory) {
    if (!selectedItem) return;
    const res = await fetch(`/api/plans/${id}/items/${selectedItem.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, category }),
    });
    if (res.ok) {
      toast.success("Reportero asignado al ítem");
      setPendingAssign(null);
      const updated = await fetch(`/api/plans/${id}/items`);
      if (updated.ok) {
        const items = await updated.json();
        setPlanItems(items);
        setSelectedItem(items.find((i: PlanItem) => i.id === selectedItem.id) ?? null);
      }
    } else {
      toast.error("Error al asignar");
    }
  }

  async function handleUnassignFromItem(userId: string) {
    if (!selectedItem) return;
    const res = await fetch(`/api/plans/${id}/items/${selectedItem.id}/assign`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      toast.success("Reportero desasignado del ítem");
      const updated = await fetch(`/api/plans/${id}/items`);
      if (updated.ok) {
        const items = await updated.json();
        setPlanItems(items);
        setSelectedItem(items.find((i: PlanItem) => i.id === selectedItem.id) ?? null);
      }
    } else {
      toast.error("Error al desasignar");
    }
  }


  async function handleCalUploadSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!calUpload) return;
    setUploadingCal(true);

    const monthKey = `${calUpload.month.getFullYear()}-${String(calUpload.month.getMonth() + 1).padStart(2, "0")}`;
    const formData = new FormData(e.currentTarget);
    formData.set("planId", id);
    formData.set("planItemId", calUpload.item.id);
    formData.set("activityMonth", monthKey);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    setUploadingCal(false);

    if (res.ok) {
      toast.success("Evidencia subida correctamente");
      (e.target as HTMLFormElement).reset();
      setCalUpload(null);
      loadPlan();
    } else {
      const data = await res.json();
      toast.error(data.error || "Error al subir");
    }
  }

  async function handleDownloadPeriod(pi: PlanItem, periodKey: string) {
    const downloadId = `${pi.id}-${periodKey}`;
    setDownloadingPeriod(downloadId);
    try {
      const params = new URLSearchParams({
        planItemId: pi.id,
        periodStart: periodKey,
        planId: id,
      });
      const res = await fetch(`/api/download/item-period?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "No hay archivos para descargar");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pi.item}_${periodKey}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Error al descargar");
    } finally {
      setDownloadingPeriod(null);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm("¿Eliminar este ítem?")) return;

    const res = await fetch(`/api/plans/${id}/items/${itemId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      toast.success("Ítem eliminado");
      loadItems();
    } else {
      toast.error("Error al eliminar ítem");
    }
  }

  async function handleSaveObservation() {
    if (!obsItem) return;
    setSavingObs(true);
    const res = await fetch(`/api/plans/${id}/items/${obsItem.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation: obsText }),
    });
    setSavingObs(false);
    if (res.ok) {
      setPlanItems((prev) =>
        prev.map((pi) => (pi.id === obsItem.id ? { ...pi, observation: obsText } : pi))
      );
      toast.success("Observación guardada");
      setObsItem(null);
    } else {
      toast.error("Error al guardar observación");
    }
  }

  if (!plan) {
    return <div className="text-muted-foreground">Cargando...</div>;
  }


  const userId = session?.user?.id ?? "";
  const visibleItems = (isAdmin || isViewer)
    ? planItems
    : planItems.filter((pi) =>
        (pi.assignedUsers ?? []).some((a) => a.userId === userId)
      );
  const visibleEvidences = (isAdmin || isViewer)
    ? evidences
    : evidences.filter(
        (ev) => !ev.planItemId || visibleItems.some((pi) => pi.id === ev.planItemId)
      );

  return (
    <div className="space-y-6">
      {/* Plan Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold">{plan.title}</h1>
          {isViewer && (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
              Solo lectura
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1">
          {plan.description || "Sin descripción"}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Creado el {new Date(plan.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Viewers assigned to this plan (admin only) */}
      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Visualizadores del Plan ({assignedViewerIds.filter(id => allViewers.some(v => v.id === id)).length})
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setAssignViewerOpen(true)}>
              <Users className="w-4 h-4 mr-2" />
              Gestionar Visualizadores
            </Button>
          </CardHeader>
          <CardContent>
            {assignedViewerIds.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Sin visualizadores asignados. Agrega uno para que pueda ver este plan.
              </p>
            ) : (
              <div className="space-y-2">
                {assignedViewerIds.map((vid) => {
                  const viewer = allViewers.find((v) => v.id === vid);
                  if (!viewer) return null;
                  return (
                    <div
                      key={vid}
                      className="flex items-center justify-between p-2 rounded-lg border"
                    >
                      <div>
                        <p className="text-sm font-medium">{viewer.name}</p>
                        <p className="text-xs text-muted-foreground">{viewer.email}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnassignViewer(vid)}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plan Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Ítems del Plan ({visibleItems.length})
          </CardTitle>
          {isAdmin && (
            <Dialog
                open={addItemOpen}
                onOpenChange={(open) => {
                  if (!open) {
                    setEditingItem(null);
                    setItemForm(EMPTY_ITEM_FORM);
                  } else if (open && !editingItem && planItems.length > 0) {
                    const last = planItems[planItems.length - 1];
                    setItemForm({
                      item: last.item,
                      type: last.type,
                      subplan: last.subplan,
                      environmental_activity: last.environmental_activity,
                      identified_environmental_impact:
                        last.identified_environmental_impact,
                      proposed_measure: last.proposed_measure,
                      indicator: last.indicator,
                      verification_method: last.verification_method,
                      periodicity: last.periodicity,
                      budget: String(last.budget),
                      report_per: last.report_per ?? "6 meses",
                    });
                  } else if (open && !editingItem) {
                    setItemForm(EMPTY_ITEM_FORM);
                  }
                  setAddItemOpen(open);
                }}
              >
              <DialogTrigger render={<Button size="sm" />}>
                <Plus className="w-4 h-4 mr-2" />
                Agregar Ítem
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingItem ? "Editar Ítem" : "Agregar Ítem al Plan"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleAddItem} className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="item">Ítem</Label>
                      <Input
                        id="item"
                        value={itemForm.item}
                        onChange={(e) =>
                          setItemForm({ ...itemForm, item: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="subplan">Subplan</Label>
                      <Input
                        id="subplan"
                        value={itemForm.subplan}
                        onChange={(e) =>
                          setItemForm({ ...itemForm, subplan: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="periodicity">Periodicidad</Label>
                      <select
                        id="periodicity"
                        value={itemForm.periodicity}
                        onChange={(e) =>
                          setItemForm({
                            ...itemForm,
                            periodicity: e.target.value,
                          })
                        }
                        required
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="" disabled>
                          Seleccionar periodicidad...
                        </option>
                        <option value="Mensual">Mensual</option>
                        <option value="Bimensual">Bimensual</option>
                        <option value="Trimestral">Trimestral</option>
                        <option value="Semestral">Semestral</option>
                        <option value="Anual">Anual</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="budget">Presupuesto</Label>
                      <Input
                        id="budget"
                        type="number"
                        min="0"
                        step="0.01"
                        value={itemForm.budget}
                        onChange={(e) =>
                          setItemForm({ ...itemForm, budget: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="environmental_activity">
                      Actividad Ambiental
                    </Label>
                    <Input
                      id="environmental_activity"
                      value={itemForm.environmental_activity}
                      onChange={(e) =>
                        setItemForm({
                          ...itemForm,
                          environmental_activity: e.target.value,
                        })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="identified_environmental_impact">
                      Impacto Ambiental Identificado
                    </Label>
                    <Input
                      id="identified_environmental_impact"
                      value={itemForm.identified_environmental_impact}
                      onChange={(e) =>
                        setItemForm({
                          ...itemForm,
                          identified_environmental_impact: e.target.value,
                        })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="proposed_measure">Medida Propuesta</Label>
                    <Input
                      id="proposed_measure"
                      value={itemForm.proposed_measure}
                      onChange={(e) =>
                        setItemForm({
                          ...itemForm,
                          proposed_measure: e.target.value,
                        })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="indicator">Indicador</Label>
                    <Input
                      id="indicator"
                      value={itemForm.indicator}
                      onChange={(e) =>
                        setItemForm({ ...itemForm, indicator: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="verification_method">
                      Método de Verificación
                    </Label>
                    <Input
                      id="verification_method"
                      value={itemForm.verification_method}
                      onChange={(e) =>
                        setItemForm({
                          ...itemForm,
                          verification_method: e.target.value,
                        })
                      }
                      required
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={savingItem}>
                    {savingItem ? "Guardando..." : editingItem ? "Guardar cambios" : "Agregar Ítem"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {visibleItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin ítems aún.{" "}
              {isAdmin && "Usa el botón \"Agregar Ítem\" para comenzar."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ítem</TableHead>
                    <TableHead>Subplan</TableHead>
                    <TableHead>Actividad Ambiental</TableHead>
                    <TableHead>Impacto Identificado</TableHead>
                    <TableHead>Medida Propuesta</TableHead>
                    <TableHead>Indicador</TableHead>
                    <TableHead>Método Verificación</TableHead>
                    <TableHead>Periodicidad</TableHead>
                    <TableHead>Presupuesto</TableHead>
                    <TableHead>Reporteros</TableHead>
                    <TableHead>Observación</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                    {isAdmin && <TableHead className="w-[60px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleItems.map((pi) => (
                    <TableRow key={pi.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {pi.item}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {pi.subplan}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate">
                        {pi.environmental_activity}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate">
                        {pi.identified_environmental_impact}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate">
                        {pi.proposed_measure}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        {pi.indicator}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        {pi.verification_method}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {pi.periodicity}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {pi.budget.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                        })}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedItem(pi);
                            setAssignItemOpen(true);
                          }}
                          className="flex items-center gap-1 whitespace-nowrap"
                        >
                          <Users className="w-3.5 h-3.5" />
                          {(pi.assignedUsers ?? []).length > 0
                            ? `${(pi.assignedUsers ?? []).length} asignado(s)`
                            : "Asignar"}
                        </Button>
                      </TableCell>
                      <TableCell
                        className="max-w-[160px] cursor-pointer"
                        onClick={() => {
                          setObsItem(pi);
                          setObsText(pi.observation ?? "");
                        }}
                      >
                        {pi.observation ? (
                          <span className="truncate block text-sm text-muted-foreground hover:text-foreground transition-colors">
                            {pi.observation}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground/50 italic hover:text-muted-foreground transition-colors">
                            Sin observación
                          </span>
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Editar ítem"
                              onClick={() => {
                                setEditingItem(pi);
                                setItemForm({
                                  item: pi.item,
                                  type: pi.type,
                                  subplan: pi.subplan,
                                  environmental_activity: pi.environmental_activity,
                                  identified_environmental_impact: pi.identified_environmental_impact,
                                  proposed_measure: pi.proposed_measure,
                                  indicator: pi.indicator,
                                  verification_method: pi.verification_method,
                                  periodicity: pi.periodicity,
                                  budget: String(pi.budget),
                                  report_per: pi.report_per ?? "6 meses",
                                });
                                setAddItemOpen(true);
                              }}
                            >
                              <Pencil className="w-4 h-4 text-blue-500" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteItem(pi.id)}
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cronograma mensual */}
      {visibleItems.length > 0 && (() => {
        const p = plan!;
        // Build evidence status lookup: "planItemId-YYYY-MM" → validationStatus of latest evidence
        // Priority for multiple evidences: valid > invalid > pending
        const evidenceMonthStatus = new Map<string, EvidenceValidationStatus>();
        const statusPriority: Record<EvidenceValidationStatus, number> = { valid: 3, invalid: 2, pending: 1 };
        visibleEvidences
          .filter((e) => e.planItemId && e.activityMonth)
          .forEach((e) => {
            const key = `${e.planItemId}-${e.activityMonth}`;
            const current = evidenceMonthStatus.get(key);
            const incoming = e.validationStatus ?? "pending";
            if (!current || statusPriority[incoming] > statusPriority[current]) {
              evidenceMonthStatus.set(key, incoming);
            }
          });

        // Colors by status
        const statusStyle: Record<"none" | EvidenceValidationStatus, { bg: string; color: string; border: string; label: string }> = {
          none:    { bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc", label: "" },    // celeste
          pending: { bg: "#fef9c3", color: "#854d0e", border: "#fde047", label: "⏳" }, // amarillo
          invalid: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: "✕" },  // rojo
          valid:   { bg: "#dcfce7", color: "#166534", border: "#86efac", label: "✓" },  // verde
        };

        const periodicityInterval: Record<string, number> = {
          Mensual: 1,
          Bimensual: 2,
          Trimestral: 3,
          Semestral: 6,
          Anual: 12,
        };

        const periodicityLabel: Record<string, string> = {
          Mensual: "M",
          Bimensual: "B",
          Trimestral: "T",
          Semestral: "S",
          Anual: "A",
        };

        const today = new Date();
        const todayMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        const planStart = new Date(p.start_date || p.createdAt);
        const rangeStart = new Date(planStart.getFullYear(), planStart.getMonth(), 1);
        const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 2, 1);

        const months: Date[] = [];
        const cur = new Date(rangeStart);
        while (cur < rangeEnd) {
          months.push(new Date(cur));
          cur.setMonth(cur.getMonth() + 1);
        }

        function isActive(pi: PlanItem, month: Date): boolean {
          const s = new Date(p.start_date || p.createdAt);
          const sm = new Date(s.getFullYear(), s.getMonth(), 1);
          const mm = new Date(month.getFullYear(), month.getMonth(), 1);
          if (mm < sm) return false;
          const diff =
            (mm.getFullYear() - sm.getFullYear()) * 12 +
            (mm.getMonth() - sm.getMonth());
          const interval = periodicityInterval[pi.periodicity] ?? 1;
          return diff % interval === 0;
        }

        // Block shading: size comes from report_per, origin is January of the item's start year
        function getBlockSize(report_per: string | undefined): number {
          const s = (report_per ?? "").toLowerCase();
          if (s.startsWith("2")) return 24;
          if (s.startsWith("1")) return 12;
          return 6;
        }

        function getBlockShade(pi: PlanItem, month: Date): "green" | "red" | "none" {
          const blockSize = getBlockSize(pi.report_per);
          if (!blockSize) return "none";

          // Blocks always start from January of the plan's start year
          const startYear = new Date(p.start_date || p.createdAt).getFullYear();
          const blockOrigin = new Date(startYear, 0, 1);
          const mm = new Date(month.getFullYear(), month.getMonth(), 1);

          if (mm < blockOrigin) return "none";

          const diffFromOrigin =
            (mm.getFullYear() - blockOrigin.getFullYear()) * 12 +
            (mm.getMonth() - blockOrigin.getMonth());
          const blockIndex = Math.floor(diffFromOrigin / blockSize);
          const blockStart = new Date(blockOrigin.getFullYear(), blockOrigin.getMonth() + blockIndex * blockSize, 1);
          const blockEnd   = new Date(blockOrigin.getFullYear(), blockOrigin.getMonth() + (blockIndex + 1) * blockSize, 1);

          // Collect active months in this block that have already passed (≤ today)
          const dueMonths: Date[] = [];
          const cur = new Date(blockStart);
          while (cur < blockEnd) {
            if (cur <= todayMonth && isActive(pi, cur)) {
              dueMonths.push(new Date(cur));
            }
            cur.setMonth(cur.getMonth() + 1);
          }

          // If block hasn't started yet → no shade
          if (blockStart > todayMonth) return "none";
          // If block started but has no planned activities → automatically green
          if (dueMonths.length === 0) return "green";

          const allValid = dueMonths.every((d) => {
            const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            return evidenceMonthStatus.get(`${pi.id}-${mk}`) === "valid";
          });

          return allValid ? "green" : "red";
        }

        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cronograma</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-background border border-border px-3 py-2 min-w-[200px] text-left font-medium text-muted-foreground">
                        Ítem
                      </th>
                      {months.map((m, i) => {
                        const showYear = i === 0 || m.getMonth() === 0;
                        const sameYearCount = months.filter(
                          (x) => x.getFullYear() === m.getFullYear()
                        ).length;
                        if (!showYear) return null;
                        return (
                          <th
                            key={`y-${i}`}
                            colSpan={sameYearCount}
                            className="border border-border px-2 py-1 text-center font-semibold bg-muted text-muted-foreground"
                          >
                            {m.getFullYear()}
                          </th>
                        );
                      })}
                    </tr>
                    <tr>
                      <th className="sticky left-0 z-10 bg-background border border-border" />
                      {months.map((m, i) => {
                        const isToday = m.getTime() === todayMonth.getTime();
                        return (
                          <th
                            key={`m-${i}`}
                            className={`border border-border px-1 py-1 text-center font-medium min-w-[48px] ${
                              isToday
                                ? "bg-primary/10 text-primary"
                                : "bg-muted/50 text-muted-foreground"
                            }`}
                          >
                            {m.toLocaleString("es", { month: "short" })}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((pi, rowIdx) => {
                      return (
                        <tr
                          key={pi.id}
                          className={rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"}
                        >
                          <td className="sticky left-0 z-10 border border-border px-3 py-1.5 font-medium truncate max-w-[200px] bg-inherit">
                            {pi.item}
                          </td>
                          {months.map((m, i) => {
                            const active = isActive(pi, m);
                            const planStartDate = new Date(p.start_date || p.createdAt);
                            const isStart =
                              planStartDate.getFullYear() === m.getFullYear() &&
                              planStartDate.getMonth() === m.getMonth();
                            const isToday = m.getTime() === todayMonth.getTime();
                            const periodicLabel = periodicityLabel[pi.periodicity] ?? "•";
                            const monthKey = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
                            const evStatus = evidenceMonthStatus.get(`${pi.id}-${monthKey}`) ?? "none";
                            const style = statusStyle[evStatus];
                            const blockShade = getBlockShade(pi, m);

                            const titleText =
                              evStatus === "valid"   ? `Válido — ${m.toLocaleString("es", { month: "long", year: "numeric" })}` :
                              evStatus === "invalid" ? `Rechazado — ${m.toLocaleString("es", { month: "long", year: "numeric" })}` :
                              evStatus === "pending" ? `Pendiente de aprobación — ${m.toLocaleString("es", { month: "long", year: "numeric" })}` :
                              isStart ? `Subir evidencia de inicio — ${planStartDate.toLocaleDateString("es")}` :
                              `Subir evidencia — ${m.toLocaleString("es", { month: "long", year: "numeric" })}`;

                            const cellBg =
                              blockShade === "green" ? "#f0fdf4" :
                              blockShade === "red"   ? "#fef2f2" :
                              isToday               ? "#f0f9ff" :
                              undefined;

                            return (
                              <td
                                key={i}
                                className="border border-border p-0.5"
                                style={cellBg ? { backgroundColor: cellBg } : undefined}
                              >
                                {active && (
                                  isStart && evStatus === "none" ? (
                                    <span
                                      className="w-full flex items-center justify-center leading-none select-none"
                                      style={{ height: "24px", fontSize: "10px", color: "#111827", fontWeight: 600 }}
                                    >
                                      Inicio
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => { if (!isViewer) setCalUpload({ item: pi, month: m }); }}
                                      disabled={isViewer}
                                      className="w-full rounded flex items-center justify-center font-bold leading-none transition-opacity hover:opacity-75 disabled:cursor-default disabled:opacity-100"
                                      style={{
                                        height: "24px",
                                        backgroundColor: style.bg,
                                        color: style.color,
                                        fontSize: "10px",
                                        border: `1px solid ${style.border}`,
                                      }}
                                      title={isViewer ? titleText.replace("Subir evidencia", "Sin evidencia") : titleText}
                                    >
                                      {evStatus !== "none" ? style.label : periodicLabel}
                                    </button>
                                  )
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-4 py-3 border-t text-xs text-muted-foreground mt-3">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-10 h-4 rounded border" style={{ backgroundColor: "#e0f2fe", borderColor: "#7dd3fc" }} />
                  Sin entregar
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-10 h-4 rounded border" style={{ backgroundColor: "#fef9c3", borderColor: "#fde047" }} />
                  Pendiente aprobación
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-10 h-4 rounded border" style={{ backgroundColor: "#fee2e2", borderColor: "#fca5a5" }} />
                  Rechazado
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-10 h-4 rounded border" style={{ backgroundColor: "#dcfce7", borderColor: "#86efac" }} />
                  Válido
                </span>
                <span className="ml-auto flex gap-3">
                  {(["Mensual","Bimensual","Trimestral","Semestral","Anual"] as const).map((p) => (
                    <span key={p}><span className="font-semibold">{periodicityLabel[p]}</span> = {p}</span>
                  ))}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Assign viewers to plan dialog */}
      <Dialog open={assignViewerOpen} onOpenChange={setAssignViewerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gestionar Visualizadores</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Assigned viewers */}
            {assignedViewerIds.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Asignados</p>
                <div className="space-y-1">
                  {assignedViewerIds.map((vid) => {
                    const viewer = allViewers.find((v) => v.id === vid);
                    if (!viewer) return null;
                    return (
                      <div key={vid} className="flex items-center justify-between p-2 rounded-lg border">
                        <div>
                          <p className="text-sm font-medium">{viewer.name}</p>
                          <p className="text-xs text-muted-foreground">{viewer.email}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnassignViewer(vid)}
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Available viewers to assign */}
            {allViewers.filter((v) => !assignedViewerIds.includes(v.id)).length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Agregar visualizador</p>
                <div className="space-y-1">
                  {allViewers
                    .filter((v) => !assignedViewerIds.includes(v.id))
                    .map((viewer) => (
                      <div key={viewer.id} className="flex items-center justify-between p-2 rounded-lg border">
                        <div>
                          <p className="text-sm font-medium">{viewer.name}</p>
                          <p className="text-xs text-muted-foreground">{viewer.email}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAssignViewer(viewer.id)}
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          Asignar
                        </Button>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              allViewers.length > 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">
                  Todos los visualizadores ya están asignados.
                </p>
              )
            )}

            {allViewers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-3">
                No hay visualizadores creados aún. Crea uno en la sección de Usuarios.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign reporters to item dialog */}
      <Dialog open={assignItemOpen} onOpenChange={(open) => { setAssignItemOpen(open); if (!open) setPendingAssign(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reporteros — {selectedItem?.item}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Assigned */}
            {(selectedItem?.assignedUsers ?? []).length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Asignados</p>
                <div className="space-y-1">
                  {(selectedItem?.assignedUsers ?? []).map((a) => {
                    const reporter = allReporters.find((r) => r.id === a.userId);
                    return (
                      <div key={a.userId} className="flex items-center justify-between p-2 rounded-lg border">
                        <div>
                          <p className="text-sm font-medium">{reporter?.name || a.userId}</p>
                          <p className="text-xs text-muted-foreground">{reporter?.email}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{a.category}</Badge>
                          {isAdmin && (
                            <Button variant="ghost" size="sm" onClick={() => handleUnassignFromItem(a.userId)}>
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Category picker for pending assignment */}
            {pendingAssign && (
              <div className="rounded-lg border p-3 space-y-3 bg-muted/40">
                <p className="text-sm font-medium">
                  Asignar a <span className="text-foreground">{pendingAssign.reporter.name}</span> como:
                </p>
                <div className="flex gap-2">
                  {(["Responsable", "Colaborador"] as ItemAssignmentCategory[]).map((cat) => (
                    <Button
                      key={cat}
                      size="sm"
                      variant={pendingAssign.category === cat ? "default" : "outline"}
                      onClick={() => setPendingAssign({ ...pendingAssign, category: cat })}
                    >
                      {cat}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => handleAssignToItem(pendingAssign.reporter.id, pendingAssign.category)}>
                    Confirmar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPendingAssign(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {/* Unassigned reporters list */}
            {isAdmin && !pendingAssign && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Agregar reportero</p>
                {allReporters.filter((r) => !(selectedItem?.assignedUsers ?? []).some((a) => a.userId === r.id)).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">Todos los reporteros ya están asignados.</p>
                ) : (
                  <div className="space-y-1">
                    {allReporters
                      .filter((r) => !(selectedItem?.assignedUsers ?? []).some((a) => a.userId === r.id))
                      .map((reporter) => (
                        <div key={reporter.id} className="flex items-center justify-between p-2 rounded-lg border">
                          <div>
                            <p className="text-sm font-medium">{reporter.name}</p>
                            <p className="text-xs text-muted-foreground">{reporter.email}</p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => setPendingAssign({ reporter, category: "Responsable" })}
                          >
                            Asignar
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>


      {/* Calendar Upload Dialog */}
      <Dialog open={!!calUpload} onOpenChange={(open) => { if (!open) setCalUpload(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Subir Evidencia
            </DialogTitle>
          </DialogHeader>
          {calUpload && (
            <div className="space-y-1 mb-2">
              <p className="text-sm font-medium">{calUpload.item.item}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {calUpload.month.toLocaleString("es", { month: "long", year: "numeric" })}
                {" · "}
                {calUpload.item.periodicity}
              </p>
            </div>
          )}
          <form onSubmit={handleCalUploadSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cal-file">Archivo (máx 10MB)</Label>
              <Input id="cal-file" name="file" type="file" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cal-desc">Descripción</Label>
              <Input
                id="cal-desc"
                name="description"
                placeholder="Breve descripción de la evidencia"
                required
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setCalUpload(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={uploadingCal}>
                <Upload className="w-4 h-4 mr-2" />
                {uploadingCal ? "Subiendo..." : "Subir Evidencia"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Observation Dialog */}
      <Dialog open={!!obsItem} onOpenChange={(open) => { if (!open) setObsItem(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Observación — {obsItem?.item}</DialogTitle>
          </DialogHeader>
          <textarea
            className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            placeholder="Escribe una observación..."
            value={obsText}
            onChange={(e) => setObsText(e.target.value)}
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setObsItem(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveObservation} disabled={savingObs}>
              {savingObs ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Evidence List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Evidencias ({visibleEvidences.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visibleEvidences.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin evidencias subidas aún.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[48px]"></TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Mes-Año</TableHead>
                  <TableHead>Archivo</TableHead>
                  <TableHead>Subido por</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="w-[80px]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEvidences.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell>
                      {isViewer ? (
                        <span className="p-0 h-auto inline-flex">
                          {(ev.validationStatus ?? "pending") === "valid" && (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          )}
                          {(ev.validationStatus ?? "pending") === "invalid" && (
                            <XCircle className="w-5 h-5 text-red-500" />
                          )}
                          {(ev.validationStatus ?? "pending") === "pending" && (
                            <AlertTriangle className="w-5 h-5 text-yellow-500" />
                          )}
                        </span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger className="p-0 h-auto bg-transparent border-0 cursor-pointer inline-flex items-center justify-center rounded hover:opacity-75 transition-opacity">
                              {(ev.validationStatus ?? "pending") === "valid" && (
                                <CheckCircle2 className="w-5 h-5 text-green-500" />
                              )}
                              {(ev.validationStatus ?? "pending") === "invalid" && (
                                <XCircle className="w-5 h-5 text-red-500" />
                              )}
                              {(ev.validationStatus ?? "pending") === "pending" && (
                                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                              )}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem onClick={() => handleValidationChange(ev.id, "valid")}>
                              <CheckCircle2 className="w-4 h-4 text-green-500 mr-2" /> Válido
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleValidationChange(ev.id, "pending")}>
                              <AlertTriangle className="w-4 h-4 text-yellow-500 mr-2" /> Pendiente
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleValidationChange(ev.id, "invalid")}>
                              <XCircle className="w-4 h-4 text-red-500 mr-2" /> No válido
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm">
                      {ev.planItemId
                        ? visibleItems.find((pi) => pi.id === ev.planItemId)?.item ?? "-"
                        : "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {ev.activityMonth
                        ? new Date(`${ev.activityMonth}-01T00:00:00`).toLocaleDateString("es", { month: "short", year: "numeric" })
                        : "-"}
                    </TableCell>
                    <TableCell className="font-medium">{ev.fileName}</TableCell>
                    <TableCell>{ev.uploaderName}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {ev.description || "-"}
                    </TableCell>
                    <TableCell>
                      {new Date(ev.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <a
                          href={ev.driveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="ghost" size="sm">
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </a>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteEvidence(ev.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reportería */}
      {visibleItems.length > 0 && (() => {
        const p = plan!;
        function getBlockSize(report_per: string | undefined): number {
          const s = (report_per ?? "").toLowerCase();
          if (s.startsWith("2")) return 24;
          if (s.startsWith("1")) return 12;
          return 6;
        }

        function getAvailablePeriods(pi: PlanItem): { key: string; label: string }[] {
          const blockSize = getBlockSize(pi.report_per);
          const startYear = new Date(p.start_date || p.createdAt).getFullYear();
          const blockOrigin = new Date(startYear, 0, 1);
          const today = new Date();
          const todayMonth = new Date(today.getFullYear(), today.getMonth(), 1);

          const periods: { key: string; label: string }[] = [];
          let blockIndex = 0;

          while (blockIndex < 100) {
            const blockStart = new Date(
              blockOrigin.getFullYear(),
              blockOrigin.getMonth() + blockIndex * blockSize,
              1
            );
            if (blockStart > todayMonth) break;
            const blockEndMonth = new Date(
              blockOrigin.getFullYear(),
              blockOrigin.getMonth() + (blockIndex + 1) * blockSize - 1,
              1
            );
            const key = `${blockStart.getFullYear()}-${String(blockStart.getMonth() + 1).padStart(2, "0")}`;
            const startLabel = blockStart.toLocaleString("es", { month: "short", year: "numeric" });
            const endLabel = blockEndMonth.toLocaleString("es", { month: "short", year: "numeric" });
            periods.push({ key, label: `${startLabel} – ${endLabel}` });
            blockIndex++;
          }

          return periods;
        }

        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reportería</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ítem</TableHead>
                      <TableHead>Anexos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((pi) => {
                      const periods = getAvailablePeriods(pi);
                      return (
                        <TableRow key={pi.id}>
                          <TableCell className="font-medium whitespace-nowrap">
                            {pi.item}
                          </TableCell>
                          <TableCell>
                            {periods.length === 0 ? (
                              <span className="text-xs text-muted-foreground">Sin períodos disponibles</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <select
                                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-w-[200px]"
                                  value={selectedReportPeriods[pi.id] ?? ""}
                                  onChange={(e) =>
                                    setSelectedReportPeriods((prev) => ({
                                      ...prev,
                                      [pi.id]: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="" disabled>Seleccionar período...</option>
                                  {periods.map((p) => (
                                    <option key={p.key} value={p.key}>
                                      {p.label}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!selectedReportPeriods[pi.id] || downloadingPeriod === `${pi.id}-${selectedReportPeriods[pi.id]}`}
                                  onClick={() => {
                                    const key = selectedReportPeriods[pi.id];
                                    if (key) handleDownloadPeriod(pi, key);
                                  }}
                                  title="Descargar evidencias del período"
                                >
                                  {downloadingPeriod === `${pi.id}-${selectedReportPeriods[pi.id]}` ? (
                                    <span className="flex items-center gap-1 text-xs">
                                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                      </svg>
                                      Descargando...
                                    </span>
                                  ) : (
                                    <Download className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
