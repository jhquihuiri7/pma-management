import type { CoeActividad } from "@pma/types";
import { getDb } from "../../db/client.js";
import { coeDestinatarios } from "../../db/schema/coeReporte.js";
import { env } from "../../lib/env.js";
import { enqueueMail } from "../shared/mailOutbox.js";
import { ESTADOS, nombreEquipo } from "./catalogos.js";
import { ZONA_HORARIA } from "./modelo.js";

// One email per activity programmed or result recorded, to every address in
// coe_destinatarios (decision of 2026-11-26, as in the original app). The
// message is queued in the same transaction as the activity, so a saved
// activity always has its notice; the worker delivers and retries it.

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type TipoAviso = "programacion" | "resultado";

const VIGENCIA_MS = 3 * 24 * 60 * 60 * 1000;
const fechaHora = new Intl.DateTimeFormat("es-EC", { timeZone: ZONA_HORARIA, dateStyle: "medium", timeStyle: "short" });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const metricas = (items: CoeActividad["metas"]) =>
  items.map((m) => `${m.indicador} · ${m.cantidad} ${m.unidad}`).join("; ");

/** Subject, plain text and HTML of one notice. Pure, so it can be tested. */
export function mensajeAviso(actividad: CoeActividad, tipo: TipoAviso, tituloEvento: string, enlace: string) {
  const programacion = tipo === "programacion";
  const nombre = tituloEvento.replace(/\s+/g, " ").trim() || actividad.evento;
  const registrado = programacion || actividad.estado === "extra" ? actividad.creadoEn : actividad.completadoEn;
  const filas: Array<[string, string]> = [
    ["Evento", `${nombre} (${actividad.evento})`],
    ["Fecha de la actividad", actividad.dia],
    ...(registrado ? [["Registrado en Galápagos", fechaHora.format(new Date(registrado))] as [string, string]] : []),
    ["Institución", actividad.institucion],
    ["Isla y sector", `${actividad.isla} · ${actividad.sector}`],
    ["Coordinación", nombreEquipo(actividad.instancia, actividad.equipo)],
    ["Actividad", actividad.descripcion],
  ];
  if (actividad.metas.length) filas.push(["Metas", metricas(actividad.metas)]);
  if (!programacion) {
    filas.push(["Estado", ESTADOS[actividad.estado]], ["Resultado", actividad.resultado]);
    if (actividad.motivo) filas.push(["Motivo", actividad.motivo]);
    if (actividad.numeros.length) filas.push(["Indicadores", metricas(actividad.numeros)]);
  }
  const corte = programacion ? "Programación · Corte 08h00" : "Resultado · Corte 19h00";
  const subject = `[COE Galápagos] ${programacion ? "Programación" : "Resultado"} · ${nombre}`;
  const text = [
    "COE Provincial de Galápagos",
    corte,
    "",
    ...filas.map(([k, v]) => `${k}: ${v}`),
    "",
    `Tablero de administración: ${enlace}`,
  ].join("\n");
  const celdas = filas
    .map(([k, v]) => `<tr><th style="text-align:left;vertical-align:top;padding:6px 12px 6px 0;color:#21566c;white-space:nowrap;font-size:13px;">${escapeHtml(k)}</th><td style="padding:6px 0;font-size:14px;color:#1f2d33;white-space:pre-wrap;">${escapeHtml(v)}</td></tr>`)
    .join("");
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#eef3f5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#173f4d;color:#ffffff;padding:20px 24px;">
<p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a8dbe0;">COE Provincial de Galápagos</p>
<h1 style="margin:6px 0 0 0;font-size:20px;">${escapeHtml(corte)}</h1></td></tr>
<tr><td style="padding:20px 24px;"><table role="presentation" style="border-collapse:collapse;">${celdas}</table>
<p style="margin:20px 0 0 0;"><a href="${escapeHtml(enlace)}" style="display:inline-block;background:#08766a;color:#ffffff;text-decoration:none;border-radius:8px;padding:10px 16px;font-weight:bold;font-size:14px;">Abrir el tablero</a></p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Queue the notice for every recipient. No recipients, no email. */
export async function encolarAviso(tx: DbTransaction, actividad: CoeActividad, tipo: TipoAviso, tituloEvento: string) {
  const destinatarios = await tx.select({ email: coeDestinatarios.email }).from(coeDestinatarios);
  if (destinatarios.length === 0) return 0;
  const contenido = mensajeAviso(actividad, tipo, tituloEvento, `${env.FRONTEND_ORIGIN}/coe-reporte/tablero`);
  const ids = await enqueueMail(
    tx,
    { to: destinatarios.map((d) => d.email), ...contenido },
    new Date(Date.now() + VIGENCIA_MS),
  );
  return ids.length;
}

/** Whether an SMTP server is configured; without one, mail is only logged. */
export function correoConfigurado(): boolean {
  return Boolean(env.SMTP_HOST);
}
