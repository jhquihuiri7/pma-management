"use client";

import { api, apiErrorMessage } from "@/lib/api-client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  TreePine,
  Building2,
  Users,
  BriefcaseBusiness,
  Scale,
  Database,
  Search,
  Map,
} from "lucide-react";
import { toast } from "sonner";
import { GEO_CATEGORIES, GEO_MAPS } from "@/lib/geo-mock-data";
import type { GeoCategory, GeoMap } from "@/types/geo";
import AddMapDialog from "@/components/geo/AddMapDialog";
import GeoMapCard from "@/components/geo/GeoMapCard";

const ENABLE_GEO_MOCKS = process.env.NEXT_PUBLIC_ENABLE_GEO_MOCKS === "true";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  TreePine, Building2, Users, BriefcaseBusiness, Scale, Database,
};

const CATEGORY_GRADIENT: Record<string, string> = {
  "informacion-base": "from-slate-400 to-slate-600",
  "fisico-ambiental": "from-green-400 to-emerald-600",
  "asentamientos-humanos": "from-blue-400 to-cyan-600",
  sociocultural: "from-rose-400 to-pink-600",
  "economico-productivo": "from-amber-400 to-yellow-600",
  "politico-institucional": "from-purple-400 to-violet-600",
};

const CATEGORY_CARD_STYLES: Record<string, {
  active: string;
  inactive: string;
  activeTitle: string;
  count: string;
}> = {
  "informacion-base": {
    active: "border-slate-500 bg-slate-50 shadow-md",
    inactive: "border-slate-200 hover:border-slate-400 bg-white hover:shadow-sm",
    activeTitle: "text-slate-800",
    count: "bg-slate-100 text-slate-700",
  },
  "fisico-ambiental": {
    active: "border-green-500 bg-green-50 shadow-md",
    inactive: "border-green-200 hover:border-green-400 bg-white hover:shadow-sm",
    activeTitle: "text-green-800",
    count: "bg-green-100 text-green-700",
  },
  "asentamientos-humanos": {
    active: "border-blue-500 bg-blue-50 shadow-md",
    inactive: "border-blue-200 hover:border-blue-400 bg-white hover:shadow-sm",
    activeTitle: "text-blue-800",
    count: "bg-blue-100 text-blue-700",
  },
  sociocultural: {
    active: "border-rose-500 bg-rose-50 shadow-md",
    inactive: "border-rose-200 hover:border-rose-400 bg-white hover:shadow-sm",
    activeTitle: "text-rose-800",
    count: "bg-rose-100 text-rose-700",
  },
  "economico-productivo": {
    active: "border-amber-500 bg-amber-50 shadow-md",
    inactive: "border-amber-200 hover:border-amber-400 bg-white hover:shadow-sm",
    activeTitle: "text-amber-800",
    count: "bg-amber-100 text-amber-700",
  },
  "politico-institucional": {
    active: "border-purple-500 bg-purple-50 shadow-md",
    inactive: "border-purple-200 hover:border-purple-400 bg-white hover:shadow-sm",
    activeTitle: "text-purple-800",
    count: "bg-purple-100 text-purple-700",
  },
};

function CategoryCard({
  category,
  active,
  onClick,
  count,
}: {
  category: GeoCategory;
  active: boolean;
  onClick: () => void;
  count: number;
}) {
  const Icon = CATEGORY_ICONS[category.iconName] || Map;
  const styles = CATEGORY_CARD_STYLES[category.id] ?? {
    active: "border-slate-500 bg-slate-50 shadow-md",
    inactive: "border-slate-200 hover:border-slate-400 bg-white hover:shadow-sm",
    activeTitle: "text-slate-800",
    count: "bg-slate-100 text-slate-700",
  };
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all text-center cursor-pointer w-full ${
        active ? styles.active : styles.inactive
      }`}
    >
      <div
        className={`w-12 h-12 rounded-xl bg-gradient-to-br ${CATEGORY_GRADIENT[category.id]} flex items-center justify-center shadow-sm`}
      >
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className={`text-sm font-semibold ${active ? styles.activeTitle : "text-slate-800"}`}>
          {category.name}
        </p>
        <p className="text-xs text-slate-500 mt-0.5 leading-tight">{category.description}</p>
      </div>
      <span
        className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles.count}`}
      >
        {count} {count === 1 ? "mapa" : "mapas"}
      </span>
    </button>
  );
}

export default function GeoDashboardPage() {
  const { user: session} = useAuth();
  // Public visitors can browse. Mutations require an ADMIN or an explicit GEO
  // app grant, matching requireApp("geo") in the API.
  const canEdit = session?.role === "ADMIN" || session?.apps.includes("geo") === true;
  const canDelete = session?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [maps, setMaps] = useState<GeoMap[]>([]);
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

  const handleAdd = (map: GeoMap) => {
    setMaps((prev) => [map, ...prev]);
  };

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

  const countByCategory = (catId: string) =>
    maps.filter((m) => m.categoryId === catId).length;

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div
        className="px-8 pt-12 pb-20 relative overflow-hidden"
        style={{
          backgroundImage: "url(/imgs/geo/geo_header.png)",
          backgroundSize: "cover",
          backgroundPosition: "center bottom",
          backgroundAttachment: "fixed",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-teal-700/80 via-teal-600/80 to-emerald-700/80" />
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Ccircle cx='30' cy='30' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        />
        <div className="relative max-w-5xl mx-auto z-10">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Map className="w-6 h-6 text-teal-200" />
                <span className="text-teal-200 text-sm font-medium uppercase tracking-widest">
                  Geoportal Ambiental
                </span>
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">
                Centro de Datos Geoespaciales
              </h1>
              <p className="text-teal-100 text-base max-w-xl">
                Accede y explora mapas ambientales interactivos organizados por temática.
                Visualiza datos espaciales por sistema, temática y territorio.
              </p>
            </div>
            {canEdit && (
              <div className="flex-shrink-0">
                <AddMapDialog onAdd={handleAdd} />
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative max-w-xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar mapas por título, descripción o etiqueta..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl bg-white/95 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-white/60 shadow-lg"
            />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 mt-6 pb-16">
        {loadError && !ENABLE_GEO_MOCKS && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p>{loadError}</p>
            <button type="button" className="mt-2 underline" onClick={() => void loadMaps()}>
              Reintentar
            </button>
          </div>
        )}
        {/* Category tiles */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
              Categorías temáticas
            </h2>
            {activeCategory && (
              <button
                onClick={() => setActiveCategory(null)}
                className="text-xs text-teal-600 hover:text-teal-800 font-medium"
              >
                Ver todas
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {GEO_CATEGORIES.map((cat) => (
              <CategoryCard
                key={cat.id}
                category={cat}
                active={activeCategory === cat.id}
                onClick={() => setActiveCategory((prev) => (prev === cat.id ? null : cat.id))}
                count={countByCategory(cat.id)}
              />
            ))}
          </div>
        </div>

        {/* Maps grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">
              {activeCategory
                ? GEO_CATEGORIES.find((c) => c.id === activeCategory)?.name
                : "Todos los mapas"}
              <span className="ml-2 font-normal text-slate-400">({filtered.length})</span>
            </h2>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Map className="w-12 h-12 text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">No se encontraron mapas</p>
              <p className="text-sm text-slate-400 mt-1">
                {search
                  ? "Intenta con otros términos de búsqueda."
                  : "Aún no hay mapas en esta categoría."}
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
      </div>
    </div>
  );
}
