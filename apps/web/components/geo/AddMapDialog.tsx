"use client";

import { api, requirePersistedEntity } from "@/lib/api-client";
import { useConfirmedMutation } from "@/lib/use-confirmed-mutation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GEO_CATEGORIES, getDefaultGeoThematic, getGeoThematics } from "@/lib/geo-mock-data";
import type { GeoMap } from "@/types/geo";

interface Props {
  onAdd: (map: GeoMap) => void;
  triggerClassName?: string;
}

export default function AddMapDialog({ onAdd, triggerClassName = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    categoryId: GEO_CATEGORIES[0].id,
    thematic: getDefaultGeoThematic(GEO_CATEGORIES[0].id),
    tags: "",
  });

  const reset = () =>
    setForm({
      title: "",
      description: "",
      categoryId: GEO_CATEGORIES[0].id,
      thematic: getDefaultGeoThematic(GEO_CATEGORIES[0].id),
      tags: "",
    });

  const thematicOptions = getGeoThematics(form.categoryId);

  const createMap = useConfirmedMutation<{
    title: string;
    description: string;
    categoryId: string;
    thematic: string;
    tags: string[];
  }, GeoMap>({
    mutation: async (payload, signal) => requirePersistedEntity<GeoMap>(
      await api.post<unknown>("/geo/maps", payload, { signal }),
      "El servidor no confirmó la creación del mapa"
    ),
    successMessage: "Mapa agregado correctamente",
    errorMessage: "Error al agregar el mapa",
    onConfirmed: (newMap) => {
      onAdd(newMap);
      setOpen(false);
      reset();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createMap.mutate({
      title: form.title.trim(),
      description: form.description.trim(),
      categoryId: form.categoryId,
      thematic: form.thematic,
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    });
  };

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className={`bg-teal-600 hover:bg-teal-700 text-white gap-2 ${triggerClassName}`}
      >
        <Plus className="w-4 h-4" />
        Agregar Mapa
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-base font-semibold text-slate-900">Agregar nuevo mapa</h2>
          <button
            onClick={() => { if (!createMap.isPending) { setOpen(false); reset(); } }}
            disabled={createMap.isPending}
            className="text-slate-400 hover:text-slate-700"
          >
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
              placeholder="Ej. Cobertura vegetal 2024"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descripción</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Describe brevemente el contenido del mapa..."
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
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => { setOpen(false); reset(); }}
              disabled={createMap.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" className="flex-1 bg-teal-600 hover:bg-teal-700 text-white" disabled={createMap.isPending}>
              {createMap.isPending ? "Guardando..." : "Agregar mapa"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
