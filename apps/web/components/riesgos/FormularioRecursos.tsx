"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Plus, Send, Trash2 } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api-client";
import {
  correoValido,
  erroresDeCampos,
  nuevoId,
  telefonoValido,
  useRiesgosCatalogos,
} from "@/lib/riesgos";
import { CAMPOS_CANTIDAD, leerCantidad, reglasCantidades, type CampoCantidad } from "@/lib/riesgosReglas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Campo, CampoInstitucion, CampoMesaGrupo, CampoSelect, CampoTexto, Recibo, textareaClass } from "./campos";
import type {
  RiesgosCatalogos,
  RiesgosContacto,
  RiesgosFichaEntrada,
  RiesgosIsla,
  RiesgosRecibo,
  RiesgosRecursoEntrada,
  RiesgosRecursoTipo,
} from "@/types";

type Errores = Record<string, string>;

type Valores = {
  institucionNombre: string;
  institucionTipo: string;
  mesaGrupo: string;
  isla: RiesgosIsla;
  principal: RiesgosContacto;
  alterno: RiesgosContacto;
  delegadosConfirmados: boolean;
  brechas: string;
  observaciones: string;
};

const PASOS = ["Institución y delegados", "Recursos", "Revisar y enviar"];

const UNIDAD_SUGERIDA: Record<RiesgosRecursoTipo, string> = {
  "Talento humano": "personas",
  "Vehículos": "vehículos",
  "Maquinaria y equipos": "equipos",
  "Infraestructura": "instalaciones",
  "Comunicaciones": "equipos",
  "Logística": "unidades",
};

/** Fields the quantity rules relate; a change to one re-checks them all. */
const CAMPOS_RELACIONADOS = [...CAMPOS_CANTIDAD, "esTitular", "disponibilidad"] as const;

const contactoVacio = (): RiesgosContacto => ({ nombre: "", cargo: "", correo: "", telefono: "" });

const valoresIniciales = (): Valores => ({
  institucionNombre: "",
  institucionTipo: "",
  mesaGrupo: "",
  isla: "San Cristóbal",
  principal: contactoVacio(),
  alterno: contactoVacio(),
  delegadosConfirmados: false,
  brechas: "",
  observaciones: "",
});

const recursoVacio = (): RiesgosRecursoEntrada => ({
  tipo: "Talento humano",
  nombre: "",
  ubicacion: "",
  unidad: UNIDAD_SUGERIDA["Talento humano"],
  cantidadExistente: 0,
  cantidadOperativa: 0,
  cantidadMovilizable: 0,
  esTitular: true,
  disponibilidad: "Inmediata",
  restricciones: "",
  detalles: {},
});

const normalizar = (value: string) => value.trim().toLocaleLowerCase("es").replace(/\s+/g, " ");

