"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  TreePine,
  Waves,
  Thermometer,
  Mountain,
  AlertTriangle,
  Shield,
  Scale,
  Search,
  Map,
} from "lucide-react";
import { toast } from "sonner";
import { GEO_CATEGORIES, GEO_MAPS } from "@/lib/geo-mock-data";
import type { GeoCategory, GeoMap } from "@/types/geo";
import AddMapDialog from "@/components/geo/AddMapDialog";
import GeoMapCard from "@/components/geo/GeoMapCard";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  TreePine, Waves, Thermometer, Mountain, AlertTriangle, Shield, Scale,
};

const CATEGORY_GRADIENT: Record<string, string> = {
  biodiversidad: "from-green-400 to-emerald-600",
  "calidad-agua": "from-blue-400 to-cyan-600",
  clima: "from-orange-400 to-amber-600",
  suelo: "from-amber-400 to-yellow-600",
  riesgo: "from-red-400 to-rose-600",
  protegidas: "from-emerald-400 to-teal-600",
  gobernanza: "from-purple-400 to-violet-600",
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
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all text-center cursor-pointer w-full ${
        active
          ? "border-teal-500 bg-teal-50 shadow-md"
          : `${category.borderClass} bg-white hover:shadow-sm`
      }`}
    >
      <div
        className={`w-12 h-12 rounded-xl bg-gradient-to-br ${CATEGORY_GRADIENT[category.id]} flex items-center justify-center shadow-sm`}
      >
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className={`text-sm font-semibold ${active ? "text-teal-800" : "text-slate-800"}`}>
          {category.name}
        </p>
        <p className="text-xs text-slate-500 mt-0.5 leading-tight">{category.description}</p>
      </div>
      <span
        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          active ? "bg-teal-100 text-teal-700" : `${category.accentClass} ${category.textClass}`
        }`}
      >
        {count} {count === 1 ? "mapa" : "mapas"}
      </span>
    </button>
  );
}

export default function GeoDashboardPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [maps, setMaps] = useState<GeoMap[]>([]);

  useEffect(() => {
    loadMaps();
  }, []);

  async function loadMaps() {
    try {
      const res = await fetch("/geo/api/maps");
      if (res.ok) {
        const data = await res.json();
        setMaps(data);
      } else {
        toast.error("Error loading maps");
        setMaps(GEO_MAPS);
      }
    } catch (error) {
      console.error(error);
      toast.error("Error loading maps");
      setMaps(GEO_MAPS);
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
        m.description.toLowerCase().includes(q) ||
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
                Visualiza datos espaciales de biodiversidad, clima, riesgos y más.
              </p>
            </div>
            {isAdmin && (
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
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
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
                  isAdmin={isAdmin}
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
