"use client";

import { api, apiErrorMessage, assertQueuedInvitationReceipt, requireOkReceipt } from "@/lib/api-client";
import { useEffect, useRef, useState } from "react";
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
import { UserPlus, Trash2, Send, Users } from "lucide-react";
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
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function loadAssigned(showError = true): Promise<boolean> {
    try {
      setAssigned(await api.get<User[]>(`${apiPrefix}/api/users`));
      return true;
    } catch (error) {
      if (showError) toast.error(apiErrorMessage(error, "No se pudieron cargar los usuarios"));
      return false;
    }
  }

  async function loadAllUsers(): Promise<boolean> {
    try {
      setAllUsers(await api.get<User[]>("/api/users"));
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudieron cargar los usuarios disponibles"));
      return false;
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadAssigned(); }, [apiPrefix]);

  async function openAssignDialog() {
    if (loadingUsers) return;
    setLoadingUsers(true);
    const loaded = await loadAllUsers();
    setLoadingUsers(false);
    if (loaded) setAssignOpen(true);
  }

  async function runLocked(key: string, operation: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingAction(key);
    try {
      await operation();
    } finally {
      pendingRef.current = false;
      setPendingAction(null);
    }
  }

  async function handleAssign(userId: string) {
    await runLocked(`assign:${userId}`, async () => {
      try {
        requireOkReceipt(
          await api.post<unknown>(`${apiPrefix}/api/users/${userId}/assign`),
          "El servidor no confirmó la asignación"
        );
        const assignedUser = allUsers.find((user) => user.id === userId);
        if (assignedUser) {
          setAssigned((current) => current.some((user) => user.id === userId)
            ? current
            : [...current, assignedUser]);
        }
        toast.success("Usuario asignado a " + appLabel);
      } catch (error) {
        toast.error(apiErrorMessage(error, "Error al asignar usuario"));
      }
    });
  }

  async function handleUnassign(userId: string, name: string) {
    if (!confirm(`¿Quitar a ${name} del subsistema ${appLabel}?`)) return;
    await runLocked(`unassign:${userId}`, async () => {
      try {
        requireOkReceipt(
          await api.delete<unknown>(`${apiPrefix}/api/users/${userId}`),
          "El servidor no confirmó la desasignación"
        );
        setAssigned((current) => current.filter((user) => user.id !== userId));
        toast.success(`${name} fue quitado de ${appLabel}`);
      } catch (error) {
        toast.error(apiErrorMessage(error, "Error al quitar usuario"));
      }
    });
  }

  async function handleResend(userId: string, email: string) {
    await runLocked(`resend:${userId}`, async () => {
      try {
        const receipt = await api.post<unknown>(`${apiPrefix}/api/users/${userId}/resend-invitation`);
        assertQueuedInvitationReceipt(receipt);
        toast.success(`Invitación encolada para ${email}`);
      } catch (error) {
        toast.error(apiErrorMessage(error, "Error al encolar la invitación"));
      }
    });
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
                      disabled={pendingAction !== null}
                      onClick={() => handleResend(user.id, user.email)}>
                      <Send className="w-4 h-4 text-blue-500" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" title="Quitar de este subsistema"
                    disabled={pendingAction !== null}
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
          <Button onClick={openAssignDialog} disabled={loadingUsers || pendingAction !== null}>
            <UserPlus className="w-4 h-4 mr-2" />
            Asignar Usuario
          </Button>
        </div>
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
                  <Button size="sm" disabled={pendingAction !== null}
                    onClick={() => handleAssign(user.id)}>
                    {pendingAction === `assign:${user.id}` ? "Asignando..." : "Asignar"}
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
