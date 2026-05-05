"use client";

import { useEffect, useState } from "react";
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
import { Plus, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { User } from "@/types";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    unit: "",
    position: "",
    role: "REPORTER" as "REPORTER" | "VIEWER",
  });

  async function loadUsers() {
    const res = await fetch("/pg/api/users");
    if (res.ok) {
      setUsers(await res.json());
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const res = await fetch("/pg/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    setLoading(false);

    if (res.ok) {
      const data = await res.json();
      if ((data as { emailSent?: boolean }).emailSent === false) {
        toast.warning(
          "Usuario creado, pero no se pudo enviar el correo de invitación. Usa 'Reenviar invitación' para intentarlo de nuevo."
        );
      } else {
        toast.success(
          `${form.role === "VIEWER" ? "Visualizador" : "Reportero"} creado. Se envió un correo de invitación a ${form.email}.`
        );
      }
      setForm({ name: "", email: "", unit: "", position: "", role: "REPORTER" });
      setOpen(false);
      loadUsers();
    } else {
      const data = await res.json();
      toast.error(data.error || "Error al crear usuario");
    }
  }

  async function handleDelete(userId: string) {
    if (!confirm("¿Estás seguro de que quieres eliminar este usuario?")) return;

    const res = await fetch(`/pg/api/users?userId=${userId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      toast.success("Usuario eliminado");
      loadUsers();
    } else {
      toast.error("Error al eliminar usuario");
    }
  }

  async function handleResendInvitation(userId: string, email: string) {
    const res = await fetch("/pg/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    if (res.ok) {
      toast.success(`Invitación reenviada a ${email}`);
    } else {
      const data = await res.json();
      toast.error(data.error || "Error al reenviar invitación");
    }
  }

  const reporters = users.filter((u) => u.role === "REPORTER");
  const viewers = users.filter((u) => u.role === "VIEWER");

  function StatusBadge({ user }: { user: User }) {
    if (user.passwordSet === false) {
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
          Pendiente
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">
        Activo
      </Badge>
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
            <TableHead>Creado</TableHead>
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
              <TableCell>
                <StatusBadge user={user} />
              </TableCell>
              <TableCell>
                {new Date(user.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {user.passwordSet === false && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Reenviar invitación"
                      onClick={() => handleResendInvitation(user.id, user.email)}
                    >
                      <Send className="w-4 h-4 text-blue-500" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Eliminar usuario"
                    onClick={() => handleDelete(user.id)}
                  >
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
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-muted-foreground">
            Gestionar cuentas de reporteros y visualizadores de tu organización
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="w-4 h-4 mr-2" />
            Agregar Usuario
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear Nuevo Usuario</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-2">
              Se enviará un correo de invitación para que el usuario establezca su propia contraseña.
            </p>
            <form onSubmit={handleCreate} className="space-y-4 mt-2">
              {/* Role selector */}
              <div className="space-y-2">
                <Label>Tipo de usuario</Label>
                <div className="flex rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                      form.role === "REPORTER"
                        ? "bg-white shadow-sm text-slate-900"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                    onClick={() => setForm({ ...form, role: "REPORTER" })}
                  >
                    Reportero
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                      form.role === "VIEWER"
                        ? "bg-white shadow-sm text-slate-900"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                    onClick={() => setForm({ ...form, role: "VIEWER" })}
                  >
                    Visualizador
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Nombre Completo</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Dirección</Label>
                <Input
                  id="unit"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="position">Cargo</Label>
                <Input
                  id="position"
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading
                  ? "Creando..."
                  : form.role === "VIEWER"
                  ? "Crear Visualizador"
                  : "Crear Reportero"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Reporters Table */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            Reporteros ({reporters.length})
          </CardTitle>
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

      {/* Viewers Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Visualizadores ({viewers.length})
          </CardTitle>
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
    </div>
  );
}
