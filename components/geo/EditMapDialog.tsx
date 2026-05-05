"use client";

import { useState, useEffect } from "react";
import { X, Link } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GEO_CATEGORIES } from "@/lib/geo-mock-data";
import type { GeoMap } from "@/types/geo";

interface Props {
  map: GeoMap;
  onSave: (updated: GeoMap) => void;
  onClose: () => void;
}

export default function EditMapDialog({ map, onSave, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: map.title,
    description: map.description,
    categoryId: map.categoryId,
    arcgisUrl: map.arcgisUrl ?? "",
    tags: map.tags?.join(", ") ?? "",
  });

  useEffect(() => {
    setForm({
      title: map.title,
      description: map.description,
      categoryId: map.categoryId,
      arcgisUrl: map.arcgisUrl ?? "",
      tags: map.tags?.join(", ") ?? "",
    });
  }, [map]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch(`/geo/api/maps/${map.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          categoryId: form.categoryId,
          arcgisUrl: form.arcgisUrl.trim() || undefined,
          tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        onSave(updated);
        toast.success("Mapa actualizado correctamente");
        onClose();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error al actualizar el mapa");
      }
    } catch (error) {
      console.error(error);
      toast.error("Error al actualizar el mapa");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-base font-semibold text-slate-900">Editar mapa</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Título <span className="text-red-500">*</span>
            </label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Categoría <span className="text-red-500">*</span>
            </label>
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {GEO_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">URL</label>
            <div className="relative">
              <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="url"
                value={form.arcgisUrl}
                onChange={(e) => setForm({ ...form, arcgisUrl: e.target.value })}
                placeholder="https://arcgis.com/apps/..."
                className="w-full pl-9 pr-3 border border-slate-200 rounded-lg py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Etiquetas{" "}
              <span className="text-slate-400 font-normal">(separadas por coma)</span>
            </label>
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="Ej. vegetación, bosques, ecuador"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1 bg-teal-600 hover:bg-teal-700 text-white" disabled={loading}>
              {loading ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
