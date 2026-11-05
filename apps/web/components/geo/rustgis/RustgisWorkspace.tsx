"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Bot, Download, FolderOpen, Loader2, PanelLeft, Save, SaveAll, X,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage, ApiError, auth } from "@/lib/api-client";
import { BridgeError, RustgisBridge } from "./bridge";
import CatalogSearchPanel from "./CatalogSearchPanel";
import ProjectsDialog from "./ProjectsDialog";
import { absoluteUrl, blankProject, inspectProject, withTileLayer } from "./projectRefs";
import type { CatalogItem, OpenedProject, ProjectSummary, WorkspaceConfig, WorkspaceNotice } from "./types";

/**
 * The Workspace with RustGIS (docs/plan-integracion-rustgis.md): RustGIS Web in a
 * same-origin iframe (`?embed`), the geoportal's catalog search beside it, and
 * projects saved on the server. The page always holds the last project JSON
 * RustGIS posted, which is what «Guardar» stores.
 */

interface CurrentProject {
  id: string | null;
  title: string;
  revision: number | null;
  sourceMapId: string | null;
}

const KEEPALIVE_MS = 10 * 60_000;
const ADD_TIMEOUT_MS = 120_000;
/**
 * RustGIS is ~47 MB of WebAssembly: on a slow computer (or one drawing without a
 * GPU) it can take minutes to start. Past SLOW_START_MS the page says so and
 * offers the classic Workspace, but keeps waiting; only START_TIMEOUT_MS gives up.
 */
const SLOW_START_MS = 45_000;
const START_TIMEOUT_MS = 15 * 60_000;
const NEW_PROJECT: CurrentProject = { id: null, title: "Proyecto nuevo", revision: null, sourceMapId: null };

const NOTICE_TEXT: Record<WorkspaceNotice["kind"], string> = {
  unavailable: "ya no está disponible",
  updated: "se actualizó",
  preparing: "se está preparando",
  copy: "es una copia",
  tiles: "se muestra con teselas",
};

