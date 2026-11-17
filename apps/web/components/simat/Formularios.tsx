"use client";

// Formularios modales de la vista previa (risk-ui.js: riskCriteriaForm,
// observedForm) sobre PUT /simat/criterios y POST /simat/nivel-observado.

import type { SimatCriterio, SimatEstacion } from "@pma/types";
import { guardarCriterio, registrarNivelObservado } from "@/lib/simat/api";
import { Modal } from "./piezas";

const VENTANAS = [5, 15, 30, 60, 180, 360, 720];

/** Ventanas de intensidad compatibles con la resolución de la estación. */
export function ventanasCompatibles(estacion: SimatEstacion | undefined) {
  return estacion ? VENTANAS.filter((w) => w % estacion.pasoMin === 0) : [];
}

const texto = (d: FormData, k: string) => String(d.get(k) ?? "").trim();
const numeroCampo = (d: FormData, k: string) => Number(texto(d, k));

export function CriterioModal({
  estacion,
  puerto,
  criterio,
  onGuardado,
  onCerrar,
}: {
  estacion: SimatEstacion;
  puerto: string;
  /** null crea un sector nuevo para la estación y el puerto. */
  criterio: SimatCriterio | null;
  onGuardado: (puerto: string, sector: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const ventanas = ventanasCompatibles(estacion);
  return (
    <Modal
      titulo={criterio ? "Editar criterio local" : "Configurar criterio local"}
      onCerrar={onCerrar}
      onEnviar={async (d) => {
        const sector = texto(d, "sector");
        const p = texto(d, "puerto");
        await guardarCriterio({
          estacion: estacion.id,
          puerto: p,
          datum: texto(d, "datum"),
          sector,
          respaldo: texto(d, "respaldo"),
          ventanaMin: numeroCampo(d, "ventana_min"),
          vigenciaMin: numeroCampo(d, "vigencia_min"),
          desfaseMin: numeroCampo(d, "desfase_min"),
          lluviaMmH: numeroCampo(d, "lluvia_mm_h"),
          marM: numeroCampo(d, "mar_m"),
          activo: d.get("activo") === "on",
        });
        await onGuardado(p, sector);
      }}
    >
      <p className="meta">Usa umbrales sustentados para este sector y su drenaje costero. Los valores iguales o superiores al umbral se clasifican como altos.</p>
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
          Ventana de intensidad (min)
          <select name="ventana_min" defaultValue={String(criterio?.ventanaMin ?? (ventanas.includes(60) ? 60 : ventanas[0]))}>
            {ventanas.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label>
          Referencia vertical de la medición
          <input name="datum" required maxLength={80} defaultValue={criterio?.datum ?? ""} />
        </label>
        <label>
          Umbral de lluvia alta (mm/h)
          <input name="lluvia_mm_h" type="number" min={0} step="any" required defaultValue={criterio?.lluviaMmH ?? ""} />
        </label>
        <label>
          Umbral de mar alto (m)
          <input name="mar_m" type="number" step="any" required defaultValue={criterio?.marM ?? ""} />
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
        <input name="activo" type="checkbox" defaultChecked={criterio ? criterio.activo : true} /> Habilitar evaluación automática
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
