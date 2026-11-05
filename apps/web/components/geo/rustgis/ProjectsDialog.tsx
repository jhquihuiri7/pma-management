"use client";

import { useEffect, useMemo, useState } from "react";
import { FileUp, FolderOpen, Loader2, Map as MapIcon, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api-client";
import type { ProjectSummary, ReadableMap } from "./types";

type Tab = "projects" | "maps" | "import";

const MAX_LEGACY_FILE_BYTES = 2 * 1024 * 1024;

export default function ProjectsDialog({
  currentProjectId,
  onClose,
  onOpenProject,
  onOpenMap,
  onImportLegacy,
}: {
  currentProjectId: string | null;
  onClose: () => void;
  onOpenProject: (id: string) => Promise<void>;
  onOpenMap: (id: string) => Promise<void>;
  onImportLegacy: (title: string, document: unknown) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [maps, setMaps] = useState<ReadableMap[] | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.get<ProjectSummary[]>("/geo/workspace/v1/projects")
      .then(setProjects)
      .catch((e) => toast.error(apiErrorMessage(e, "No se pudieron cargar tus proyectos")));
  }, []);

  useEffect(() => {
    if (tab !== "maps" || maps) return;
    api.get<ReadableMap[]>("/geo/workspace/v1/maps")
      .then(setMaps)
      .catch((e) => toast.error(apiErrorMessage(e, "No se pudieron cargar los mapas")));
  }, [tab, maps]);

  const visibleMaps = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!needle || !maps) return maps ?? [];
    return maps.filter((m) =>
      `${m.title} ${m.thematic}`.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(needle),
    );
  }, [maps, filter]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e, "No se pudo completar la acción"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(project: ProjectSummary) {
    if (!window.confirm(`¿Eliminar el proyecto «${project.title}»? No se borra ninguna capa del geoportal.`)) return;
    setBusy(`delete:${project.id}`);
    try {
      await api.delete(`/geo/workspace/v1/projects/${project.id}`);
      setProjects((current) => (current ?? []).filter((p) => p.id !== project.id));
      toast.success("Proyecto eliminado");
    } catch (e) {
      toast.error(apiErrorMessage(e, "No se pudo eliminar el proyecto"));
    } finally {
      setBusy(null);
    }
  }

  async function importFile(file: File) {
    if (file.size > MAX_LEGACY_FILE_BYTES) {
      toast.error("El archivo supera el límite de 2 MB");
      return;
    }
    let document: unknown;
    try {
      document = JSON.parse(await file.text());
    } catch {
      toast.error("El archivo no contiene JSON válido");
      return;
    }
    const title = file.name.replace(/\.json$/i, "").replace(/^sigtar-workspace-?/i, "") || "Workspace importado";
    await run("import", () => onImportLegacy(`Workspace ${title}`, document));
  }

  const tabClass = (t: Tab) =>
    `rounded-md px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-100"}`;

  return (
    <div className="fixed inset-0 z-[1300] grid place-items-center bg-black/45 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Abrir en el Workspace"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Abrir en el Workspace</h2>
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose} aria-label="Cerrar" disabled={!!busy}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-1 border-b border-slate-200 px-5 py-2">
          <button type="button" className={tabClass("projects")} onClick={() => setTab("projects")}>Mis proyectos</button>
          <button type="button" className={tabClass("maps")} onClick={() => setTab("maps")}>Mapas del geoportal</button>
          <button type="button" className={tabClass("import")} onClick={() => setTab("import")}>Importar Workspace anterior</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "projects" && (
            projects === null ? (
              <p className="flex items-center gap-2 p-3 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</p>
            ) : projects.length === 0 ? (
              <p className="p-3 text-xs text-slate-500">Aún no tienes proyectos guardados. Abre un mapa o añade capas y pulsa «Guardar».</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {projects.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-2 py-2">
                    <FolderOpen className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-800">
                        {p.title} {p.id === currentProjectId && <span className="text-[10px] text-teal-700">(abierto)</span>}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {p.layerCount} capa{p.layerCount === 1 ? "" : "s"} del catálogo · {new Date(p.updatedAt).toLocaleString("es-EC")}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="h-7 rounded-md bg-teal-600 px-3 text-xs font-medium text-white hover:bg-teal-700 disabled:bg-slate-300"
                      disabled={!!busy}
                      onClick={() => void run(`open:${p.id}`, () => onOpenProject(p.id))}
                    >
                      {busy === `open:${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Abrir"}
                    </button>
                    <button
                      type="button"
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      disabled={!!busy}
                      onClick={() => void remove(p)}
                      aria-label={`Eliminar ${p.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === "maps" && (
            <div className="space-y-2">
              <input
                className="h-8 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:ring-2 focus:ring-teal-500"
                placeholder="Filtrar mapas…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {maps === null ? (
                <p className="flex items-center gap-2 p-3 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {visibleMaps.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-2 py-2">
                      <MapIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-800">{m.title}</p>
                        {m.thematic && <p className="truncate text-[11px] text-slate-500">{m.thematic}</p>}
                      </div>
                      <button
                        type="button"
                        className="h-7 rounded-md bg-teal-600 px-3 text-xs font-medium text-white hover:bg-teal-700 disabled:bg-slate-300"
                        disabled={!!busy}
                        onClick={() => void run(`map:${m.id}`, () => onOpenMap(m.id))}
                      >
                        {busy === `map:${m.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Abrir"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "import" && (
            <div className="space-y-3 p-2 text-sm text-slate-600">
              <p>
                Elige un archivo <code className="rounded bg-slate-100 px-1">sigtar-workspace-….json</code> descargado del Workspace anterior.
                Se crea un proyecto nuevo con sus capas; el archivo no se modifica.
              </p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                Elegir archivo
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  disabled={!!busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void importFile(file);
                  }}
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
