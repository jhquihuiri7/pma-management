"use client";

import { useMemo, useState } from "react";
import { Database, Image as ImageIcon, Layers3, Search, X } from "lucide-react";
import { toast } from "sonner";
import type {
  GeoWorkspaceCatalogMap,
  GeoWorkspaceRasterCatalogLayer,
  GeoWorkspaceVectorCatalogLayer,
} from "@pma/types/geo";
import { api, apiErrorMessage } from "@/lib/api-client";
import { GEO_CATEGORIES } from "@/lib/geo-mock-data";
import { workspaceLayerKey } from "./workspace";

export type WorkspaceCatalogSelection = {
  mapId: string;
  mapTitle: string;
  categoryId: string;
  thematic: string;
  layer: GeoWorkspaceVectorCatalogLayer | GeoWorkspaceRasterCatalogLayer;
};

export default function WorkspaceLayerCatalogModal({ existingKeys, onClose, onAdd }: {
  existingKeys: ReadonlySet<string>;
  onClose: () => void;
  onAdd: (items: WorkspaceCatalogSelection[]) => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [maps, setMaps] = useState<GeoWorkspaceCatalogMap[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  async function chooseCategory(nextCategoryId: string) {
    setCategoryId(nextCategoryId);
    setSelected(new Set());
    setMaps([]);
    if (!nextCategoryId) return;
    setLoading(true);
    try {
      setMaps(await api.get<GeoWorkspaceCatalogMap[]>(
        `/geo/workspace/catalog?categoryId=${encodeURIComponent(nextCategoryId)}`,
      ));
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo cargar el catálogo de capas"));
    } finally {
      setLoading(false);
    }
  }

  const available = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return maps.map((map) => ({
      ...map,
      layers: map.layers.filter((layer) => {
        if (!normalized) return true;
        return `${layer.name} ${map.mapTitle} ${map.thematic}`.toLocaleLowerCase("es").includes(normalized);
      }),
    })).filter((map) => map.layers.length > 0);
  }, [maps, query]);

  const selectionsByKey = useMemo(() => {
    const result = new Map<string, WorkspaceCatalogSelection>();
    for (const map of maps) {
      for (const layer of map.layers) {
        result.set(workspaceLayerKey(layer.kind, map.mapId, layer.layerId), {
          mapId: map.mapId,
          mapTitle: map.mapTitle,
          categoryId: map.categoryId,
          thematic: map.thematic,
          layer,
        });
      }
    }
    return result;
  }, [maps]);

  async function confirmSelection() {
    const items = Array.from(selected).flatMap((key) => {
      const item = selectionsByKey.get(key);
      return item ? [item] : [];
    });
    if (items.length === 0) return;
    setAdding(true);
    try {
      await onAdd(items);
      onClose();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1300] grid place-items-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => { if (!adding) onClose(); }}>
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Agregar capas al Workspace</h2>
            <p className="mt-1 text-xs text-slate-500">Selecciona una categoría y elige capas publicadas en SIGTAR.</p>
          </div>
          <button type="button" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose} disabled={adding} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-6 py-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-700">
            Categoría
            <select
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-teal-500"
              value={categoryId}
              onChange={(event) => void chooseCategory(event.target.value)}
              disabled={adding}
            >
              <option value="">Selecciona una categoría…</option>
              {GEO_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700">
            Buscar
            <span className="relative mt-1.5 block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-100"
                placeholder="Capa, mapa o temática…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={!categoryId || adding}
              />
            </span>
          </label>
        </div>

        <div className="min-h-[260px] flex-1 overflow-y-auto px-6 py-4">
          {!categoryId ? (
            <EmptyState icon={Database} text="Elige primero la categoría del mapa." />
          ) : loading ? (
            <EmptyState icon={Layers3} text="Cargando capas disponibles…" />
          ) : available.length === 0 ? (
            <EmptyState icon={Layers3} text={query ? "No hay capas que coincidan con la búsqueda." : "No hay capas publicadas en esta categoría."} />
          ) : (
            <div className="space-y-4">
              {available.map((map) => (
                <section key={map.mapId} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <h3 className="text-sm font-semibold text-slate-800">{map.mapTitle}</h3>
                    {map.thematic && <p className="mt-0.5 text-xs text-slate-500">{map.thematic}</p>}
                  </div>
                  <div className="divide-y divide-slate-100">
                    {map.layers.map((layer) => {
                      const key = workspaceLayerKey(layer.kind, map.mapId, layer.layerId);
                      const alreadyAdded = existingKeys.has(key);
                      const checked = selected.has(key);
                      return (
                        <label key={key} className={`flex items-center gap-3 px-4 py-3 ${alreadyAdded ? "cursor-not-allowed bg-slate-50 opacity-60" : "cursor-pointer hover:bg-teal-50/50"}`}>
                          <input
                            type="checkbox"
                            checked={checked || alreadyAdded}
                            disabled={alreadyAdded || adding}
                            onChange={(event) => setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(key); else next.delete(key);
                              return next;
                            })}
                            className="h-4 w-4 accent-teal-600"
                          />
                          {layer.kind === "vector"
                            ? <Layers3 className="h-4 w-4 shrink-0 text-teal-600" />
                            : <ImageIcon className="h-4 w-4 shrink-0 text-blue-600" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-800">{layer.name}</span>
                            <span className="block text-xs text-slate-500">
                              {layer.kind === "vector" ? `${layer.geometryType} · ${layer.featureCount} entidades` : "Ortofoto procesada"}
                            </span>
                          </span>
                          {alreadyAdded && <span className="text-[11px] font-medium text-slate-500">Agregada</span>}
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <span className="text-xs text-slate-500">{selected.size} {selected.size === 1 ? "capa seleccionada" : "capas seleccionadas"}</span>
          <div className="flex gap-2">
            <button type="button" className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100" onClick={onClose} disabled={adding}>Cancelar</button>
            <button type="button" className="h-9 rounded-lg bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void confirmSelection()} disabled={selected.size === 0 || adding}>
              {adding ? "Agregando…" : "Agregar al Workspace"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="grid min-h-[250px] place-items-center text-center">
      <div>
        <Icon className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <p className="text-sm text-slate-500">{text}</p>
      </div>
    </div>
  );
}
