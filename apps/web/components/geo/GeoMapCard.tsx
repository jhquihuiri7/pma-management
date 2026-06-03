"use client";

import { apiFetch } from "@/lib/api-client";


import { useState } from "react";
import {
  Map,
  TreePine,
  Waves,
  Thermometer,
  Mountain,
  AlertTriangle,
  Shield,
  Scale,
  Calendar,
  Tag,
  ChevronRight,
  Pencil,
  Trash2,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { GEO_CATEGORIES } from "@/lib/geo-mock-data";
import type { GeoMap } from "@/types/geo";
import EditMapDialog from "@/components/geo/EditMapDialog";

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

interface Props {
  geoMap: GeoMap;
  /** Any geo user (incl. VIEWER) may edit; only ADMIN may delete. */
  canEdit?: boolean;
  canDelete?: boolean;
  onEdit?: (updated: GeoMap) => void;
  onDelete?: (id: string) => void;
}

export default function GeoMapCard({ geoMap, canEdit, canDelete, onEdit, onDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/geo/api/maps/${geoMap.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        onDelete?.(geoMap.id);
        toast.success("Mapa eliminado correctamente");
      } else {
        toast.error("Error al eliminar el mapa");
      }
    } catch (error) {
      console.error(error);
      toast.error("Error al eliminar el mapa");
    } finally {
      setDeleting(false);
    }
  };

  const category = GEO_CATEGORIES.find((c) => c.id === geoMap.categoryId);
  const Icon = category ? (CATEGORY_ICONS[category.iconName] || Map) : Map;
  const gradient = CATEGORY_GRADIENT[geoMap.categoryId] || "from-slate-400 to-slate-600";
  const date = new Date(geoMap.createdAt).toLocaleDateString("es-EC", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <>
      <div className="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-lg hover:border-slate-300 transition-all">
        {/* Thumbnail */}
        <div className={`h-36 bg-gradient-to-br ${gradient} flex items-center justify-center relative overflow-hidden`}>
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
          <Icon className="w-14 h-14 text-white/80" />
          {category && (
            <span className="absolute top-3 left-3 text-xs font-medium px-2.5 py-1 rounded-full bg-white/20 text-white backdrop-blur-sm">
              {category.name}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          <h3 className="font-semibold text-slate-900 text-sm leading-tight line-clamp-2 mb-1.5">
            {geoMap.title}
          </h3>
          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed mb-3">
            {geoMap.description}
          </p>

          {geoMap.tags && geoMap.tags.length > 0 && (
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              {geoMap.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full"
                >
                  <Tag className="w-2.5 h-2.5" />
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <Calendar className="w-3 h-3" />
              {date}
            </div>

            <div className="flex items-center gap-1">
              {canEdit && (
                /* Edit */
                <button
                  onClick={() => setEditOpen(true)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"
                  title="Editar"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}

              {canDelete && (
                <>
                  {/* Delete */}
                  {confirmDelete ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="text-xs font-medium px-2 py-1 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                      >
                        {deleting ? "..." : "Sí"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                        className="text-xs font-medium px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition-colors"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}

              {/* Open GIS editor */}
              <a
                href={`/geo/maps/${geoMap.id}/gis`}
                className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors ml-1"
                title="Abrir mapa en el GIS"
              >
                <Layers className="w-3 h-3" />
                Abrir GIS
                <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {editOpen && onEdit && (
        <EditMapDialog
          map={geoMap}
          onSave={onEdit}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}
