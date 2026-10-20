"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api-client";
import { correoValido, erroresDeCampos, nuevoId, telefonoValido, useRiesgosCatalogos } from "@/lib/riesgos";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CampoMesaGrupo, CampoSelect, CampoTexto, Recibo } from "./campos";
import type {
  RiesgosCatalogos,
  RiesgosContacto,
  RiesgosDelegacionEntrada,
  RiesgosDelegado,
  RiesgosIsla,
  RiesgosRecibo,
} from "@/types";

type Errores = Record<string, string>;
type Persona = "reporta" | "principal" | "alterno";

type Valores = {
  institucionNombre: string;
  institucionTipo: string;
  isla: RiesgosIsla;
  mesaGrupo: string;
  reporta: RiesgosContacto;
  principal: RiesgosDelegado;
  alterno: RiesgosDelegado;
  confirmado: boolean;
};

const contacto = (): RiesgosContacto => ({ nombre: "", cargo: "", correo: "", telefono: "" });
const delegado = (): RiesgosDelegado => ({ ...contacto(), documento: "" });

const iniciales = (): Valores => ({
  institucionNombre: "",
  institucionTipo: "",
  isla: "San Cristóbal",
  mesaGrupo: "",
  reporta: contacto(),
  principal: delegado(),
  alterno: delegado(),
  confirmado: false,
});

const normalizar = (value: string) => value.trim().toLocaleLowerCase("es").replace(/\s+/g, " ");

function validar(v: Valores): Errores {
  const errores: Errores = {};
  if (v.institucionNombre.trim().length < 2) errores.institucionNombre = "Ingrese el nombre de la institución.";
  if (!v.institucionTipo) errores.institucionTipo = "Seleccione el tipo de institución.";
  if (!v.mesaGrupo) errores.mesaGrupo = "Seleccione una mesa o grupo.";
  for (const quien of ["reporta", "principal", "alterno"] as const) {
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
  if (!v.confirmado) errores.confirmado = "Confirme la designación de las dos personas.";
  return errores;
}

const SECCIONES: Array<{ quien: Persona; titulo: string; ayuda: string }> = [
  { quien: "reporta", titulo: "Persona que reporta *", ayuda: "Quien completa este registro en nombre de la institución." },
  { quien: "principal", titulo: "Delegado principal al COE Provincial *", ayuda: "Representa a la institución en las sesiones del COE Provincial." },
  { quien: "alterno", titulo: "Delegado alterno al COE Provincial *", ayuda: "Persona distinta que asiste cuando el principal no puede hacerlo." },
];

export default function FormularioDelegados() {
  const { catalogos, error } = useRiesgosCatalogos();
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!catalogos) return <Skeleton className="h-96 w-full" />;
  return <Formulario catalogos={catalogos} />;
}

