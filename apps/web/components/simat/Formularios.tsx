"use client";

// Formularios modales de la vista previa (risk-ui.js: riskCriteriaForm,
// observedForm) sobre PUT /simat/criterios y POST /simat/nivel-observado.

import { useState } from "react";
import type { SimatCriterio, SimatEstacion, SimatEstadoValidacion } from "@pma/types";
import { guardarCriterio, registrarNivelObservado } from "@/lib/simat/api";
import { Modal } from "./piezas";

const VENTANAS = [5, 15, 30, 60, 180, 360, 720];

/** Ventanas de intensidad compatibles con la resolución de las estaciones dadas (todas sin estación). */
export function ventanasCompatibles(...estaciones: Array<SimatEstacion | undefined | null>) {
  return VENTANAS.filter((w) => estaciones.every((e) => !e || w % e.pasoMin === 0));
}

/** Estaciones que pueden dar la lluvia de un criterio: con precipitación y sub-diarias. */
export function estacionesDeLluvia(estaciones: SimatEstacion[], isla: string | undefined) {
  return estaciones.filter((e) => e.isla === isla && e.pasoMin < 1440 && e.variables.includes("precipitacion"));
}

const texto = (d: FormData, k: string) => String(d.get(k) ?? "").trim();
const numeroCampo = (d: FormData, k: string) => Number(texto(d, k));

