"use client";

import {
  api,
  ApiError,
  apiErrorMessage,
  checkedApiFetch,
  requireOkReceipt,
  requirePersistedAsset,
  requirePersistedEntity,
} from "@/lib/api-client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { useParams, useSearchParams, useRouter } from "next/navigation";
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
import {
  Plan,
  PmaEvidence,
  User,
  PlanItem,
  ItemAssignmentCategory,
  EvidenceValidationStatus,
  EvidenceType,
  EVIDENCE_TYPE_VALUES,
  PeriodCompliance,
  PeriodComplianceStatus,
  Finding,
  FindingComponent,
} from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUBPLAN_OPTIONS, PERIODICITY_OPTIONS, DIRECCION_OPTIONS } from "@/lib/planItemConstants";
import { parseExcelFile, ParsedItemRow } from "@/lib/excelImport";
import {
  createPeriodHelpers,
  getBusinessMonth,
  getItemRanges,
  getPlanStartDate,
  type ItemRange,
} from "@/lib/planPeriods";

const EMPTY_ITEM_FORM = {
  item: "",
  subplan: "",
  direccion: "",
  environmental_activity: "",
  identified_environmental_impact: "",
  proposed_measure: "",
  indicator: "",
  verification_method: "",
  periodicity: "",
  budget: "",
  report_per: "6 meses",
};

const FINDING_COMPONENT_OPTIONS: FindingComponent[] = [
  "LEGAL",
  "OPERACIONAL",
  "AMBIENTAL",
];

const EMPTY_FINDING_FORM = {
  component: "LEGAL" as FindingComponent,
  nudosCriticos: "",
  alarmas: "",
  riesgos: "",
  propuestasSolucion: "",
};

function emptyManualEvidenceForm() {
  const businessMonth = getBusinessMonth();
  return {
    itemId: "",
    year: businessMonth.getFullYear(),
    month: businessMonth.getMonth() + 1,
    description: "",
    evidenceType: "" as EvidenceType | "",
  };
}

