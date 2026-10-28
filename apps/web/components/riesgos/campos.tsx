"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { soloDigitos } from "@/lib/riesgos";
import type { RiesgosInstitucionCatalogo, RiesgosInstitucionTipo } from "@/types";

export const selectClass =
  "flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

export const textareaClass =
  "flex min-h-20 w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Label, control and the message the client or the server attached to it. */
export function Campo({
  id,
  etiqueta,
  error,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  error?: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
      {ayuda && !error && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function CampoTexto({
  id,
  etiqueta,
  valor,
  onChange,
  error,
  tipo = "text",
  placeholder,
  ayuda,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  error?: string;
  tipo?: "text" | "email" | "tel";
  placeholder?: string;
  ayuda?: string;
}) {
  return (
    <Campo id={id} etiqueta={etiqueta} error={error} ayuda={ayuda}>
      <Input
        id={id}
        type={tipo}
        inputMode={tipo === "tel" ? "numeric" : undefined}
        value={valor}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(tipo === "tel" ? soloDigitos(e.target.value) : e.target.value)}
      />
    </Campo>
  );
}

export function CampoSelect({
  id,
  etiqueta,
  valor,
  opciones,
  onChange,
  error,
  vacio,
  ayuda,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  opciones: readonly string[];
  onChange: (valor: string) => void;
  error?: string;
  /** Placeholder option; omitted when the field always has a value. */
  vacio?: string;
  ayuda?: string;
}) {
  return (
    <Campo id={id} etiqueta={etiqueta} error={error} ayuda={ayuda}>
      <select
        id={id}
        className={selectClass}
        value={valor}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      >
        {vacio && <option value="" disabled>{vacio}</option>}
        {opciones.map((opcion) => (
          <option key={opcion} value={opcion}>
            {opcion}
          </option>
        ))}
      </select>
    </Campo>
  );
}

const OTRA_INSTITUCION = "__otra__";

/**
 * The convened institutions by name, plus "Otra" for one outside the list,
 * which then writes its own name. Choosing a listed one also suggests its type
 * (`tipo`); writing a name leaves the type to the person filling the form.
 */
export function CampoInstitucion({
  instituciones,
  valor,
  onChange,
  error,
}: {
  instituciones: RiesgosInstitucionCatalogo[];
  valor: string;
  onChange: (nombre: string, tipo?: RiesgosInstitucionTipo | "") => void;
  error?: string;
}) {
  const [otraElegida, setOtraElegida] = useState(() => valor !== "" && !instituciones.some((i) => i.nombre === valor));

  return (
    <>
      <Campo id="institucionNombre" etiqueta="Institución *" error={otraElegida ? undefined : error}>
        <select
          id="institucionNombre"
          className={selectClass}
          value={otraElegida ? OTRA_INSTITUCION : valor}
          aria-invalid={!otraElegida && !!error}
          onChange={(e) => {
            const elegida = instituciones.find((i) => i.nombre === e.target.value);
            setOtraElegida(!elegida);
            onChange(elegida?.nombre ?? "", elegida?.tipo ?? "");
          }}
        >
          <option value="" disabled>Seleccione la institución</option>
          {instituciones.map((i) => <option key={i.nombre} value={i.nombre}>{i.nombre}</option>)}
          <option value={OTRA_INSTITUCION}>Otra institución (no está en la lista)</option>
        </select>
      </Campo>
      {otraElegida && (
        <CampoTexto id="institucionOtra" etiqueta="Nombre de la institución *" valor={valor}
          onChange={(nombre) => onChange(nombre)} error={error}
          ayuda="Escriba el nombre oficial completo." />
      )}
    </>
  );
}

/** MTT and GT grouped as the COE organizes them, plus "No pertenece". */
export function CampoMesaGrupo({
  id,
  valor,
  onChange,
  error,
  sinMesa,
  mesasTecnicas,
  gruposTrabajo,
}: {
  id: string;
  valor: string;
  onChange: (valor: string) => void;
  error?: string;
  sinMesa: string;
  mesasTecnicas: string[];
  gruposTrabajo: string[];
}) {
  return (
    <Campo id={id} etiqueta="Mesa Técnica de Trabajo o Grupo de Trabajo *" error={error}>
      <select id={id} className={selectClass} value={valor} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>Seleccione una opción</option>
        <option value={sinMesa}>No pertenece a una MTT o GT</option>
        <optgroup label="Mesas Técnicas de Trabajo (MTT)">
          {mesasTecnicas.map((mesa) => <option key={mesa} value={mesa}>{mesa}</option>)}
        </optgroup>
        <optgroup label="Grupos de Trabajo (GT)">
          {gruposTrabajo.map((grupo) => <option key={grupo} value={grupo}>{grupo}</option>)}
        </optgroup>
      </select>
    </Campo>
  );
}

/** The receipt shown after a public form is stored. */
export function Recibo({
  titulo,
  codigo,
  detalle,
  onOtro,
  otroTexto,
}: {
  titulo: string;
  codigo: string;
  detalle: string;
  onOtro: () => void;
  otroTexto: string;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
      <p className="text-xs font-semibold tracking-widest text-emerald-700">REGISTRO RECIBIDO</p>
      <h2 className="mt-2 text-xl font-bold text-slate-900">{titulo}</h2>
      <p className="mt-3 text-sm text-muted-foreground">{detalle}</p>
      <p className="mt-5 text-sm text-slate-600">Código de recepción</p>
      <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-slate-900">{codigo}</p>
      <p className="mt-2 text-xs text-muted-foreground">Conserve este código para cualquier consulta con el equipo coordinador.</p>
      <button type="button" onClick={onOtro} className="mt-6 text-sm font-medium text-teal-700 underline-offset-4 hover:underline">
        {otroTexto}
      </button>
    </div>
  );
}
