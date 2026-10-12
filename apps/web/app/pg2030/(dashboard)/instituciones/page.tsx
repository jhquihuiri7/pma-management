"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api, apiErrorMessage, requireOkReceipt, requirePersistedEntity } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PG2030_INSTITUCION_TIPO_VALUES, type Pg2030Institucion, type Pg2030InstitucionTipo } from "@/types";

type Form = { nombre: string; sigla: string; tipo: Pg2030InstitucionTipo; activa: boolean };
const emptyForm: Form = { nombre: "", sigla: "", tipo: "Ejecutivo", activa: true };

export default function Pg2030InstitucionesPage() {
  const { user: session } = useAuth();
  const isAdmin = session?.role === "ADMIN";
  const [instituciones, setInstituciones] = useState<Pg2030Institucion[] | null>(null);
  // `null` closes the dialog; "new" creates; an id edits that institution.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      setInstituciones(await api.get<Pg2030Institucion[]>("/pg2030/instituciones"));
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudieron cargar las instituciones"));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setForm(emptyForm);
    setEditing("new");
  }

  function openEdit(institucion: Pg2030Institucion) {
    setForm({ nombre: institucion.nombre, sigla: institucion.sigla, tipo: institucion.tipo, activa: institucion.activa });
    setEditing(institucion.id);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setPending(true);
    try {
      const saved = editing === "new"
        ? await api.post<unknown>("/pg2030/instituciones", form)
        : await api.patch<unknown>(`/pg2030/instituciones/${editing}`, form);
      requirePersistedEntity(saved, "El servidor no confirmó el guardado");
      toast.success(editing === "new" ? `Institución ${form.sigla} creada` : `Institución ${form.sigla} actualizada`);
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo guardar la institución"));
    } finally {
      setPending(false);
    }
  }

  async function remove(institucion: Pg2030Institucion) {
    if (!confirm(`¿Eliminar ${institucion.sigla}? Solo procede si nadie depende de ella; si tiene historia, desactívala.`)) return;
    setPending(true);
    try {
      requireOkReceipt(await api.delete<unknown>(`/pg2030/instituciones/${institucion.id}`), "El servidor no confirmó la eliminación");
      toast.success(`Institución ${institucion.sigla} eliminada`);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo eliminar la institución"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Instituciones</h1>
          <p className="text-muted-foreground">
            Catálogo único de instituciones que planifican y reportan sobre los proyectos del Plan. Una sigla, una institución.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva institución
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {instituciones ? `${instituciones.length} institución(es)` : "Instituciones"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!instituciones ? (
            <Skeleton className="h-32 w-full" />
          ) : instituciones.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay instituciones.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sigla</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Reporteros</TableHead>
                  {isAdmin && <TableHead className="w-[90px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {instituciones.map((institucion) => (
                  <TableRow key={institucion.id}>
                    <TableCell className="font-mono font-semibold">{institucion.sigla}</TableCell>
                    <TableCell className="whitespace-normal">{institucion.nombre}</TableCell>
                    <TableCell>{institucion.tipo}</TableCell>
                    <TableCell>
                      {institucion.activa ? (
                        <Badge variant="outline" className="border-green-300 bg-green-50 text-green-700">Activa</Badge>
                      ) : (
                        <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-500">Inactiva</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal text-sm">
                      {institucion.usuarios.length === 0
                        ? <span className="text-slate-400">—</span>
                        : institucion.usuarios.map((u) => u.name).join(", ")}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" title="Editar" disabled={pending} onClick={() => openEdit(institucion)}>
                            <Pencil className="h-4 w-4 text-slate-500" />
                          </Button>
                          <Button variant="ghost" size="sm" title="Eliminar" disabled={pending} onClick={() => remove(institucion)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Los reporteros se asignan a su institución desde Administración → Usuarios, al darles acceso a PG2030.
      </p>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Nueva institución" : "Editar institución"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inst-nombre">Nombre oficial</Label>
              <Input id="inst-nombre" required value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="inst-sigla">Sigla</Label>
                <Input id="inst-sigla" required maxLength={40} value={form.sigla}
                  onChange={(e) => setForm({ ...form, sigla: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inst-tipo">Tipo</Label>
                <select id="inst-tipo" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Pg2030InstitucionTipo })}>
                  {PG2030_INSTITUCION_TIPO_VALUES.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} />
              Activa (una institución inactiva no recibe reporteros nuevos)
            </label>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Guardando..." : "Guardar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
