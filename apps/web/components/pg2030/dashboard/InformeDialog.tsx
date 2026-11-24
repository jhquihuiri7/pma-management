"use client";

import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { FileText, Loader2, TriangleAlert } from "lucide-react";
import { api, apiErrorMessage, checkedApiFetch } from "@/lib/api-client";
import { MESES_LARGOS } from "@/lib/pg2030";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Pg2030Dashboard, Pg2030InstitucionTipo } from "@/types";
import { AlineacionChart, AvanceFisicoChart, CoherenciaChart, DineroChart } from "./graficos";

const fieldClass = "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const TIPOS: Pg2030InstitucionTipo[] = ["Ejecutivo", "GAD", "Otro"];
const CLAVE_LOCAL = "pg2030.informe.campos";

type ClaveGrafico = "alineacion" | "avanceFisico" | "presupuesto" | "coherencia" | "inversion";

type Campos = {
  numeroInforme: string;
  fecha: string;
  oficiosMetas: string;
  oficioAvances: string;
  fechaLimite: string;
  enlaceAnexo: string;
  observaciones: string;
};

type EstadoTrabajo = {
  estado: "en_cola" | "redactando" | "listo" | "error";
  paso: number;
  pasos: number;
  detalle: string;
  enCola: number;
  avisos: string[];
  error: string | null;
  nombreArchivo: string;
};

type Fase =
  | { tipo: "formulario" }
  | { tipo: "capturando" }
  | { tipo: "redactando"; trabajo: EstadoTrabajo | null }
  | { tipo: "listo"; avisos: string[] };

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Text fields remembered from the last report (this browser only). */
function recordados(): Partial<Campos> {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_LOCAL) ?? "{}") as Partial<Campos>;
  } catch {
    return {};
  }
}

function recordar(c: Campos) {
  try {
    const { numeroInforme, oficiosMetas, oficioAvances, enlaceAnexo } = c;
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify({ numeroInforme, oficiosMetas, oficioAvances, enlaceAnexo }));
  } catch {
    // Private mode or blocked storage: the form simply starts empty next time.
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The dashboard's own charts, drawn off-screen at a fixed width and without
 * animation, so the Word report carries them exactly as the panel shows them.
 */
export function GraficosInforme({ d, nodos }: { d: Pg2030Dashboard; nodos: React.MutableRefObject<Partial<Record<ClaveGrafico, HTMLDivElement | null>>> }) {
  const nada = () => {};
  const avance = d.instituciones
    .filter((i) => i.cuenta && i.fisico.valor !== null && i.fisico.semaforo !== null)
    .sort((a, b) => b.fisico.valor! - a.fisico.valor! || a.institucion.sigla.localeCompare(b.institucion.sigla));
  const fuentes = d.presupuesto.porFuente.filter((f) => f.dinero.planificado > 0 || f.dinero.devengado > 0);
  const puntos = d.instituciones.filter((i) => i.cuenta && i.coherencia !== "no_aplica" && i.fisico.valor !== null && i.presupuesto.valor !== null);
  const tipos = d.inversion.filter((t) => t.total.planificado > 0 || t.total.devengado > 0);
  const marco = (clave: ClaveGrafico, hijo: React.ReactNode) => (
    <div ref={(n) => { nodos.current[clave] = n; }} style={{ width: 600, padding: 12, background: "#ffffff" }}>{hijo}</div>
  );
  return (
    <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, width: 600, pointerEvents: "none" }}>
      {d.alineacion.porEje.some((e) => e.total > 0) && marco("alineacion", (
        <AlineacionChart estatico leyenda={d.leyenda} categorias={d.alineacion.categorias}
          filas={d.alineacion.porEje.map((e) => ({ eje: e.eje.codigo, total: e.total, porCategoria: e.porCategoria }))} />
      ))}
      {avance.length > 0 && marco("avanceFisico", (
        <AvanceFisicoChart estatico leyenda={d.leyenda} promedio={d.avanceFisico.valor} onSelect={nada}
          filas={avance.map((i) => ({ id: i.institucion.id, sigla: i.institucion.sigla, valor: i.fisico.valor!, semaforo: i.fisico.semaforo! }))} />
      ))}
      {avance.length > 0 && fuentes.length > 0 && marco("presupuesto", (
        <DineroChart estatico leyenda={d.leyenda}
          filas={fuentes.map((f) => ({ nombre: f.fuente, planificado: f.dinero.planificado, computable: f.dinero.computable, avance: f.dinero.avance }))} />
      ))}
      {avance.length > 0 && puntos.length > 0 && marco("coherencia", (
        <CoherenciaChart leyenda={d.leyenda} onSelect={nada}
          puntos={puntos.map((i) => ({ id: i.institucion.id, sigla: i.institucion.sigla, fisico: i.fisico.valor!, presupuesto: i.presupuesto.valor!, coherencia: i.coherencia }))} />
      ))}
      {tipos.length > 0 && marco("inversion", (
        <DineroChart estatico leyenda={d.leyenda}
          filas={tipos.map((t) => ({ nombre: t.tipo, planificado: t.total.planificado, computable: t.total.computable, avance: t.total.avance }))} />
      ))}
    </div>
  );
}

