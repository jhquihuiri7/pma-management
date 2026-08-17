"use client";

import { api, apiErrorMessage } from "@/lib/api-client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Map, Search } from "lucide-react";
import { toast } from "sonner";
import { GEO_MAPS, GEO_CATEGORIES } from "@/lib/geo-mock-data";
import type { GeoMap } from "@/types/geo";
import AddMapDialog from "@/components/geo/AddMapDialog";
import GeoMapCard from "@/components/geo/GeoMapCard";

const ENABLE_GEO_MOCKS = process.env.NEXT_PUBLIC_ENABLE_GEO_MOCKS === "true";

export default function MapsPage() {
  const { user: session} = useAuth();
  const canEdit = session?.role === "ADMIN" || session?.apps.includes("geo") === true;
  const canDelete = session?.role === "ADMIN";

  const [maps, setMaps] = useState<GeoMap[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadMaps();
  }, []);

  async function loadMaps() {
    try {
      setMaps(await api.get<GeoMap[]>("/geo/api/maps"));
      setLoadError(null);
    } catch (error) {
      const message = apiErrorMessage(error, "No se pudieron cargar los mapas");
      toast.error(message);
      setLoadError(message);
      setMaps(ENABLE_GEO_MOCKS ? GEO_MAPS : []);
    }
  }

  const handleAdd = (map: GeoMap) => setMaps((prev) => [map, ...prev]);
  const handleEdit = (updated: GeoMap) =>
    setMaps((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  const handleDelete = (id: string) =>
    setMaps((prev) => prev.filter((m) => m.id !== id));

  const filtered = maps.filter((m) => {
    const matchCat = activeCategory ? m.categoryId === activeCategory : true;
    const q = search.toLowerCase();
    const matchSearch = q
      ? m.title.toLowerCase().includes(q) ||
        (m.description ?? "").toLowerCase().includes(q) ||
        m.thematic?.toLowerCase().includes(q) ||
        m.tags?.some((t) => t.toLowerCase().includes(q))
      : true;
    return matchCat && matchSearch;
  });

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Explorar Mapas</h1>
          <p className="text-sm text-slate-500 mt-1">
            {maps.length} mapas disponibles en el geoportal
          </p>
        </div>
        {canEdit && <AddMapDialog onAdd={handleAdd} />}
      </div>

      {loadError && !ENABLE_GEO_MOCKS && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{loadError}</p>
          <button type="button" className="mt-2 underline" onClick={() => void loadMaps()}>
            Reintentar
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar mapas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              !activeCategory
                ? "bg-teal-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Todos
          </button>
          {GEO_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeCategory === cat.id
                  ? "bg-teal-600 text-white"
                  : `bg-white border border-slate-200 ${cat.textClass} hover:${cat.bgClass}`
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Map className="w-12 h-12 text-slate-300 mb-3" />
          <p className="text-slate-500 font-medium">No se encontraron mapas</p>
          <p className="text-sm text-slate-400 mt-1">
            {search ? "Prueba con otros términos." : "No hay mapas en esta categoría."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((m) => (
            <GeoMapCard
              key={m.id}
              geoMap={m}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
