"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Grid3x3, Image as ImageIcon, Loader2, Plus, Search, Shapes } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api-client";
import { GEO_CATEGORIES } from "@/lib/geo-mock-data";
import type { CatalogItem, CatalogPage } from "./types";

const PAGE = 30;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("es", { maximumFractionDigits: value >= 10 ? 0 : 1 })} ${units[unit]}`;
}

const GEOMETRY_LABEL: Record<string, string> = { Point: "Puntos", LineString: "Líneas", Polygon: "Polígonos" };

function describe(item: CatalogItem): string {
  if (item.vector) {
    const parts = [GEOMETRY_LABEL[item.vector.geometryType] ?? item.vector.geometryType, `${item.vector.featureCount.toLocaleString("es")} entidades`];
    const size = formatBytes(item.sizeBytes);
    if (size) parts.push(size);
    return parts.join(" · ");
  }
  const r = item.raster;
  const parts: string[] = [];
  if (r?.widthPx && r.heightPx) parts.push(`${r.widthPx.toLocaleString("es")} × ${r.heightPx.toLocaleString("es")} px`);
  if (r?.bandCount) parts.push(`${r.bandCount} banda${r.bandCount === 1 ? "" : "s"}`);
  if (r?.resolution) parts.push(`${r.resolution < 1 ? r.resolution.toFixed(2) : Math.round(r.resolution)} m/px`);
  if (item.crs) parts.push(item.crs);
  return parts.join(" · ");
}

export default function CatalogSearchPanel({
  presentKeys,
  pendingKeys,
  disabled,
  onAdd,
}: {
  presentKeys: ReadonlySet<string>;
  pendingKeys: ReadonlySet<string>;
  disabled: boolean;
  onAdd: (item: CatalogItem, mode: "stream" | "copy") => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | "vector" | "raster">("");
  const [categoryId, setCategoryId] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  async function load(offset: number) {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (q.trim()) params.set("q", q.trim());
    if (kind) params.set("kind", kind);
    if (categoryId) params.set("categoryId", categoryId);
    try {
      const page = await api.get<CatalogPage>(`/geo/workspace/v1/catalog/search?${params}`);
      if (id !== requestId.current) return;
      setItems((current) => (offset === 0 ? page.items : [...current, ...page.items]));
      setNextOffset(page.nextOffset);
    } catch (e) {
      if (id === requestId.current) setError(apiErrorMessage(e, "No se pudo buscar en el catálogo"));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(0), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, categoryId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-slate-200 p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="Buscar capas y rásteres del geoportal…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar en el catálogo"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            aria-label="Tipo"
          >
            <option value="">Vectores y rásteres</option>
            <option value="vector">Solo vectores</option>
            <option value="raster">Solo rásteres</option>
          </select>
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-label="Categoría"
          >
            <option value="">Todas las categorías</option>
            {GEO_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="m-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="p-4 text-center text-xs text-slate-500">Sin resultados.</p>
        )}
        <ul className="divide-y divide-slate-100">
          {items.map((item) => {
            const present = presentKeys.has(item.key);
            const pending = pendingKeys.has(item.key);
            const preparing = item.load.mode === "preparing";
            return (
              <li key={item.key} className="px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-slate-500">
                    {item.kind === "vector" ? <Shapes className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800" title={item.name}>{item.name}</p>
                    <p className="truncate text-[11px] text-slate-500" title={item.mapTitle}>{item.mapTitle}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{describe(item)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {present && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">En el mapa</span>}
                      {preparing && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">Preparando versión para el Workspace</span>}
                      {item.load.mode === "tiles" && (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600" title="Se dibuja con teselas: no se pueden leer sus valores de píxel">
                          <Grid3x3 className="h-3 w-3" /> Teselas
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-teal-600 px-2 text-xs font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      disabled={disabled || present || pending || preparing}
                      onClick={() => onAdd(item, "stream")}
                      title={present ? "Ya está en el mapa" : preparing ? "Aún se está preparando" : "Añadir al mapa"}
                    >
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      Añadir
                    </button>
                    {item.load.copyPath && (item.kind === "vector" || item.load.mode === "stream") && (
                      <button
                        type="button"
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={disabled || present || pending}
                        onClick={() => onAdd(item, "copy")}
                        title="Descarga los datos completos dentro del proyecto (para analizarlos). Ocupa espacio en el proyecto."
                      >
                        <Copy className="h-3 w-3" /> Copia
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {loading && (
          <p className="flex items-center justify-center gap-2 p-3 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…
          </p>
        )}
        {!loading && nextOffset !== null && (
          <div className="p-3">
            <button
              type="button"
              className="h-8 w-full rounded-md border border-slate-200 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => void load(nextOffset)}
            >
              Cargar más
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
