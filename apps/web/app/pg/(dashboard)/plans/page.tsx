"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
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
import { Plus, ArrowRight, Pencil, Download, Upload, Map } from "lucide-react";
import { toast } from "sonner";
import { Plan, PLAN_TIPO_VALUES, PLAN_REPORTE_VALUES } from "@/types";
import { formatDateOnly } from "@/lib/dateOnly";
import {
  CiiuEntry,
  RGDP_LOCATION_TREE,
  convertCsvToXlsx,
  isCoordinateFileNameAllowed,
  loadCiiuCatalog,
  parseCoordinateFile,
  searchCiiu,
} from "@/lib/rgdpProjectForm";

const COORDINATE_FORMAT_OPTIONS = [
  "UTM WGS84 Zona 17 Sur",
  "UTM WGS84 Zona 18 Sur",
  "Geograficas (Lat/Lon)",
];

type CiiuSelection = { code: string; description: string } | undefined;

interface ProjectFormState {
  title: string;
  description: string;
  tipo: string;
  report_per: string;
  start_date: string;
  visualization_url: string;
  location: {
    province: string;
    canton: string;
    parish: string;
    reference: string;
  };
  ciiu: {
    principal?: { code: string; description: string };
    complementary1?: { code: string; description: string };
    complementary2?: { code: string; description: string };
  };
  zoneType: "Urbana" | "Rural" | "Maritima" | "Fluvial" | "";
  coordinateFormat: string;
  geographicArea?: {
    fileName?: string;
    pointsCount: number;
    areaM2: number;
    areaHa: number;
  };
  implantationArea?: {
    fileName?: string;
    pointsCount: number;
    areaM2: number;
    areaHa: number;
  };
}

const INITIAL_FORM: ProjectFormState = {
  title: "",
  description: "",
  tipo: "",
  report_per: "6 meses",
  start_date: "",
  visualization_url: "",
  location: {
    province: "Galápagos",
    canton: "",
    parish: "",
    reference: "",
  },
  ciiu: {},
  zoneType: "",
  coordinateFormat: "UTM WGS84 Zona 17 Sur",
};

