"use client";

import { apiFetch } from "@/lib/api-client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Trash2, Send, ExternalLink, Users } from "lucide-react";
import { toast } from "sonner";
import { User } from "@/types";

interface Props {
  appLabel: string;
  apiPrefix: string;
}

export default function SubsystemUsersPage({ appLabel, apiPrefix }: Props) {
  const [assigned, setAssigned] = useState<User[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  async function loadAssigned() {
    const res = await apiFetch(`${apiPrefix}/api/users`);
    if (res.ok) setAssigned(await res.json());
  }

  async function loadAllUsers() {
    const res = await apiFetch("/api/users");
    if (res.ok) setAllUsers(await res.json());
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAssigned(); }, [apiPrefix]);

  async function openAssignDialog() {
    await loadAllUsers();
    setAssignOpen(true);
  }

  async function handleAssign(userId: string) {
    setAssigning(userId);
    const res = await apiFetch(`${apiPrefix}/api/users/${userId}/assign`, {
      method: "POST",
    });
    setAssigning(null);
    if (res.ok) {
      toast.success("Usuario asignado a " + appLabel);
      loadAssigned();
      loadAllUsers();
    } else {
      const data = await res.json();
      toast.error(data.message || "Error al asignar usuario");
    }
  }

  async function handleUnassign(userId: string, name: string) {
    if (!confirm(`¿Quitar a ${name} del subsistema ${appLabel}?`)) return;
    const res = await apiFetch(`${apiPrefix}/api/users/${userId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`${name} fue quitado de ${appLabel}`);
      loadAssigned();
    } else {
      toast.error("Error al quitar usuario");
    }
  }

  async function handleResend(userId: string, email: string) {
    const res = await apiFetch(`${apiPrefix}/api/users/${userId}/resend-invitation`, {
      method: "POST",
    });
    if (res.ok) {
      toast.success(`Invitación reenviada a ${email}`);
    } else {
      const data = await res.json();
      toast.error(data.message || "Error al reenviar invitación");
    }
  }

  const assignedIds = new Set(assigned.map((u) => u.id));
  const unassigned = allUsers.filter((u) => !assignedIds.has(u.id));

  const reporters = assigned.filter((u) => u.role === "REPORTER");
  const viewers = assigned.filter((u) => u.role === "VIEWER");

  function StatusBadge({ user }: { user: User }) {
    return user.passwordSet === false ? (
      <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">Pendiente</Badge>
    ) : (
      <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">Activo</Badge>
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
            <TableHead className="w-[80px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>{user.unit || "-"}</TableCell>
              <TableCell>{user.position || "-"}</TableCell>
              <TableCell><StatusBadge user={user} /></TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {user.passwordSet === false && (
                    <Button variant="ghost" size="sm" title="Reenviar invitación"
                      onClick={() => handleResend(user.id, user.email)}>
                      <Send className="w-4 h-4 text-blue-500" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" title="Quitar de este subsistema"
                    onClick={() => handleUnassign(user.id, user.name)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
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
          <h1 className="text-2xl font-bold">Usuarios de {appLabel}</h1>
          <p className="text-muted-foreground">
            Usuarios asignados a este subsistema.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/users">
            <Button variant="outline" size="sm">
              <Users className="w-4 h-4 mr-2" />
              Gestión Global
              <ExternalLink className="w-3 h-3 ml-1 opacity-60" />
            </Button>
          </Link>
          <Button onClick={openAssignDialog}>
            <UserPlus className="w-4 h-4 mr-2" />
            Asignar Usuario
          </Button>
        </div>
      </div>

      <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-100 text-sm text-blue-700 flex items-center gap-2">
        <ExternalLink className="w-4 h-4 shrink-0" />
        Para crear nuevos usuarios ve a{" "}
        <Link href="/admin/users" className="font-semibold underline underline-offset-2">
          Gestión Global de Usuarios
        </Link>
        . Aquí solo se asignan usuarios existentes.
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Reporteros ({reporters.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {reporters.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin reporteros asignados a este subsistema.
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
              Sin visualizadores asignados a este subsistema.
            </p>
          ) : (
            <UserTable list={viewers} />
          )}
        </CardContent>
      </Card>

      {/* Assign dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Asignar Usuario a {appLabel}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            Selecciona un usuario de tu organización para darle acceso a este subsistema.
          </p>
          {unassigned.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Todos los usuarios ya están asignados a este subsistema, o no hay usuarios creados.
              </p>
              <Link href="/admin/users">
                <Button variant="outline" size="sm" className="mt-3">
                  <Users className="w-4 h-4 mr-2" />
                  Crear un usuario nuevo
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {unassigned.map((user) => (
                <div key={user.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {user.role === "REPORTER" ? "Reportero" : "Visualizador"}
                      </Badge>
                      {user.passwordSet === false && (
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                          Pendiente
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button size="sm" disabled={assigning === user.id}
                    onClick={() => handleAssign(user.id)}>
                    {assigning === user.id ? "Asignando..." : "Asignar"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
