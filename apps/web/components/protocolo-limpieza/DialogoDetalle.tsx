"use client";

import Image from "next/image";
import { Fragment, useEffect, useRef } from "react";
import { camposAnteriores, camposDe, conMayuscula, datosAnteriores, forms, type RegistroLimpieza } from "@pma/types/protocolo-limpieza";
import { urlFoto } from "@/lib/protocolo-limpieza/api";
import { displayDate, number } from "@/lib/protocolo-limpieza/tablero";

/**
 * Every value of a report, in the order of its form (dialog #detail of the standalone app),
 * then those of fields the form no longer asks, which older reports keep.
 */
export default function DialogoDetalle({ row, onClose }: { row: RegistroLimpieza | null; onClose(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (row && !dialog.open) dialog.showModal();
    if (!row && dialog.open) dialog.close();
  }, [row]);

  const formulario = row ? forms[row.kind] : null;
  return (
    <dialog id="detail" ref={dialogRef} onClose={onClose}>
      <div className="dialog-head">
        <div>
          <p className="dialog-eyebrow">Registro</p>
          <h2 id="detail-title">{formulario ? `${formulario.route} · ${formulario.name}` : "Detalle del registro"}</h2>
        </div>
        <form method="dialog">
          <button className="button secondary" aria-label="Cerrar">✕</button>
        </form>
      </div>
      <div id="detail-body">
        {row && formulario && (
          <dl>
            {camposDe(row.kind)
              .filter((f) => row.data[f.id] !== undefined)
              .map((f) => {
                const valor = row.data[f.id];
                return (
                  <Fragment key={f.id}>
                    <dt>{f.label}</dt>
                    <dd>
                      {f.type === "photo" ? (
                        <a href={urlFoto(String(valor))} target="_blank" rel="noopener">
                          <Image className="detail-photo" src={urlFoto(String(valor))} alt={f.label} width={320} height={240} style={{ height: "auto" }} unoptimized />
                        </a>
                      ) : f.type === "date" ? displayDate(valor) : String(valor)}
                    </dd>
                  </Fragment>
                );
              })}
            {Object.entries(datosAnteriores(row.kind, row.data)).map(([id, valor]) => (
              <Fragment key={id}>
                <dt>{camposAnteriores[id]}</dt>
                <dd>{String(valor)}</dd>
              </Fragment>
            ))}
            {row.recursos?.length ? (
              <>
                <dt>Recursos disponibles</dt>
                <dd>
                  <ul className="detalle-recursos">
                    {row.recursos.map((r, i) => <li key={i}>{number(r.cantidad)} {conMayuscula(r.recurso)} · {r.institucion}</li>)}
                  </ul>
                </dd>
              </>
            ) : null}
          </dl>
        )}
      </div>
    </dialog>
  );
}
