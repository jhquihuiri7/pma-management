"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import PrevieneMap, { type PrevieneMapHandle } from "@/components/previene/PrevieneMap";
import PrevieneFilters, { DEFAULT_RANGE, type FilterState } from "@/components/previene/PrevieneFilters";
import ReportTable, { type SortDir, type SortKey } from "@/components/previene/ReportTable";
import ReportDetail from "@/components/previene/ReportDetail";
import MapLegend from "@/components/previene/MapLegend";
import type { PrevieneEventType, PrevieneReport, PrevieneStatus } from "@/lib/previene";

type ViewMode = "split" | "map" | "table";

/**
 * Galápagos Previene — viewer for citizen reports of emergencies and natural
 * events sent through a Telegram bot.
 *
 * Everything rendered here comes from SIGTAR's own cache: the browser never
 * contacts the reports API (no CORS, loopback-only, bearer key that must stay
 * server-side), and evidence is streamed through the API's media proxy.
 */
export default function PrevienePage() {
  const { user } = useAuth();
  const mapRef = useRef<PrevieneMapHandle | null>(null);

  const [reports, setReports] = useState<PrevieneReport[]>([]);
  const [eventTypes, setEventTypes] = useState<PrevieneEventType[]>([]);
  const [status, setStatus] = useState<PrevieneStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [view, setView] = useState<ViewMode>("split");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("fecha");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [viewport, setViewport] = useState({ lat: -0.62, lng: -90.5, zoom: 8 });

  const [filters, setFilters] = useState<FilterState>({
    tipos: new Set<string>(),
    clases: new Set(["EVENT", "INCIDENT"]),
    ...DEFAULT_RANGE,
  });
  // Distinguishes "no types selected yet" (initial load) from "user unticked
  // everything", which must legitimately show zero reports.
  const typesInitialised = useRef(false);

  const load = useCallback(
    async (range: { desde: string; hasta: string }) => {
      setLoading(true);
      try {
        // An empty edge means "no bound", and it must be OMITTED rather than
        // sent blank: the server rejects `desde=`, and substituting a default
        // date is what silently hid every report past it.
        const query = new URLSearchParams();
        if (range.desde) query.set("desde", range.desde);
        if (range.hasta) query.set("hasta", range.hasta);
        const search = query.toString();

        const [reportList, types, state] = await Promise.all([
          api.get<PrevieneReport[]>(`/previene/api/reports${search ? `?${search}` : ""}`),
          api.get<PrevieneEventType[]>("/previene/api/event-types"),
          api.get<PrevieneStatus>("/previene/api/estado"),
        ]);
        setReports(reportList);
        setEventTypes(types);
        setStatus(state);
        setLoadError(null);
        if (!typesInitialised.current) {
          typesInitialised.current = true;
          setFilters((prev) => ({ ...prev, tipos: new Set(types.map((t) => t.code)) }));
        }
      } catch (error) {
        const message = apiErrorMessage(error, "No se pudieron cargar los reportes");
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load({ desde: filters.desde, hasta: filters.hasta });
    // The date range is the only server-side filter; type and class are applied
    // in the browser so ticking a box never costs a round trip.
  }, [load, filters.desde, filters.hasta]);

  // Switching view mode resizes the map container; Leaflet needs to be told.
  useEffect(() => {
    const timer = setTimeout(() => mapRef.current?.invalidate(), 70);
    return () => clearTimeout(timer);
  }, [view]);

  const visible = useMemo(
    () =>
      reports.filter((report) => {
        if (!filters.clases.has(report.reportKind)) return false;
        // Incidents carry no type, so the type filter must not exclude them.
        if (report.eventTypeCode && !filters.tipos.has(report.eventTypeCode)) return false;
        return true;
      }),
    [reports, filters.clases, filters.tipos]
  );

  const kindCounts = useMemo(
    () => ({
      EVENT: reports.filter((r) => r.reportKind === "EVENT").length,
      INCIDENT: reports.filter((r) => r.reportKind === "INCIDENT").length,
    }),
    [reports]
  );

  const selected = useMemo(
    () => visible.find((r) => r.id === selectedId) ?? null,
    [visible, selectedId]
  );

  const selectFromTable = (id: string) => {
    setSelectedId(id);
    mapRef.current?.focus(id);
  };

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir(key === "fecha" ? "desc" : "asc");
    }
  };

  const reset = () => {
    setFilters({
      tipos: new Set(eventTypes.map((t) => t.code)),
      clases: new Set(["EVENT", "INCIDENT"]),
      ...DEFAULT_RANGE,
    });
    setSelectedId(null);
    setTimeout(() => mapRef.current?.fitAll(), 80);
  };

  const retry = async () => {
    setSyncing(true);
    try {
      // Only an administrator can force a pull from upstream; everyone else
      // re-reads the cache, which is what recovers from a transient blip.
      if (user?.role === "ADMIN") {
        const result = await api.post<{ status: string; message?: string }>("/previene/api/sync", {});
        if (result.status === "error") toast.error(result.message ?? "La sincronización falló");
        else toast.success("Sincronización completada");
      }
      await load({ desde: filters.desde, hasta: filters.hasta });
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo sincronizar"));
    } finally {
      setSyncing(false);
    }
  };

  const degraded = Boolean(status?.degraded) || Boolean(loadError);
  const statusLabel = loadError
    ? "Sin respuesta del SIGTAR"
    : !status
      ? "Conectando…"
      : !status.configured
        ? "Módulo sin credenciales configuradas"
        : status.lastError
          ? "API sin respuesta · datos en caché"
          : status.ageMinutes === null
            ? "Sin sincronizaciones aún"
            : `API conectada · sincronizado hace ${status.ageMinutes} min`;

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <header className="flex h-[60px] flex-none items-center gap-5 border-b border-slate-200 bg-white px-5 py-3">
        <Link href="/select-app" className="flex flex-none items-center gap-2.5" aria-label="Volver a aplicaciones">
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-emerald-600">
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M10 18s6-5.2 6-9.4A6 6 0 0 0 4 8.6C4 12.8 10 18 10 18Z"
                stroke="#fff"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <circle cx="10" cy="8.4" r="2.1" fill="#fff" />
            </svg>
          </span>
          <span className="flex flex-col gap-px">
            <span className="text-[15px] font-semibold tracking-tight">Galápagos Previene</span>
            <span className="text-[11.5px] text-slate-400">Visor de reportes ciudadanos</span>
          </span>
        </Link>

        <div className="flex min-w-0 items-center gap-2 overflow-hidden rounded-full border border-slate-200 px-3 py-1.5 text-[11.5px] text-slate-500">
          <span
            className={`h-1.5 w-1.5 flex-none rounded-full ${degraded ? "bg-red-500" : "bg-emerald-500"}`}
            aria-hidden
          />
          <span className="truncate">{statusLabel}</span>
        </div>

        <div className="flex-1" />

        <div className="flex flex-none items-center gap-1.5 rounded-[10px] border border-slate-200 bg-slate-50 p-1">
          {([
            ["split", "Mapa + tabla"],
            ["map", "Solo mapa"],
            ["table", "Solo tabla"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              aria-pressed={view === mode}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                view === mode ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {degraded && (
        <div className="flex flex-none items-center gap-3 border-b border-red-200 bg-red-50 px-5 py-2.5 text-[12.5px] text-red-800">
          <span className="font-semibold">
            {loadError ?? (status?.configured === false
              ? "El módulo no tiene configurada la clave de la API de reportes."
              : "La API de reportes no responde.")}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {status?.lastSuccessAt
              ? `Se muestran los últimos datos en caché · actualizados hace ${status.ageMinutes} min. Los medios nuevos no estarán disponibles hasta restablecer la conexión.`
              : "Todavía no hay datos en caché para mostrar."}
          </span>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={syncing}
            className="flex-none rounded-lg bg-red-800 px-3 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-60"
          >
            {syncing ? "Reintentando…" : "Reintentar"}
          </button>
        </div>
      )}

      <PrevieneFilters
        eventTypes={eventTypes}
        filters={filters}
        onChange={setFilters}
        visibleCount={visible.length}
        totalCount={status?.totalReports ?? reports.length}
        kindCounts={kindCounts}
        onReset={reset}
      />

      <div className="relative flex min-h-0 flex-1">
        <div
          className="relative min-w-0 border-r border-slate-200"
          style={{ display: view === "table" ? "none" : "block", flex: view === "map" ? "1 1 100%" : "1 1 50%" }}
        >
          <PrevieneMap
            ref={mapRef}
            reports={visible}
            selectedId={selectedId}
            onSelect={setSelectedId}
            cluster
            showAccuracy
            onViewportChange={setViewport}
          />

          <div className="pointer-events-none absolute right-3 top-3 z-[500] flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => mapRef.current?.fitAll()}
              className="pointer-events-auto flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-medium text-slate-500 shadow-sm hover:bg-slate-50"
            >
              Ver todo
            </button>
            <div
              className="pointer-events-auto flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm"
              title="Centro del mapa y nivel de zoom"
            >
              <span className="font-mono text-[11px] text-slate-500">
                {viewport.lat.toFixed(4)}, {viewport.lng.toFixed(4)}
              </span>
              <span className="font-mono text-[11px] text-slate-400">z {viewport.zoom}</span>
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 z-[500]">
            <MapLegend eventTypes={eventTypes} />
          </div>

          {!loading && visible.length === 0 && (
            <div className="absolute inset-0 z-[600] flex items-center justify-center bg-slate-100/70 backdrop-blur-[2px]">
              <div className="max-w-[330px] rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-xl">
                <div className="mb-2 text-sm font-semibold">Ningún reporte en este rango</div>
                <p className="mb-4 text-[12.5px] leading-relaxed text-slate-500">
                  No hay reportes que cumplan los filtros de tipo, clase y fechas seleccionados.
                </p>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  Limpiar filtros
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className="absolute inset-0 z-[600] flex items-center justify-center bg-slate-100/60">
              <span className="text-[12.5px] text-slate-500">Cargando reportes…</span>
            </div>
          )}
        </div>

        <div
          className="min-w-0 flex-col"
          style={{
            display: view === "map" ? "none" : "flex",
            flex: view === "table" ? "1 1 100%" : "1 1 50%",
          }}
        >
          <ReportTable
            reports={visible}
            selectedId={selectedId}
            onSelect={selectFromTable}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
          />
        </div>

        {selected && <ReportDetail report={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}
