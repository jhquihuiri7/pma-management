"use client";

import { api, ApiError, apiErrorMessage, requirePersistedAsset } from "@/lib/api-client";


import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  Trash2,
  ExternalLink,
  FileCheck,
  FileMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Format, FormatFunctionality } from "@/types";
import { useAuth } from "@/lib/auth-context";

interface FunctionalityConfig {
  key: FormatFunctionality;
  label: string;
  description: string;
}

const FUNCTIONALITIES: FunctionalityConfig[] = [
  {
    key: "descargar_anexos",
    label: "Descargar Anexos",
    description:
      "Formato Word (.docx) con encabezado y pie de página que se aplicará al generar el ZIP de anexos de un período.",
  },
];

export default function FormatosPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [formats, setFormats] = useState<Format[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<FormatFunctionality | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const mutationPendingRef = useRef(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetchFormats();
  }, []);

  async function fetchFormats() {
    setLoading(true);
    try {
      setFormats(await api.get<Format[]>("/rgdp/api/formats"));
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudieron cargar los formatos"));
    } finally {
      setLoading(false);
    }
  }

  function getFormatForFunctionality(key: FormatFunctionality): Format | undefined {
    return formats.find((f) => f.functionality === key);
  }

  const mutationPending = uploading !== null || deleting !== null;

  async function handleUpload(functionality: FormatFunctionality, file: File) {
    if (!isAdmin || mutationPendingRef.current) return;
    mutationPendingRef.current = true;
    setUploading(functionality);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("functionality", functionality);

      const saved = requirePersistedAsset<Format>(
        await api.upload<unknown>("/rgdp/api/formats", formData, { timeoutMs: 60_000 }),
        "El servidor no confirmó el formato guardado"
      );
      if (saved.functionality !== functionality || saved.fileName !== file.name) {
        throw new ApiError(200, "El servidor confirmó datos distintos para el formato", saved, "invalid_response");
      }
      setFormats((current) => [saved, ...current.filter((format) => format.functionality !== functionality)]);
      toast.success("Formato subido correctamente");
      const input = fileInputRefs.current[functionality];
      if (input) input.value = "";
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "Error al subir el formato"));
    } finally {
      mutationPendingRef.current = false;
      setUploading(null);
    }
  }

  async function handleDelete(format: Format) {
    if (!isAdmin || mutationPendingRef.current) return;
    mutationPendingRef.current = true;
    setDeleting(format.id);
    try {
      const receipt = await api.delete<unknown>(`/rgdp/api/formats/${format.id}`);
      if (
        !receipt ||
        typeof receipt !== "object" ||
        (receipt as { ok?: unknown }).ok !== true ||
        (receipt as { deleted?: { id?: unknown } }).deleted?.id !== format.id
      ) {
        throw new ApiError(
          200,
          "El servidor no confirmó la eliminación del formato",
          receipt,
          "invalid_response"
        );
      }
      toast.success("Formato eliminado");
      setFormats((prev) => prev.filter((f) => f.id !== format.id));
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "Error al eliminar el formato"));
    } finally {
      mutationPendingRef.current = false;
      setDeleting(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Formatos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestiona los formatos Word que se usan en las funcionalidades de la
          plataforma. Los archivos se guardan en el almacenamiento configurado
          para el subsistema.
        </p>
      </div>

      <Separator className="mb-6" />

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {FUNCTIONALITIES.map((func) => {
            const currentFormat = getFormatForFunctionality(func.key);
            const isUploading = uploading === func.key;

            return (
              <div
                key={func.key}
                className="border border-slate-200 rounded-xl p-5 bg-white"
              >
                {/* Header */}
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0 w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">
                      {func.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-md">
                      {func.description}
                    </p>
                  </div>
                </div>

                {/* Format status */}
                <div className="mt-4 pl-12">
                  {currentFormat ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <FileCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-emerald-800 truncate">
                          {currentFormat.fileName}
                        </p>
                        <p className="text-xs text-emerald-600 mt-0.5">
                          Subido el{" "}
                          {new Date(currentFormat.uploadedAt).toLocaleDateString(
                            "es-PE",
                            { day: "2-digit", month: "long", year: "numeric" }
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <a
                          href={currentFormat.driveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        </a>
                        {isAdmin && <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          disabled={mutationPending}
                          onClick={() => handleDelete(currentFormat)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>}
                        {isAdmin && <input
                          type="file"
                          disabled={mutationPending}
                          accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                          className="hidden"
                          ref={(el) => { fileInputRefs.current[func.key] = el; }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUpload(func.key, f);
                          }}
                        />}
                        {isAdmin && <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs ml-1"
                          disabled={mutationPending}
                          onClick={() => fileInputRefs.current[func.key]?.click()}
                        >
                          <Upload className="w-3 h-3 mr-1" />
                          {isUploading ? "Subiendo..." : "Reemplazar"}
                        </Button>}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-dashed border-slate-300">
                      <FileMinus className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-500">
                          Sin formato configurado
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Se usará la salida por defecto sin encabezado ni pie de
                          página.
                        </p>
                      </div>
                      {isAdmin && <input
                        type="file"
                        disabled={mutationPending}
                        accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                        className="hidden"
                        ref={(el) => { fileInputRefs.current[func.key] = el; }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUpload(func.key, f);
                        }}
                      />}
                      {isAdmin && <Button
                        size="sm"
                        className="h-8 text-xs flex-shrink-0"
                        disabled={mutationPending}
                        onClick={() => fileInputRefs.current[func.key]?.click()}
                      >
                        <Upload className="w-3 h-3 mr-1" />
                        {isUploading ? "Subiendo..." : "Cargar formato"}
                      </Button>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