/** The same rules the API applies, checked before leaving each step. */
function validarPaso(paso: number, v: Valores, recursos: RiesgosRecursoEntrada[]): Errores {
  const errores: Errores = {};
  if (paso === 0) {
    if (v.institucionNombre.trim().length < 2) errores.institucionNombre = "Seleccione la institución o escriba su nombre.";
    if (!v.institucionTipo) errores.institucionTipo = "Seleccione el tipo de institución.";
    if (!v.mesaGrupo) errores.mesaGrupo = "Seleccione una mesa o grupo.";
    for (const quien of ["principal", "alterno"] as const) {
      const persona = v[quien];
      if (persona.nombre.trim().length < 2) errores[`${quien}.nombre`] = "Ingrese el nombre completo.";
      if (persona.cargo.trim().length < 2) errores[`${quien}.cargo`] = "Ingrese el cargo.";
      if (!correoValido(persona.correo)) errores[`${quien}.correo`] = "Ingrese un correo válido.";
      if (!telefonoValido(persona.telefono)) errores[`${quien}.telefono`] = "Ingrese entre 7 y 15 dígitos, solo números.";
    }
    if (v.principal.correo && normalizar(v.principal.correo) === normalizar(v.alterno.correo)) {
      errores["alterno.correo"] = "Los delegados deben tener correos distintos.";
    }
    if (v.principal.nombre.trim() && normalizar(v.principal.nombre) === normalizar(v.alterno.nombre)) {
      errores["alterno.nombre"] = "El delegado principal y el alterno deben ser personas distintas.";
    }
  }
  if (paso === 1) {
    const vistos = new Set<string>();
    recursos.forEach((r, i) => {
      const campo = (nombre: string) => `recursos.${i}.${nombre}`;
      if (r.nombre.trim().length < 2) errores[campo("nombre")] = "Ingrese el nombre del recurso.";
      if (r.ubicacion.trim().length < 2) errores[campo("ubicacion")] = "Ingrese la ubicación.";
      if (r.unidad.trim().length < 2) errores[campo("unidad")] = "Ingrese la unidad de medida.";
      for (const [nombre, mensaje] of Object.entries(reglasCantidades(r))) errores[campo(nombre)] = mensaje;
      const clave = [r.tipo, r.nombre, r.ubicacion].map(normalizar).join("|");
      if (r.nombre.trim() && vistos.has(clave)) errores[campo("nombre")] = "Este recurso ya está incluido en la ficha.";
      vistos.add(clave);
    });
  }
  if (paso === 2 && !v.delegadosConfirmados) {
    errores.delegadosConfirmados = "Confirme la designación de ambos delegados.";
  }
  return errores;
}

/** Which step holds a field the server rejected. */
function pasoDeCampo(campo: string): number {
  if (campo.startsWith("recursos")) return 1;
  if (["brechas", "observaciones", "delegadosConfirmados"].includes(campo)) return 2;
  return 0;
}

export default function FormularioRecursos() {
  const { catalogos, error } = useRiesgosCatalogos();
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!catalogos) return <Skeleton className="h-96 w-full" />;
  return <Asistente catalogos={catalogos} />;
}