export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { user: session} = useAuth();
  const router = useRouter();
  const isAdmin = session?.role === "ADMIN";
  const isViewer = session?.role === "VIEWER";
  const isReporter = session?.role === "REPORTER";
  // VIEWERs may edit and review an assigned plan, but uploads belong to
  // ADMIN/REPORTER and destructive plan/item/finding actions remain ADMIN-only.
  const canEdit = isAdmin || isViewer;
  const canUploadEvidence = isAdmin || isReporter || isViewer;
  const canDeleteEvidence = isAdmin || isReporter || isViewer;
  const deepLinkEvidenceId = searchParams.get("evidenceId");

  const [plan, setPlan] = useState<Plan | null>(null);
  const [evidences, setEvidences] = useState<PmaEvidence[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [allReporters, setAllReporters] = useState<User[]>([]);
  const [allViewers, setAllViewers] = useState<User[]>([]);
  const [assignedViewerIds, setAssignedViewerIds] = useState<string[]>([]);
  const [assignViewerOpen, setAssignViewerOpen] = useState(false);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [savingItem, setSavingItem] = useState(false);
  const [selectedDireccion, setSelectedDireccion] = useState<string>("");
  const [direccionPendingAssign, setDireccionPendingAssign] = useState<{ reporter: User; category: ItemAssignmentCategory } | null>(null);
  const [savingDireccionAssign, setSavingDireccionAssign] = useState(false);
  const [obsItem, setObsItem] = useState<PlanItem | null>(null);
  const [detailItem, setDetailItem] = useState<PlanItem | null>(null);
  const [obsText, setObsText] = useState("");
  const [savingObs, setSavingObs] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanItem | null>(null);
  const [calUpload, setCalUpload] = useState<{ item: PlanItem; range: ItemRange } | null>(null);
  const [calUploadMonth, setCalUploadMonth] = useState<string>("");
  const [calUploadType, setCalUploadType] = useState<EvidenceType | "">("");
  const [editEvidence, setEditEvidence] = useState<PmaEvidence | null>(null);
  const [editEvidenceForm, setEditEvidenceForm] = useState({
    description: "",
    evidenceType: "" as EvidenceType | "",
  });
  const [savingEvidenceEdit, setSavingEvidenceEdit] = useState(false);
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
  const [highlightEvidenceId, setHighlightEvidenceId] = useState<string | null>(null);
  const [findingDialogOpen, setFindingDialogOpen] = useState(false);
  const [findingForm, setFindingForm] = useState(EMPTY_FINDING_FORM);
  const [editingFinding, setEditingFinding] = useState<Finding | null>(null);
  const [savingFinding, setSavingFinding] = useState(false);
  const [deletePlanOpen, setDeletePlanOpen] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [manualEvidenceOpen, setManualEvidenceOpen] = useState(false);
  const [manualEvidenceForm, setManualEvidenceForm] = useState(emptyManualEvidenceForm);
  const [uploadingManualEvidence, setUploadingManualEvidence] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationPending, setMutationPending] = useState(false);
  const mutationPendingRef = useRef(false);

  const runMutation = useCallback(async <T,>(
    operation: () => Promise<T>,
    fallbackMessage: string
  ): Promise<T | undefined> => {
    if (mutationPendingRef.current) return undefined;
    mutationPendingRef.current = true;
    setMutationPending(true);
    try {
      return await operation();
    } catch (error) {
      toast.error(apiErrorMessage(error, fallbackMessage));
      return undefined;
    } finally {
      mutationPendingRef.current = false;
      setMutationPending(false);
    }
  }, []);

  const loadPlan = useCallback(async () => {
    try {
      const data = await api.get<{
        plan: Plan;
        evidences: PmaEvidence[];
        findings?: Finding[];
        assignedUsers?: string[];
      }>(`/pma/plans/${id}`);
      setPlan(data.plan);
      setEvidences(data.evidences);
      setFindings(Array.isArray(data.findings) ? data.findings : []);
      if (Array.isArray(data.assignedUsers)) {
        setAssignedViewerIds(data.assignedUsers);
      }
      setLoadError(null);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "No se pudo cargar el plan"));
    }
  }, [id]);

  const loadItems = useCallback(async () => {
    try {
      setPlanItems(await api.get<PlanItem[]>(`/pma/plans/${id}/items`));
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudieron cargar los items"));
    }
  }, [id]);

  const loadCompliance = useCallback(async () => {
    try {
      setComplianceRecords(await api.get<PeriodCompliance[]>(`/pma/plans/${id}/period-compliance`));
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo cargar el cumplimiento"));
    }
  }, [id]);

  useEffect(() => {
    loadPlan();
    loadItems();
    loadCompliance();
  }, [loadPlan, loadItems, loadCompliance]);

  useEffect(() => {
    if (canEdit) {
      api.get<User[]>("/pma/users")
        .then((data) => {
          if (Array.isArray(data)) {
            setAllReporters(data.filter((u: User) => u.role === "REPORTER"));
            setAllViewers(data.filter((u: User) => u.role === "VIEWER"));
          }
        })
        .catch((error) => toast.error(apiErrorMessage(error, "No se pudieron cargar los usuarios")));
    }
  }, [canEdit]);

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
    await runMutation(async () => {
      requireOkReceipt(
        await api.delete<unknown>(`/pma/api/plans/${id}`),
        "El servidor no confirmó la eliminación del plan"
      );
      toast.success("Plan eliminado correctamente");
      setDeletePlanOpen(false);
      router.push("/pma/plans");
    }, "Error al eliminar el plan");
    setDeletingPlan(false);
  }

  async function handleAssignViewer(viewerId: string) {
    await runMutation(async () => {
      requireOkReceipt(
        await api.post<unknown>(`/pma/api/plans/${id}/assign`, { userId: viewerId }),
        "El servidor no confirmó la asignación"
      );
      setAssignedViewerIds((prev) => prev.includes(viewerId) ? prev : [...prev, viewerId]);
      toast.success("Visualizador asignado al plan");
    }, "Error al asignar visualizador");
  }

  async function handleUnassignViewer(viewerId: string) {
    await runMutation(async () => {
      requireOkReceipt(
        await api.delete<unknown>(`/pma/api/plans/${id}/assign`, { body: { userId: viewerId } }),
        "El servidor no confirmó la desasignación"
      );
      setAssignedViewerIds((prev) => prev.filter((vid) => vid !== viewerId));
      toast.success("Visualizador desasignado del plan");
    }, "Error al desasignar visualizador");
  }

  async function handleValidationChange(
    evidenceId: string,
    status: EvidenceValidationStatus,
    validationComment?: string
  ) {
    await runMutation(async () => {
      const normalizedComment = validationComment?.trim() ?? "";
      const result = await api.put<{ evidence?: unknown }>(
        `/pma/api/evidences/${evidenceId}/validation`,
        {
          status,
          ...(status === "invalid"
            ? { comment: normalizedComment }
            : {}),
        }
      );
      const updated = requirePersistedEntity<PmaEvidence>(
        result?.evidence,
        "El servidor no confirmó la validación",
        evidenceId
      );
      if (
        updated.planId !== id ||
        updated.validationStatus !== status ||
        (status === "invalid" && updated.validationComment?.trim() !== normalizedComment)
      ) {
        throw new ApiError(200, "El servidor confirmó un estado de validación distinto", updated, "invalid_response");
      }
      setEvidences((prev) =>
        prev.map((evidence) => evidence.id === evidenceId ? updated : evidence)
      );
      toast.success("Validación actualizada");
    }, "Error al actualizar validación");
  }

  async function handleDeleteEvidence(evidenceId: string) {
    if (!confirm("¿Eliminar esta evidencia?")) return;
    await runMutation(async () => {
      requireOkReceipt(
        await api.delete<unknown>(`/pma/api/evidences?id=${evidenceId}`),
        "El servidor no confirmó la eliminación de la evidencia"
      );
      setEvidences((current) => current.filter((evidence) => evidence.id !== evidenceId));
      toast.success("Evidencia eliminada");
    }, "Error al eliminar la evidencia");
  }

  function resetFindingForm() {
    setFindingForm(EMPTY_FINDING_FORM);
    setEditingFinding(null);
  }

  function openCreateFindingDialog() {
    resetFindingForm();
    setFindingDialogOpen(true);
  }

  function openEditFindingDialog(finding: Finding) {
    setEditingFinding(finding);
    setFindingForm({
      component: finding.component,
      nudosCriticos: finding.nudosCriticos,
      alarmas: finding.alarmas,
      riesgos: finding.riesgos,
      propuestasSolucion: finding.propuestasSolucion,
    });
    setFindingDialogOpen(true);
  }

  async function handleSaveFinding(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!plan) return;

    const payload = {
      planId: plan.id,
      component: findingForm.component,
      nudosCriticos: findingForm.nudosCriticos.trim(),
      alarmas: findingForm.alarmas.trim(),
      riesgos: findingForm.riesgos.trim(),
      propuestasSolucion: findingForm.propuestasSolucion.trim(),
    };

    if (
      !payload.component ||
      !payload.nudosCriticos ||
      !payload.alarmas ||
      !payload.riesgos ||
      !payload.propuestasSolucion
    ) {
      toast.error("Todos los campos son obligatorios");
      return;
    }

    setSavingFinding(true);
    await runMutation(async () => {
      if (editingFinding) {
        const params = new URLSearchParams({ planId: plan.id });
        const saved = requirePersistedEntity<Finding>(
          await api.put<unknown>(`/pma/api/findings/${editingFinding.id}?${params.toString()}`, payload),
          "El servidor no confirmó la actualización del hallazgo",
          editingFinding.id
        );

        setFindings((prev) =>
          prev.map((finding) => finding.id === editingFinding.id ? saved : finding)
        );
        toast.success("Hallazgo actualizado");
      } else {
        const created = requirePersistedEntity<Finding>(
          await api.post<unknown>("/pma/api/findings", payload),
          "El servidor no confirmó la creación del hallazgo"
        );
        if (created.planId !== plan.id) {
          throw new ApiError(200, "El servidor confirmó el hallazgo para otro plan", created, "invalid_response");
        }
        setFindings((prev) => [created, ...prev]);
        toast.success("Hallazgo creado");
      }

      setFindingDialogOpen(false);
      resetFindingForm();
    }, editingFinding ? "Error al actualizar hallazgo" : "Error al crear hallazgo");
    setSavingFinding(false);
  }

  async function handleDeleteFinding(findingId: string) {
    if (!plan) return;
    if (!confirm("¿Eliminar este hallazgo?")) return;

    await runMutation(async () => {
      const params = new URLSearchParams({ planId: plan.id });
      requireOkReceipt(
        await api.delete<unknown>(`/pma/api/findings/${findingId}?${params.toString()}`),
        "El servidor no confirmó la eliminación del hallazgo"
      );
      setFindings((prev) => prev.filter((finding) => finding.id !== findingId));
      toast.success("Hallazgo eliminado");
    }, "Error al eliminar hallazgo");
  }

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    setSavingItem(true);
    await runMutation(async () => {
      if (editingItem) {
        const saved = requirePersistedEntity<PlanItem>(
          await api.patch<unknown>(`/pma/api/plans/${id}/items/${editingItem.id}`, {
            ...itemForm,
            budget: Number(itemForm.budget),
          }),
          "El servidor no confirmó la actualización del Item",
          editingItem.id
        );
        if (saved.planId !== id) {
          throw new ApiError(200, "El servidor confirmó el Item para otro plan", saved, "invalid_response");
        }
        setPlanItems((current) => current.map((item) => item.id === saved.id ? saved : item));
        toast.success("Item actualizado correctamente");
        setEditingItem(null);
        setItemForm(EMPTY_ITEM_FORM);
        setAddItemOpen(false);
        return;
      }

      const saved = requirePersistedEntity<PlanItem>(
        await api.post<unknown>(`/pma/api/plans/${id}/items`, {
          ...itemForm,
          budget: Number(itemForm.budget),
        }),
        "El servidor no confirmó la creación del Item"
      );
      if (saved.planId !== id) {
        throw new ApiError(200, "El servidor confirmó el Item para otro plan", saved, "invalid_response");
      }
      setPlanItems((current) => [saved, ...current]);
      toast.success("Item agregado correctamente");
      setItemForm(EMPTY_ITEM_FORM);
      setAddItemOpen(false);
    }, "Error al guardar el item");
    setSavingItem(false);
  }

  async function handleBulkFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBulkFileName(file.name);
    setBulkParseError("");
    setBulkRows([]);

    try {
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
    } catch (error) {
      const message = apiErrorMessage(error, "No se pudo leer el archivo Excel");
      setBulkParseError(message);
      setBulkOpen(true);
      toast.error(message);
    }
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
    await runMutation(async () => {
      const data = await api.post<{ created: number; failed?: unknown[]; items?: PlanItem[] }>(
        `/pma/api/plans/${id}/items/bulk`,
        { items: toSend }
      );
      const created = Number(data.created) || 0;
      const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
      if (
        !Number.isInteger(data.created) ||
        data.created < 0 ||
        !Array.isArray(data.items) ||
        data.items.length !== data.created ||
        data.items.some((item) => !item?.id || item.planId !== id)
      ) {
        throw new ApiError(200, "El servidor devolvió una confirmación de carga inválida", data, "invalid_response");
      }
      if (created <= 0) {
        toast.error(failedCount > 0
          ? `No se creó ningún Item; ${failedCount} filas fallaron`
          : "El servidor no confirmó la creación de ningún Item");
        return;
      }

      toast.success(`${created} Items cargados correctamente`);
      setPlanItems((current) => [...data.items!, ...current]);
      if (failedCount > 0) {
        setBulkParseError(`${created} Items creados; ${failedCount} filas fallaron. Revisa y corrige las filas antes de reintentar.`);
        toast.warning(`${failedCount} Items fallaron al crear`);
      } else {
        setBulkOpen(false);
        setBulkRows([]);
        setBulkFileName("");
      }
    }, "Error al cargar Items");
    setBulkUploading(false);
  }

  async function handleAssignToDireccion(userId: string, category: ItemAssignmentCategory) {
    if (!selectedDireccion) return;
    setSavingDireccionAssign(true);
    await runMutation(async () => {
      const receipt = await api.post<{
        ok?: unknown;
        planId?: unknown;
        direccion?: unknown;
        userId?: unknown;
        category?: unknown;
        assignedItemIds?: unknown;
      }>(`/pma/api/plans/${id}/items/assign-direccion`, {
          direccion: selectedDireccion,
          userId,
          category,
        });
      requireOkReceipt(receipt, "El servidor no confirmó la asignación del reportero");
      if (
        receipt.planId !== id ||
        receipt.direccion !== selectedDireccion ||
        receipt.userId !== userId ||
        receipt.category !== category ||
        !Array.isArray(receipt.assignedItemIds) ||
        receipt.assignedItemIds.length === 0
      ) {
        throw new ApiError(200, "El servidor devolvió una asignación incompleta", receipt, "invalid_response");
      }
      toast.success("Reportero asignado a la dirección");
      setDireccionPendingAssign(null);
      await loadItems();
    }, "Error al asignar el reportero");
    setSavingDireccionAssign(false);
  }

  async function handleUnassignFromDireccion(userId: string) {
    if (!selectedDireccion) return;
    setSavingDireccionAssign(true);
    await runMutation(async () => {
      const receipt = await api.delete<{
        ok?: unknown;
        planId?: unknown;
        direccion?: unknown;
        userId?: unknown;
        unassignedItemIds?: unknown;
      }>(`/pma/api/plans/${id}/items/assign-direccion`, {
          body: { direccion: selectedDireccion, userId },
        });
      requireOkReceipt(receipt, "El servidor no confirmó la desasignación del reportero");
      if (
        receipt.planId !== id ||
        receipt.direccion !== selectedDireccion ||
        receipt.userId !== userId ||
        !Array.isArray(receipt.unassignedItemIds) ||
        receipt.unassignedItemIds.length === 0
      ) {
        throw new ApiError(200, "El servidor devolvió una desasignación incompleta", receipt, "invalid_response");
      }
      toast.success("Reportero desasignado de la dirección");
      await loadItems();
    }, "Error al desasignar el reportero");
    setSavingDireccionAssign(false);
  }

  function openCalUpload(item: PlanItem, range: ItemRange) {
    const now = getBusinessMonth();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const months = range.selectableMonthKeys;
    // Default to the current month if it falls in the range, otherwise the deadline.
    const def = months.includes(todayKey) ? todayKey : months[months.length - 1];
    setCalUpload({ item, range });
    setCalUploadMonth(def ?? range.key);
    setCalUploadType("");
  }

  async function handleCalUploadSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!calUpload) return;
    if (!calUpload.range.selectableMonthKeys.includes(calUploadMonth)) {
      toast.error("El mes seleccionado no pertenece al período habilitado");
      return;
    }
    if (!calUploadType) {
      toast.error("Selecciona el tipo de evidencia");
      return;
    }
    setUploadingCal(true);

    const formData = new FormData(e.currentTarget);
    formData.set("planId", id);
    formData.set("planItemId", calUpload.item.id);
    formData.set("activityMonth", calUploadMonth);
    formData.set("evidenceType", calUploadType);

    await runMutation(async () => {
      const uploaded = requirePersistedAsset<PmaEvidence>(
        await api.upload<unknown>("/pma/api/upload", formData, { timeoutMs: 60_000 }),
        "El servidor no confirmó la evidencia guardada"
      );
      if (
        uploaded.planId !== id ||
        uploaded.planItemId !== calUpload.item.id ||
        uploaded.activityMonth !== calUploadMonth ||
        uploaded.evidenceType !== calUploadType
      ) {
        throw new ApiError(200, "El servidor confirmó la evidencia con un período o tipo distinto", uploaded, "invalid_response");
      }
      setEvidences((current) => [uploaded, ...current.filter((evidence) => evidence.id !== uploaded.id)]);
      toast.success("Evidencia subida correctamente");
      (e.target as HTMLFormElement).reset();
      setCalUpload(null);
    }, "Error al subir la evidencia");
    setUploadingCal(false);
  }

  async function handleManualEvidenceSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!manualEvidenceForm.itemId) {
      toast.error("Selecciona un item");
      return;
    }
    if (!manualEvidenceForm.evidenceType) {
      toast.error("Selecciona el tipo de evidencia");
      return;
    }
    setUploadingManualEvidence(true);

    const monthKey = `${manualEvidenceForm.year}-${String(manualEvidenceForm.month).padStart(2, "0")}`;
    const selectedItem = planItems.find((item) => item.id === manualEvidenceForm.itemId);
    const allowedMonths = selectedItem && plan
      ? new Set(getItemRanges(plan, selectedItem.periodicity).flatMap((range) => range.selectableMonthKeys))
      : new Set<string>();
    if (!allowedMonths.has(monthKey)) {
      setUploadingManualEvidence(false);
      toast.error("El mes seleccionado está fuera del período habilitado para este Item");
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set("planId", id);
    formData.set("planItemId", manualEvidenceForm.itemId);
    formData.set("activityMonth", monthKey);
    formData.set("evidenceType", manualEvidenceForm.evidenceType);

    await runMutation(async () => {
      const uploaded = requirePersistedAsset<PmaEvidence>(
        await api.upload<unknown>("/pma/api/upload", formData, { timeoutMs: 60_000 }),
        "El servidor no confirmó la evidencia guardada"
      );
      if (
        uploaded.planId !== id ||
        uploaded.planItemId !== manualEvidenceForm.itemId ||
        uploaded.activityMonth !== monthKey ||
        uploaded.evidenceType !== manualEvidenceForm.evidenceType
      ) {
        throw new ApiError(200, "El servidor confirmó la evidencia con un período o tipo distinto", uploaded, "invalid_response");
      }
      setEvidences((current) => [uploaded, ...current.filter((evidence) => evidence.id !== uploaded.id)]);
      toast.success("Evidencia agregada correctamente");
      setManualEvidenceOpen(false);
      setManualEvidenceForm(emptyManualEvidenceForm());
    }, "Error al agregar la evidencia");
    setUploadingManualEvidence(false);
  }

  function openEditEvidence(ev: PmaEvidence) {
    setEditEvidence(ev);
    setEditEvidenceForm({
      description: ev.description ?? "",
      evidenceType: ev.evidenceType,
    });
  }

  async function handleEditEvidenceSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editEvidence) return;
    if (!editEvidenceForm.evidenceType) {
      toast.error("Selecciona el tipo de evidencia");
      return;
    }
    setSavingEvidenceEdit(true);

    await runMutation(async () => {
      const updated = requirePersistedEntity<PmaEvidence>(
        await api.patch<unknown>(`/pma/api/evidences/${editEvidence.id}`, {
          description: editEvidenceForm.description,
          evidenceType: editEvidenceForm.evidenceType,
        }),
        "El servidor no confirmó la actualización de la evidencia",
        editEvidence.id
      );
      if (
        updated.evidenceType !== editEvidenceForm.evidenceType ||
        updated.description !== editEvidenceForm.description
      ) {
        throw new ApiError(200, "El servidor guardó valores distintos a los enviados", updated, "invalid_response");
      }
      setEvidences((current) =>
        current.map((evidence) => (evidence.id === updated.id ? updated : evidence))
      );
      toast.success("Evidencia actualizada");
      setEditEvidence(null);
    }, "Error al actualizar la evidencia");
    setSavingEvidenceEdit(false);
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
      const res = await checkedApiFetch(`/pma/api/download/item-period?${params}`, {}, "No hay archivos para descargar");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${pi.item}_${periodKey}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Error al descargar"));
    } finally {
      setDownloadingPeriod(null);
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm("¿Eliminar este Item?")) return;

    await runMutation(async () => {
      requireOkReceipt(
        await api.delete<unknown>(`/pma/api/plans/${id}/items/${itemId}`),
        "El servidor no confirmó la eliminación del Item"
      );
      setPlanItems((current) => current.filter((item) => item.id !== itemId));
      toast.success("Item eliminado");
    }, "Error al eliminar Item");
  }

  async function handleSaveObservation() {
    if (!obsItem) return;
    setSavingObs(true);
    await runMutation(async () => {
      const receipt = await api.patch<{ ok?: unknown; id?: unknown }>(
        `/pma/api/plans/${id}/items/${obsItem.id}/observation`,
        { observation: obsText }
      );
      requireOkReceipt(receipt, "El servidor no confirmó la observación");
      if (receipt.id !== obsItem.id) {
        throw new ApiError(200, "El servidor confirmó una observación para otro Item", receipt, "invalid_response");
      }
      setPlanItems((prev) => prev.map((item) =>
        item.id === obsItem.id ? { ...item, observation: obsText } : item
      ));
      toast.success("Observación guardada");
      setObsItem(null);
    }, "Error al guardar observación");
    setSavingObs(false);
  }

  async function handleComplianceChange(planItemId: string, periodKey: string, status: PeriodComplianceStatus) {
    await runMutation(async () => {
      const receipt = await api.put<{ ok?: unknown; updated?: unknown }>(
        `/pma/api/plans/${id}/period-compliance`, {
          entries: [{ planItemId, periodKey, status }],
        }
      );
      requireOkReceipt(receipt, "El servidor no confirmó el estado de cumplimiento");
      if (receipt.updated !== 1) {
        throw new ApiError(
          200,
          "El servidor no confirmó la escritura del estado de cumplimiento",
          receipt,
          "invalid_response"
        );
      }
      const updated: PeriodCompliance = {
        id: `${planItemId}:${periodKey}`,
        planId: id,
        planItemId,
        periodKey,
        status,
        updatedAt: new Date().toISOString(),
      };
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
    }, "Error al guardar cumplimiento");
  }

  function autoResizeTextarea(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  if (!plan) {
    return loadError ? (
      <div className="space-y-3">
        <p className="text-sm text-red-600">{loadError}</p>
        <Button variant="outline" onClick={() => void loadPlan()}>Reintentar</Button>
      </div>
    ) : <div className="text-muted-foreground">Cargando...</div>;
  }


  const userId = session?.id ?? "";
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
  const visibleFindings = findings;
  const manualEvidenceItem = visibleItems.find((item) => item.id === manualEvidenceForm.itemId);
  const manualAllowedMonthKeys = manualEvidenceItem
    ? getItemRanges(plan, manualEvidenceItem.periodicity).flatMap((range) => range.selectableMonthKeys)
    : [];
  const manualAllowedYears = Array.from(
    new Set(manualAllowedMonthKeys.map((key) => Number(key.slice(0, 4))))
  ).sort((a, b) => a - b);
  const manualAllowedMonths = manualAllowedMonthKeys
    .filter((key) => Number(key.slice(0, 4)) === manualEvidenceForm.year)
    .map((key) => Number(key.slice(5, 7)));

  // Distinct "direcciones" present across this plan's items, used by the
  // "Asignar por dirección" card to assign a reporter to a whole group at once.
  const direcciones = Array.from(
    new Set(
      planItems.map((pi) => (pi.direccion ?? "").trim()).filter((d) => d.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));
  // Items missing a "direccion". While any exist, assigning reporters by
  // direccion is disabled: those items would silently fall outside every group.
  const itemsSinDireccion = planItems.filter(
    (pi) => (pi.direccion ?? "").trim().length === 0
  );
  const direccionItems = selectedDireccion
    ? planItems.filter((pi) => (pi.direccion ?? "").trim() === selectedDireccion)
    : [];
  // Union of reporters assigned to at least one item in the selected direccion,
  // keeping the category from the first item where each reporter appears.
  const direccionAssignments = (() => {
    const map = new Map<string, ItemAssignmentCategory>();
    for (const pi of direccionItems) {
      for (const a of pi.assignedUsers ?? []) {
        if (!map.has(a.userId)) map.set(a.userId, a.category);
      }
    }
    return Array.from(map.entries()).map(([userId, category]) => ({ userId, category }));
  })();

  return (
    <div className="space-y-6">
      {mutationPending && (
        <div className="fixed inset-0 z-[90] cursor-wait" aria-label="Operación en curso" />
      )}
      {/* Plan Header */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{plan.title}</h1>
          </div>
          {isAdmin && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeletePlanOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Eliminar plan
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

      {/* Viewers assigned to this plan */}
      {canEdit && (
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

      {/* Assign reporters by direccion */}
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Asignar reporteros por dirección</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {itemsSinDireccion.length > 0 ? (
              <div className="flex items-start gap-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
                <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    Completa la dirección de todos los items para asignar por dirección.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hay {itemsSinDireccion.length} item(s) sin dirección
                    {itemsSinDireccion.length <= 10 && (
                      <> ({itemsSinDireccion.map((pi) => pi.item).join(", ")})</>
                    )}
                    . Mientras existan, quedarían fuera de cualquier grupo.
                  </p>
                </div>
              </div>
            ) : direcciones.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay direcciones en los items de este plan.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Dirección</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={selectedDireccion}
                    onChange={(e) => {
                      setSelectedDireccion(e.target.value);
                      setDireccionPendingAssign(null);
                    }}
                  >
                    <option value="">Selecciona una dirección…</option>
                    {direcciones.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  {selectedDireccion && (
                    <p className="text-xs text-muted-foreground">
                      {direccionItems.length} item(s) en esta dirección. La asignación aplica a todos.
                    </p>
                  )}
                </div>

                {selectedDireccion && (
                  <div className="space-y-4">
                    {/* Reporters currently assigned to this direccion */}
                    {direccionAssignments.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Asignados a la dirección</p>
                        <div className="space-y-1">
                          {direccionAssignments.map((a) => {
                            const reporter = allReporters.find((r) => r.id === a.userId);
                            return (
                              <div key={a.userId} className="flex items-center justify-between p-2 rounded-lg border">
                                <div>
                                  <p className="text-sm font-medium">{reporter?.name || a.userId}</p>
                                  <p className="text-xs text-muted-foreground">{reporter?.email}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">{a.category}</Badge>
                                  <Button variant="ghost" size="sm" disabled={savingDireccionAssign} onClick={() => handleUnassignFromDireccion(a.userId)}>
                                    <Trash2 className="w-4 h-4 text-red-500" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Category picker for a pending assignment */}
                    {direccionPendingAssign && (
                      <div className="rounded-lg border p-3 space-y-3 bg-muted/40">
                        <p className="text-sm font-medium">
                          Asignar a <span className="text-foreground">{direccionPendingAssign.reporter.name}</span> como:
                        </p>
                        <div className="flex gap-2">
                          {(["Responsable", "Colaborador"] as ItemAssignmentCategory[]).map((cat) => (
                            <Button
                              key={cat}
                              size="sm"
                              variant={direccionPendingAssign.category === cat ? "default" : "outline"}
                              onClick={() => setDireccionPendingAssign({ ...direccionPendingAssign, category: cat })}
                            >
                              {cat}
                            </Button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1" disabled={savingDireccionAssign} onClick={() => handleAssignToDireccion(direccionPendingAssign.reporter.id, direccionPendingAssign.category)}>
                            {savingDireccionAssign ? "Asignando…" : "Confirmar"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDireccionPendingAssign(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Add a reporter to the direccion */}
                    {!direccionPendingAssign && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-2">Agregar reportero</p>
                        {allReporters.filter((r) => !direccionAssignments.some((a) => a.userId === r.id)).length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-3">Todos los reporteros ya están asignados a esta dirección.</p>
                        ) : (
                          <div className="space-y-1">
                            {allReporters
                              .filter((r) => !direccionAssignments.some((a) => a.userId === r.id))
                              .map((reporter) => (
                                <div key={reporter.id} className="flex items-center justify-between p-2 rounded-lg border">
                                  <div>
                                    <p className="text-sm font-medium">{reporter.name}</p>
                                    <p className="text-xs text-muted-foreground">{reporter.email}</p>
                                  </div>
                                  <Button size="sm" onClick={() => setDireccionPendingAssign({ reporter, category: "Responsable" })}>
                                    Asignar
                                  </Button>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plan Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Items del Plan ({visibleItems.length})
          </CardTitle>
          {canEdit && (
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
                  } else if (open && !editingItem && planItems.length > 0) {
                    const last = planItems[planItems.length - 1];
                    setItemForm({
                      item: last.item,
                      subplan: last.subplan,
                      direccion: last.direccion ?? "",
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
                Agregar Item
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingItem ? "Editar Item" : "Agregar Item al Plan"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleAddItem} className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="item">Item</Label>
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
                      <Label htmlFor="direccion">Dirección</Label>
                      <select
                        id="direccion"
                        value={itemForm.direccion}
                        onChange={(e) =>
                          setItemForm({ ...itemForm, direccion: e.target.value })
                        }
                        required
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="" disabled>
                          Seleccionar dirección...
                        </option>
                        {DIRECCION_OPTIONS.map((option) => (
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
                        {PERIODICITY_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
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
              {canEdit && "Usa el botón \"Agregar Item\" para comenzar."}
            </p>
          ) : (
            <div className="w-full">
              <Table className="w-full table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[8%]">Item</TableHead>
                    <TableHead className="w-[11%]">Dirección</TableHead>
                    <TableHead className="w-[30%]">Medida Propuesta</TableHead>
                    <TableHead className="w-[23%]">Método Verificación</TableHead>
                    <TableHead className="w-[20%]">Observación</TableHead>
                    {canEdit && <TableHead className="w-[8%]">Acciones</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleItems.map((pi) => (
                    <TableRow
                      key={pi.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailItem(pi)}
                    >
                      <TableCell className="font-medium align-top break-words">
                        {pi.item}
                      </TableCell>
                      <TableCell className="align-top" title={pi.direccion ?? ""}>
                        <span className="line-clamp-2 whitespace-normal break-words">{pi.direccion ?? ""}</span>
                      </TableCell>
                      <TableCell className="align-top" title={pi.proposed_measure}>
                        <span className="line-clamp-2 whitespace-normal break-words">{pi.proposed_measure}</span>
                      </TableCell>
                      <TableCell className="align-top" title={pi.verification_method}>
                        <span className="line-clamp-2 whitespace-normal break-words">{pi.verification_method}</span>
                      </TableCell>
                      <TableCell
                        className="cursor-pointer align-top"
                        onClick={(e) => {
                          e.stopPropagation();
                          setObsItem(pi);
                          setObsText(pi.observation ?? "");
                        }}
                      >
                        {pi.observation ? (
                          <span className="line-clamp-2 whitespace-normal break-words text-sm text-muted-foreground hover:text-foreground transition-colors">
                            {pi.observation}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground/50 italic hover:text-muted-foreground transition-colors">
                            Sin observación
                          </span>
                        )}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1 items-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              title="Editar Item"
                              onClick={() => {
                                setEditingItem(pi);
                                setItemForm({
                                  item: pi.item,
                                  subplan: pi.subplan,
                                  direccion: pi.direccion ?? "",
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
                            {(isAdmin || isViewer) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => handleDeleteItem(pi.id)}
                              >
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            )}
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

        // // Build compliance lookup: "planItemId::periodKey" -> status
        const complianceMap = new Map(
          complianceRecords.map((r) => [`${r.planItemId}::${r.periodKey}`, r.status])
        );

        const statusStyle: Record<"none" | EvidenceValidationStatus, { bg: string; color: string; border: string; label: string }> = {
          none:    { bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc", label: "" },
          pending: { bg: "#fef9c3", color: "#854d0e", border: "#fde047", label: "⏳" },
          invalid: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5", label: "✕" },
          valid:   { bg: "#dcfce7", color: "#166534", border: "#86efac", label: "✓“" },
        };

        const todayMonth = getBusinessMonth();

        const planStart = getPlanStartDate(p);
        const rangeStart = new Date(planStart.getFullYear(), planStart.getMonth(), 1);
        const rangeEnd = new Date(todayMonth.getFullYear(), todayMonth.getMonth() + 2, 1);

        const months: Date[] = [];
        const cur = new Date(rangeStart);
        while (cur < rangeEnd) {
          months.push(new Date(cur));
          cur.setMonth(cur.getMonth() + 1);
        }

        // Period block helpers (based on plan's report_per)
        const { isBlockEnd, getPeriodLabel } = createPeriodHelpers(p);

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
                            Cump.
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((pi, rowIdx) => {
                      // Evidence upload ranges for this item, based on its periodicity.
                      const ranges = getItemRanges(p, pi.periodicity);
                      const rangeByMonth = new Map<string, ItemRange>();
                      ranges.forEach((r) => r.monthKeys.forEach((mk) => rangeByMonth.set(mk, r)));

                      // Highest-priority evidence status across the range's months.
                      const rangeStatus = (range: ItemRange): "none" | EvidenceValidationStatus => {
                        let best: "none" | EvidenceValidationStatus = "none";
                        for (const mk of range.monthKeys) {
                          const s = evidenceMonthStatus.get(`${pi.id}-${mk}`);
                          if (s && (best === "none" || statusPriority[s] > statusPriority[best])) best = s;
                        }
                        return best;
                      };

                      const renderRangeCell = (
                        range: ItemRange,
                        colSpan: number,
                        firstSegment: boolean,
                        cellKey: string
                      ) => {
                        const evStatus = rangeStatus(range);
                        const hasEvidence = evStatus !== "none";
                        const started = range.started;
                        const style = hasEvidence
                          ? statusStyle[evStatus]
                          : started
                            ? statusStyle.none
                            : { bg: "transparent", color: "#cbd5e1", border: "#e2e8f0", label: "" };
                        const label = hasEvidence ? style.label : firstSegment ? range.label : "";
                        const titleText =
                          evStatus === "valid"   ? `Válido · ${range.label}` :
                          evStatus === "invalid" ? `Rechazado · ${range.label}` :
                          evStatus === "pending" ? `Pendiente de aprobación · ${range.label}` :
                          started && canUploadEvidence ? `Subir evidencia · ${range.label}` :
                          started ? `Sin evidencia · ${range.label}` :
                          `Periodo futuro (aún no disponible) · ${range.label}`;

                        return (
                          <td key={cellKey} colSpan={colSpan} className="border border-border p-0.5">
                            {started && canUploadEvidence ? (
                              <button
                                onClick={() => openCalUpload(pi, range)}
                                className="w-full rounded flex items-center justify-center font-semibold leading-none transition-opacity hover:opacity-75 px-1"
                                style={{
                                  height: "24px",
                                  backgroundColor: style.bg,
                                  color: style.color,
                                  fontSize: "10px",
                                  border: `1px solid ${style.border}`,
                                }}
                                title={titleText}
                              >
                                <span className="truncate">{label}</span>
                              </button>
                            ) : (
                              <div
                                className="w-full rounded flex items-center justify-center leading-none px-1 cursor-not-allowed"
                                style={{
                                  height: "24px",
                                  backgroundColor: style.bg,
                                  color: style.color,
                                  fontSize: "10px",
                                  border: `1px dashed ${style.border}`,
                                }}
                                title={titleText}
                              >
                                <span className="truncate">{label}</span>
                              </div>
                            )}
                          </td>
                        );
                      };

                      const renderComplianceCell = (
                        vc: Extract<VCol, { type: "compliance" }>,
                        cellKey: string
                      ) => {
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
                          <td key={cellKey} className="border-2 border-border p-0.5">
                            {canEdit ? (
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
                                  {compStatus ?? ""}
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
                                {compStatus ?? ""}
                              </div>
                            )}
                          </td>
                        );
                      };

                      // Group consecutive month columns that share a range into a
                      // single colSpan cell, splitting around compliance columns.
                      const cells: React.ReactNode[] = [];
                      const seenRange = new Set<number>();
                      let group: { range: ItemRange; count: number; startIdx: number } | null = null;
                      const flush = () => {
                        if (!group) return;
                        const first = !seenRange.has(group.range.index);
                        seenRange.add(group.range.index);
                        cells.push(renderRangeCell(group.range, group.count, first, `r-${group.startIdx}`));
                        group = null;
                      };
                      vcols.forEach((vc, i) => {
                        if (vc.type === "month") {
                          const mk = `${vc.date.getFullYear()}-${String(vc.date.getMonth() + 1).padStart(2, "0")}`;
                          const r = rangeByMonth.get(mk);
                          if (!r) {
                            flush();
                            cells.push(<td key={`e-${i}`} className="border border-border p-0.5" />);
                            return;
                          }
                          if (group && group.range.index === r.index) {
                            group.count += 1;
                          } else {
                            flush();
                            group = { range: r, count: 1, startIdx: i };
                          }
                        } else {
                          flush();
                          cells.push(renderComplianceCell(vc, `c-${i}`));
                        }
                      });
                      flush();

                      return (
                        <tr
                          key={pi.id}
                          className={rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"}
                        >
                          <td className="sticky left-0 z-10 border border-border px-3 py-1.5 font-medium truncate max-w-[200px] bg-background">
                            {pi.item}
                          </td>
                          {cells}
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
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-10 h-4 rounded" style={{ backgroundColor: "transparent", border: "1px dashed #e2e8f0" }} />
                  Periodo futuro (aún no disponible)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-10 h-4 rounded border-2" style={{ backgroundColor: "#f8fafc", borderColor: "#e2e8f0" }} />
                  Columna de cumplimiento (C / NC+ / NC-)
                </span>
                <span className="ml-auto italic">
                  Cada celda cubre un periodo completo según la periodicidad del item.
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
              <p className="text-xs text-muted-foreground">
                Periodo <span className="font-medium">{calUpload.range.label}</span>
                {" · "}
                {calUpload.item.periodicity}
              </p>
            </div>
          )}
          <form onSubmit={handleCalUploadSubmit} className="space-y-4">
            {calUpload && calUpload.range.selectableMonthKeys.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="cal-month">Mes de la actividad</Label>
                <select
                  id="cal-month"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={calUploadMonth}
                  onChange={(e) => setCalUploadMonth(e.target.value)}
                  required
                >
                  {calUpload.range.selectableMonthKeys.map((mk) => {
                    const [y, mo] = mk.split("-").map(Number);
                    return (
                      <option key={mk} value={mk}>
                        {new Date(y, mo - 1).toLocaleString("es", { month: "long", year: "numeric" })}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="cal-type">Tipo *</Label>
              <select
                id="cal-type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={calUploadType}
                onChange={(e) => setCalUploadType(e.target.value as EvidenceType | "")}
                required
              >
                <option value="">Selecciona un tipo</option>
                {EVIDENCE_TYPE_VALUES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
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

      {/* Edit Evidence Dialog */}
      <Dialog open={!!editEvidence} onOpenChange={(open) => { if (!open) setEditEvidence(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Evidencia</DialogTitle>
          </DialogHeader>
          {editEvidence && (
            <div className="space-y-1 mb-2">
              <p className="text-sm font-medium break-all">{editEvidence.fileName}</p>
              {editEvidence.activityMonth && (
                <p className="text-xs text-muted-foreground">
                  Mes de actividad{" "}
                  <span className="font-medium">
                    {new Date(`${editEvidence.activityMonth}-01T00:00:00`)
                      .toLocaleString("es", { month: "long", year: "numeric" })}
                  </span>
                  {" · no editable"}
                </p>
              )}
            </div>
          )}
          <form onSubmit={handleEditEvidenceSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-ev-type">Tipo *</Label>
              <select
                id="edit-ev-type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editEvidenceForm.evidenceType}
                onChange={(e) =>
                  setEditEvidenceForm((prev) => ({
                    ...prev,
                    evidenceType: e.target.value as EvidenceType | "",
                  }))
                }
                required
              >
                <option value="">Selecciona un tipo</option>
                {EVIDENCE_TYPE_VALUES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-ev-desc">Descripción *</Label>
              <Input
                id="edit-ev-desc"
                value={editEvidenceForm.description}
                onChange={(e) =>
                  setEditEvidenceForm((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Breve descripción de la evidencia"
                required
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditEvidence(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={savingEvidenceEdit}>
                {savingEvidenceEdit ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manual Evidence Dialog */}
      <Dialog open={manualEvidenceOpen} onOpenChange={setManualEvidenceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar Evidencia Manual</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleManualEvidenceSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="manual-item">Item *</Label>
              <select
                id="manual-item"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={manualEvidenceForm.itemId}
                onChange={(e) => {
                  const itemId = e.target.value;
                  const item = visibleItems.find((candidate) => candidate.id === itemId);
                  const lastAllowed = item
                    ? getItemRanges(plan, item.periodicity)
                        .flatMap((range) => range.selectableMonthKeys)
                        .at(-1)
                    : undefined;
                  setManualEvidenceForm((prev) => ({
                    ...prev,
                    itemId,
                    year: lastAllowed ? Number(lastAllowed.slice(0, 4)) : prev.year,
                    month: lastAllowed ? Number(lastAllowed.slice(5, 7)) : prev.month,
                  }));
                }}
                required
              >
                <option value="">Selecciona un item</option>
                {visibleItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.item}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="manual-month">Mes *</Label>
                <select
                  id="manual-month"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={manualEvidenceForm.month}
                  onChange={(e) =>
                    setManualEvidenceForm((prev) => ({
                      ...prev,
                      month: parseInt(e.target.value),
                    }))
                  }
                  required
                >
                  {manualAllowedMonths.map((m) => (
                    <option key={m} value={m}>
                      {new Date(2000, m - 1).toLocaleString("es", { month: "short" })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="manual-year">Año *</Label>
                <select
                  id="manual-year"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={manualEvidenceForm.year}
                  onChange={(e) => {
                    const year = Number(e.target.value);
                    const months = manualAllowedMonthKeys
                      .filter((key) => Number(key.slice(0, 4)) === year)
                      .map((key) => Number(key.slice(5, 7)));
                    setManualEvidenceForm((prev) => ({
                      ...prev,
                      year,
                      month: months.includes(prev.month) ? prev.month : (months[0] ?? prev.month),
                    }));
                  }}
                  required
                >
                  {manualAllowedYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-type">Tipo *</Label>
              <select
                id="manual-type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={manualEvidenceForm.evidenceType}
                onChange={(e) =>
                  setManualEvidenceForm((prev) => ({
                    ...prev,
                    evidenceType: e.target.value as EvidenceType | "",
                  }))
                }
                required
              >
                <option value="">Selecciona un tipo</option>
                {EVIDENCE_TYPE_VALUES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-file">Archivo (máx 10MB) *</Label>
              <Input id="manual-file" name="file" type="file" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-desc">Descripción *</Label>
              <Input
                id="manual-desc"
                name="description"
                placeholder="Breve descripción de la evidencia"
                required
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setManualEvidenceOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={uploadingManualEvidence}>
                <Upload className="w-4 h-4 mr-2" />
                {uploadingManualEvidence ? "Agregando..." : "Agregar Evidencia"}
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

      {/* Item Detail Dialog */}
      <Dialog open={!!detailItem} onOpenChange={(open) => { if (!open) setDetailItem(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Item — {detailItem?.item}</DialogTitle>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-4 mt-2 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Subplan</p>
                  <p className="whitespace-pre-wrap break-words">{detailItem.subplan || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Dirección</p>
                  <p className="whitespace-pre-wrap break-words">{detailItem.direccion || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Periodicidad</p>
                  <p className="whitespace-pre-wrap break-words">{detailItem.periodicity || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Presupuesto</p>
                  <p>
                    {detailItem.budget.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                    })}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Actividad Ambiental</p>
                <p className="whitespace-pre-wrap break-words">{detailItem.environmental_activity || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Impacto Ambiental Identificado</p>
                <p className="whitespace-pre-wrap break-words">{detailItem.identified_environmental_impact || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Medida Propuesta</p>
                <p className="whitespace-pre-wrap break-words">{detailItem.proposed_measure || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Indicador</p>
                <p className="whitespace-pre-wrap break-words">{detailItem.indicator || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Método de Verificación</p>
                <p className="whitespace-pre-wrap break-words">{detailItem.verification_method || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Observación</p>
                <p className="whitespace-pre-wrap break-words">{detailItem.observation || "Sin observación"}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Findings Dialog */}
      <Dialog
        open={findingDialogOpen}
        onOpenChange={(open) => {
          setFindingDialogOpen(open);
          if (!open) resetFindingForm();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingFinding ? "Editar hallazgo" : "Nuevo hallazgo"}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveFinding}>
            <div className="space-y-2">
              <Label htmlFor="finding-component">Componente</Label>
              <select
                id="finding-component"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={findingForm.component}
                onChange={(e) =>
                  setFindingForm((prev) => ({
                    ...prev,
                    component: e.target.value as FindingComponent,
                  }))
                }
                required
              >
                {FINDING_COMPONENT_OPTIONS.map((component) => (
                  <option key={component} value={component}>
                    {component}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="finding-nudos">Nudos críticos</Label>
              <textarea
                id="finding-nudos"
                className="w-full min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                value={findingForm.nudosCriticos}
                onChange={(e) =>
                  setFindingForm((prev) => ({ ...prev, nudosCriticos: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="finding-alarmas">Alarmas</Label>
              <textarea
                id="finding-alarmas"
                className="w-full min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                value={findingForm.alarmas}
                onChange={(e) =>
                  setFindingForm((prev) => ({ ...prev, alarmas: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="finding-riesgos">Riesgos</Label>
              <textarea
                id="finding-riesgos"
                className="w-full min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                value={findingForm.riesgos}
                onChange={(e) =>
                  setFindingForm((prev) => ({ ...prev, riesgos: e.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="finding-propuestas">Propuestas de solución</Label>
              <textarea
                id="finding-propuestas"
                className="w-full min-h-[90px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                value={findingForm.propuestasSolucion}
                onChange={(e) =>
                  setFindingForm((prev) => ({
                    ...prev,
                    propuestasSolucion: e.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFindingDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={savingFinding}>
                {savingFinding
                  ? editingFinding
                    ? "Guardando..."
                    : "Creando..."
                  : editingFinding
                  ? "Guardar cambios"
                  : "Crear hallazgo"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Findings List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            Hallazgos ({visibleFindings.length})
          </CardTitle>
          {canEdit && (
            <Button size="sm" onClick={openCreateFindingDialog}>
              <Plus className="w-4 h-4 mr-1" />
              Nuevo hallazgo
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {visibleFindings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin hallazgos registrados aún.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead>Nudos críticos</TableHead>
                  <TableHead>Alarmas</TableHead>
                  <TableHead>Riesgos</TableHead>
                  <TableHead>Propuestas de solución</TableHead>
                  <TableHead>Creado por</TableHead>
                  <TableHead>Fecha</TableHead>
                  {canEdit && <TableHead className="w-[96px]">Acciones</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleFindings.map((finding) => (
                  <TableRow key={finding.id}>
                    <TableCell className="font-medium">{finding.component}</TableCell>
                    <TableCell className="max-w-[220px] whitespace-pre-wrap break-words">
                      {finding.nudosCriticos}
                    </TableCell>
                    <TableCell className="max-w-[220px] whitespace-pre-wrap break-words">
                      {finding.alarmas}
                    </TableCell>
                    <TableCell className="max-w-[220px] whitespace-pre-wrap break-words">
                      {finding.riesgos}
                    </TableCell>
                    <TableCell className="max-w-[260px] whitespace-pre-wrap break-words">
                      {finding.propuestasSolucion}
                    </TableCell>
                    <TableCell>{finding.createdByName || "-"}</TableCell>
                    <TableCell>
                      {new Date(finding.createdAt).toLocaleString()}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditFindingDialog(finding)}
                            title="Editar hallazgo"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          {(isAdmin || isViewer) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteFinding(finding.id)}
                              title="Eliminar hallazgo"
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Evidence List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Evidencias ({visibleEvidences.length})
            </CardTitle>
            {canUploadEvidence && visibleItems.length > 0 && (
              <Button
                size="sm"
                onClick={() => setManualEvidenceOpen(true)}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Agregar Manual
              </Button>
            )}
          </div>
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
                  <TableHead>Tipo</TableHead>
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
                      {canEdit ? (
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
                    <TableCell className="whitespace-nowrap text-sm">
                      {ev.evidenceType}
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
                        {canDeleteEvidence && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Editar evidencia"
                            onClick={() => openEditEvidence(ev)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canDeleteEvidence && (
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

        // Downloadable periods follow the item's evidence ranges (by periodicity),
        // matching the calendar. Only ranges that have already started are listed.
        function getAvailablePeriods(pi: PlanItem): { key: string; label: string }[] {
          return getItemRanges(p, pi.periodicity)
            .filter((r) => r.started)
            .map((r) => ({ key: r.key, label: r.label }));
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
                                      Ya existe un Item con este código en el plan
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

      {/* Delete Plan Confirmation Dialog */}
      <Dialog open={deletePlanOpen} onOpenChange={setDeletePlanOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <OctagonAlert className="w-5 h-5" />
              Eliminar plan permanentemente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Esta acción es <strong>irreversible</strong>. Se eliminará todo lo relacionado con este plan:
            </p>
            <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
              <li>Todos los Items del plan</li>
              <li>Todas las evidencias y archivos en Google Drive</li>
              <li>Todos los hallazgos registrados</li>
              <li>Registros de cumplimiento por período</li>
              <li>Todas las asignaciones de usuarios a los Items</li>
              <li>Notificaciones relacionadas al plan</li>
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
              {deletingPlan ? "Eliminando..." : "Sí, eliminar plan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