export function CriterioModal({
  estaciones,
  estacionInicial,
  puerto,
  criterio,
  onGuardado,
  onCerrar,
}: {
  /** Estaciones de lluvia de la isla del puerto. */
  estaciones: SimatEstacion[];
  /** Estación propuesta para un sector nuevo. */
  estacionInicial: string | null;
  puerto: string;
  /** null crea un sector nuevo para el puerto. */
  criterio: SimatCriterio | null;
  onGuardado: (puerto: string, sector: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const [estacionId, setEstacionId] = useState<string>(criterio ? (criterio.estacion ?? "") : (estacionInicial ?? ""));
  const [respaldoId, setRespaldoId] = useState<string>(criterio?.estacionRespaldo ?? "");
  const estacion = estaciones.find((e) => e.id === estacionId) ?? null;
  // El respaldo exige una estación principal distinta.
  const respaldo = (estacionId && respaldoId !== estacionId && estaciones.find((e) => e.id === respaldoId)) || null;
  const ventanas = ventanasCompatibles(estacion, respaldo);
  const ventanaInicial = criterio && ventanas.includes(criterio.ventanaMin) ? criterio.ventanaMin : ventanas.includes(60) ? 60 : ventanas[0];
  return (
    <Modal
      titulo={criterio ? "Editar criterio local" : "Configurar criterio local"}
      onCerrar={onCerrar}
      onEnviar={async (d) => {
        const sector = texto(d, "sector");
        const p = texto(d, "puerto");
        const mar = texto(d, "mar_m");
        await guardarCriterio({
          id: criterio?.id,
          estacion: estacionId || null,
          estacionRespaldo: respaldo?.id ?? null,
          puerto: p,
          datum: texto(d, "datum"),
          sector,
          respaldo: texto(d, "respaldo"),
          ventanaMin: numeroCampo(d, "ventana_min"),
          vigenciaMin: numeroCampo(d, "vigencia_min"),
          desfaseMin: numeroCampo(d, "desfase_min"),
          lluvia: {
            vigilancia: numeroCampo(d, "lluvia_vigilancia"),
            preparacion: numeroCampo(d, "lluvia_preparacion"),
            respuesta: numeroCampo(d, "lluvia_respuesta"),
          },
          marM: mar === "" ? null : Number(mar),
          estadoValidacion: texto(d, "estado_validacion") as SimatEstadoValidacion,
          alertasPublicas: d.get("alertas_publicas") === "on",
          activo: d.get("activo") === "on",
        });
        await onGuardado(p, sector);
      }}
    >
      <p className="meta">
        Cada umbral de lluvia (mm/h en la ventana) da su nivel: desde vigilancia es Vigilancia, desde preparación es Preparación y desde respuesta es Respuesta. Si el sector desagua al mar, el mar alto sube un nivel; deja el
        umbral de mar vacío si no influye. Si la estación principal no tiene un dato válido y vigente, el nivel se calcula con la de respaldo.
      </p>
      <div className="field-grid">
        <label>
          Sector costero
          <input name="sector" required maxLength={120} readOnly={!!criterio} defaultValue={criterio?.sector ?? ""} />
        </label>
        <label>
          Puerto de referencia
          <input name="puerto" required maxLength={100} readOnly defaultValue={criterio?.puerto ?? puerto} />
        </label>
        <label>
          Estación de lluvia
          <select value={estacionId} onChange={(e) => setEstacionId(e.target.value)}>
            <option value="">Sin estación (no se evalúa)</option>
            {estaciones.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} · cada {e.pasoMin < 60 ? `${e.pasoMin} min` : `${e.pasoMin / 60} h`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estación de respaldo · opcional
          <select value={respaldo?.id ?? ""} disabled={!estacionId} onChange={(e) => setRespaldoId(e.target.value)}>
            <option value="">Sin respaldo</option>
            {estaciones
              .filter((e) => e.id !== estacionId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre} · cada {e.pasoMin < 60 ? `${e.pasoMin} min` : `${e.pasoMin / 60} h`}
                </option>
              ))}
          </select>
        </label>
        <label>
          Ventana de intensidad (min)
          <select key={`${estacionId}|${respaldo?.id ?? ""}`} name="ventana_min" defaultValue={String(ventanaInicial)}>
            {ventanas.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label>
          Umbral de vigilancia (mm/h)
          <input name="lluvia_vigilancia" type="number" min={0} step="any" required defaultValue={criterio?.lluvia.vigilancia ?? ""} />
        </label>
        <label>
          Umbral de preparación (mm/h)
          <input name="lluvia_preparacion" type="number" min={0} step="any" required defaultValue={criterio?.lluvia.preparacion ?? ""} />
        </label>
        <label>
          Umbral de respuesta (mm/h)
          <input name="lluvia_respuesta" type="number" min={0} step="any" required defaultValue={criterio?.lluvia.respuesta ?? ""} />
        </label>
        <label>
          Umbral de mar alto (m) · opcional
          <input name="mar_m" type="number" step="any" placeholder="Sin umbral" defaultValue={criterio?.marM ?? ""} />
        </label>
        <label>
          Referencia vertical de la medición
          <input name="datum" required maxLength={80} defaultValue={criterio?.datum ?? "MLWS"} />
        </label>
        <label>
          Estado de validación
          <select name="estado_validacion" defaultValue={criterio?.estadoValidacion ?? "experimental"}>
            <option value="experimental">Experimental</option>
            <option value="validado">Validado</option>
          </select>
        </label>
        <label>
          Vigencia máxima (min)
          <input name="vigencia_min" type="number" min={1} max={1440} required defaultValue={criterio?.vigenciaMin ?? ""} />
        </label>
        <label>
          Desfase máximo entre lluvia y mar (min)
          <input name="desfase_min" type="number" min={0} max={1440} required defaultValue={criterio?.desfaseMin ?? ""} />
        </label>
      </div>
      <label>
        Fuente de los umbrales y evidencia del vínculo con el drenaje
        <textarea name="respaldo" rows={3} required maxLength={500} defaultValue={criterio?.respaldo ?? ""} />
      </label>
      <label className="inline">
        <input name="alertas_publicas" type="checkbox" defaultChecked={criterio ? criterio.alertasPublicas : false} /> Alertas públicas habilitadas
      </label>
      <label className="inline">
        <input name="activo" type="checkbox" defaultChecked={criterio ? criterio.activo : false} /> Habilitar el nivel oficial (sin marcar, el nivel es orientativo)
      </label>
    </Modal>
  );
}

export function NivelObservadoModal({ puerto, datum, onGuardado, onCerrar }: { puerto: string; datum: string; onGuardado: (puerto: string) => Promise<void>; onCerrar: () => void }) {
  return (
    <Modal
      titulo="Registrar nivel del mar observado"
      onCerrar={onCerrar}
      onEnviar={async (d) => {
        const p = texto(d, "puerto");
        await registrarNivelObservado({
          puerto: p,
          // La hora se escribe en Galápagos (UTC−6).
          instante: `${texto(d, "fecha")}:00-06:00`,
          valor: numeroCampo(d, "valor"),
          unidad: "m",
          referencia: texto(d, "referencia"),
          calidad: texto(d, "calidad"),
          fuente: texto(d, "fuente"),
        });
        await onGuardado(p);
      }}
    >
      <p className="meta">Ingresa una medición trazable con hora local de Galápagos (UTC−6) y su referencia vertical.</p>
      <div className="field-grid">
        <label>
          Puerto
          <input name="puerto" required maxLength={100} readOnly defaultValue={puerto} />
        </label>
        <label>
          Fecha y hora en Galápagos
          <input name="fecha" type="datetime-local" required />
        </label>
        <label>
          Nivel observado (m)
          <input name="valor" type="number" step="any" required />
        </label>
        <label>
          Referencia vertical
          <input name="referencia" required maxLength={80} defaultValue={datum} />
        </label>
        <label>
          Calidad
          <select name="calidad" defaultValue="Pendiente de validación">
            {["Pendiente de validación", "Válido", "Sospechoso", "Inválido"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Fuente o identificación del mareógrafo
          <input name="fuente" required maxLength={120} />
        </label>
      </div>
    </Modal>
  );
}