function Asistente({ catalogos }: { catalogos: RiesgosCatalogos }) {
  const [id, setId] = useState(nuevoId);
  const [paso, setPaso] = useState(0);
  const [valores, setValores] = useState<Valores>(valoresIniciales);
  const [recursos, setRecursos] = useState<RiesgosRecursoEntrada[]>(() => [recursoVacio()]);
  const [errores, setErrores] = useState<Errores>({});
  const [enviando, setEnviando] = useState(false);
  const [recibo, setRecibo] = useState<RiesgosRecibo | null>(null);

  function limpiar(campo: string) {
    setErrores((actual) => (actual[campo] ? { ...actual, [campo]: "" } : actual));
  }

  function cambiar<K extends keyof Valores>(campo: K, valor: Valores[K]) {
    setValores((actual) => ({ ...actual, [campo]: valor }));
    limpiar(campo);
  }

  function cambiarContacto(quien: "principal" | "alterno", campo: keyof RiesgosContacto, valor: string) {
    setValores((actual) => ({ ...actual, [quien]: { ...actual[quien], [campo]: valor } }));
    limpiar(`${quien}.${campo}`);
  }

  function cambiarRecurso(indice: number, cambios: Partial<RiesgosRecursoEntrada>) {
    setRecursos((actual) => actual.map((r, i) => (i === indice ? { ...r, ...cambios } : r)));
    const campos = Object.keys(cambios);
    // The quantity rules tie several fields together: raising "existente" can
    // settle the message on "operativa". The live check shows what still holds.
    if (campos.some((c) => (CAMPOS_RELACIONADOS as readonly string[]).includes(c))) campos.push(...CAMPOS_RELACIONADOS);
    Array.from(new Set(campos)).forEach((campo) => limpiar(`recursos.${indice}.${campo}`));
  }

  function cambiarTipo(indice: number, tipo: RiesgosRecursoTipo) {
    const actual = recursos[indice];
    const unidad = actual.unidad === UNIDAD_SUGERIDA[actual.tipo] ? UNIDAD_SUGERIDA[tipo] : actual.unidad;
    cambiarRecurso(indice, { tipo, unidad, detalles: {} });
  }

  function avanzar() {
    const encontrados = validarPaso(paso, valores, recursos);
    setErrores(encontrados);
    if (Object.keys(encontrados).length) {
      toast.error("Revise los campos marcados");
      return;
    }
    setPaso((p) => p + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function enviar() {
    const encontrados = validarPaso(2, valores, recursos);
    setErrores(encontrados);
    if (Object.keys(encontrados).length) return;
    setEnviando(true);
    try {
      const entrada: RiesgosFichaEntrada = {
        ...valores,
        id,
        institucionTipo: valores.institucionTipo as RiesgosFichaEntrada["institucionTipo"],
        delegadosConfirmados: true,
        recursos,
      };
      setRecibo(await api.post<RiesgosRecibo>("/riesgos/public/fichas", entrada));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const campos = erroresDeCampos(err);
      if (campos) {
        setErrores(campos);
        const primero = Object.keys(campos)[0];
        if (primero) setPaso(pasoDeCampo(primero));
      }
      toast.error(apiErrorMessage(err, "No fue posible guardar la ficha. Intente nuevamente."));
    } finally {
      setEnviando(false);
    }
  }

  function reiniciar() {
    setId(nuevoId());
    setPaso(0);
    setValores(valoresIniciales());
    setRecursos([recursoVacio()]);
    setErrores({});
    setRecibo(null);
  }

  if (recibo) {
    return (
      <Recibo
        titulo="Gracias por aportar a la preparación provincial."
        codigo={recibo.codigo}
        detalle="La ficha quedó registrada y ya forma parte de la matriz provincial del COE."
        onOtro={reiniciar}
        otroTexto="Registrar otra ficha"
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-xs font-semibold tracking-widest text-teal-700">LEVANTAMIENTO DE CAPACIDADES</p>
        <h2 className="mt-1 text-2xl font-bold text-slate-900">Registro institucional de recursos</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Declare los recursos que su institución tiene en Galápagos para responder a emergencias. Registre cada grupo
          o activo una sola vez y distinga las cantidades existentes, operativas y realmente movilizables.
        </p>
      </div>

      <ol className="grid grid-cols-3 gap-2" aria-label="Pasos del formulario">
        {PASOS.map((nombre, i) => (
          <li
            key={nombre}
            aria-current={i === paso ? "step" : undefined}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium sm:text-sm ${
              i === paso ? "border-teal-600 bg-teal-50 text-teal-900" : i < paso ? "border-emerald-200 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${i < paso ? "bg-emerald-600 text-white" : i === paso ? "bg-teal-700 text-white" : "bg-slate-200"}`}>
              {i < paso ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="truncate">{nombre}</span>
          </li>
        ))}
      </ol>

      {paso === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Identificación institucional</CardTitle>
            <p className="text-xs text-muted-foreground">Los campos con * son obligatorios.</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoInstitucion instituciones={catalogos.instituciones} valor={valores.institucionNombre}
                onChange={(nombre, tipo) => {
                  cambiar("institucionNombre", nombre);
                  if (tipo !== undefined) cambiar("institucionTipo", tipo);
                }}
                error={errores.institucionNombre} />
              <CampoSelect id="institucionTipo" etiqueta="Tipo de institución *" valor={valores.institucionTipo}
                opciones={catalogos.tiposInstitucion} vacio="Seleccione el tipo"
                onChange={(v) => cambiar("institucionTipo", v)} error={errores.institucionTipo} />
              <CampoMesaGrupo id="mesaGrupo" valor={valores.mesaGrupo} onChange={(v) => cambiar("mesaGrupo", v)}
                error={errores.mesaGrupo} sinMesa={catalogos.sinMesa} mesasTecnicas={catalogos.mesasTecnicas}
                gruposTrabajo={catalogos.gruposTrabajo} />
              <CampoSelect id="isla" etiqueta="Isla donde se encuentran los recursos *" valor={valores.isla}
                opciones={catalogos.islas} onChange={(v) => cambiar("isla", v as RiesgosIsla)} error={errores.isla}
                ayuda="Todos los recursos de esta ficha quedan en esta isla. Si tiene recursos en otra isla, envíe una ficha por cada isla." />
            </div>
            {(["principal", "alterno"] as const).map((quien) => (
              <fieldset key={quien} className="space-y-3">
                <legend className="text-sm font-semibold text-slate-900">
                  {quien === "principal" ? "Delegado principal *" : "Delegado alterno *"}
                </legend>
                <p className="text-xs text-muted-foreground">
                  {quien === "principal"
                    ? "Persona designada para coordinar y confirmar la disponibilidad de los recursos durante una emergencia."
                    : "Persona distinta que asumirá la coordinación cuando el delegado principal no esté disponible."}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <CampoTexto id={`${quien}.nombre`} etiqueta="Nombre completo *" valor={valores[quien].nombre}
                    onChange={(v) => cambiarContacto(quien, "nombre", v)} error={errores[`${quien}.nombre`]} />
                  <CampoTexto id={`${quien}.cargo`} etiqueta="Cargo *" valor={valores[quien].cargo}
                    onChange={(v) => cambiarContacto(quien, "cargo", v)} error={errores[`${quien}.cargo`]} />
                  <CampoTexto id={`${quien}.correo`} etiqueta="Correo institucional *" tipo="email" valor={valores[quien].correo}
                    onChange={(v) => cambiarContacto(quien, "correo", v)} error={errores[`${quien}.correo`]} />
                  <CampoTexto id={`${quien}.telefono`} etiqueta="Teléfono directo *" tipo="tel" valor={valores[quien].telefono}
                    onChange={(v) => cambiarContacto(quien, "telefono", v)} error={errores[`${quien}.telefono`]} />
                </div>
              </fieldset>
            ))}
          </CardContent>
        </Card>
      )}

      {paso === 1 && (
        <div className="space-y-4">
          <p className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
            Todos los recursos de esta ficha se registran en <strong>{valores.isla}</strong>. Para recursos en otra isla,
            envíe una ficha aparte.
          </p>
          {recursos.map((recurso, i) => (
            <TarjetaRecurso
              key={i}
              indice={i}
              recurso={recurso}
              catalogos={catalogos}
              errores={errores}
              onCambiar={(cambios) => cambiarRecurso(i, cambios)}
              onCambiarTipo={(tipo) => cambiarTipo(i, tipo)}
              onQuitar={recursos.length > 1 ? () => {
                setRecursos((actual) => actual.filter((_, j) => j !== i));
                // Messages are keyed by position; after a removal they would point at the wrong card.
                setErrores({});
              } : undefined}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={recursos.length >= catalogos.maxRecursos}
            onClick={() => setRecursos((actual) => [...actual, recursoVacio()])}
          >
            <Plus /> Agregar otro recurso
          </Button>
          <p className="text-xs text-muted-foreground">
            {recursos.length} de {catalogos.maxRecursos} recursos posibles en esta ficha.
          </p>
        </div>
      )}

      {paso === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Revisar y enviar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Institución</dt><dd className="font-medium">{valores.institucionNombre} · {valores.institucionTipo}</dd></div>
              <div><dt className="text-muted-foreground">Mesa o grupo</dt><dd className="font-medium">{valores.mesaGrupo}</dd></div>
              <div><dt className="text-muted-foreground">Isla de los recursos</dt><dd className="font-medium">{valores.isla}</dd></div>
              <div><dt className="text-muted-foreground">Delegado principal</dt><dd className="font-medium">{valores.principal.nombre} · {valores.principal.cargo}</dd></div>
              <div><dt className="text-muted-foreground">Delegado alterno</dt><dd className="font-medium">{valores.alterno.nombre} · {valores.alterno.cargo}</dd></div>
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Recurso</th><th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3 text-right">Existente</th><th className="py-2 pr-3 text-right">Operativo</th><th className="py-2 text-right">Movilizable</th>
                  </tr>
                </thead>
                <tbody>
                  {recursos.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{r.nombre}<span className="block text-xs text-muted-foreground">{r.ubicacion} · {r.unidad}</span></td>
                      <td className="py-2 pr-3">{r.tipo}</td>
                      <td className="py-2 pr-3 text-right">{r.cantidadExistente}</td><td className="py-2 pr-3 text-right">{r.cantidadOperativa}</td>
                      <td className="py-2 text-right font-semibold">{r.cantidadMovilizable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="brechas" etiqueta="Brechas identificadas" error={errores.brechas}
                ayuda="Lo que la institución necesitaría y no tiene para responder.">
                <textarea id="brechas" className={textareaClass} value={valores.brechas} maxLength={3000}
                  onChange={(e) => cambiar("brechas", e.target.value)} />
              </Campo>
              <Campo id="observaciones" etiqueta="Observaciones" error={errores.observaciones}>
                <textarea id="observaciones" className={textareaClass} value={valores.observaciones} maxLength={3000}
                  onChange={(e) => cambiar("observaciones", e.target.value)} />
              </Campo>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="text-muted-foreground">
                Los nombres, correos y teléfonos registrados se usarán para coordinar la respuesta del COE Provincial y del
                Comité Territorial. Solo el equipo coordinador con acceso a SIGTAR puede consultarlos.
              </p>
              <label className="mt-3 flex items-start gap-2 font-medium">
                <input type="checkbox" className="mt-0.5 size-4" checked={valores.delegadosConfirmados}
                  onChange={(e) => cambiar("delegadosConfirmados", e.target.checked)} />
                Confirmo que la institución designó a los dos delegados indicados y que la información registrada es correcta.
              </label>
              {errores.delegadosConfirmados && <p className="mt-2 text-xs text-destructive" role="alert">{errores.delegadosConfirmados}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" disabled={paso === 0 || enviando} onClick={() => setPaso((p) => p - 1)}>
          <ArrowLeft /> Anterior
        </Button>
        {paso < 2 ? (
          <Button type="button" onClick={avanzar}>
            Siguiente <ArrowRight />
          </Button>
        ) : (
          <Button type="button" onClick={enviar} disabled={enviando}>
            <Send /> {enviando ? "Enviando…" : "Enviar ficha"}
          </Button>
        )}
      </div>
    </div>
  );
}

function TarjetaRecurso({
  indice,
  recurso,
  catalogos,
  errores,
  onCambiar,
  onCambiarTipo,
  onQuitar,
}: {
  indice: number;
  recurso: RiesgosRecursoEntrada;
  catalogos: RiesgosCatalogos;
  errores: Errores;
  onCambiar: (cambios: Partial<RiesgosRecursoEntrada>) => void;
  onCambiarTipo: (tipo: RiesgosRecursoTipo) => void;
  onQuitar?: () => void;
}) {
  const campo = (nombre: string) => `recursos.${indice}.${nombre}`;
  const avisos = reglasCantidades(recurso);
  // Nothing moves that the institution does not own or that is unavailable.
  const sinMovilizable = !recurso.esTitular
    ? "Cero: el recurso no es de la institución."
    : recurso.disponibilidad === "No disponible" ? "Cero: el recurso no está disponible." : undefined;
  const cantidad = (nombre: CampoCantidad, etiqueta: string) => {
    const error = avisos[nombre] ?? errores[campo(nombre)];
    const bloqueada = nombre === "cantidadMovilizable" && !!sinMovilizable;
    return (
      <Campo id={campo(nombre)} etiqueta={etiqueta} error={error} ayuda={bloqueada ? sinMovilizable : undefined}>
        <Input
          id={campo(nombre)}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={String(recurso[nombre])}
          disabled={bloqueada}
          aria-invalid={!!error}
          aria-describedby={error ? `${campo(nombre)}-error` : undefined}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onCambiar({ [nombre]: leerCantidad(e.target.value) })}
        />
      </Campo>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Recurso {indice + 1}</CardTitle>
        {onQuitar && (
          <Button type="button" variant="ghost" size="sm" onClick={onQuitar}>
            <Trash2 /> Quitar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoSelect id={campo("tipo")} etiqueta="Tipo de recurso *" valor={recurso.tipo} opciones={catalogos.tiposRecurso}
            onChange={(v) => onCambiarTipo(v as RiesgosRecursoTipo)} error={errores[campo("tipo")]} />
          <CampoTexto id={campo("nombre")} etiqueta="Nombre del recurso *" valor={recurso.nombre}
            placeholder="Ej. brigada de rescate, camioneta 4x4" onChange={(v) => onCambiar({ nombre: v })} error={errores[campo("nombre")]} />
          <CampoTexto id={campo("ubicacion")} etiqueta="Ubicación *" valor={recurso.ubicacion}
            placeholder="Ej. bodega central, barrio El Progreso" onChange={(v) => onCambiar({ ubicacion: v })} error={errores[campo("ubicacion")]} />
          <CampoTexto id={campo("unidad")} etiqueta="Unidad de medida *" valor={recurso.unidad}
            onChange={(v) => onCambiar({ unidad: v })} error={errores[campo("unidad")]} />
          <CampoSelect id={campo("disponibilidad")} etiqueta="Disponibilidad *" valor={recurso.disponibilidad}
            opciones={catalogos.disponibilidades}
            onChange={(v) => onCambiar({
              disponibilidad: v as RiesgosRecursoEntrada["disponibilidad"],
              ...(v === "No disponible" ? { cantidadMovilizable: 0 } : {}),
            })}
            error={avisos.disponibilidad ?? errores[campo("disponibilidad")]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {cantidad("cantidadExistente", "Cantidad existente *")}
          {cantidad("cantidadOperativa", "Cantidad operativa *")}
          {cantidad("cantidadMovilizable", "Realmente movilizable *")}
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          Solo números enteros, cero o mayores. La cantidad operativa no puede superar la existente, y la realmente
          movilizable no puede superar la operativa.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={recurso.esTitular}
            onChange={(e) => onCambiar({ esTitular: e.target.checked, ...(e.target.checked ? {} : { cantidadMovilizable: 0 }) })} />
          <span>
            <span className="font-medium">La institución es titular de este recurso</span>
            <span className="block text-xs text-muted-foreground">
              Si es prestado o de otra entidad, desmarque: quedará como referencia, sin cantidad movilizable.
            </span>
          </span>
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          {catalogos.camposDetalle[recurso.tipo].map((detalle) => (
            <CampoTexto
              key={detalle.clave}
              id={campo(`detalles.${detalle.clave}`)}
              etiqueta={detalle.etiqueta}
              placeholder={detalle.ejemplo}
              valor={recurso.detalles[detalle.clave] ?? ""}
              onChange={(v) => onCambiar({ detalles: { ...recurso.detalles, [detalle.clave]: v } })}
              error={errores[campo(`detalles.${detalle.clave}`)]}
            />
          ))}
        </div>
        <Campo id={campo("restricciones")} etiqueta="Restricciones de uso" error={errores[campo("restricciones")]}
          ayuda="Ej. requiere autorización, solo en horario laboral, necesita combustible.">
          <textarea id={campo("restricciones")} className={textareaClass} value={recurso.restricciones} maxLength={3000}
            onChange={(e) => onCambiar({ restricciones: e.target.value })} />
        </Campo>
      </CardContent>
    </Card>
  );
}
