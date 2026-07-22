"use client";

import { api, requirePersistedEntity } from "@/lib/api-client";
import { useConfirmedMutation } from "@/lib/use-confirmed-mutation";
import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GEO_CATEGORIES, getDefaultGeoThematic, getGeoThematics } from "@/lib/geo-mock-data";
import type { GeoMap } from "@/types/geo";

interface Props {
  map: GeoMap;
  onSave: (updated: GeoMap) => void;
  onClose: () => void;
}

const normalizeCategoryId = (categoryId: string) =>
  GEO_CATEGORIES.some((category) => category.id === categoryId)
    ? categoryId
    : GEO_CATEGORIES[0].id;

export default function EditMapDialog({ map, onSave, onClose }: Props) {
  const initialCategoryId = normalizeCategoryId(map.categoryId);
  const [form, setForm] = useState({
    title: map.title,
    description: map.description,
    categoryId: initialCategoryId,
    thematic: map.thematic || getDefaultGeoThematic(initialCategoryId),
    tags: map.tags?.join(", ") ?? "",
  });

  useEffect(() => {
    const categoryId = normalizeCategoryId(map.categoryId);
    const thematics = getGeoThematics(categoryId);
    setForm({
      title: map.title,
      description: map.description,
      categoryId,
      thematic: map.thematic && thematics.includes(map.thematic)
        ? map.thematic
        : getDefaultGeoThematic(categoryId),
      tags: map.tags?.join(", ") ?? "",
    });
  }, [map]);

  const thematicOptions = getGeoThematics(form.categoryId);

  const updateMap = useConfirmedMutation<{
    title: string;
    description: string;
    categoryId: string;
    thematic: string;
    tags: string[];
  }, GeoMap>({
    mutation: async (payload, signal) => requirePersistedEntity<GeoMap>(
      await api.put<unknown>(`/geo/maps/${map.id}`, payload, { signal }),
      "El servidor no confirmó la actualización del mapa",
      map.id
    ),
    successMessage: "Mapa actualizado correctamente",
    errorMessage: "Error al actualizar el mapa",
    onConfirmed: (updated) => {
      onSave(updated);
      onClose();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateMap.mutate({
      title: form.title.trim(),
      description: form.description.trim(),
      categoryId: form.categoryId,
      thematic: form.thematic,
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-base font-semibold text-slate-900">Editar mapa</h2>
          <button onClick={() => { if (!updateMap.isPending) onClose(); }} disabled={updateMap.isPending} className="text-slate-400 hover:text-slate-700 disabled:opacity-50">
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
              onChange={(e) => {
                const categoryId = e.target.value;
                setForm({
                  ...form,
                  categoryId,
                  thematic: getDefaultGeoThematic(categoryId),
                });
              }}
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
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Temática <span className="text-red-500">*</span>
            </label>
            <select
              value={form.thematic}
              onChange={(e) => setForm({ ...form, thematic: e.target.value })}
              required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {thematicOptions.map((thematic) => (
                <option key={thematic} value={thematic}>
                  {thematic}
                </option>
              ))}
            </select>
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
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={updateMap.isPending}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1 bg-teal-600 hover:bg-teal-700 text-white" disabled={updateMap.isPending}>
              {updateMap.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
