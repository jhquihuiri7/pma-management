"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api, apiErrorMessage } from "@/lib/api-client";

type Visibility = "public" | "internal" | "restricted";

interface MapAccess {
  mapId: string;
  visibility: Visibility;
  createdBy: string | null;
  users: Array<{ id: string; name: string; email: string }>;
}

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "REPORTER" | "VIEWER";
  apps: string[];
}

const OPTIONS: Array<{ value: Visibility; label: string; help: string }> = [
  { value: "public", label: "Público", help: "Cualquiera, con o sin sesión (como hasta ahora)." },
  { value: "internal", label: "Interno", help: "Solo usuarios con acceso al Geoportal." },
  { value: "restricted", label: "Restringido", help: "Solo administradores, quien lo creó y los usuarios elegidos." },
];

/**
 * Who may read a map — and so find and open its layers in the Workspace
 * (ADMIN only). Backed by PUT /geo/maps/:id/access (modules/geo/access.ts).
 */
export default function MapAccessDialog({
  mapId,
  mapTitle,
  onClose,
  onSaved,
}: {
  mapId: string;
  mapTitle: string;
  onClose: () => void;
  onSaved: (visibility: Visibility) => void;
}) {
  const [access, setAccess] = useState<MapAccess | null>(null);
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.get<MapAccess>(`/geo/maps/${mapId}/access`), api.get<ManagedUser[]>("/api/users")])
      .then(([current, all]) => {
        setAccess(current);
        setVisibility(current.visibility);
        setSelected(new Set(current.users.map((u) => u.id)));
        setUsers(all);
      })
      .catch((e) => toast.error(apiErrorMessage(e, "No se pudo cargar el acceso del mapa")));
  }, [mapId]);

  const candidates = useMemo(
    () => (users ?? []).filter((u) => u.role !== "ADMIN" && u.apps.includes("geo")).sort((a, b) => a.name.localeCompare(b.name, "es")),
    [users],
  );

  async function save() {
    setSaving(true);
    try {
      await api.put(`/geo/maps/${mapId}/access`, {
        visibility,
        ...(visibility === "restricted" ? { userIds: Array.from(selected) } : {}),
      });
      toast.success("Acceso del mapa actualizado");
      onSaved(visibility);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e, "No se pudo guardar el acceso"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => { if (!saving) onClose(); }}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Acceso del mapa">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Acceso del mapa</h2>
            <p className="truncate text-xs text-slate-500">{mapTitle}</p>
          </div>
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose} disabled={saving} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        {!access || !users ? (
          <p className="flex items-center gap-2 p-5 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
        ) : (
          <div className="space-y-4 p-5">
            <fieldset className="space-y-2">
              {OPTIONS.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="radio" name="visibility" className="mt-1" checked={visibility === o.value} onChange={() => setVisibility(o.value)} />
                  <span>
                    <span className="font-medium text-slate-800">{o.label}</span>
                    <span className="block text-xs text-slate-500">{o.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {visibility === "restricted" && (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-700">Usuarios autorizados</p>
                {candidates.length === 0 ? (
                  <p className="text-xs text-slate-500">No hay usuarios con acceso al Geoportal.</p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                    {candidates.map((u) => (
                      <li key={u.id}>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected.has(u.id)}
                            onChange={(e) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (e.target.checked) next.add(u.id);
                                else next.delete(u.id);
                                return next;
                              })
                            }
                          />
                          <span className="min-w-0 truncate">{u.name} <span className="text-xs text-slate-500">{u.email}</span></span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="h-8 rounded-md border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50" onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-600 px-3 text-xs font-medium text-white hover:bg-teal-700 disabled:bg-slate-300"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
