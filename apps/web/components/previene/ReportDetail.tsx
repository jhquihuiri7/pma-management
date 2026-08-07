"use client";

import { useEffect, useState } from "react";
import {
  formatDuration,
  formatLong,
  formatSize,
  islandOf,
  isIncident,
  kindLabel,
  mediaUrl,
  typeLabel,
  visualFor,
  type PrevieneMedia,
  type PrevieneReport,
} from "@/lib/previene";

interface Props {
  report: PrevieneReport;
  onClose: () => void;
}

/**
 * Detail panel + evidence lightbox.
 *
 * Media is requested through the API proxy, so an <img>/<video> tag works with
 * the session cookie and never needs the upstream bearer key. Files Telegram
 * has stopped keeping answer 404: that is a normal outcome here, rendered as a
 * dashed placeholder rather than a broken image.
 */
export default function ReportDetail({ report, onClose }: Props) {
  const [lightbox, setLightbox] = useState<PrevieneMedia | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  // The panel is dismissible with Escape; so is the lightbox on top of it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, onClose]);

  // A new selection must not inherit the previous report's failures.
  useEffect(() => {
    setFailed(new Set());
    setLightbox(null);
  }, [report.id]);

  const visual = visualFor(report);
  const incident = isIncident(report);
  const markGone = (id: string) => setFailed((prev) => new Set(prev).add(id));

  return (
    <>
      <aside className="previene-panel absolute inset-y-0 right-0 z-[700] flex w-[412px] max-w-full flex-col border-l border-slate-200 bg-white shadow-2xl">
        <header className="flex flex-none items-start gap-3 border-b border-slate-200 px-[18px] py-4">
          <span
            className="flex h-[34px] w-[34px] flex-none items-center justify-center"
            style={{
              background: visual.color,
              width: 34,
              height: 34,
              borderRadius: incident ? 8 : "50%",
              transform: incident ? "rotate(45deg)" : undefined,
            }}
            aria-hidden
          >
            <span
              style={{ transform: incident ? "rotate(-45deg)" : undefined }}
              dangerouslySetInnerHTML={{
                __html: `<svg width="15" height="15" viewBox="0 0 12 12">${visual.glyph}</svg>`,
              }}
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{typeLabel(report)}</h2>
            <p className="mt-0.5 text-[11.5px] text-slate-400">
              {kindLabel(report)}
              {report.latitude != null && report.longitude != null
                ? ` · ${islandOf(report.latitude, report.longitude)}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-4">
          <div className="mb-4 flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">Enviado</span>
            <span className="font-mono text-[12.5px] text-slate-800">{formatLong(report.submittedAt)}</span>
            <span className="text-[11px] text-slate-400">Hora local de Galápagos (UTC-6)</span>
          </div>

          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            <p className="text-[13px] leading-relaxed text-slate-800">{report.description || "Sin descripción."}</p>
          </div>

          <div className="mb-[18px] grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-slate-200 px-3 py-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">
                Coordenadas
              </div>
              <div className="font-mono text-[11.5px] text-slate-800">
                {report.latitude != null && report.longitude != null
                  ? `${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}`
                  : "no informadas"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 px-3 py-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">
                Precisión
              </div>
              <div className="font-mono text-[11.5px] text-slate-800">
                {report.locationAccuracy ? `± ${report.locationAccuracy} m` : "no informada"}
              </div>
            </div>
          </div>

          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-slate-400">Evidencias</span>
            {report.media.length > 0 && (
              <span className="font-mono text-[10.5px] text-slate-400">
                {report.media.length} {report.media.length === 1 ? "archivo" : "archivos"}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            {report.media.map((media) => {
              const gone = media.availability === "gone" || failed.has(media.id);
              const isVideo = media.mediaType === "VIDEO";
              return (
                <div
                  key={media.id}
                  className={`overflow-hidden rounded-xl border bg-slate-50 ${
                    gone ? "border-dashed border-red-400" : "border-slate-200"
                  }`}
                >
                  <button
                    type="button"
                    disabled={gone}
                    onClick={() => !gone && setLightbox(media)}
                    className={`flex h-[132px] w-full flex-col items-center justify-center gap-2 ${
                      gone ? "cursor-default" : "cursor-zoom-in"
                    }`}
                  >
                    {gone ? (
                      <>
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 text-[15px] text-red-600">
                          !
                        </span>
                        <span className="text-[11px] text-red-600">Evidencia no disponible (404)</span>
                      </>
                    ) : isVideo ? (
                      <>
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[15px] text-slate-600 shadow-sm">
                          ▶
                        </span>
                        <span className="text-[11px] text-slate-400">
                          Video{media.durationSeconds ? ` · ${formatDuration(media.durationSeconds)}` : ""}
                        </span>
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(media.id)}
                        alt={media.caption ?? "Evidencia fotográfica del reporte"}
                        className="h-full w-full object-cover"
                        onError={() => markGone(media.id)}
                      />
                    )}
                  </button>
                  <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-500">
                      {media.caption ?? (isVideo ? "Video sin título" : "Foto sin título")}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {media.width && media.height ? `${media.width}×${media.height}` : ""}
                      {media.fileSize ? ` · ${formatSize(media.fileSize)}` : ""}
                    </span>
                  </div>
                </div>
              );
            })}

            {report.media.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-[11.5px] text-slate-400">
                Este reporte se envió sin foto ni video.
              </div>
            )}
          </div>

          <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2.5 text-[10.5px] leading-relaxed text-slate-600">
            Las evidencias se sirven por el proxy del SIGTAR (<span className="font-mono">/previene/media/&#123;id&#125;</span>):
            la clave de la API nunca llega al navegador.
          </p>
        </div>
      </aside>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.caption ?? "Evidencia"}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-[900] flex items-center justify-center bg-black/80 p-8"
        >
          <div
            className="max-h-full w-full max-w-3xl overflow-hidden rounded-xl border border-white/10 bg-neutral-900"
            onClick={(event) => event.stopPropagation()}
          >
            {lightbox.mediaType === "VIDEO" ? (
              // Range requests are proxied, so the browser can seek instead of
              // having to download the whole file first.
              <video
                src={mediaUrl(lightbox.id)}
                controls
                autoPlay
                className="max-h-[70vh] w-full bg-black"
                onError={() => {
                  markGone(lightbox.id);
                  setLightbox(null);
                }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(lightbox.id)}
                alt={lightbox.caption ?? "Evidencia fotográfica"}
                className="max-h-[70vh] w-full bg-black object-contain"
                onError={() => {
                  markGone(lightbox.id);
                  setLightbox(null);
                }}
              />
            )}
            <div className="flex items-center gap-3 border-t border-white/10 px-4 py-3">
              <span className="flex-1 text-[12.5px] text-white/85">{lightbox.caption ?? "Evidencia"}</span>
              <span className="font-mono text-[11px] text-white/40">
                {lightbox.width && lightbox.height ? `${lightbox.width} × ${lightbox.height} px` : ""}
                {lightbox.fileSize ? ` · ${formatSize(lightbox.fileSize)}` : ""}
              </span>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-[11.5px] text-white hover:bg-white/20"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
