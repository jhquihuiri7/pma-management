"use client";

import {
  api,
  ApiError,
  apiErrorMessage,
  assertQueuedInvitationReceipt,
  requireOkReceipt,
  requirePersistedEntity,
} from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Send, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { User, type Pg2030Institucion } from "@/types";

type AppKey = "pma" | "rgdp" | "geo" | "previene" | "pg2030" | "plan_familiar";

const APP_LABELS: Record<AppKey, string> = {
  pma: "PMA",
  rgdp: "RGDP",
  geo: "Geoportal",
  previene: "Previene",
  pg2030: "PG2030",
  plan_familiar: "Plan Familiar",
};

const ALL_APPS: AppKey[] = ["pma", "rgdp", "geo", "previene", "pg2030", "plan_familiar"];

const emptyForm = {
  name: "",
  email: "",
  unit: "",
  position: "",
  role: "REPORTER" as "ADMIN" | "REPORTER" | "VIEWER",
  apps: [] as AppKey[],
  pg2030InstitucionId: "",
};

/** A PG2030 reporter reports for one institution; no other role carries one. */
function needsPg2030Institucion(role: string, apps: readonly string[]) {
  return role === "REPORTER" && apps.includes("pg2030");
}

export default function AdminUsersPage() {
  const { user: session } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState({
    name: "",
    unit: "",
    position: "",
    role: "REPORTER" as "ADMIN" | "REPORTER" | "VIEWER",
    pg2030InstitucionId: "",
  });
  const [pg2030Instituciones, setPg2030Instituciones] = useState<Pg2030Institucion[]>([]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef(false);

  async function withActionLock(key: string, operation: () => Promise<void>) {
    if (pendingActionRef.current) return;
    pendingActionRef.current = true;
    setPendingAction(key);
    try {
      await operation();
    } finally {
      pendingActionRef.current = false;
      setPendingAction(null);
    }
  }

  async function loadUsers() {
    try {
      const data = await api.get<User[]>("/api/users");
      setUsers(data);
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudieron cargar los usuarios"));
    }
  }

  async function loadPg2030Instituciones() {
    try {
      setPg2030Instituciones(await api.get<Pg2030Institucion[]>("/pg2030/instituciones"));
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudieron cargar las instituciones de PG2030"));
    }
  }

  useEffect(() => { loadUsers(); loadPg2030Instituciones(); }, []);

  function toggleApp(app: AppKey) {
    setForm((f) => ({
      ...f,
      apps: f.apps.includes(app) ? f.apps.filter((a) => a !== app) : [...f.apps, app],
    }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await withActionLock("create", async () => {
      setLoading(true);
      try {
        const response = await api.post<unknown>("/api/users", {
          name: form.name,
          email: form.email,
          role: form.role,
          unit: form.unit || undefined,
          position: form.position || undefined,
          apps: form.role === "ADMIN" ? [] : form.apps,
          pg2030InstitucionId: needsPg2030Institucion(form.role, form.apps)
            ? form.pg2030InstitucionId || undefined
            : undefined,
        });
        const saved = requirePersistedEntity<{ id: string; invitation: unknown }>(
          response,
          "El servidor no confirmó la creación del usuario"
        );
        if (!("invitation" in saved)) {
          throw new ApiError(200, "El servidor no informó el estado de la invitación", response, "invalid_response");
        }
        assertQueuedInvitationReceipt(saved);
        toast.success(`Usuario creado; invitación encolada para ${form.email}.`);
        setForm(emptyForm);
        setCreateOpen(false);
        await loadUsers();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Error al crear usuario");
      } finally {
        setLoading(false);
      }
    });
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    // Sent only when it changed and still applies: a role change away from
    // REPORTER drops the institution on the server by itself.
    const institucionChanged =
      needsPg2030Institucion(editForm.role, editUser.apps ?? []) &&
      editForm.pg2030InstitucionId !== (editUser.pg2030Institucion?.id ?? "");
    await withActionLock(`edit:${editUser.id}`, async () => {
      setLoading(true);
      try {
        requireOkReceipt(
          await api.put<unknown>(`/api/users/${editUser.id}`, {
            name: editForm.name || undefined,
            unit: editForm.unit || null,
            position: editForm.position || null,
            role: editForm.role,
            ...(institucionChanged ? { pg2030InstitucionId: editForm.pg2030InstitucionId || null } : {}),
          }),
          "El servidor no confirmó la actualización del usuario"
        );
        toast.success("Usuario actualizado");
        setEditUser(null);
        await loadUsers();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Error al actualizar usuario");
      } finally {
        setLoading(false);
      }
    });
  }

  async function handleDelete(userId: string, name: string) {
    if (!confirm(`¿Eliminar permanentemente a ${name}? Esto lo quitará de todos los subsistemas.`)) return;
    await withActionLock(`delete:${userId}`, async () => {
      try {
        requireOkReceipt(
          await api.delete<unknown>(`/api/users/${userId}`),
          "El servidor no confirmó la eliminación del usuario"
        );
        toast.success("Usuario eliminado");
        setUsers((current) => current.filter((user) => user.id !== userId));
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Error al eliminar usuario");
      }
    });
  }

  async function handleResend(userId: string, email: string) {
    await withActionLock(`resend:${userId}`, async () => {
      try {
        const receipt = await api.post<unknown>(`/api/users/${userId}/resend-invitation`);
        assertQueuedInvitationReceipt(receipt);
        toast.success(`Invitación encolada para ${email}`);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Error al encolar la invitación");
      }
    });
  }

  async function handleAssignApp(userId: string, appKey: AppKey) {
    await withActionLock(`assign:${userId}:${appKey}`, async () => {
      try {
        requireOkReceipt(
          await api.post<unknown>(`/api/users/${userId}/apps`, { appKey }),
          "El servidor no confirmó la asignación de la aplicación"
        );
        await loadUsers();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Error al asignar aplicación");
      }
    });
  }

  async function handleUnassignApp(userId: string, appKey: AppKey) {
    await withActionLock(`unassign:${userId}:${appKey}`, async () => {
      try {
        requireOkReceipt(
          await api.delete<unknown>(`/api/users/${userId}/apps/${appKey}`),
          "El servidor no confirmó la desasignación de la aplicación"
        );
        await loadUsers();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Error al quitar aplicación");
      }
    });
  }

  function openEdit(user: User) {
    setEditUser(user);
    setEditForm({
      name: user.name,
      unit: user.unit || "",
      position: user.position || "",
      role: user.role,
      pg2030InstitucionId: user.pg2030Institucion?.id ?? "",
    });
  }

  const institucionesActivas = pg2030Instituciones.filter((i) => i.activa);

  // A render function, not a component: declared inside the page, a component
  // would be a new type on every render and remount the <select> mid-edit.
  function renderPg2030InstitucionSelect({ id, value, required, onChange }: {
    id: string;
    value: string;
    required: boolean;
    onChange: (value: string) => void;
  }) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>Institución en PG2030</Label>
        <select id={id} required={required} value={value} onChange={(e) => onChange(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">{required ? "Elige la institución…" : "Sin institución"}</option>
          {institucionesActivas.map((i) => (
            <option key={i.id} value={i.id}>{i.sigla} — {i.nombre}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          El reportero planifica y reporta solo por esta institución.
        </p>
      </div>
    );
  }

  const admins = users.filter((u) => u.role === "ADMIN");
  const reporters = users.filter((u) => u.role === "REPORTER");
  const viewers = users.filter((u) => u.role === "VIEWER");

  function StatusBadge({ user }: { user: User }) {
    return user.passwordSet === false ? (
      <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">Pendiente</Badge>
    ) : (
      <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">Activo</Badge>
    );
  }

  function AppBadges({ user }: { user: User }) {
    if (user.role === "ADMIN") {
      return (
        <Badge variant="secondary" className="text-xs">Todos los subsistemas</Badge>
      );
    }
    const assigned = (user.apps ?? []) as AppKey[];
    const unassigned = ALL_APPS.filter((a) => !assigned.includes(a));
    return (
      <div className="flex flex-wrap gap-1">
        {assigned.map((a) => {
          // A PG2030 reporter shows the institution they report for, or that they lack one.
          const pg2030Reporter = a === "pg2030" && user.role === "REPORTER";
          const sinInstitucion = pg2030Reporter && !user.pg2030Institucion;
          return (
            <Badge
              key={a}
              variant="secondary"
              className={`text-xs flex items-center gap-1 group ${sinInstitucion ? "bg-amber-100 text-amber-800" : ""} ${pendingAction ? "pointer-events-none opacity-50" : "cursor-pointer hover:bg-red-100 hover:text-red-700"}`}
              aria-disabled={pendingAction !== null}
              onClick={() => { if (!pendingAction) void handleUnassignApp(user.id, a); }}
              title={sinInstitucion
                ? "Reportero de PG2030 sin institución: asígnala editando el usuario. Clic para quitar PG2030"
                : `Quitar de ${APP_LABELS[a]}`}
            >
              {APP_LABELS[a]}
              {pg2030Reporter && (user.pg2030Institucion ? ` · ${user.pg2030Institucion.sigla}` : " · sin institución")}
              <X className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100" />
            </Badge>
          );
        })}
        {unassigned.map((a) => (
          <Badge
            key={a}
            variant="outline"
            className={`text-xs text-slate-400 border-dashed ${pendingAction ? "pointer-events-none opacity-50" : "cursor-pointer hover:bg-slate-100"}`}
            aria-disabled={pendingAction !== null}
            onClick={() => { if (!pendingAction) void handleAssignApp(user.id, a); }}
            title={`Asignar a ${APP_LABELS[a]}`}
          >
            + {APP_LABELS[a]}
          </Badge>
        ))}
      </div>
    );
  }

  function UserTable({ list }: { list: User[] }) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Correo</TableHead>
            <TableHead>Dirección</TableHead>
            <TableHead>Cargo</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Aplicaciones</TableHead>
            <TableHead className="w-[100px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                  {user.name}
                  {user.id === session?.id && (
                    <Badge variant="outline" className="text-xs text-slate-600 border-slate-300 bg-slate-50">Tú</Badge>
                  )}
                </span>
              </TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>{user.unit || "-"}</TableCell>
              <TableCell>{user.position || "-"}</TableCell>
              <TableCell><StatusBadge user={user} /></TableCell>
              <TableCell><AppBadges user={user} /></TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {user.passwordSet === false && (
                    <Button variant="ghost" size="sm" title="Reenviar invitación"
                      disabled={pendingAction !== null}
                      onClick={() => handleResend(user.id, user.email)}>
                      <Send className="w-4 h-4 text-blue-500" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" title="Editar usuario"
                    disabled={pendingAction !== null}
                    onClick={() => openEdit(user)}>
                    <Pencil className="w-4 h-4 text-slate-500" />
                  </Button>
                  {user.id !== session?.id && (
                    <Button variant="ghost" size="sm" title="Eliminar usuario"
                      disabled={pendingAction !== null}
                      onClick={() => handleDelete(user.id, user.name)}>
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Gestión de Usuarios</h1>
          <p className="text-muted-foreground">
            Crea y administra usuarios de tu organización. Asígnalos a los subsistemas desde aquí.
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Usuario
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear Nuevo Usuario</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-2">
              Se enviará un correo de invitación para que el usuario establezca su contraseña.
            </p>
            <form onSubmit={handleCreate} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Tipo de usuario</Label>
                <div className="flex rounded-lg bg-slate-100 p-1">
                  {(["ADMIN", "REPORTER", "VIEWER"] as const).map((r) => (
                    <button key={r} type="button"
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                        form.role === r ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
                      }`}
                      onClick={() => setForm({ ...form, role: r })}
                    >
                      {r === "ADMIN" ? "Administrador" : r === "REPORTER" ? "Reportero" : "Visualizador"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Nombre Completo</Label>
                <Input id="name" value={form.name} required
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input id="email" type="email" value={form.email} required
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="unit">Dirección</Label>
                  <Input id="unit" value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="position">Cargo</Label>
                  <Input id="position" value={form.position}
                    onChange={(e) => setForm({ ...form, position: e.target.value })} />
                </div>
              </div>

              {form.role === "ADMIN" ? (
                <p className="text-sm text-muted-foreground rounded-lg bg-slate-50 border border-slate-200 p-3">
                  Los administradores tienen acceso a todos los subsistemas por defecto.
                </p>
              ) : (
                <div className="space-y-2">
                  <Label>Asignar a subsistemas</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_APPS.map((appKey) => (
                      <label key={appKey}
                        className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50">
                        <input type="checkbox" checked={form.apps.includes(appKey)}
                          onChange={() => toggleApp(appKey)}
                          className="rounded border-slate-300" />
                        <span className="text-sm font-medium">{APP_LABELS[appKey]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {needsPg2030Institucion(form.role, form.apps) && (
                renderPg2030InstitucionSelect({
                  id: "pg2030-institucion",
                  required: true,
                  value: form.pg2030InstitucionId,
                  onChange: (value) => setForm({ ...form, pg2030InstitucionId: value }),
                })
              )}

              <Button type="submit" className="w-full" disabled={loading || pendingAction !== null}>
                {loading ? "Creando..." : "Crear Usuario"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Administradores ({admins.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {admins.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin administradores aún. Crea uno para comenzar.
            </p>
          ) : (
            <UserTable list={admins} />
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Reporteros ({reporters.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {reporters.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin reporteros aún. Crea uno para comenzar.
            </p>
          ) : (
            <UserTable list={reporters} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visualizadores ({viewers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {viewers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin visualizadores aún. Crea uno para comenzar.
            </p>
          ) : (
            <UserTable list={viewers} />
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => !o && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuario</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Tipo de usuario</Label>
              <div className="flex rounded-lg bg-slate-100 p-1">
                {(["ADMIN", "REPORTER", "VIEWER"] as const).map((r) => (
                  <button key={r} type="button"
                    disabled={editUser?.id === session?.id}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                      editForm.role === r ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                    onClick={() => setEditForm({ ...editForm, role: r })}
                  >
                    {r === "ADMIN" ? "Administrador" : r === "REPORTER" ? "Reportero" : "Visualizador"}
                  </button>
                ))}
              </div>
              {editUser?.id === session?.id && (
                <p className="text-xs text-muted-foreground">No puedes cambiar tu propio rol.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nombre Completo</Label>
              <Input id="edit-name" value={editForm.name} required
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-unit">Dirección</Label>
                <Input id="edit-unit" value={editForm.unit}
                  onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-position">Cargo</Label>
                <Input id="edit-position" value={editForm.position}
                  onChange={(e) => setEditForm({ ...editForm, position: e.target.value })} />
              </div>
            </div>
            {editUser && needsPg2030Institucion(editForm.role, editUser.apps ?? []) && (
              renderPg2030InstitucionSelect({
                id: "edit-pg2030-institucion",
                required: false,
                value: editForm.pg2030InstitucionId,
                onChange: (value) => setEditForm({ ...editForm, pg2030InstitucionId: value }),
              })
            )}
            <Button type="submit" className="w-full" disabled={loading || pendingAction !== null}>
              {loading ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