function Formulario({ catalogos }: { catalogos: RiesgosCatalogos }) {
  const [id, setId] = useState(nuevoId);
  const [valores, setValores] = useState<Valores>(iniciales);
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

  function cambiarPersona(quien: Persona, campo: keyof RiesgosDelegado, valor: string) {
    setValores((actual) => ({ ...actual, [quien]: { ...actual[quien], [campo]: valor } }));
    limpiar(`${quien}.${campo}`);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const encontrados = validar(valores);
    setErrores(encontrados);
    if (Object.keys(encontrados).length) {
      toast.error("Revise los campos marcados");
      return;
    }
    setEnviando(true);
    try {
      const entrada: RiesgosDelegacionEntrada = {
        ...valores,
        id,
        institucionTipo: valores.institucionTipo as RiesgosDelegacionEntrada["institucionTipo"],
        confirmado: true,
      };
      setRecibo(await api.post<RiesgosRecibo>("/riesgos/public/delegaciones", entrada));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const campos = erroresDeCampos(err);
      if (campos) setErrores(campos);
      toast.error(apiErrorMessage(err, "No fue posible guardar la designación. Intente nuevamente."));
    } finally {
      setEnviando(false);
    }
  }

  if (recibo) {
    return (
      <Recibo
        titulo="La designación quedó registrada."
        codigo={recibo.codigo}
        detalle="El equipo coordinador del COE Provincial ya puede consultar a los delegados de su institución."
        onOtro={() => {
          setId(nuevoId());
          setValores(iniciales());
          setErrores({});
          setRecibo(null);
        }}
        otroTexto="Registrar otra designación"
      />
    );
  }

  return (
    <form onSubmit={enviar} className="mx-auto max-w-4xl space-y-6" noValidate>
      <div>
        <p className="text-xs font-semibold tracking-widest text-teal-700">COE PROVINCIAL</p>
        <h2 className="mt-1 text-2xl font-bold text-slate-900">Delegados al COE Provincial</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Registre a la persona que reporta y a los dos delegados (principal y alterno) que representarán a su
          institución ante el COE Provincial de Galápagos.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Institución</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <CampoTexto id="institucionNombre" etiqueta="Nombre de la institución *" valor={valores.institucionNombre}
            onChange={(v) => cambiar("institucionNombre", v)} error={errores.institucionNombre} />
          <CampoSelect id="institucionTipo" etiqueta="Tipo de institución *" valor={valores.institucionTipo}
            opciones={catalogos.tiposInstitucion} vacio="Seleccione el tipo"
            onChange={(v) => cambiar("institucionTipo", v)} error={errores.institucionTipo} />
          <CampoSelect id="isla" etiqueta="Isla *" valor={valores.isla} opciones={catalogos.islas}
            onChange={(v) => cambiar("isla", v as RiesgosIsla)} error={errores.isla} />
          <CampoMesaGrupo id="mesaGrupo" valor={valores.mesaGrupo} onChange={(v) => cambiar("mesaGrupo", v)}
            error={errores.mesaGrupo} sinMesa={catalogos.sinMesa} mesasTecnicas={catalogos.mesasTecnicas}
            gruposTrabajo={catalogos.gruposTrabajo} />
        </CardContent>
      </Card>

      {SECCIONES.map(({ quien, titulo, ayuda }) => (
        <Card key={quien}>
          <CardHeader>
            <CardTitle>{titulo}</CardTitle>
            <p className="text-xs text-muted-foreground">{ayuda}</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <CampoTexto id={`${quien}.nombre`} etiqueta="Nombre completo *" valor={valores[quien].nombre}
              onChange={(v) => cambiarPersona(quien, "nombre", v)} error={errores[`${quien}.nombre`]} />
            <CampoTexto id={`${quien}.cargo`} etiqueta="Cargo *" valor={valores[quien].cargo}
              onChange={(v) => cambiarPersona(quien, "cargo", v)} error={errores[`${quien}.cargo`]} />
            <CampoTexto id={`${quien}.correo`} etiqueta="Correo *" tipo="email" valor={valores[quien].correo}
              onChange={(v) => cambiarPersona(quien, "correo", v)} error={errores[`${quien}.correo`]} />
            <CampoTexto id={`${quien}.telefono`} etiqueta="Teléfono *" tipo="tel" valor={valores[quien].telefono}
              onChange={(v) => cambiarPersona(quien, "telefono", v)} error={errores[`${quien}.telefono`]} />
            {quien !== "reporta" && (
              <CampoTexto id={`${quien}.documento`} etiqueta="Cédula o identificación" valor={valores[quien].documento}
                onChange={(v) => cambiarPersona(quien, "documento", v)} error={errores[`${quien}.documento`]}
                ayuda="Opcional." />
            )}
          </CardContent>
        </Card>
      ))}

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <p className="text-muted-foreground">
          Estos datos de contacto se usarán para convocar y coordinar al COE Provincial. Solo el equipo coordinador con
          acceso a SIGTAR puede consultarlos.
        </p>
        <label className="mt-3 flex items-start gap-2 font-medium">
          <input type="checkbox" className="mt-0.5 size-4" checked={valores.confirmado}
            onChange={(e) => cambiar("confirmado", e.target.checked)} />
          Confirmo que la institución designó a estas dos personas como delegados al COE Provincial.
        </label>
        {errores.confirmado && <p className="mt-2 text-xs text-destructive" role="alert">{errores.confirmado}</p>}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={enviando}>
          <Send /> {enviando ? "Enviando…" : "Registrar delegados"}
        </Button>
      </div>
    </form>
  );
}
