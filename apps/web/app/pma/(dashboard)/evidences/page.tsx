"use client";

import { api, apiErrorMessage, requireOkReceipt } from "@/lib/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Evidence } from "@/types";

export default function EvidencesPage() {
  const { user: session} = useAuth();
  const isAdmin = session?.role === "ADMIN";
  const isReporter = session?.role === "REPORTER";
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deletingRef = useRef(false);

  const loadEvidences = useCallback(async (mine: boolean) => {
    setLoading(true);
    try {
      const data = await api.get<Evidence[]>(`/pma/api/evidences${mine ? "?mine=true" : ""}`);
      if (!Array.isArray(data)) throw new TypeError("Respuesta de evidencias inválida");
      setEvidences(data);
      setLoadError(null);
    } catch (error) {
      const message = apiErrorMessage(error, "No se pudieron cargar las evidencias");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) void loadEvidences(isReporter);
  }, [session, isReporter, loadEvidences]);

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta evidencia?")) return;
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingId(id);
    try {
      requireOkReceipt(
        await api.delete<unknown>(`/pma/api/evidences?id=${id}`),
        "El servidor no confirmó la eliminación de la evidencia"
      );
      setEvidences((current) => current.filter((evidence) => evidence.id !== id));
      toast.success("Evidencia eliminada");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Error al eliminar la evidencia"));
    } finally {
      deletingRef.current = false;
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          {isAdmin ? "Todas las Evidencias" : isReporter ? "Mis Evidencias" : "Evidencias de mis planes"}
        </h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "Ver todos los archivos de evidencia subidos"
            : isReporter
              ? "Archivos de evidencia que has subido"
              : "Archivos de evidencia de los planes que tienes asignados"}
        </p>
      </div>

      {loadError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          <p>{loadError}</p>
          <Button variant="link" className="h-auto p-0 text-red-700" onClick={() => void loadEvidences(isReporter)}>
            Reintentar
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Archivos de Evidencia ({evidences.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Cargando evidencias...</p>
          ) : evidences.length === 0 && !loadError ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Sin archivos de evidencia aún.
            </p>
          ) : evidences.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre del Archivo</TableHead>
                  <TableHead>Subido por</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="w-[80px]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evidences.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="font-medium">{ev.fileName}</TableCell>
                    <TableCell>{ev.uploaderName}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {ev.description || "-"}
                    </TableCell>
                    <TableCell>
                      {new Date(ev.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <a
                          href={ev.driveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="ghost" size="sm">
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </a>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={deletingId !== null}
                            aria-busy={deletingId === ev.id}
                            onClick={() => handleDelete(ev.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
