"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Eye, FileDown, Home, Loader2, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import type { FamilyEmergencyPlan, FamilyPlanListItem } from "@pma/types";
import { api, apiErrorMessage, checkedApiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

type ListResponse = {
  rows: FamilyPlanListItem[];
  total: number;
  people: number;
  page: number;
  pageSize: number;
};

type Detail = { id: string; code: string; createdAt: string; plan: FamilyEmergencyPlan };

const PAGE_SIZE = 50;
const ISLANDS = ["San Cristóbal", "Santa Cruz", "Isabela", "Floreana", "Otra"];

export default function FamilyPlanResults() {
  const { user, status } = useAuth();
  const [data, setData] = useState<ListResponse>({ rows: [], total: 0, people: 0, page: 1, pageSize: PAGE_SIZE });
  const [search, setSearch] = useState("");
  const [island, setIsland] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const authorized = user?.role === "ADMIN" || user?.apps.includes("plan_familiar");

  const query = useCallback((targetPage = page) => {
    const params = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE) });
    if (search.trim()) params.set("search", search.trim());
    if (island) params.set("island", island);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }, [from, island, page, search, to]);

  const load = useCallback(async (targetPage = page) => {
    if (!authorized) return;
    setLoading(true);
    setError("");
    try {
      setData(await api.get<ListResponse>(`/plan-familiar/plans?${query(targetPage)}`));
    } catch (loadError) {
      setError(apiErrorMessage(loadError, "No se pudieron cargar los planes familiares."));
    } finally {
      setLoading(false);
    }
  }, [authorized, page, query]);

  useEffect(() => { if (status === "authenticated") void load(); }, [load, status]);

  function applyFilters() {
    setPage(1);
    void load(1);
  }

  async function openDetail(id: string) {
    setDetailLoading(true);
    setError("");
    try {
      setDetail(await api.get<Detail>(`/plan-familiar/plans/${id}`));
    } catch (detailError) {
      setError(apiErrorMessage(detailError, "No se pudo abrir el plan."));
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveResponse(response: Response, name: string) {
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  async function downloadPdf(row: Pick<FamilyPlanListItem, "id" | "code">) {
    setError("");
    try {
      const response = await checkedApiFetch(`/plan-familiar/plans/${row.id}/pdf`, { timeoutMs: 60_000 });
      await saveResponse(response, `Plan_Familiar_${row.code}.pdf`);
    } catch (downloadError) {
      setError(apiErrorMessage(downloadError, "No se pudo descargar el PDF."));
    }
  }

  async function exportCsv() {
    setError("");
    try {
      const params = query(1);
      params.delete("page");
      params.delete("pageSize");
      const response = await checkedApiFetch(`/plan-familiar/export.csv?${params}`, { timeoutMs: 60_000 });
      await saveResponse(response, "Planes_Familiares.csv");
    } catch (exportError) {
      setError(apiErrorMessage(exportError, "No se pudo exportar el archivo."));
    }
  }

  if (status === "loading") {
    return <div className="grid min-h-screen place-items-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-teal-700" /></div>;
  }

  if (!authorized) {
    return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm"><ShieldCheck className="mx-auto mb-4 h-10 w-10 text-slate-400" /><h1 className="text-xl font-bold text-slate-900">Acceso restringido</h1><p className="mt-2 text-sm text-slate-500">Tu cuenta no tiene acceso al módulo Plan Familiar de Emergencia.</p><Link href="/select-app" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-teal-700"><ArrowLeft className="h-4 w-4" /> Volver a aplicaciones</Link></div></main>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-700 text-white"><Home className="h-5 w-5" /></span>
          <div className="min-w-0"><h1 className="truncate text-base font-bold">Plan Familiar de Emergencia</h1><p className="text-xs text-slate-500">Resultados · CGREG / DGTAR</p></div>
          <div className="flex-1" />
          <Link href="/plan-familiar" className="hidden text-sm font-medium text-teal-700 sm:block">Ver formulario público</Link>
          <Link href="/select-app" className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Aplicaciones</span></Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[.14em] text-teal-700">SEGUIMIENTO DE PARTICIPACIÓN</p><h2 className="mt-1 text-2xl font-bold">Planes familiares registrados</h2><p className="mt-1 text-sm text-slate-500">Consulta hogares participantes y sus copias institucionales.</p></div>{user?.role === "ADMIN" && <button type="button" onClick={() => void exportCsv()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"><FileDown className="h-4 w-4" /> Exportar CSV</button>}</div>

        <section className="mb-5 grid gap-4 sm:grid-cols-3"><div className="rounded-xl border bg-white p-5"><span className="text-xs font-medium text-slate-500">Planes encontrados</span><strong className="mt-2 block text-3xl text-teal-700">{data.total}</strong></div><div className="rounded-xl border bg-white p-5"><span className="text-xs font-medium text-slate-500">Integrantes registrados</span><strong className="mt-2 block text-3xl text-blue-700">{data.people}</strong></div><div className="rounded-xl border bg-white p-5"><span className="text-xs font-medium text-slate-500">Acceso</span><strong className="mt-2 block text-sm">Información protegida</strong><p className="mt-1 text-xs text-slate-400">{user?.name}</p></div></section>

        <section className="mb-5 grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[minmax(220px,1fr)_180px_150px_150px_auto]">
          <label className="relative"><span className="sr-only">Buscar</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input className="h-10 w-full rounded-lg border pl-9 pr-3 text-sm" placeholder="Familia, sector o código" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyFilters(); }} /></label>
          <select className="h-10 rounded-lg border px-3 text-sm" value={island} onChange={(event) => setIsland(event.target.value)}><option value="">Todas las islas</option>{ISLANDS.map((value) => <option key={value}>{value}</option>)}</select>
          <label><span className="sr-only">Desde</span><input type="date" title="Desde" className="h-10 w-full rounded-lg border px-3 text-sm" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span className="sr-only">Hasta</span><input type="date" title="Hasta" className="h-10 w-full rounded-lg border px-3 text-sm" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button type="button" onClick={applyFilters} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold text-slate-700"><RefreshCw className="h-4 w-4" /> Consultar</button>
        </section>

        {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div>}

        <section className="overflow-hidden rounded-xl border bg-white">
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Familia</th><th className="px-4 py-3">Isla / sector</th><th className="px-4 py-3">Teléfono</th><th className="px-4 py-3 text-center">Integrantes</th><th className="px-4 py-3">Acciones</th></tr></thead><tbody className="divide-y">{data.rows.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-4 py-3"><span>{new Date(row.createdAt).toLocaleDateString("es-EC")}</span><small className="block text-[10px] font-bold tracking-wider text-slate-400">{row.code}</small></td><td className="px-4 py-3 font-semibold">{row.family}</td><td className="px-4 py-3"><span>{row.island}</span><small className="block text-slate-500">{row.sector}</small></td><td className="px-4 py-3">{row.phone}</td><td className="px-4 py-3 text-center">{row.membersCount}</td><td className="px-4 py-3"><div className="flex gap-1"><button type="button" title="Ver respuestas" disabled={detailLoading} onClick={() => void openDetail(row.id)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-teal-700"><Eye className="h-4 w-4" /></button><button type="button" title="Descargar PDF" onClick={() => void downloadPdf(row)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-teal-700"><Download className="h-4 w-4" /></button></div></td></tr>)}{!loading && data.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-14 text-center text-slate-500">No hay planes para esta consulta.</td></tr>}{loading && <tr><td colSpan={6} className="px-4 py-14 text-center text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando registros…</td></tr>}</tbody></table></div>
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-slate-500"><button type="button" disabled={page === 1 || loading} onClick={() => { const next = page - 1; setPage(next); void load(next); }} className="rounded border px-3 py-1.5 disabled:opacity-40">Anterior</button><span>{data.total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, data.total)} de {data.total}</span><button type="button" disabled={page * PAGE_SIZE >= data.total || loading} onClick={() => { const next = page + 1; setPage(next); void load(next); }} className="rounded border px-3 py-1.5 disabled:opacity-40">Siguiente</button></div>
        </section>
      </main>

      {detail && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.currentTarget === event.target) setDetail(null); }}><article className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"><header className="sticky top-0 flex items-start gap-3 border-b bg-white p-5"><div><p className="text-xs font-bold tracking-wider text-teal-700">PLAN {detail.code}</p><h2 className="text-xl font-bold">{detail.plan.family}</h2><p className="text-xs text-slate-500">Registrado {new Date(detail.createdAt).toLocaleString("es-EC")}</p></div><div className="flex-1" /><button type="button" onClick={() => void downloadPdf({ id: detail.id, code: detail.code })} className="rounded-lg border p-2 text-teal-700" title="Descargar PDF"><Download className="h-4 w-4" /></button><button type="button" onClick={() => setDetail(null)} className="rounded-lg border p-2" title="Cerrar"><X className="h-4 w-4" /></button></header><div className="space-y-6 p-5 text-sm"><DetailSection title="Datos principales"><DetailGrid values={[["Isla", detail.plan.island], ["Sector", detail.plan.sector], ["Dirección", detail.plan.address], ["Teléfono", detail.plan.phone], ["Contacto", `${detail.plan.contact} · ${detail.plan.contactPhone}`], ["Punto de encuentro", detail.plan.meeting]]} /></DetailSection><DetailSection title={`Integrantes (${detail.plan.members.length})`}>{detail.plan.members.map((member, index) => <p key={index} className="border-b py-2 last:border-0"><strong>{member.name}</strong> · {member.age} años · {member.relation}<br /><span className="text-slate-500">Apoyos: {member.support || "Ninguno"} · Rol: {member.role}</span></p>)}</DetailSection><DetailSection title="Riesgos">{detail.plan.risks.map((risk, index) => <div key={index} className="mb-3 rounded-lg bg-slate-50 p-3"><strong>{risk.type} · {risk.priority}</strong><p className="mt-1 text-slate-600">{risk.effect}</p><p className="mt-1"><b>Prevención:</b> {risk.prevention}</p><p><b>Primer paso:</b> {risk.first}</p></div>)}</DetailSection><DetailSection title="Rutas">{detail.plan.routes.map((route) => <p key={route.situation} className="border-b py-2 last:border-0"><strong>{route.situation}</strong><br />{route.route} · {route.point}<br /><span className="text-slate-500">Aviso: {route.notice}</span></p>)}</DetailSection><DetailSection title="Ubicación">{detail.plan.location ? <p>{detail.plan.location.lat.toFixed(6)}, {detail.plan.location.lng.toFixed(6)} · {detail.plan.location.layer}</p> : <p className="text-slate-500">Sin coordenadas.</p>}</DetailSection><DetailSection title="Acciones">{detail.plan.actions.filter((action) => action.action).map((action, index) => <p key={index} className="border-b py-2 last:border-0"><strong>{action.moment}:</strong> {action.action}<br /><span className="text-slate-500">Responsable: {action.person} · {action.date || "Sin fecha"}</span></p>)}</DetailSection></div></article></div>}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-teal-700">{title}</h3><div className="rounded-xl border p-4">{children}</div></section>;
}

function DetailGrid({ values }: { values: Array<[string, string]> }) {
  return <div className="grid gap-3 sm:grid-cols-2">{values.map(([label, value]) => <div key={label}><span className="block text-xs text-slate-500">{label}</span><strong>{value}</strong></div>)}</div>;
}
