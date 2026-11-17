// Formatting in Galápagos time (UTC−6), shared by every SIMAT view.

const TZ = "Pacific/Galapagos";

const fmtFechaHora = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
const fmtHoraCorta = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtFechaSola = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, dateStyle: "medium" });
export const fmtReloj = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const fmtNumero = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 });

export function fechaHora(iso?: string | null): string {
  return iso ? fmtFechaHora.format(new Date(iso)) : "—";
}

export function horaCorta(iso?: string | null): string {
  return iso ? fmtHoraCorta.format(new Date(iso)) : "—";
}

export function soloFecha(iso?: string | null): string {
  return iso ? fmtFechaSola.format(new Date(iso)) : "—";
}

export function numero(valor?: number | null): string {
  return valor == null || !Number.isFinite(valor) ? "—" : fmtNumero.format(valor);
}

/** A tide/prediction time stored as a published local wall clock (no zone). */
export function horaPublicada(valor: string): string {
  // "2026-11-16 06:45" → "16/11 06:45"
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(valor);
  return m ? `${m[3]}/${m[2]} ${m[4]}` : valor;
}

export function hace(iso?: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function duracion(min: number): string {
  return min < 60 ? `${min} min` : `${min / 60} h`;
}

const fmtMedida = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 8 });

/** Una medición tal como se registró (sin redondear a 2 decimales). */
export function medida(valor?: number | null): string {
  return valor == null || !Number.isFinite(valor) ? "—" : fmtMedida.format(valor);
}

/** La fecha (AAAA-MM-DD) de una marca de tiempo, para series diarias. */
export function fechaDia(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}
