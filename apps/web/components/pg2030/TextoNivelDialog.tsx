"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, apiErrorMessage, requirePersistedEntity } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** A catalog level above the project whose text an administrator corrects. */
export type NivelEditable =
  | { nivel: "ejes"; id: string; codigo: string; texto: string }
  | { nivel: "objetivos" | "politicas" | "estrategias"; id: string; codigo: string; texto: string }
  | { nivel: "metas"; id: string; codigo: string; texto: string; cuantificable: boolean };

const TITLES: Record<NivelEditable["nivel"], string> = {
  ejes: "eje",
  objetivos: "objetivo",
  politicas: "política",
  estrategias: "estrategia",
  metas: "meta del Plan",
};

export default function TextoNivelDialog({
  target,
  onClose,
  onChanged,
}: {
  target: NivelEditable | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [cuantificable, setCuantificable] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setTexto(target.texto);
    setCuantificable(target.nivel === "metas" ? target.cuantificable : false);
  }, [target]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    // Ejes carry a name; every other level carries a text.
    const body: Record<string, unknown> = target.nivel === "ejes" ? { nombre: texto } : { texto };
    if (target.nivel === "metas") body.cuantificable = cuantificable;
    setSaving(true);
    try {
      requirePersistedEntity(
        await api.patch<unknown>(`/pg2030/catalogo/${target.nivel}/${target.id}`, body),
        "El servidor no confirmó la corrección",
      );
      toast.success(`${target.codigo} corregido`);
      onClose();
      await onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo guardar la corrección"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>
                Corregir {TITLES[target.nivel]} <span className="font-mono text-teal-700">{target.codigo}</span>
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="pg-nivel-texto">{target.nivel === "ejes" ? "Nombre" : "Texto"}</Label>
                <textarea
                  id="pg-nivel-texto"
                  className="flex min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                />
              </div>
              {target.nivel === "metas" && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={cuantificable} onChange={(e) => setCuantificable(e.target.checked)} />
                  Meta cuantificable
                </label>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
