"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useParams, useSearchParams } from "next/navigation";
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
import { Upload, ExternalLink, Trash2, Plus, Users, CheckCircle2, AlertTriangle, XCircle, Pencil, Download, FileSpreadsheet, OctagonAlert } from "lucide-react";
import { toast } from "sonner";
import { Plan, Evidence, User, PlanItem, ItemAssignmentCategory, EvidenceValidationStatus, MonthlyGeneration } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parseExcelFile, ParsedItemRow } from "@/lib/excelImport";
import { parseDateOnly } from "@/lib/dateOnly";

interface RgdtCatalogEntry {
  codigo: string;
  descripcion: string;
  crtib: string;
}

const EMPTY_ITEM_FORM = {
  wasteCode: "",
  wasteName: "",
  wasteDescription: "",
  crtib: "",
  annualGenerationKg: "",
  generationOrigin: "",
  selfManagement: false,
};

function normalizeCatalogValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isViewer = session?.user?.role === "VIEWER";
  const deepLinkEvidenceId = searchParams.get("evidenceId");

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
  const [monthlyGenerationRecords, setMonthlyGenerationRecords] = useState<MonthlyGeneration[]>([]);
  const [highlightEvidenceId, setHighlightEvidenceId] = useState<string | null>(null);
  const [deletePlanOpen, setDeletePlanOpen] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [catalogEntries, setCatalogEntries] = useState<RgdtCatalogEntry[]>([]);
  const [draftGenerationInputs, setDraftGenerationInputs] = useState<Record<string, string>>({});

  const loadPlan = useCallback(async () => {
    const res = await fetch(`/pg/api/plans/${id}`);
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
    const res = await fetch(`/pg/api/plans/${id}/items`);
    if (res.ok) setPlanItems(await res.json());
  }, [id]);

  const loadMonthlyGeneration = useCallback(async () => {
    const res = await fetch(`/pg/api/plans/${id}/monthly-generation`);
    if (res.ok) setMonthlyGenerationRecords(await res.json());
  }, [id]);

  useEffect(() => {
    loadPlan();
    loadItems();
    loadMonthlyGeneration();
  }, [loadPlan, loadItems, loadMonthlyGeneration]);

  useEffect(() => {
    if (isAdmin) {
      fetch("/pg/api/users")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setAllReporters(data.filter((u: User) => u.role === "REPORTER"));
            setAllViewers(data.filter((u: User) => u.role === "VIEWER"));
          }
        });
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/pg/api/waste-catalog")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCatalogEntries(data);
        } else {
          setCatalogEntries([]);
        }
      })
      .catch(() => {
        setCatalogEntries([]);
        toast.error("No se pudo cargar el catálogo de residuos RGDT");
      });
  }, [isAdmin]);

  useEffect(() => {
    if (!deepLinkEvidenceId || evidences.length === 0) return;
    if (!evidences.some((evidence) => evidence.id === deepLinkEvidenceId)) return;

    setHighlightEvidenceId(deepLinkEvidenceId);
    const scrollTimeout = window.setTimeout(() => {
      const row = document.querySelector(
        `[data-evidence-id="${deepLinkEvidenceId}"]`
      );
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const clearTimeoutId = window.setTimeout(() => {
      setHighlightEvidenceId((current) =>
        current === deepLinkEvidenceId ? null : current
      );
    }, 5000);

    return () => {
      window.clearTimeout(scrollTimeout);
      window.clearTimeout(clearTimeoutId);
    };
  }, [deepLinkEvidenceId, evidences]);

  async function handleDeletePlan() {
    setDeletingPlan(true);
    try {
      const res = await fetch(`/pg/api/plans/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Proyecto eliminado correctamente");
        window.location.assign("/pg/plans");
      } else {
        const data = await res.json();
        toast.error(data.error || "Error al eliminar el proyecto");
      }
    } finally {
      setDeletingPlan(false);
      setDeletePlanOpen(false);
    }
  }

  async function handleAssignViewer(viewerId: string) {
    const res = await fetch(`/pg/api/plans/${id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: viewerId }),
    });
    if (res.ok) {
      setAssignedViewerIds((prev) => [...prev, viewerId]);
      toast.success("Visualizador asignado al proyecto");
    } else {
      toast.error("Error al asignar visualizador");
    }
  }

  async function handleUnassignViewer(viewerId: string) {
    const res = await fetch(`/pg/api/plans/${id}/assign`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: viewerId }),
    });
    if (res.ok) {
      setAssignedViewerIds((prev) => prev.filter((vid) => vid !== viewerId));
      toast.success("Visualizador desasignado del proyecto");
    } else {
      toast.error("Error al desasignar visualizador");
    }
  }

  async function handleValidationChange(
    evidenceId: string,
    status: EvidenceValidationStatus,
    validationComment?: string
  ) {
    const res = await fetch(`/pg/api/evidences?id=${evidenceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        validationStatus: status,
        ...(status === "invalid"
          ? { validationComment: validationComment?.trim() ?? "" }
          : {}),
      }),
    });

    if (res.ok) {
      setEvidences((prev) =>
        prev.map((ev) =>
          ev.id === evidenceId
            ? {
                ...ev,
                validationStatus: status,
                validationComment:
                  status === "invalid" ? validationComment?.trim() ?? "" : "",
              }
            : ev
        )
      );
      toast.success("Validación actualizada");
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Error al actualizar validación");
    }
  }

  async function handleDeleteEvidence(evidenceId: string) {
    if (!confirm("¿Eliminar esta evidencia?")) return;
    const res = await fetch(`/pg/api/evidences?id=${evidenceId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      toast.success("Evidencia eliminada");
      loadPlan();
    } else {
      toast.error("Error al eliminar");
    }
  }

  const findExactCatalogMatch = useCallback(
    (values: { wasteCode: string; wasteName: string; crtib: string }) => {
      const code = normalizeCatalogValue(values.wasteCode);
      const name = normalizeCatalogValue(values.wasteName);
      const crtib = normalizeCatalogValue(values.crtib);
      if (!code || !name || !crtib) return null;

      return (
        catalogEntries.find(
          (entry) =>
            normalizeCatalogValue(entry.codigo) === code &&
            normalizeCatalogValue(entry.descripcion) === name &&
            normalizeCatalogValue(entry.crtib) === crtib
        ) ?? null
      );
    },
    [catalogEntries]
  );

  function applyCatalogEntry(entry: RgdtCatalogEntry) {
    setItemForm((prev) => ({
      ...prev,
      wasteCode: entry.codigo,
      wasteName: entry.descripcion,
      crtib: entry.crtib,
    }));
  }

  const filteredCodeOptions = useMemo(() => {
    const q = normalizeCatalogValue(itemForm.wasteCode);
    return catalogEntries
      .filter((e) => (q ? normalizeCatalogValue(e.codigo).includes(q) : true))
      .slice(0, 30);
  }, [catalogEntries, itemForm.wasteCode]);

  const filteredNameOptions = useMemo(() => {
    const q = normalizeCatalogValue(itemForm.wasteName);
    return catalogEntries
      .filter((e) =>
        q ? normalizeCatalogValue(e.descripcion).includes(q) : true
      )
      .slice(0, 30);
  }, [catalogEntries, itemForm.wasteName]);

  const filteredCrtibOptions = useMemo(() => {
    const q = normalizeCatalogValue(itemForm.crtib);
    return catalogEntries
      .filter((e) => (q ? normalizeCatalogValue(e.crtib).includes(q) : true))
      .slice(0, 30);
  }, [catalogEntries, itemForm.crtib]);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    const annualGenerationKg = Number(itemForm.annualGenerationKg);
    if (!Number.isFinite(annualGenerationKg) || annualGenerationKg < 0) {
      toast.error("Generación anual (kg) debe ser un número válido");
      return;
    }

    const exactMatch = findExactCatalogMatch({
      wasteCode: itemForm.wasteCode,
      wasteName: itemForm.wasteName,
      crtib: itemForm.crtib,
    });
    if (!exactMatch) {
      toast.error("Código, Nombre y CRTIB deben coincidir con el catálogo RGDT");
      return;
    }

    const payload = {
      wasteCode: exactMatch.codigo,
      wasteName: exactMatch.descripcion,
      wasteDescription: itemForm.wasteDescription.trim(),
      crtib: exactMatch.crtib,
      annualGenerationKg,
      generationOrigin: itemForm.generationOrigin.trim(),
      selfManagement: itemForm.selfManagement,
    };

    setSavingItem(true);
    try {
      if (editingItem) {
        const res = await fetch(`/pg/api/plans/${id}/items/${editingItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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

      const res = await fetch(`/pg/api/plans/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        direccion: r.direccion,
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
      const res = await fetch(`/pg/api/plans/${id}/items/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: toSend }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`${data.created} Items cargados correctamente`);
        if (data.failed?.length > 0) {
          toast.warning(`${data.failed.length} Items fallaron al crear`);
        }
        setBulkOpen(false);
        setBulkRows([]);
        setBulkFileName("");
        await loadItems();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error al cargar Items");
      }
    } catch {
      toast.error("Error al cargar Items");
    } finally {
      setBulkUploading(false);
    }
  }

  async function handleAssignToItem(userId: string, category: ItemAssignmentCategory) {
    if (!selectedItem) return;
    const res = await fetch(`/pg/api/plans/${id}/items/${selectedItem.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, category }),
    });
    if (res.ok) {
      toast.success("Reportero asignado al Item");
      setPendingAssign(null);
      const updated = await fetch(`/pg/api/plans/${id}/items`);
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
    const res = await fetch(`/pg/api/plans/${id}/items/${selectedItem.id}/assign`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      toast.success("Reportero desasignado del Item");
      const updated = await fetch(`/pg/api/plans/${id}/items`);
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
        fetch(`/pg/api/plans/${id}/items/${itemId}/assign`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        })
      ),
      ...toUpsert.map(({ userId, category }) =>
        fetch(`/pg/api/plans/${id}/items/${itemId}/assign`, {
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

    const res = await fetch("/pg/api/upload", { method: "POST", body: formData });
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
      const res = await fetch(`/pg/api/download/item-period?${params}`);
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
    if (!confirm("¿Eliminar este Item?")) return;

    const res = await fetch(`/pg/api/plans/${id}/items/${itemId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      toast.success("Item eliminado");
      loadItems();
    } else {
      toast.error("Error al eliminar Item");
    }
  }

  async function handleSaveObservation() {
    if (!obsItem) return;
    setSavingObs(true);
    const res = await fetch(`/pg/api/plans/${id}/items/${obsItem.id}`, {
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

  async function handleMonthlyGenerationChange(
    planItemId: string,
    periodKey: string,
    generationKg: number
  ): Promise<boolean> {
    const res = await fetch(`/pg/api/plans/${id}/monthly-generation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planItemId, periodKey, generationKg }),
    });
    if (res.ok) {
      const updated = (await res.json()) as MonthlyGeneration;
      setMonthlyGenerationRecords((prev) => {
        const exists = prev.some(
          (r) => r.planItemId === planItemId && r.periodKey === periodKey
        );
        if (exists) {
          return prev.map((r) =>
            r.planItemId === planItemId && r.periodKey === periodKey
              ? { ...r, generationKg }
              : r
          );
        }
        return [...prev, updated];
      });
      return true;
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Error al guardar generación mensual");
      return false;
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
      {/* Project Header */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{plan.title}</h1>
            {isViewer && (
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                Solo lectura
              </span>
            )}
          </div>
          {isAdmin && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeletePlanOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Eliminar Proyecto
            </Button>
          )}
        </div>
        <p className="text-muted-foreground mt-1">
          {plan.description || "Sin descripción"}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Creado el {new Date(plan.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Viewers assigned to this project (admin only) */}
      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Visualizadores del proyecto ({assignedViewerIds.filter(id => allViewers.some(v => v.id === id)).length})
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => setAssignViewerOpen(true)}>
              <Users className="w-4 h-4 mr-2" />
              Gestionar Visualizadores
            </Button>
          </CardHeader>
          <CardContent>
            {assignedViewerIds.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Sin visualizadores asignados. Agrega uno para que pueda ver este proyecto.
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

      {/* Project Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Items del proyecto ({visibleItems.length})
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
                  } else if (open && !editingItem) {
                    setItemForm(EMPTY_ITEM_FORM);
                    setItemAssignments([]);
                  }
                  setAddItemOpen(open);
                }}
              >
              <DialogTrigger render={<Button size="sm" />}>
                <Plus className="w-4 h-4 mr-2" />
                Agregar Item
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingItem ? "Editar Item" : "Agregar Item al Proyecto"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleAddItem} className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="wasteCode">Código del residuo o desecho</Label>
                      <Input
                        id="wasteCode"
                        list="rgdt-code-options"
                        value={itemForm.wasteCode}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          const matched = catalogEntries.find(
                            (entry) =>
                              normalizeCatalogValue(entry.codigo) ===
                              normalizeCatalogValue(nextValue)
                          );
                          if (matched) {
                            applyCatalogEntry(matched);
                          } else {
                            setItemForm((prev) => ({ ...prev, wasteCode: nextValue }));
                          }
                        }}
                        required
                      />
                      <datalist id="rgdt-code-options">
                        {filteredCodeOptions.map((entry) => (
                          <option key={`${entry.codigo}-${entry.descripcion}`} value={entry.codigo}>
                            {entry.descripcion} ({entry.crtib})
                          </option>
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="wasteName">Nombre del residuo o desecho</Label>
                      <Input
                        id="wasteName"
                        list="rgdt-name-options"
                        value={itemForm.wasteName}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          const matched = catalogEntries.find(
                            (entry) =>
                              normalizeCatalogValue(entry.descripcion) ===
                              normalizeCatalogValue(nextValue)
                          );
                          if (matched) {
                            applyCatalogEntry(matched);
                          } else {
                            setItemForm((prev) => ({ ...prev, wasteName: nextValue }));
                          }
                        }}
                        required
                      />
                      <datalist id="rgdt-name-options">
                        {filteredNameOptions.map((entry) => (
                          <option key={`${entry.codigo}-${entry.crtib}`} value={entry.descripcion}>
                            {entry.codigo} ({entry.crtib})
                          </option>
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="crtib">CRTIB</Label>
                      <Input
                        id="crtib"
                        list="rgdt-crtib-options"
                        value={itemForm.crtib}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          const matched = catalogEntries.find(
                            (entry) =>
                              normalizeCatalogValue(entry.crtib) ===
                              normalizeCatalogValue(nextValue)
                          );
                          if (matched) {
                            applyCatalogEntry(matched);
                          } else {
                            setItemForm((prev) => ({ ...prev, crtib: nextValue }));
                          }
                        }}
                        required
                      />
                      <datalist id="rgdt-crtib-options">
                        {filteredCrtibOptions.map((entry) => (
                          <option key={`${entry.codigo}-${entry.descripcion}`} value={entry.crtib}>
                            {entry.codigo} - {entry.descripcion}
                          </option>
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="annualGenerationKg">Generación anual (kg)</Label>
                      <Input
                        id="annualGenerationKg"
                        type="number"
                        min="0"
                        step="0.01"
                        value={itemForm.annualGenerationKg}
                        onChange={(e) =>
                          setItemForm((prev) => ({
                            ...prev,
                            annualGenerationKg: e.target.value,
                          }))
                        }
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="generationOrigin">Origen de la generación</Label>
                    <Input
                      id="generationOrigin"
                      value={itemForm.generationOrigin}
                      onChange={(e) =>
                        setItemForm((prev) => ({
                          ...prev,
                          generationOrigin: e.target.value,
                        }))
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="wasteDescription">Descripción del residuo o desecho (opcional)</Label>
                    <textarea
                      id="wasteDescription"
                      className="w-full min-h-[96px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden resize-none"
                      value={itemForm.wasteDescription}
                      onChange={(e) => {
                        autoResizeTextarea(e);
                        setItemForm((prev) => ({
                          ...prev,
                          wasteDescription: e.target.value,
                        }));
                      }}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="inline-flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={itemForm.selfManagement}
                        onChange={(e) =>
                          setItemForm((prev) => ({
                            ...prev,
                            selfManagement: e.target.checked,
                          }))
                        }
                      />
                      Gestión propia
                    </label>
                  </div>
                  {catalogEntries.length === 0 && (
                    <p className="text-sm text-destructive">
                      No hay catálogo RGDT cargado. Verifica `public/data/rgdt-residuos.xlsx|xls|csv`.
                    </p>
                  )}

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
                    {savingItem ? "Guardando..." : editingItem ? "Guardar cambios" : "Agregar Item"}
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
              Sin Items aún.{" "}
              {isAdmin && "Usa el botón \"Agregar Item\" para comenzar."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>CRTIB</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Generación anual (kg)</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead>Gestión propia</TableHead>
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
                        {pi.wasteCode ?? pi.item}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate" title={pi.wasteName ?? pi.environmental_activity}>
                        {pi.wasteName ?? pi.environmental_activity}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {pi.crtib ?? pi.indicator}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate" title={pi.wasteDescription ?? ""}>
                        {pi.wasteDescription || (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {typeof pi.annualGenerationKg === "number"
                          ? pi.annualGenerationKg.toLocaleString("en-US")
                          : "—"}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate" title={pi.generationOrigin ?? pi.direccion ?? ""}>
                        {pi.generationOrigin ?? pi.direccion ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {pi.selfManagement ? "Sí" : "No"}
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
                              title="Editar Item"
                              onClick={() => {
                                setEditingItem(pi);
                                setItemForm({
                                  wasteCode: pi.wasteCode ?? pi.item,
                                  wasteName: pi.wasteName ?? pi.environmental_activity,
                                  wasteDescription:
                                    pi.wasteDescription ??
                                    (pi.identified_environmental_impact === "-"
                                      ? ""
                                      : pi.identified_environmental_impact),
                                  crtib: pi.crtib ?? pi.indicator,
                                  annualGenerationKg:
                                    typeof pi.annualGenerationKg === "number"
                                      ? String(pi.annualGenerationKg)
                                      : "",
                                  generationOrigin:
                                    pi.generationOrigin ?? pi.direccion ?? "",
                                  selfManagement: Boolean(pi.selfManagement),
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

        // // Build evidence status lookup: "planItemId-YYYY-MM" -> validationStatus
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

        // Build monthly generation lookup: "planItemId::YYYY-MM" -> kg
        const monthlyGenerationMap = new Map(
          monthlyGenerationRecords.map((r) => [`${r.planItemId}::${r.periodKey}`, r.generationKg])
        );
        const itemGenerationTotals = monthlyGenerationRecords.reduce<Record<string, number>>(
          (acc, record) => {
            acc[record.planItemId] = (acc[record.planItemId] ?? 0) + (record.generationKg ?? 0);
            return acc;
          },
          {}
        );

        const statusStyle: Record<"none" | EvidenceValidationStatus, { bg: string; color: string; border: string; label: string }> = {
          none:    { bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc", label: "" },
          pending: { bg: "#fef9c3", color: "#854d0e", border: "#fde047", label: "⏳" },
          invalid: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: "✕" },
          valid:   { bg: "#dcfce7", color: "#166534", border: "#86efac", label: "✓“" },
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

        const planStart = parseDateOnly(p.start_date) ?? new Date(p.createdAt);
        const rangeStart = new Date(planStart.getFullYear(), planStart.getMonth(), 1);
        const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 2, 1);

        const months: Date[] = [];
        const cur = new Date(rangeStart);
        while (cur < rangeEnd) {
          months.push(new Date(cur));
          cur.setMonth(cur.getMonth() + 1);
        }

        function isActive(pi: PlanItem, month: Date): boolean {
          const s = parseDateOnly(p.start_date) ?? new Date(p.createdAt);
          const sm = new Date(s.getFullYear(), s.getMonth(), 1);
          const mm = new Date(month.getFullYear(), month.getMonth(), 1);
          if (mm < sm) return false;
          const diff =
            (mm.getFullYear() - sm.getFullYear()) * 12 +
            (mm.getMonth() - sm.getMonth());
          const interval = periodicityInterval[pi.periodicity] ?? 1;
          return diff % interval === 0;
        }

        // Build virtual column list: month columns + monthly generation columns
        type VCol =
          | { type: "month"; date: Date; year: number }
          | { type: "generation"; periodKey: string; periodLabel: string; year: number };

        const vcols: VCol[] = [];
        for (const m of months) {
          const periodKey = toMonthKey(m);
          const periodLabel = m.toLocaleString("es", { month: "long", year: "numeric" });
          vcols.push({ type: "month", date: m, year: m.getFullYear() });
          vcols.push({ type: "generation", periodKey, periodLabel, year: m.getFullYear() });
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
                        Item
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
                            Gen. kg
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
                          <div className="truncate">{pi.item}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {(itemGenerationTotals[pi.id] ?? 0).toLocaleString("en-US")} /{" "}
                            {Number(pi.annualGenerationKg ?? 0).toLocaleString("en-US")} kg
                          </div>
                        </td>
                        {vcols.map((vc, i) => {
                          if (vc.type === "month") {
                            const m = vc.date;
                            const active = isActive(pi, m);
                            const planStartDate = parseDateOnly(p.start_date) ?? new Date(p.createdAt);
                            const isStart =
                              planStartDate.getFullYear() === m.getFullYear() &&
                              planStartDate.getMonth() === m.getMonth();
                            const isToday = m.getTime() === todayMonth.getTime();
                            const periodicLabel = periodicityLabel[pi.periodicity] ?? "";
                            const monthKey = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
                            const evStatus = evidenceMonthStatus.get(`${pi.id}-${monthKey}`) ?? "none";
                            const style = statusStyle[evStatus];

                            const titleText =
                              evStatus === "valid"   ? `Válido "” ${m.toLocaleString("es", { month: "long", year: "numeric" })}` :
                              evStatus === "invalid" ? `Rechazado "” ${m.toLocaleString("es", { month: "long", year: "numeric" })}` :
                              evStatus === "pending" ? `Pendiente de aprobación "” ${m.toLocaleString("es", { month: "long", year: "numeric" })}` :
                              isStart ? `Subir evidencia de inicio "” ${planStartDate.toLocaleDateString("es")}` :
                              `Subir evidencia "” ${m.toLocaleString("es", { month: "long", year: "numeric" })}`;

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

                          // Monthly generation column
                          const generationKgRaw = monthlyGenerationMap.get(`${pi.id}::${vc.periodKey}`);
                          const generationKg =
                            typeof generationKgRaw === "number" && Number.isFinite(generationKgRaw)
                              ? generationKgRaw
                              : undefined;
                          const generationCellKey = `${pi.id}::${vc.periodKey}`;
                          const generationDisplay =
                            generationKg === undefined ? "" : String(generationKg);
                          const generationInputValue =
                            draftGenerationInputs[generationCellKey] ?? generationDisplay;

                          return (
                            <td
                              key={i}
                              className="border-2 border-border p-0.5"
                            >
                              {isAdmin ? (
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="h-7 text-[10px] px-1 text-right"
                                  value={generationInputValue}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const nextRaw = e.target.value;
                                    setDraftGenerationInputs((prev) => ({
                                      ...prev,
                                      [generationCellKey]: nextRaw,
                                    }));
                                  }}
                                  onBlur={async (e) => {
                                    const raw = e.target.value.trim();
                                    const nextValue = raw === "" ? 0 : Number(raw);
                                    if (!Number.isFinite(nextValue) || nextValue < 0) {
                                      toast.error("Generación mensual inválida");
                                      return;
                                    }
                                    if (generationKg !== undefined && nextValue === generationKg) {
                                      setDraftGenerationInputs((prev) => {
                                        const next = { ...prev };
                                        delete next[generationCellKey];
                                        return next;
                                      });
                                      return;
                                    }
                                    const ok = await handleMonthlyGenerationChange(
                                      pi.id,
                                      vc.periodKey,
                                      nextValue
                                    );
                                    if (ok) {
                                      setDraftGenerationInputs((prev) => {
                                        const next = { ...prev };
                                        delete next[generationCellKey];
                                        return next;
                                      });
                                    }
                                  }}
                                  title={vc.periodLabel}
                                />
                              ) : (
                                <div
                                  className="w-full rounded flex items-center justify-end font-semibold leading-none px-1"
                                  style={{ height: "24px", fontSize: "10px" }}
                                  title={vc.periodLabel}
                                >
                                  {generationKg === undefined ? "—" : generationKg.toLocaleString("en-US")}
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
                  Columna de generación mensual (kg)
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

      {/* Assign viewers to project dialog */}
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
            <DialogTitle>Reporteros - {selectedItem?.item}</DialogTitle>
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
                {" Â· "}
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
            <DialogTitle>Observación - {obsItem?.item}</DialogTitle>
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
                  <TableHead>Mes-AÍ±o</TableHead>
                  <TableHead>Archivo</TableHead>
                  <TableHead>Subido por</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="w-[80px]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleEvidences.map((ev) => (
                  <TableRow
                    key={ev.id}
                    data-evidence-id={ev.id}
                    className={
                      highlightEvidenceId === ev.id
                        ? "bg-blue-50/70 outline outline-1 outline-blue-200"
                        : undefined
                    }
                  >
                    <TableCell>
                      {isAdmin ? (
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
                            <DropdownMenuItem
                              onClick={() => {
                                const reason = window.prompt("Ingresa el motivo del rechazo");
                                if (!reason || !reason.trim()) {
                                  toast.error("El motivo es obligatorio para rechazar");
                                  return;
                                }
                                void handleValidationChange(ev.id, "invalid", reason.trim());
                              }}
                            >
                              <XCircle className="w-4 h-4 text-red-500 mr-2" /> No válido
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
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
        function getAvailablePeriods(): { key: string; label: string }[] {
          const planStart = parseDateOnly(p.start_date) ?? new Date(p.createdAt);
          const startMonth = new Date(planStart.getFullYear(), planStart.getMonth(), 1);
          const today = new Date();
          const todayMonth = new Date(today.getFullYear(), today.getMonth(), 1);

          const periods: { key: string; label: string }[] = [];
          const cur = new Date(startMonth);
          while (cur <= todayMonth) {
            const key = toMonthKey(cur);
            const label = cur.toLocaleString("es", { month: "short", year: "numeric" });
            periods.push({ key, label });
            cur.setMonth(cur.getMonth() + 1);
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
                      <TableHead>Item</TableHead>
                      <TableHead>Anexos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleItems.map((pi) => {
                      const periods = getAvailablePeriods();
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
            <DialogTitle>Carga masiva de Items</DialogTitle>
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
                          <TableHead>Item</TableHead>
                          <TableHead>Subplan</TableHead>
                          <TableHead>Dirección</TableHead>
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
                                    -
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="max-w-[160px] truncate" title={row.direccion}>
                                {row.direccion || (
                                  <span className="text-muted-foreground italic">
                                    -
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
                                    -
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
                                      Ya existe un Item con este código en el proyecto
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
                        : `Crear ${toCreateCount} Item${toCreateCount === 1 ? "" : "s"}`}
                    </Button>
                  </div>
                </div>
              );
            })()
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Project Confirmation Dialog */}
      <Dialog open={deletePlanOpen} onOpenChange={setDeletePlanOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <OctagonAlert className="w-5 h-5" />
              Eliminar Proyecto permanentemente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Esta acción es <strong>irreversible</strong>. Se eliminará todo lo relacionado con este Proyecto:
            </p>
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>Todos los Items del proyecto</li>
              <li>Todas las evidencias y archivos en Google Drive</li>
              <li>Registros de cumplimiento por período</li>
              <li>Todas las asignaciones de usuarios a los Items</li>
              <li>Notificaciones relacionadas al proyecto</li>
            </ul>
            <p className="text-sm font-medium">
              Los usuarios no serán eliminados.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setDeletePlanOpen(false)}
              disabled={deletingPlan}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeletePlan}
              disabled={deletingPlan}
            >
              {deletingPlan ? "Eliminando..." : "Sí, Eliminar Proyecto"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