function CiiuPicker({
  label,
  value,
  onChange,
  entries,
  excludedCodes,
  required,
}: {
  label: string;
  value?: { code: string; description: string };
  onChange: (value: CiiuSelection) => void;
  entries: CiiuEntry[];
  excludedCodes: string[];
  required?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const results = searchCiiu(entries, query).filter((entry) => {
      if (!excludedCodes.includes(entry.code)) return true;
      return value?.code === entry.code;
    });
    console.debug(`🔍 ${label}: Total entries=${entries.length}, Filtered=${results.length}, Query='${query}'`);
    return results;
  }, [entries, query, excludedCodes, value, label]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="space-y-2">
        <Input
          value={value ? `${value.code} - ${value.description}` : query}
          onFocus={() => {
            console.debug(`📍 ${label}: Input enfocado, total entries disponibles: ${entries.length}`);
            setOpen(true);
          }}
          onChange={(e) => {
            console.debug(`✏️ ${label}: Escribiendo '${e.target.value}'`);
            onChange(undefined);
            setQuery(e.target.value);
            setOpen(true);
          }}
          placeholder="Buscar por codigo o descripcion"
          required={required}
        />
        {open && (
          <div className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-white">
            {filtered.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">Sin resultados nivel 6</p>
            ) : (
              filtered.map((entry) => (
                <button
                  type="button"
                  key={entry.code}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50"
                  onClick={() => {
                    console.debug(`✅ ${label}: Seleccionado ${entry.code} - ${entry.description}`);
                    onChange({ code: entry.code, description: entry.description });
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  {entry.code} - {entry.description}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlansPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isViewer = session?.user?.role === "VIEWER";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ProjectFormState>(INITIAL_FORM);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    visualization_url: "",
    tipo: "",
    report_per: "6 meses",
    start_date: "",
  });

  const [ciiuCatalog, setCiiuCatalog] = useState<CiiuEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const provinces = useMemo(() => Object.keys(RGDP_LOCATION_TREE), []);
  const cantons = useMemo(() => {
    return form.location.province
      ? Object.keys(RGDP_LOCATION_TREE[form.location.province] ?? {})
      : [];
  }, [form.location.province]);
  const parishes = useMemo(() => {
    if (!form.location.province || !form.location.canton) return [];
    return RGDP_LOCATION_TREE[form.location.province]?.[form.location.canton] ?? [];
  }, [form.location.province, form.location.canton]);

  async function loadPlans() {
    const res = await fetch("/pg/api/plans");
    if (res.ok) setPlans(await res.json());
  }

  useEffect(() => {
    loadPlans();
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;

    const run = async () => {
      setCatalogLoading(true);
      try {
        const entries = await loadCiiuCatalog();
        if (active) setCiiuCatalog(entries);
      } catch (error) {
        toast.error((error as Error).message);
      } finally {
        if (active) setCatalogLoading(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [open]);

  function validateProjectForm(state: ProjectFormState): string | null {
    if (state.title.trim().length < 1 || state.title.trim().length > 500) {
      return "Nombre del proyecto: 1 a 500 caracteres";
    }

    if (state.description.trim().length < 25 || state.description.trim().length > 2500) {
      return "Resumen del proyecto: 25 a 2500 caracteres";
    }

    if (!state.location.province || !state.location.canton || !state.location.parish) {
      return "Provincia, canton y parroquia son obligatorios";
    }

    if (!state.ciiu.principal) {
      return "Actividad principal CIIU es obligatoria";
    }

    const codes = [
      state.ciiu.principal?.code,
      state.ciiu.complementary1?.code,
      state.ciiu.complementary2?.code,
    ].filter((v): v is string => Boolean(v));

    if (new Set(codes).size !== codes.length) {
      return "No se pueden repetir codigos CIIU";
    }

    if (!state.zoneType) {
      return "Tipo de zona es obligatorio";
    }

    if (!state.coordinateFormat) {
      return "Formato de coordenadas es obligatorio";
    }

    return null;
  }

  async function handleCoordinateUpload(
    file: File,
    areaType: "geographicArea" | "implantationArea"
  ) {
    if (!isCoordinateFileNameAllowed(file.name)) {
      toast.error("Formato no permitido. Usa .xlsx, .xls o .csv");
      return;
    }

    try {
      const parsed = await parseCoordinateFile(file);
      setForm((prev) => ({
        ...prev,
        [areaType]: {
          fileName: file.name,
          pointsCount: parsed.pointsCount,
          areaM2: parsed.areaM2,
          areaHa: parsed.areaHa,
        },
      }));

      toast.success(`Archivo procesado: ${parsed.pointsCount} puntos`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function handleDownloadTemplate() {
    console.log("📥 Usuario solicitó descargar plantilla...");
    setDownloadingTemplate(true);
    try {
      await convertCsvToXlsx(
        "/templates/plantilla-coordenadas.csv",
        "plantilla-coordenadas.xlsx"
      );
      toast.success("Plantilla descargada correctamente en formato Excel");
    } catch (error) {
      console.error("❌ Error descargando plantilla:", error);
      toast.error("Error al descargar la plantilla");
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    const validationError = validateProjectForm(form);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setLoading(true);

    const res = await fetch("/pg/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setLoading(false);

    if (res.ok) {
      toast.success("Proyecto creado correctamente");
      setForm(INITIAL_FORM);
      setOpen(false);
      loadPlans();
    } else {
      const data = await res.json();
      toast.error(data.error || "Error al crear proyecto");
    }
  }

  function openEdit(plan: Plan) {
    setEditingPlan(plan);
    setEditForm({
      title: plan.title,
      description: plan.description || "",
      visualization_url: plan.visualization_url || "",
      tipo: plan.tipo || "",
      report_per: plan.report_per || "6 meses",
      start_date: plan.start_date || "",
    });
    setEditOpen(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPlan) return;
    setLoading(true);

    const res = await fetch(`/pg/api/plans/${editingPlan.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editingPlan, ...editForm }),
    });

    setLoading(false);

    if (res.ok) {
      toast.success("Proyecto actualizado correctamente");
      setEditOpen(false);
      setEditingPlan(null);
      loadPlans();
    } else {
      const data = await res.json();
      toast.error(data.error || "Error al actualizar proyecto");
    }
  }

  const excludedForComplementary1 = useMemo(
    () => [form.ciiu.principal?.code].filter((v): v is string => Boolean(v)),
    [form.ciiu.principal?.code]
  );

  const excludedForComplementary2 = useMemo(
    () => [form.ciiu.principal?.code, form.ciiu.complementary1?.code].filter(
      (v): v is string => Boolean(v)
    ),
    [form.ciiu.principal?.code, form.ciiu.complementary1?.code]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{isAdmin ? "Proyectos" : "Mis Proyectos"}</h1>
          <p className="text-muted-foreground">
            {isAdmin ? "Gestionar proyectos RGDP" : "Proyectos asignados a ti"}
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
              Agregar Proyecto
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Agregar Proyecto</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-4">
                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="text-sm font-semibold">UBICACION DEL PROYECTO</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Provincia</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={form.location.province}
                        disabled
                        required
                      >
                        {provinces.map((province) => (
                          <option key={province} value={province}>
                            {province}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Canton</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={form.location.canton}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            location: {
                              ...prev.location,
                              canton: e.target.value,
                              parish: "",
                            },
                          }))
                        }
                        disabled={!form.location.province}
                        required
                      >
                        <option value="">Seleccionar...</option>
                        {cantons.map((canton) => (
                          <option key={canton} value={canton}>
                            {canton}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Parroquia</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={form.location.parish}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            location: {
                              ...prev.location,
                              parish: e.target.value,
                            },
                          }))
                        }
                        disabled={!form.location.canton}
                        required
                      >
                        <option value="">Seleccionar...</option>
                        {parishes.map((parish) => (
                          <option key={parish} value={parish}>
                            {parish}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Direccion o referencia (opcional)</Label>
                    <textarea
                      className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.location.reference}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          location: { ...prev.location, reference: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="text-sm font-semibold">CLASIFICACION DE ACTIVIDAD (CIIU)</h3>
                  {catalogLoading && <p className="text-xs text-muted-foreground">Cargando catalogo CIIU...</p>}
                  <CiiuPicker
                    label="Actividad principal"
                    value={form.ciiu.principal}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, ciiu: { ...prev.ciiu, principal: value } }))
                    }
                    entries={ciiuCatalog}
                    excludedCodes={[]}
                    required
                  />
                  <CiiuPicker
                    label="Actividad complementaria 1"
                    value={form.ciiu.complementary1}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, ciiu: { ...prev.ciiu, complementary1: value } }))
                    }
                    entries={ciiuCatalog}
                    excludedCodes={excludedForComplementary1}
                  />
                  <CiiuPicker
                    label="Actividad complementaria 2"
                    value={form.ciiu.complementary2}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, ciiu: { ...prev.ciiu, complementary2: value } }))
                    }
                    entries={ciiuCatalog}
                    excludedCodes={excludedForComplementary2}
                  />
                </div>

                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="text-sm font-semibold">INFORMACION GENERAL DEL PROYECTO</h3>
                  <div className="space-y-2">
                    <Label>Nombre del proyecto</Label>
                    <Input
                      value={form.title}
                      onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                      minLength={1}
                      maxLength={500}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Resumen del proyecto</Label>
                    <textarea
                      className="flex min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.description}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, description: e.target.value }))
                      }
                      minLength={25}
                      maxLength={2500}
                      required
                    />
                  </div>
                </div>

                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="text-sm font-semibold">TIPO DE ZONA</h3>
                  <div className="flex flex-wrap gap-4">
                    {(["Urbana", "Rural", "Maritima", "Fluvial"] as const).map((zone) => (
                      <label key={zone} className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="zoneType"
                          checked={form.zoneType === zone}
                          onChange={() => setForm((prev) => ({ ...prev, zoneType: zone }))}
                        />
                        {zone}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="text-sm font-semibold">COORDENADAS DEL AREA GEOGRAFICA</h3>
                  <div className="space-y-2">
                    <Label>Formato de coordenadas</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.coordinateFormat}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, coordinateFormat: e.target.value }))
                      }
                    >
                      {COORDINATE_FORMAT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={downloadingTemplate}
                      onClick={(e) => {
                        e.preventDefault();
                        void handleDownloadTemplate();
                      }}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {downloadingTemplate ? "Descargando..." : "Descargar plantilla Excel"}
                    </Button>
                    <label className="inline-flex">
                      <input
                        type="file"
                        className="hidden"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleCoordinateUpload(file, "geographicArea");
                        }}
                      />
                      <span className="inline-flex h-10 cursor-pointer items-center rounded-md border border-input px-4 text-sm">
                        <Upload className="w-4 h-4 mr-2" /> Adjuntar archivo Excel
                      </span>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Superficie total en hectareas</Label>
                      <Input value={String(form.geographicArea?.areaHa ?? "")} readOnly />
                    </div>
                    <div className="space-y-1">
                      <Label>Superficie total en metros cuadrados</Label>
                      <Input value={String(form.geographicArea?.areaM2 ?? "")} readOnly />
                    </div>
                  </div>
                </div>

                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="text-sm font-semibold">COORDENADAS DEL AREA DE IMPLANTACION</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={downloadingTemplate}
                      onClick={(e) => {
                        e.preventDefault();
                        void handleDownloadTemplate();
                      }}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {downloadingTemplate ? "Descargando..." : "Descargar plantilla Excel"}
                    </Button>
                    <label className="inline-flex">
                      <input
                        type="file"
                        className="hidden"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleCoordinateUpload(file, "implantationArea");
                        }}
                      />
                      <span className="inline-flex h-10 cursor-pointer items-center rounded-md border border-input px-4 text-sm">
                        <Upload className="w-4 h-4 mr-2" /> Adjuntar archivo Excel
                      </span>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Superficie total en hectareas</Label>
                      <Input value={String(form.implantationArea?.areaHa ?? "")} readOnly />
                    </div>
                    <div className="space-y-1">
                      <Label>Superficie total en metros cuadrados</Label>
                      <Input value={String(form.implantationArea?.areaM2 ?? "")} readOnly />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.tipo}
                      onChange={(e) => setForm((prev) => ({ ...prev, tipo: e.target.value }))}
                      required
                    >
                      <option value="" disabled>Seleccionar tipo...</option>
                      {PLAN_TIPO_VALUES.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Reporte</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.report_per}
                      onChange={(e) => setForm((prev) => ({ ...prev, report_per: e.target.value }))}
                    >
                      {PLAN_REPORTE_VALUES.map(reporte => <option key={reporte} value={reporte}>{reporte}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Fecha de inicio</Label>
                    <Input
                      type="date"
                      value={form.start_date}
                      onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>URL de Visualización (Opcional)</Label>
                    <Input
                      type="url"
                      placeholder="https://ejemplo.com"
                      value={form.visualization_url}
                      onChange={(e) => setForm((prev) => ({ ...prev, visualization_url: e.target.value }))}
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Guardando..." : "Siguiente"}
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
              {isAdmin ? "Sin proyectos aun. Crea uno para comenzar." : "Aun no tienes proyectos asignados."}
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
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {plan.description || "Sin resumen"}
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Provincia:</span>
                    <span className="text-xs font-medium bg-slate-100 px-2 py-0.5 rounded">
                      {plan.location?.province || "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">CIIU principal:</span>
                    <span className="text-xs font-medium bg-slate-100 px-2 py-0.5 rounded max-w-[170px] truncate" title={plan.ciiu?.principal?.code}>
                      {plan.ciiu?.principal?.code || "-"}
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
                    {plan.visualization_url && (
                      <Button
                        className="bg-black text-white hover:bg-slate-800"
                        size="sm"
                        onClick={() => window.open(plan.visualization_url, "_blank")}
                      >
                        <Map className="w-4 h-4 mr-1" />
                        Visualizar
                      </Button>
                    )}
                    {isAdmin && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(plan)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    <a href={`/pg/plans/${plan.id}`}>
                      <Button variant="ghost" size="sm">
                        Ver <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Proyecto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Nombre del proyecto</Label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Resumen</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={editForm.description}
                onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={editForm.tipo}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, tipo: e.target.value }))}
                  required
                >
                  <option value="" disabled>Seleccionar tipo...</option>
                  {PLAN_TIPO_VALUES.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Reporte</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={editForm.report_per}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, report_per: e.target.value }))}
                >
                  {PLAN_REPORTE_VALUES.map(reporte => <option key={reporte} value={reporte}>{reporte}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Fecha de inicio</Label>
                <Input
                  type="date"
                  value={editForm.start_date}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, start_date: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>URL de Visualización (Opcional)</Label>
                <Input
                  type="url"
                  placeholder="https://ejemplo.com"
                  value={editForm.visualization_url}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, visualization_url: e.target.value }))}
                />
              </div>
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