/** "Descargar informe" on the dashboard: a form, then the AI writes and the Word downloads. */
export default function InformeDialog({ d, tipoInstitucion }: { d: Pg2030Dashboard; tipoInstitucion?: Pg2030InstitucionTipo }) {
  const corte = d.corte!;
  const anio = d.anio!.anio;
  const [abierto, setAbierto] = useState(false);
  const [fase, setFase] = useState<Fase>({ tipo: "formulario" });
  const [tipo, setTipo] = useState<Pg2030InstitucionTipo | "">(tipoInstitucion ?? "");
  const [campos, setCampos] = useState<Campos>({
    numeroInforme: "", fecha: hoy(), oficiosMetas: "", oficioAvances: "", fechaLimite: "", enlaceAnexo: "", observaciones: "",
  });
  const [datosGraficos, setDatosGraficos] = useState<Pg2030Dashboard | null>(null);
  const nodos = useRef<Partial<Record<ClaveGrafico, HTMLDivElement | null>>>({});
  const vivo = useRef(true);

  useEffect(() => () => { vivo.current = false; }, []);

  const motivoDeshabilitado = !corte.habilitado
    ? "Este corte no está habilitado"
    : corte.hasta === 0 ? "Todavía no termina ningún mes de este corte" : null;

  function abrir() {
    const plazo = d.anio!.cortes.find((c) => c.trimestre === corte.trimestre)?.plazoBase ?? "";
    setCampos((c) => ({ ...c, ...recordados(), fecha: hoy(), fechaLimite: plazo, observaciones: "" }));
    setTipo(tipoInstitucion ?? "");
    setFase({ tipo: "formulario" });
    setAbierto(true);
  }

  const set = (k: keyof Campos, v: string) => setCampos((c) => ({ ...c, [k]: v }));
  const ocupado = fase.tipo === "capturando" || fase.tipo === "redactando";

  async function capturar(): Promise<Partial<Record<ClaveGrafico, string>>> {
    const query = new URLSearchParams({ anio: String(anio), trimestre: String(corte.trimestre) });
    if (tipo) query.set("tipoInstitucion", tipo);
    const datos = await api.get<Pg2030Dashboard>(`/pg2030/dashboard?${query}`);
    nodos.current = {};
    setDatosGraficos(datos);
    // Let ResponsiveContainer measure and draw (no animation), then capture.
    await esperar(900);
    const imagenes: Partial<Record<ClaveGrafico, string>> = {};
    for (const [clave, nodo] of Object.entries(nodos.current) as Array<[ClaveGrafico, HTMLDivElement | null]>) {
      if (nodo) imagenes[clave] = await toPng(nodo, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
    }
    setDatosGraficos(null);
    return imagenes;
  }

  async function descargar(id: string, nombre: string) {
    const res = await checkedApiFetch(`/pg2030/informe/${id}/archivo`, {}, "No se pudo descargar el informe");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function generar(e: React.FormEvent) {
    e.preventDefault();
    recordar(campos);
    try {
      setFase({ tipo: "capturando" });
      const graficos = await capturar();
      const { id } = await api.post<{ id: string }>("/pg2030/informe", {
        anio,
        trimestre: corte.trimestre,
        tipoInstitucion: tipo || undefined,
        campos,
        graficos,
      });
      setFase({ tipo: "redactando", trabajo: null });
      for (;;) {
        await esperar(3000);
        if (!vivo.current) return;
        const t = await api.get<EstadoTrabajo>(`/pg2030/informe/${id}`);
        if (t.estado === "error") throw new Error(t.error ?? "No se pudo generar el informe");
        if (t.estado === "listo") {
          await descargar(id, t.nombreArchivo);
          setFase({ tipo: "listo", avisos: t.avisos });
          toast.success("Informe descargado");
          return;
        }
        setFase({ tipo: "redactando", trabajo: t });
      }
    } catch (error) {
      setDatosGraficos(null);
      setFase({ tipo: "formulario" });
      toast.error(apiErrorMessage(error, "No se pudo generar el informe"));
    }
  }

  const progreso = fase.tipo === "redactando" && fase.trabajo && fase.trabajo.pasos > 0
    ? Math.round((fase.trabajo.paso / fase.trabajo.pasos) * 100)
    : null;

  return (
    <>
      <Button type="button" variant="outline" onClick={abrir} disabled={!!motivoDeshabilitado} title={motivoDeshabilitado ?? "Descargar el informe Word del corte"}
        className="lg:ml-auto">
        <FileText className="mr-2 h-4 w-4" /> Descargar informe
      </Button>

      {datosGraficos && <GraficosInforme d={datosGraficos} nodos={nodos} />}

      <Dialog open={abierto} onOpenChange={(open) => { if (!open && !ocupado) setAbierto(false); }}>
        <DialogContent className="w-[calc(100%-1rem)] max-h-[92vh] gap-0 overflow-hidden p-5 sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:p-6"
          showCloseButton={!ocupado}>
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>Informe Word · Corte T{corte.trimestre} {anio}</DialogTitle>
            <p className="text-xs text-slate-500">
              Acumulado de enero a {MESES_LARGOS[(corte.hasta || 3 * corte.trimestre) - 1]}. Las cifras, tablas y gráficos son los del panel; la IA redacta el análisis.
            </p>
          </DialogHeader>

          {fase.tipo === "formulario" && (
            <form onSubmit={generar} className="mt-4 min-h-0 max-h-[calc(92vh-8rem)] space-y-4 overflow-y-auto pr-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="inf-numero">Nro. de informe</Label>
                  <Input id="inf-numero" placeholder={`CGREG-DGTAR-${anio}-001`} value={campos.numeroInforme} onChange={(e) => set("numeroInforme", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="inf-fecha">Fecha del informe</Label>
                  <Input id="inf-fecha" type="date" required value={campos.fecha} onChange={(e) => set("fecha", e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="inf-tipo">Instituciones</Label>
                <select id="inf-tipo" className={fieldClass} value={tipo} onChange={(e) => setTipo(e.target.value as Pg2030InstitucionTipo | "")}>
                  <option value="">Todos los tipos</option>
                  {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="inf-oficios-metas">Oficios del requerimiento de metas del año</Label>
                <textarea id="inf-oficios-metas" className={`${fieldClass} min-h-16`} value={campos.oficiosMetas}
                  placeholder={`Oficio Nro. CGREG-P-${anio - 1}-0000-OF, del 1 de noviembre de ${anio - 1}, y Oficio Nro. …`}
                  onChange={(e) => set("oficiosMetas", e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                <div className="space-y-1">
                  <Label htmlFor="inf-oficio-avances">Oficio del requerimiento de avances del trimestre</Label>
                  <Input id="inf-oficio-avances" value={campos.oficioAvances} placeholder={`Oficio Nro. CGREG-P-${anio}-0000-OF, del 1 de marzo de ${anio}`}
                    onChange={(e) => set("oficioAvances", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="inf-limite">Fecha límite de remisión</Label>
                  <Input id="inf-limite" type="date" value={campos.fechaLimite} onChange={(e) => set("fechaLimite", e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="inf-enlace">Enlace de la matriz consolidada (anexo)</Label>
                <Input id="inf-enlace" type="url" placeholder="https://drive.gobiernogalapagos.gob.ec/…" value={campos.enlaceAnexo}
                  onChange={(e) => set("enlaceAnexo", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inf-observaciones">Observaciones (opcional)</Label>
                <textarea id="inf-observaciones" className={`${fieldClass} min-h-24`} value={campos.observaciones} maxLength={4000}
                  placeholder="Ej.: una institución remitió la matriz sin la programación mensual de sus metas, lo que impidió evaluar su cumplimiento."
                  onChange={(e) => set("observaciones", e.target.value)} />
                <p className="text-xs text-slate-500">
                  Va en el apartado de metas del año. La IA la pasa a estilo formal sin cambiar cifras ni siglas; no cambia las cifras del panel.
                </p>
              </div>
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                La IA local redacta el análisis en unos 5 minutos. Puedes seguir trabajando en otra pestaña; no cierres esta.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
                <Button type="submit">Generar informe</Button>
              </div>
            </form>
          )}

          {(fase.tipo === "capturando" || fase.tipo === "redactando") && (
            <div className="mt-6 space-y-3" aria-live="polite">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <Loader2 className="h-4 w-4 animate-spin text-teal-700" />
                {fase.tipo === "capturando"
                  ? "Preparando los gráficos del panel…"
                  : !fase.trabajo || fase.trabajo.estado === "en_cola"
                    ? fase.trabajo?.enCola ? `En espera: hay ${fase.trabajo.enCola} informe(s) antes que este…` : "Iniciando…"
                    : fase.trabajo.paso >= fase.trabajo.pasos
                      ? "Armando el documento…"
                      : `Redactando con IA: ${fase.trabajo.detalle} (${fase.trabajo.paso + 1} de ${fase.trabajo.pasos})…`}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${progreso ?? 3}%` }} />
              </div>
              <p className="text-xs text-slate-500">Cada apartado tarda alrededor de un minuto en la IA local.</p>
            </div>
          )}

          {fase.tipo === "listo" && (
            <div className="mt-6 space-y-3">
              <p className="text-sm text-slate-700">El informe se descargó. Ábrelo en Word y acepta actualizar los campos para que el índice tome los números de página.</p>
              {fase.avisos.map((a) => (
                <p key={a} className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}
                </p>
              ))}
              <div className="flex justify-end">
                <Button type="button" onClick={() => setAbierto(false)}>Cerrar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
