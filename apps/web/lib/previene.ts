/**
 * Shared vocabulary for the Galápagos Previene viewer.
 *
 * Two encodings, kept strictly separate because they answer different
 * questions: COLOUR is the event type, SHAPE is the report class. Every marker
 * also carries a glyph — the palette is colour-blind safe overall, but the
 * red/aqua pair sits near the discrimination limit, so colour alone is not a
 * sufficient encoder.
 */

export type ReportKind = "EVENT" | "INCIDENT";

export interface PrevieneMedia {
  id: string;
  mediaType: string; // PHOTO | VIDEO
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  caption: string | null;
  availability: string; // unknown | ok | gone
}

export interface PrevieneReport {
  id: string;
  reportKind: string;
  eventTypeCode: string | null;
  eventTypeName: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  description: string;
  submittedAt: string | null;
  media: PrevieneMedia[];
}

export interface PrevieneEventType {
  code: string;
  name: string;
  count: number;
}

export interface PrevieneStatus {
  configured: boolean;
  lastSuccessAt: string | null;
  ageMinutes: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  degraded: boolean;
  totalReports: number;
  syncIntervalMs: number;
}

/** SVG path drawn white inside the marker, on a 12×12 viewBox. */
export interface TypeVisual {
  color: string;
  glyph: string;
  /** Plain-text stand-in for the detail panel badge. */
  text: string;
}

const RAIN_GLYPH = '<path d="M6 1.4C6 1.4 9.4 5.1 9.4 7.3a3.4 3.4 0 0 1-6.8 0C2.6 5.1 6 1.4 6 1.4Z" fill="#fff"/>';
const TSUNAMI_GLYPH =
  '<path d="M1.4 8.1c1.1 0 1.5-1.1 2.6-1.1s1.5 1.1 2.6 1.1 1.5-1.1 2.6-1.1M1.4 5.1c1.1 0 1.5-1.1 2.6-1.1s1.5 1.1 2.6 1.1 1.5-1.1 2.6-1.1" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round"/>';
const FIRE_GLYPH =
  '<path d="M6 1.1S3 4 3 6.5a3 3 0 0 0 6 0C9 5.3 7.6 3.9 7.6 3.9S7.5 5.3 6.7 5.3C5.7 5.3 6 2.5 6 1.1Z" fill="#fff"/>';
const INCIDENT_GLYPH =
  '<path d="M6 2.8v4.1M6 9v.7" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
/** Reserve glyph: a hollow ring, deliberately unlike any assigned type. */
const UNKNOWN_GLYPH = '<circle cx="6" cy="6" r="2.6" stroke="#fff" stroke-width="1.4" fill="none"/>';

const ASSIGNED: Record<string, TypeVisual> = {
  RAIN: { color: "#2a78d6", glyph: RAIN_GLYPH, text: "🌧" },
  TSUNAMI: { color: "#1baf7a", glyph: TSUNAMI_GLYPH, text: "≈" },
  FIRE: { color: "#e34948", glyph: FIRE_GLYPH, text: "▲" },
};

/** Incidents have no event type — grey diamond, never a fourth colour. */
export const INCIDENT_VISUAL: TypeVisual = { color: "#6b7280", glyph: INCIDENT_GLYPH, text: "!" };

/** Any type the catalog grows that has no assignment yet. */
export const UNASSIGNED_VISUAL: TypeVisual = { color: "#5b6b7c", glyph: UNKNOWN_GLYPH, text: "•" };

export function visualFor(report: Pick<PrevieneReport, "eventTypeCode" | "reportKind">): TypeVisual {
  if (!report.eventTypeCode) return INCIDENT_VISUAL;
  return ASSIGNED[report.eventTypeCode] ?? UNASSIGNED_VISUAL;
}

export function visualForCode(code: string | null): TypeVisual {
  if (!code) return INCIDENT_VISUAL;
  return ASSIGNED[code] ?? UNASSIGNED_VISUAL;
}

export function isIncident(report: Pick<PrevieneReport, "reportKind">): boolean {
  return report.reportKind === "INCIDENT";
}

export function typeLabel(report: PrevieneReport): string {
  if (report.eventTypeName) return report.eventTypeName;
  if (report.eventTypeCode) return report.eventTypeCode;
  return "Incidente";
}

export function kindLabel(report: Pick<PrevieneReport, "reportKind">): string {
  return report.reportKind === "INCIDENT" ? "Incidente" : "Evento";
}

// ── Dates ──────────────────────────────────────────────────────────────────
// Galápagos runs at UTC-6 with no DST. Shifting the instant and reading it
// with UTC getters gives local island time regardless of the browser's zone —
// a report is timestamped where it happened, not where it is being read.

const GALAPAGOS_OFFSET_MS = 6 * 60 * 60 * 1000;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function toGalapagos(iso: string): Date {
  return new Date(new Date(iso).getTime() - GALAPAGOS_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatShort(iso: string | null): string {
  if (!iso) return "—";
  const d = toGalapagos(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatLong(iso: string | null): string {
  if (!iso) return "Fecha no informada";
  const d = toGalapagos(iso);
  if (Number.isNaN(d.getTime())) return "Fecha no informada";
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} h`;
}

export function formatDay(day: string): string {
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  return `${Number(parts[2])} ${MONTHS[Number(parts[1]) - 1]} ${parts[0]}`;
}

export function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}

/**
 * Media travels through the API proxy, never straight to the reports API: the
 * bearer key lives on the server and an <img> tag cannot send it anyway.
 */
export function mediaUrl(mediaId: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api-proxy";
  return `${base}/previene/media/${mediaId}`;
}

// ── Islands ────────────────────────────────────────────────────────────────
// Nearest-centroid lookup, only for labelling the detail panel. Deliberately
// coarse: it names the island a point sits on, it is not a spatial join.
const ISLANDS: Array<[string, number, number]> = [
  ["Santa Cruz", -0.7, -90.35],
  ["San Cristóbal", -0.9, -89.58],
  ["Isabela", -0.75, -91.1],
  ["Floreana", -1.28, -90.44],
  ["Santa Fe", -0.81, -90.05],
  ["Baltra", -0.44, -90.28],
  ["Santiago", -0.24, -90.7],
  ["Genovesa", 0.32, -89.96],
  ["Fernandina", -0.37, -91.55],
  ["Española", -1.37, -89.66],
];

export function islandOf(lat: number, lon: number): string {
  let best = "Archipiélago";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, la, lo] of ISLANDS) {
    const d = (lat - la) ** 2 + ((lon - lo) * 0.6) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = name;
    }
  }
  return best;
}