export default function RustgisWorkspace({ config }: { config: WorkspaceConfig }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<RustgisBridge | null>(null);
  const [appStatus, setAppStatus] = useState<"loading" | "slow" | "ready" | "error">("loading");
  const [project, setProject] = useState<CurrentProject>(NEW_PROJECT);
  const projectRef = useRef(project);
  const [projectText, setProjectText] = useState<string | null>(null);
  const projectTextRef = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [notices, setNotices] = useState<WorkspaceNotice[]>([]);
  const [showCatalog, setShowCatalog] = useState(true);
  const [dialog, setDialog] = useState<null | "open" | "save">(null);
  const [saveTitle, setSaveTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Map<string, number>>(new Map());
  const [sessionLost, setSessionLost] = useState(false);

  useEffect(() => { projectRef.current = project; }, [project]);
  const setText = useCallback((text: string | null) => {
    projectTextRef.current = text;
    setProjectText(text);
  }, []);
  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  const info = useMemo(() => (projectText ? inspectProject(projectText) : null), [projectText]);
  const presentKeys = useMemo(() => info?.keys ?? new Set<string>(), [info]);
  const pendingKeys = useMemo(() => new Set(Array.from(pending.keys())), [pending]);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  // A pending addition is done once RustGIS posts a project containing it.
  useEffect(() => {
    if (pending.size === 0) return;
    const now = Date.now();
    let changed = false;
    const next = new Map(pending);
    pending.forEach((started, key) => {
      if (presentKeys.has(key)) {
        next.delete(key);
        changed = true;
      } else if (now - started > ADD_TIMEOUT_MS) {
        next.delete(key);
        changed = true;
        toast.warning("Una capa no terminó de cargarse. Revisa el aviso de RustGIS en el mapa.");
      }
    });
    if (changed) setPending(next);
  }, [presentKeys, pending]);

  useEffect(() => {
    if (pending.size === 0) return;
    const timer = window.setInterval(() => setPending((p) => new Map(p)), 10_000);
    return () => window.clearInterval(timer);
  }, [pending.size]);

  /** Sends a project to RustGIS and waits for it to confirm it opened. */
  const openText = useCallback(async (text: string, meta: CurrentProject, found: WorkspaceNotice[]) => {
    const bridge = bridgeRef.current;
    if (!bridge) throw new Error("RustGIS no está cargado");
    await bridge.openProject(text);
    setText(text);
    setProject(meta);
    markDirty(false);
    setPending(new Map());
    setNotices(found);
    const url = new URL(window.location.href);
    url.searchParams.delete("map");
    url.searchParams.delete("proyecto");
    if (meta.id) url.searchParams.set("proyecto", meta.id);
    else if (meta.sourceMapId) url.searchParams.set("map", meta.sourceMapId);
    window.history.replaceState(null, "", url);
    if (found.length > 0) toast.warning(`${found.length} aviso${found.length === 1 ? "" : "s"} al abrir el proyecto`);
  }, [markDirty, setText]);

  const openMap = useCallback(async (mapId: string) => {
    const opened = await api.post<OpenedProject>(`/geo/workspace/v1/maps/${mapId}/open`, { origin: window.location.origin }, { timeoutMs: 60_000 });
    await openText(opened.project, { id: null, title: opened.title, revision: null, sourceMapId: opened.sourceMapId ?? mapId }, opened.notices);
  }, [openText]);

  const openSaved = useCallback(async (id: string) => {
    const opened = await api.post<OpenedProject>(`/geo/workspace/v1/projects/${id}/open`, { origin: window.location.origin }, { timeoutMs: 60_000 });
    await openText(opened.project, { id, title: opened.title, revision: opened.revision ?? null, sourceMapId: opened.sourceMapId ?? null }, opened.notices);
  }, [openText]);

  // RustGIS in the iframe: listen first, then load it.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = new RustgisBridge({ target: () => iframe.contentWindow, origin: window.location.origin, host: window });
    bridgeRef.current = bridge;
    const offProject = bridge.onProject((text) => {
      setText(text);
      markDirty(true);
    });
    iframe.src = `${config.appPath}index.html?embed&lang=es`;
    let cancelled = false;
    // RustGIS says `ready` once; if that went before we listened, any answer will do.
    const probe = window.setInterval(() => {
      if (bridge.isReady) return;
      bridge.run("ui.language", { code: "es" }, 2_500).then(() => bridge.markReady(), (e) => {
        if (e instanceof BridgeError && e.kind === "app") bridge.markReady();
      });
    }, 3_000);
    const slow = window.setTimeout(() => {
      if (!cancelled && !bridge.isReady) setAppStatus("slow");
    }, SLOW_START_MS);
    (async () => {
      try {
        await bridge.whenReady(START_TIMEOUT_MS);
        window.clearInterval(probe);
        window.clearTimeout(slow);
        if (cancelled) return;
        setAppStatus("ready");
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get("proyecto");
        const mapId = params.get("map");
        try {
          if (projectId) await openSaved(projectId);
          else if (mapId) await openMap(mapId);
          else await openText(blankProject(), NEW_PROJECT, []);
        } catch (e) {
          toast.error(apiErrorMessage(e, "No se pudo abrir el proyecto"));
          await openText(blankProject(), NEW_PROJECT, []).catch(() => undefined);
        }
      } catch {
        window.clearInterval(probe);
        window.clearTimeout(slow);
        if (!cancelled) setAppStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      window.clearInterval(probe);
      window.clearTimeout(slow);
      offProject();
      bridge.close();
      bridgeRef.current = null;
    };
  }, [config.appPath, markDirty, openMap, openSaved, openText, setText]);

  // The session cookie lasts 15 min and RustGIS can't renew it: the page does.
  useEffect(() => {
    const timer = window.setInterval(() => {
      auth.refresh().then(() => setSessionLost(false), () => setSessionLost(true));
    }, KEEPALIVE_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function addItem(item: CatalogItem, mode: "stream" | "copy") {
    const bridge = bridgeRef.current;
    if (!bridge || appStatus !== "ready") return;
    if (presentKeys.has(item.key)) {
      toast.info("Esa capa ya está en el mapa");
      return;
    }
    try {
      if (mode === "stream" && item.load.mode === "tiles" && item.load.path) {
        // A COG RustGIS can't decode: a tile layer, which only enters with the project.
        if (pending.size > 0) {
          toast.warning("Espera a que terminen de llegar las capas que se están añadiendo.");
          return;
        }
        const base = projectTextRef.current ?? blankProject();
        const next = withTileLayer(base, { name: item.name, url: absoluteUrl(origin, item.load.path) });
        setBusy(item.key);
        await bridge.openProject(next);
        setText(next);
        markDirty(true);
        toast.success(`«${item.name}» añadida (teselas)`);
        return;
      }
      const path = mode === "copy" ? item.load.copyPath : item.load.path;
      if (!path) {
        toast.info("Esta capa aún se está preparando para el Workspace. Prueba en unos minutos o añádela como copia.");
        return;
      }
      if (mode === "copy" && item.kind === "vector" && item.sizeBytes > 20 * 1024 * 1024) {
        const ok = window.confirm("La copia guarda todos los datos dentro del proyecto y viaja con cada cambio. ¿Continuar?");
        if (!ok) return;
      }
      const params: Record<string, unknown> = { url: absoluteUrl(origin, path), name: item.name, zoom: true };
      if (mode === "copy" && item.kind === "raster") params.whole = true;
      setPending((current) => new Map(current).set(item.key, Date.now()));
      await bridge.run("ui.addUrl", params);
    } catch (e) {
      setPending((current) => {
        const next = new Map(current);
        next.delete(item.key);
        return next;
      });
      toast.error(e instanceof Error ? e.message : "No se pudo añadir la capa");
    } finally {
      setBusy(null);
    }
  }

  async function save(asNewTitle?: string) {
    const text = projectTextRef.current;
    if (!text) return;
    if (text.length > config.maxProjectBytes) {
      toast.error("El proyecto es demasiado grande para guardarse: quita las copias de datos o los archivos propios.");
      return;
    }
    setBusy("save");
    try {
      const current = projectRef.current;
      if (current.id && !asNewTitle) {
        const saved = await api.put<ProjectSummary>(
          `/geo/workspace/v1/projects/${current.id}`,
          { project: text, baseRevision: current.revision },
          { timeoutMs: 120_000 },
        );
        setProject({ ...current, revision: saved.revision });
      } else {
        const title = asNewTitle ?? current.title;
        const saved = await api.post<ProjectSummary>(
          "/geo/workspace/v1/projects",
          { title, project: text, sourceMapId: current.sourceMapId },
          { timeoutMs: 120_000 },
        );
        setProject({ id: saved.id, title: saved.title, revision: saved.revision, sourceMapId: saved.sourceMapId });
        const url = new URL(window.location.href);
        url.searchParams.delete("map");
        url.searchParams.set("proyecto", saved.id);
        window.history.replaceState(null, "", url);
      }
      // A change that arrived while saving keeps the project dirty.
      markDirty(projectTextRef.current !== text);
      toast.success("Proyecto guardado");
      setDialog(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error("Otro guardado se adelantó. Usa «Guardar como» para conservar tu versión.");
      } else {
        toast.error(apiErrorMessage(e, "No se pudo guardar el proyecto"));
      }
    } finally {
      setBusy(null);
    }
  }

  async function importLegacy(title: string, document: unknown) {
    const created = await api.post<OpenedProject & ProjectSummary>(
      "/geo/workspace/v1/projects/import-legacy",
      { title, document, origin: window.location.origin },
      { timeoutMs: 60_000 },
    );
    await openText(created.project, { id: created.id, title: created.title, revision: created.revision, sourceMapId: null }, created.notices);
  }

  function leave(event: React.MouseEvent<HTMLAnchorElement>) {
    if (dirtyRef.current && !window.confirm("El proyecto tiene cambios sin guardar. ¿Salir de todas formas?")) {
      event.preventDefault();
    }
  }

  const ready = appStatus === "ready";
  const btn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <a href="/geo/dashboard" onClick={leave} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
          <ArrowLeft className="h-4 w-4" /> Geoportal
        </a>
        <button type="button" className={btn} onClick={() => setShowCatalog((v) => !v)} aria-pressed={showCatalog} title="Catálogo">
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 px-1">
          <p className="truncate text-sm font-semibold text-slate-900" title={project.title}>{project.title}</p>
          <p className="text-[11px] text-slate-500">
            {dirty ? "Cambios sin guardar" : project.id ? "Guardado" : "Sin guardar"}
            {info ? ` · ${info.layerCount} capa${info.layerCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className={btn} disabled={!ready || !!busy} onClick={() => setDialog("open")}>
            <FolderOpen className="h-4 w-4" /> Abrir
          </button>
          <button
            type="button"
            className={btn}
            disabled={!ready || !!busy || !projectText}
            onClick={() => (project.id ? void save() : (setSaveTitle(project.title), setDialog("save")))}
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
          </button>
          <button type="button" className={btn} disabled={!ready || !!busy || !projectText} onClick={() => { setSaveTitle(`${project.title} (copia)`); setDialog("save"); }}>
            <SaveAll className="h-4 w-4" /> Guardar como
          </button>
          {project.id && (
            <a className={btn} href={`/api-proxy/geo/workspace/v1/projects/${project.id}/legacy.json`} title="Descargar para el Workspace clásico">
              <Download className="h-4 w-4" /> Workspace clásico
            </a>
          )}
          {config.ai.enabled && (
            <button type="button" className={btn} disabled={!ready} onClick={() => void bridgeRef.current?.run("ui.pane.assistant", {}).catch(() => undefined)}>
              <Bot className="h-4 w-4" /> Asistente
            </button>
          )}
        </div>
      </header>

      {sessionLost && (
        <div className="flex items-center gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          Tu sesión expiró: los datos y el asistente dejarán de responder.
          <a className="font-medium underline" href={`/login?next=${encodeURIComponent("/geo/workspace" + window.location.search)}`}>Volver a iniciar sesión</a>
        </div>
      )}

      {notices.length > 0 && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <ul className="min-w-0 flex-1 space-y-0.5">
            {notices.slice(0, 6).map((n, i) => (
              <li key={`${n.kind}-${n.name}-${i}`}>
                <span className="font-medium">{n.name}</span> {NOTICE_TEXT[n.kind]}{n.detail ? `: ${n.detail}.` : "."}
              </li>
            ))}
            {notices.length > 6 && <li>y {notices.length - 6} aviso(s) más.</li>}
          </ul>
          <button type="button" className="rounded p-1 hover:bg-amber-100" onClick={() => setNotices([])} aria-label="Cerrar avisos">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {showCatalog && (
          <aside className="w-[22rem] shrink-0 border-r border-slate-200 bg-white">
            <CatalogSearchPanel presentKeys={presentKeys} pendingKeys={pendingKeys} disabled={!ready || busy === "save"} onAdd={(item, mode) => void addItem(item, mode)} />
          </aside>
        )}
        <main className="relative min-w-0 flex-1">
          <iframe
            ref={iframeRef}
            title="RustGIS"
            className="h-full w-full border-0 bg-white"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
          {(appStatus === "loading" || appStatus === "error") && (
            <div className="absolute inset-0 grid place-items-center bg-white/90 text-sm text-slate-600">
              {appStatus === "loading" ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando RustGIS…</span>
              ) : (
                <span className="max-w-sm text-center">
                  RustGIS no pudo iniciarse. Se necesita un navegador con WebGPU o WebGL2.{" "}
                  <a className="text-teal-700 underline" href="/geo/workspace/clasico">Abrir el Workspace clásico</a>
                </span>
              )}
            </div>
          )}
          {appStatus === "slow" && (
            // Not over the frame: RustGIS's own message (e.g. no WebGL2) must stay visible.
            <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span>
                RustGIS está tardando en cargar. Necesita un navegador con WebGPU o WebGL2; si no aparece,{" "}
                <a className="font-medium underline" href="/geo/workspace/clasico">abre el Workspace clásico</a>.
              </span>
            </div>
          )}
        </main>
      </div>

      {dialog === "open" && (
        <ProjectsDialog
          currentProjectId={project.id}
          onClose={() => setDialog(null)}
          onOpenProject={async (id) => {
            if (dirtyRef.current && !window.confirm("Hay cambios sin guardar. ¿Abrir otro proyecto?")) return;
            await openSaved(id);
          }}
          onOpenMap={async (id) => {
            if (dirtyRef.current && !window.confirm("Hay cambios sin guardar. ¿Abrir otro proyecto?")) return;
            await openMap(id);
          }}
          onImportLegacy={importLegacy}
        />
      )}

      {dialog === "save" && (
        <div className="fixed inset-0 z-[1300] grid place-items-center bg-black/45 p-4" onClick={() => { if (!busy) setDialog(null); }}>
          <form
            className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const title = saveTitle.trim();
              if (title) void save(title);
            }}
          >
            <h2 className="text-sm font-semibold text-slate-900">Guardar proyecto</h2>
            <input
              className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm outline-none focus:ring-2 focus:ring-teal-500"
              value={saveTitle}
              maxLength={200}
              onChange={(e) => setSaveTitle(e.target.value)}
              autoFocus
              aria-label="Título del proyecto"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setDialog(null)} disabled={!!busy}>Cancelar</button>
              <button type="submit" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-600 px-3 text-xs font-medium text-white hover:bg-teal-700 disabled:bg-slate-300" disabled={!!busy || !saveTitle.trim()}>
                {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
