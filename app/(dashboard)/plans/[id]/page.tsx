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
import { Upload, ExternalLink, Trash2, Plus, Users, CheckCircle2, AlertTriangle, XCircle, Pencil, Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Plan, Evidence, User, PlanItem, ItemAssignmentCategory, EvidenceValidationStatus, PeriodCompliance, PeriodComplianceStatus } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUBPLAN_OPTIONS } from "@/lib/planItemConstants";
import { parseExcelFile, ParsedItemRow } from "@/lib/excelImport";

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
  const [itemAssignments, setItemAssignments] = useState<
    { userId: string; category: ItemAssignmentCategory }[]
  >([]);
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<ParsedItemRow[]>([]);
  const [bulkFileName, setBulkFileName] = useState<string>("");
  const [bulkParseError, setBulkParseError] = useState<string>("");
  const [bulkUploading, setBulkUploading] = useState(false);
  const [approvedWarningRows, setApprovedWarningRows] = useState<Set<number>>(new Set());
  const [complianceRecords, setComplianceRecords] = useState<PeriodCompliance[]>([]);

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

  const loadCompliance = useCallback(async () => {
    const res = await fetch(`/api/plans/${id}/period-compliance`);
    if (res.ok) setComplianceRecords(await res.json());
  }, [id]);

  useEffect(() => {
    loadPlan();
    loadItems();
    loadCompliance();
  }, [loadPlan, loadItems, loadCompliance]);

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
    try {
      if (editingItem) {
        const res = await fetch(`/api/plans/${id}/items/${editingItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...itemForm, budget: Number(itemForm.budget) }),
        });
        if (res.ok) {
          await syncItemAssignments(
            editingItem.id,
            editingItem.assignedUsers ?? [],
            itemAssignments
          );
          toast.success("Item actualizado correctamente");
          setEditingItem(null);
          setItemForm(EMPTY_ITEM_FORM);
          setItemAssignments([]);
          setAddItemOpen(false);
          await loadItems();
        } else {
          const data = await res.json();
          toast.error(data.error || "Error al actualizar item");
        }
        return;
      }

      const res = await fetch(`/api/plans/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...itemForm, budget: Number(itemForm.budget) }),
      });

      if (res.ok) {
        const createdItem = await res.json();
        await syncItemAssignments(createdItem.id, [], itemAssignments);
        toast.success("Item agregado correctamente");
        setItemForm(EMPTY_ITEM_FORM);
        setItemAssignments([]);
        setAddItemOpen(false);
        await loadItems();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error al agregar item");
      }
    } catch {
      toast.error("Error al guardar asignaciones del item");
    } finally {
      setSavingItem(false);
    }
  }

  async function handleBulkFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBulkFileName(file.name);
    setBulkParseError("");
    setBulkRows([]);

    const result = await parseExcelFile(file);
    if (result.fatalError) {
      setBulkParseError(result.fatalError);
      setBulkOpen(true);
      return;
    }
    if (result.missingColumns.length > 0) {
      setBulkParseError(
        `Faltan columnas requeridas: ${result.missingColumns.join(", ")}`
      );
      setBulkOpen(true);
      return;
    }
    if (result.rows.length === 0) {
      setBulkParseError("No se encontraron filas de datos");
      setBulkOpen(true);
      return;
    }

    setBulkRows(result.rows);
    setBulkOpen(true);
  }

  async function handleBulkSubmit() {
    const hasErrors = bulkRows.some((r) => r.errors.length > 0);
    if (hasErrors) {
      toast.error("Corrige las filas con error antes de cargar");
      return;
    }

    const existingItems = new Set(planItems.map((p) => p.item.trim().toLowerCase()));

    const toSend = bulkRows
      .filter((r) => {
        if (r.errors.length > 0) return false;
        const isDuplicate = !!r.item && existingItems.has(r.item.trim().toLowerCase());
        const hasWarn = r.warnings.length > 0 || isDuplicate;
        return hasWarn ? approvedWarningRows.has(r.rowNumber) : true;
      })
      .map((r) => ({
        item: r.item,
        subplan: r.subplan,
        environmental_activity: r.environmental_activity,
        identified_environmental_impact: r.identified_environmental_impact,
        proposed_measure: r.proposed_measure,
        indicator: r.indicator,
        verification_method: r.verification_method,
        periodicity: r.periodicity,
        budget: r.budget,
        observation: r.observation,
      }));

    if (toSend.length === 0) {
      toast.error("No hay filas válidas para cargar");
      return;
    }

    setBulkUploading(true);
    try {
      const res = await fetch(`/api/plans/${id}/items/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: toSend }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`${data.created} ítems cargados correctamente`);
        if (data.failed?.length > 0) {
          toast.warning(`${data.failed.length} ítems fallaron al crear`);
        }
        setBulkOpen(false);
        setBulkRows([]);
        setBulkFileName("");
        await loadItems();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error al cargar ítems");
      }
    } catch {
      toast.error("Error al cargar ítems");
    } finally {
      setBulkUploading(false);
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

  async function syncItemAssignments(
    itemId: string,
    currentAssignments: { userId: string; category: ItemAssignmentCategory }[],
    desiredAssignments: { userId: string; category: ItemAssignmentCategory }[]
  ) {
    const currentByUserId = new Map(
      currentAssignments.map((a) => [a.userId, a.category])
    );
    const desiredByUserId = new Map(
      desiredAssignments.map((a) => [a.userId, a.category])
    );

    const toRemove = currentAssignments
      .filter((a) => !desiredByUserId.has(a.userId))
      .map((a) => a.userId);
    const toUpsert = desiredAssignments.filter(
      (a) => currentByUserId.get(a.userId) !== a.category
    );

    const responses = await Promise.all([
      ...toRemove.map((userId) =>
        fetch(`/api/plans/${id}/items/${itemId}/assign`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        })
      ),
      ...toUpsert.map(({ userId, category }) =>
        fetch(`/api/plans/${id}/items/${itemId}/assign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, category }),
        })
      ),
    ]);
    if (responses.some((res) => !res.ok)) {
      throw new Error("No se pudo sincronizar asignaciones del item");
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

  async function handleComplianceChange(planItemId: string, periodKey: string, status: PeriodComplianceStatus) {
    const res = await fetch(`/api/plans/${id}/period-compliance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planItemId, periodKey, status }),
    });
    if (res.ok) {
      const updated = await res.json() as PeriodCompliance;
      setComplianceRecords((prev) => {
        const exists = prev.some(
          (r) => r.planItemId === planItemId && r.periodKey === periodKey
        );
        if (exists) {
          return prev.map((r) =>
            r.planItemId === planItemId && r.periodKey === periodKey
              ? { ...r, status }
              : r
          );
        }
        return [...prev, updated];
      });
    } else {
      toast.error("Error al guardar cumplimiento");
    }
  }

  function autoResizeTextarea(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
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
            <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => document.getElementById("bulk-excel-input")?.click()}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Cargar Excel
            </Button>
            <input
              id="bulk-excel-input"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleBulkFileSelected}
            />
            <Dialog
                open={addItemOpen}
                onOpenChange={(open) => {
                  if (!open) {
                    setEditingItem(null);
                    setItemForm(EMPTY_ITEM_FORM);
                    setItemAssignments([]);
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
                    setItemAssignments([]);
                  } else if (open && !editingItem) {
                    setItemForm(EMPTY_ITEM_FORM);
                    setItemAssignments([]);
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
                      <select
                        id="subplan"
                        value={itemForm.subplan}
                        onChange={(e) =>
                          setItemForm({ ...itemForm, subplan: e.target.value })
                        }
                        required
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="" disabled>
                          Seleccionar subplan...
                        </option>
                        {SUBPLAN_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
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
                        <option value="Al finalizar la etapa de operación">Al finalizar la etapa de operación</option>
                        <option value="Anual">Anual</option>
                        <option value="Bianual">Bianual</option>
                        <option value="Diaria">Diaria</option>
                        <option value="En caso de suceder">En caso de suceder</option>
                        <option value="Mensual">Mensual</option>
                        <option value="Permanente">Permanente</option>
                        <option value="Semanal">Semanal</option>
                        <option value="Semestral">Semestral</option>
                        <option value="Trianual">Trianual</option>
                        <option value="Trimestral">Trimestral</option>
                        <option value="Única vez">Única vez</option>
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
                    <textarea
                      id="proposed_measure"
                      className="w-full min-h-[96px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden resize-none"
                      value={itemForm.proposed_measure}
                      onChange={(e) => {
                        autoResizeTextarea(e);
                        setItemForm({
                          ...itemForm,
                          proposed_measure: e.target.value,
                        });
                      }}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="indicator">Indicador</Label>
                    <textarea
                      id="indicator"
                      className="w-full min-h-[96px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden resize-none"
                      value={itemForm.indicator}
                      onChange={(e) => {
                        autoResizeTextarea(e);
                        setItemForm({ ...itemForm, indicator: e.target.value });
                      }}
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

                  <div className="space-y-2">
                    <Label>Asignar reporteros</Label>
                    {allReporters.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No hay reporteros disponibles para asignar.
                      </p>
                    ) : (
                      <div className="space-y-2 rounded-md border p-3 max-h-56 overflow-y-auto">
                        {allReporters.map((reporter) => {
                          const assignment = itemAssignments.find(
                            (a) => a.userId === reporter.id
                          );
                          const isChecked = Boolean(assignment);
                          return (
                            <div
                              key={reporter.id}
                              className="flex items-center justify-between gap-3"
                            >
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setItemAssignments((prev) => [
                                        ...prev,
                                        { userId: reporter.id, category: "Responsable" },
                                      ]);
                                    } else {
                                      setItemAssignments((prev) =>
                                        prev.filter((a) => a.userId !== reporter.id)
                                      );
                                    }
                                  }}
                                />
                                <span>
                                  {reporter.name}
                                  <span className="text-xs text-muted-foreground ml-1">
                                    ({reporter.email})
                                  </span>
                                </span>
                              </label>
                              {isChecked && (
                                <select
                                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  value={assignment?.category ?? "Responsable"}
                                  onChange={(e) =>
                                    setItemAssignments((prev) =>
                                      prev.map((a) =>
                                        a.userId === reporter.id
                                          ? {
                                              ...a,
                                              category: e.target
                                                .value as ItemAssignmentCategory,
                                            }
                                          : a
                                      )
                                    )
                                  }
                                >
                                  <option value="Responsable">Responsable</option>
                                  <option value="Colaborador">Colaborador</option>
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <Button type="submit" className="w-full" disabled={savingItem}>
                    {savingItem ? "Guardando..." : editingItem ? "Guardar cambios" : "Agregar Ítem"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            </div>
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
                                setItemAssignments(
                                  (pi.assignedUsers ?? []).map((a) => ({
                                    userId: a.userId,
                                    category: a.category,
                                  }))
                                );
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

        // Build evidence status lookup: "planItemId-YYYY-MM" → validationStatus
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

        // Build compliance lookup: "planItemId::periodKey" → status
        const complianceMap = new Map(
          complianceRecords.map((r) => [`${r.planItemId}::${r.periodKey}`, r.status])
        );

        const statusStyle: Record<"none" | EvidenceValidationStatus, { bg: string; color: string; border: string; label: string }> = {
          none:    { bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc", label: "" },
          pending: { bg: "#fef9c3", color: "#854d0e", border: "#fde047", label: "⏳" },
          invalid: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: "✕" },
          valid:   { bg: "#dcfce7", color: "#166534", border: "#86efac", label: "✓" },
        };

        const periodicityInterval: Record<string, number> = {
          "Al finalizar la etapa de operación": 9999,
          "En caso de suceder": 1,
          Diaria: 1,
          Semanal: 1,
          Mensual: 1,
          Bimensual: 2,
          Bianual: 24,
          Trimestral: 3,
          Trianual: 36,
          Semestral: 6,
          Anual: 12,
          Permanente: 1,
          "Única vez": 9999,
        };

        const periodicityLabel: Record<string, string> = {
          "Al finalizar la etapa de operación": "Fin",
          "En caso de suceder": "CS",
          Diaria: "D",
          Semanal: "Sem",
          Mensual: "M",
          Bimensual: "B",
          Bianual: "Bi",
          Trimestral: "T",
          Trianual: "3A",
          Semestral: "S",
          Anual: "A",
          Permanente: "P",
          "Única vez": "1x",
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

        // Period block helpers (based on plan's report_per)
        function getBlockSize(report_per: string | undefined): number {
          const s = (report_per ?? "").toLowerCase();
          if (s.startsWith("2")) return 24;
          if (s.startsWith("1")) return 12;
          return 6;
        }

        const blockSize = getBlockSize(p.report_per);
        const startYear = new Date(p.start_date || p.createdAt).getFullYear();
        const blockOrigin = new Date(startYear, 0, 1);

        function diffFromOrigin(month: Date): number {
          return (
            (month.getFullYear() - blockOrigin.getFullYear()) * 12 +
            (month.getMonth() - blockOrigin.getMonth())
          );
        }

        function isBlockEnd(month: Date): boolean {
          const mm = new Date(month.getFullYear(), month.getMonth(), 1);
          if (mm < blockOrigin) return false;
          return (diffFromOrigin(mm) + 1) % blockSize === 0;
        }

        function getPeriodLabel(blockEndMonth: Date): string {
          const diff = diffFromOrigin(new Date(blockEndMonth.getFullYear(), blockEndMonth.getMonth(), 1));
          const blockIndex = Math.floor(diff / blockSize);
          const blockStart = new Date(blockOrigin.getFullYear(), blockOrigin.getMonth() + blockIndex * blockSize, 1);
          const startLbl = blockStart.toLocaleString("es", { month: "short" });
          const endLbl = blockEndMonth.toLocaleString("es", { month: "short" });
          if (blockStart.getFullYear() !== blockEndMonth.getFullYear()) {
            return `${startLbl} ${blockStart.getFullYear()}-${endLbl} ${blockEndMonth.getFullYear()}`;
          }
          return `${startLbl}-${endLbl} ${blockEndMonth.getFullYear()}`;
        }

        // Build virtual column list: month columns + compliance columns at period ends
        type VCol =
          | { type: "month"; date: Date; year: number }
          | { type: "compliance"; periodKey: string; periodLabel: string; year: number };

        const vcols: VCol[] = [];
        for (const m of months) {
          vcols.push({ type: "month", date: m, year: m.getFullYear() });
          if (isBlockEnd(m)) {
            const lbl = getPeriodLabel(m);
            vcols.push({ type: "compliance", periodKey: lbl, periodLabel: lbl, year: m.getFullYear() });
          }
        }
        // If the last month is not a block-end, add a compliance column for the current in-progress period
        const lastMonth = months[months.length - 1];
        if (lastMonth && !isBlockEnd(lastMonth)) {
          const lbl = getPeriodLabel(lastMonth);
          vcols.push({ type: "compliance", periodKey: lbl, periodLabel: lbl, year: lastMonth.getFullYear() });
        }

        // Year header grouping
        const yearColCount = new Map<number, number>();
        for (const vc of vcols) {
          yearColCount.set(vc.year, (yearColCount.get(vc.year) ?? 0) + 1);
        }
        const yearHeaders = Array.from(yearColCount.entries())
          .sort(([a], [b]) => a - b)
          .map(([year, count]) => ({ year, count }));

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
                      {yearHeaders.map(({ year, count }) => (
                        <th
                          key={`y-${year}`}
                          colSpan={count}
                          className="border border-border px-2 py-1 text-center font-semibold bg-muted text-muted-foreground"
                        >
                          {year}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th className="sticky left-0 z-10 bg-background border border-border" />
                      {vcols.map((vc, i) => {
                        if (vc.type === "month") {
                          const isToday = vc.date.getTime() === todayMonth.getTime();
                          return (
                            <th
                              key={`h-${i}`}
                              className={`border border-border px-1 py-1 text-center font-medium min-w-[48px] ${
                                isToday
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted/50 text-muted-foreground"
                              }`}
                            >
                              {vc.date.toLocaleString("es", { month: "short" })}
                            </th>
                          );
                        }
                        return (
                          <th
                            key={`h-${i}`}
                            className="border-2 border-border bg-slate-50 px-1 py-1 text-center font-semibold text-slate-500 min-w-[72px]"
                            title={vc.periodLabel}
                          >
                            Cump.
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((pi, rowIdx) => (
                      <tr
                        key={pi.id}
                        className={rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"}
                      >
                        <td className="sticky left-0 z-10 border border-border px-3 py-1.5 font-medium truncate max-w-[200px] bg-inherit">
                          {pi.item}
                        </td>
                        {vcols.map((vc, i) => {
                          if (vc.type === "month") {
                            const m = vc.date;
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

                            const titleText =
                              evStatus === "valid"   ? `Válido — ${m.toLocaleString("es", { month: "long", year: "numeric" })}` :
                              evStatus === "invalid" ? `Rechazado — ${m.toLocaleString("es", { month: "long", year: "numeric" })}` :
                              evStatus === "pending" ? `Pendiente de aprobación — ${m.toLocaleString("es", { month: "long", year: "numeric" })}` :
                              isStart ? `Subir evidencia de inicio — ${planStartDate.toLocaleDateString("es")}` :
                              `Subir evidencia — ${m.toLocaleString("es", { month: "long", year: "numeric" })}`;

                            return (
                              <td
                                key={i}
                                className={`border border-border p-0.5${isToday ? " bg-primary/5" : ""}`}
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
                          }

                          // Compliance column
                          const compStatus = complianceMap.get(`${pi.id}::${vc.periodKey}`);
                          const compBg =
                            compStatus === "C"                          ? "#dcfce7" :
                            compStatus === "NC+" || compStatus === "NC-" ? "#fee2e2" :
                            compStatus === "N/A"                        ? "#fef9c3" :
                            "#f8fafc";
                          const compColor =
                            compStatus === "C"                          ? "#166534" :
                            compStatus === "NC+" || compStatus === "NC-" ? "#991b1b" :
                            compStatus === "N/A"                        ? "#854d0e" :
                            "#94a3b8";
                          const compBorder =
                            compStatus === "C"                          ? "#86efac" :
                            compStatus === "NC+" || compStatus === "NC-" ? "#fca5a5" :
                            compStatus === "N/A"                        ? "#fde047" :
                            "#e2e8f0";

                          return (
                            <td
                              key={i}
                              className="border-2 border-border p-0.5"
                            >
                              {isAdmin ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    className="w-full rounded flex items-center justify-center font-bold leading-none transition-opacity hover:opacity-75 bg-transparent border-0 cursor-pointer"
                                    style={{
                                      height: "24px",
                                      backgroundColor: compBg,
                                      color: compColor,
                                      fontSize: "10px",
                                      border: `1px solid ${compBorder}`,
                                    }}
                                    title={vc.periodLabel}
                                  >
                                    {compStatus ?? "—"}
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="center">
                                    <DropdownMenuItem onClick={() => handleComplianceChange(pi.id, vc.periodKey, "C")}>
                                      <span className="font-bold text-green-600 mr-2">C</span> Conforme
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleComplianceChange(pi.id, vc.periodKey, "NC+")}>
                                      <span className="font-bold text-red-600 mr-2">NC+</span> No conforme mayor
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleComplianceChange(pi.id, vc.periodKey, "NC-")}>
                                      <span className="font-bold text-red-600 mr-2">NC-</span> No conforme menor
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleComplianceChange(pi.id, vc.periodKey, "N/A")}>
                                      <span className="font-bold text-yellow-600 mr-2">N/A</span> No aplica
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : (
                                <div
                                  className="w-full rounded flex items-center justify-center font-bold leading-none"
                                  style={{
                                    height: "24px",
                                    backgroundColor: compBg,
                                    color: compColor,
                                    fontSize: "10px",
                                    border: `1px solid ${compBorder}`,
                                  }}
                                  title={vc.periodLabel}
                                >
                                  {compStatus ?? "—"}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
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
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-10 h-4 rounded border-2" style={{ backgroundColor: "#f8fafc", borderColor: "#e2e8f0" }} />
                  Columna de cumplimiento (C / NC+ / NC-)
                </span>
                <span className="ml-auto flex gap-3">
                  {([
                    "Al finalizar la etapa de operación",
                    "Anual",
                    "Bianual",
                    "Diaria",
                    "En caso de suceder",
                    "Mensual",
                    "Permanente",
                    "Semanal",
                    "Semestral",
                    "Trianual",
                    "Trimestral",
                    "Única vez",
                    "Bimensual",
                  ] as const).map((p) => (
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

      {/* Bulk Excel Preview Dialog */}
      <Dialog
        open={bulkOpen}
        onOpenChange={(open) => {
          setBulkOpen(open);
          if (!open) {
            setBulkRows([]);
            setBulkFileName("");
            setBulkParseError("");
            setApprovedWarningRows(new Set());
          }
        }}
      >
        <DialogContent className="w-[80vw] sm:w-[80vw] max-w-[80vw] sm:max-w-[80vw] h-[80vh] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Carga masiva de ítems</DialogTitle>
          </DialogHeader>
          {bulkParseError ? (
            <div className="p-4 border border-destructive/50 bg-destructive/10 rounded-md text-sm">
              <p className="font-semibold text-destructive">
                No se pudo procesar el archivo
              </p>
              <p className="text-muted-foreground mt-1">{bulkParseError}</p>
            </div>
          ) : (
            (() => {
              const existing = new Set(
                planItems.map((p) => p.item.trim().toLowerCase())
              );
              const withDupes = bulkRows.map((r) => ({
                row: r,
                duplicate: !!r.item && existing.has(r.item.trim().toLowerCase()),
              }));
              const validCount = withDupes.filter(
                (x) => x.row.errors.length === 0 && x.row.warnings.length === 0 && !x.duplicate
              ).length;
              const errorCount = withDupes.filter(
                (x) => x.row.errors.length > 0
              ).length;
              const warnCount = withDupes.filter(
                (x) =>
                  x.row.errors.length === 0 &&
                  (x.row.warnings.length > 0 || x.duplicate)
              ).length;
              const approvedCount = withDupes.filter(
                ({ row, duplicate }) =>
                  row.errors.length === 0 &&
                  (row.warnings.length > 0 || duplicate) &&
                  approvedWarningRows.has(row.rowNumber)
              ).length;
              const toCreateCount = validCount + approvedCount;

              return (
                <div className="flex flex-col gap-4 mt-2 flex-1 min-h-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">
                      Archivo: <span className="font-mono">{bulkFileName}</span>
                    </span>
                    <Badge className="bg-green-600 hover:bg-green-600">
                      {validCount} válidas
                    </Badge>
                    {warnCount > 0 && (
                      <Badge className="bg-amber-500 hover:bg-amber-500">
                        {warnCount} con advertencia
                      </Badge>
                    )}
                    {approvedCount > 0 && (
                      <Badge className="bg-blue-600 hover:bg-blue-600">
                        {approvedCount} aprobadas
                      </Badge>
                    )}
                    {errorCount > 0 && (
                      <Badge variant="destructive">{errorCount} con error</Badge>
                    )}
                  </div>

                  <div className="border rounded-md flex-1 min-h-0 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Ítem</TableHead>
                          <TableHead>Subplan</TableHead>
                          <TableHead>Actividad</TableHead>
                          <TableHead>Impacto</TableHead>
                          <TableHead>Medida</TableHead>
                          <TableHead>Indicador</TableHead>
                          <TableHead>Verificación</TableHead>
                          <TableHead>Periodicidad</TableHead>
                          <TableHead className="text-right">
                            Presupuesto
                          </TableHead>
                          <TableHead>Estado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {withDupes.map(({ row, duplicate }) => {
                          const hasError = row.errors.length > 0;
                          const hasWarn = row.warnings.length > 0 || duplicate;
                          return (
                            <TableRow
                              key={row.rowNumber}
                              className={
                                hasError
                                  ? "bg-destructive/5"
                                  : hasWarn
                                  ? "bg-amber-500/5"
                                  : ""
                              }
                            >
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {row.rowNumber}
                              </TableCell>
                              <TableCell className="max-w-[140px] truncate" title={row.item}>
                                {row.item || (
                                  <span className="text-muted-foreground italic">
                                    vacío
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="max-w-[160px] truncate" title={row.subplan}>
                                {row.subplan || (
                                  <span className="text-muted-foreground italic">
                                    —
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="max-w-[160px] truncate" title={row.environmental_activity}>
                                {row.environmental_activity}
                              </TableCell>
                              <TableCell className="max-w-[160px] truncate" title={row.identified_environmental_impact}>
                                {row.identified_environmental_impact}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate" title={row.proposed_measure}>
                                {row.proposed_measure}
                              </TableCell>
                              <TableCell className="max-w-[160px] truncate" title={row.indicator}>
                                {row.indicator}
                              </TableCell>
                              <TableCell className="max-w-[160px] truncate" title={row.verification_method}>
                                {row.verification_method}
                              </TableCell>
                              <TableCell>
                                {row.periodicity || (
                                  <span className="text-muted-foreground italic">
                                    —
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                ${row.budget.toFixed(2)}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  {hasError ? (
                                    <Badge variant="destructive" className="w-fit">
                                      <XCircle className="w-3 h-3 mr-1" />
                                      Error
                                    </Badge>
                                  ) : hasWarn ? (
                                    <div className="flex flex-col gap-1">
                                      {approvedWarningRows.has(row.rowNumber) ? (
                                        <Badge className="bg-blue-600 hover:bg-blue-600 w-fit">
                                          <CheckCircle2 className="w-3 h-3 mr-1" />
                                          Aprobada
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-amber-500 hover:bg-amber-500 w-fit">
                                          <AlertTriangle className="w-3 h-3 mr-1" />
                                          Advertencia
                                        </Badge>
                                      )}
                                      <button
                                        className={`text-xs font-medium underline w-fit ${
                                          approvedWarningRows.has(row.rowNumber)
                                            ? "text-muted-foreground"
                                            : "text-blue-600"
                                        }`}
                                        onClick={() =>
                                          setApprovedWarningRows((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(row.rowNumber)) {
                                              next.delete(row.rowNumber);
                                            } else {
                                              next.add(row.rowNumber);
                                            }
                                            return next;
                                          })
                                        }
                                      >
                                        {approvedWarningRows.has(row.rowNumber) ? "Quitar aprobación" : "Aprobar"}
                                      </button>
                                    </div>
                                  ) : (
                                    <Badge className="bg-green-600 hover:bg-green-600 w-fit">
                                      <CheckCircle2 className="w-3 h-3 mr-1" />
                                      Válida
                                    </Badge>
                                  )}
                                  {row.errors.map((e, i) => (
                                    <span
                                      key={`e-${i}`}
                                      className="text-xs text-destructive"
                                    >
                                      {e}
                                    </span>
                                  ))}
                                  {row.warnings.map((w, i) => (
                                    <span
                                      key={`w-${i}`}
                                      className="text-xs text-amber-600"
                                    >
                                      {w}
                                    </span>
                                  ))}
                                  {duplicate && (
                                    <span className="text-xs text-amber-600">
                                      Ya existe un ítem con este código en el plan
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => setBulkOpen(false)}
                      disabled={bulkUploading}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleBulkSubmit}
                      disabled={bulkUploading || toCreateCount === 0 || errorCount > 0}
                    >
                      {bulkUploading
                        ? "Cargando..."
                        : `Crear ${toCreateCount} ítem${toCreateCount === 1 ? "" : "s"}`}
                    </Button>
                  </div>
                </div>
              );
            })()
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
