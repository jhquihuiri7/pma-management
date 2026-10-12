"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Home, LockKeyhole, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { api, apiErrorMessage, checkedApiFetch } from "@/lib/api-client";
import LocationPicker from "./LocationPicker";
import { emptyFamilyPlan, FAMILY_PLAN_ISLANDS, FAMILY_PLAN_STEPS, type ClientFamilyPlan } from "./model";

type Receipt = { id: string; code: string; createdAt: string };

const RISK_TYPES = ["Sismo", "Tsunami", "Incendio", "Inundación", "Deslizamiento", "Erupción volcánica", "Otro"];
const RELATIONS = ["Responsable del hogar", "Pareja", "Hija / hijo", "Madre / padre", "Otro familiar", "Otra persona"];
const ROLES = ["Guiar y apoyar", "Llevar la mochila", "Cerrar servicios si es seguro", "Cuidar mascotas", "Verificar que todos estén presentes", "Recibir apoyo", "Otro rol acordado"];

export default function FamilyPlanForm() {
  const [plan, setPlan] = useState<ClientFamilyPlan>(() => emptyFamilyPlan());
  const [downloadToken, setDownloadToken] = useState("");
  const [step, setStep] = useState(-1);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  function start() {
    const today = new Date().toLocaleDateString("en-CA");
    setPlan({ ...emptyFamilyPlan(), submissionId: crypto.randomUUID(), date: today });
    setDownloadToken(crypto.randomUUID());
    setStep(0);
    setReceipt(null);
    setError("");
  }

  function field<K extends keyof ClientFamilyPlan>(key: K, value: ClientFamilyPlan[K]) {
    setPlan((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function updateRow(key: "members" | "pets" | "risks" | "routes" | "resources" | "actions", index: number, patch: Record<string, unknown>) {
    setPlan((current) => ({
      ...current,
      [key]: (current[key] as Array<Record<string, unknown>>).map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row),
    } as ClientFamilyPlan));
    setError("");
  }

  function removeRow(key: "members" | "pets" | "risks" | "actions", index: number) {
    setPlan((current) => ({ ...current, [key]: current[key].filter((_, rowIndex) => rowIndex !== index) } as ClientFamilyPlan));
  }

  function validate(currentStep: number): string | null {
    if (currentStep === 0) {
      if (![plan.family, plan.island, plan.sector, plan.address, plan.date, plan.phone, plan.contact, plan.contactPhone, plan.meeting, plan.noSignal, plan.updater].every((value) => String(value).trim())) {
        return "Completa todos los campos obligatorios de datos y acuerdos.";
      }
      if (plan.phone.trim().length < 7 || plan.contactPhone.trim().length < 7) return "Revisa los números de teléfono.";
    }
    if (currentStep === 1 && plan.members.some((member) => !member.name || !member.relation || !member.role)) {
      return "Completa el nombre, relación y rol de cada integrante.";
    }
    if (currentStep === 1 && plan.pets.some((pet) => !pet.name || !pet.keeper || !pet.needs)) {
      return "Completa todos los datos de las mascotas agregadas.";
    }
    if (currentStep === 2 && plan.risks.some((risk) => !risk.type || !risk.effect || !risk.prevention || !risk.first)) {
      return "Completa la preparación de cada riesgo.";
    }
    if (currentStep === 3 && plan.routes.some((route) => !route.route || !route.point || !route.notice)) {
      return "Completa la ruta, punto seguro y forma de aviso de cada situación.";
    }
    if (currentStep === 6) {
      const actions = plan.actions.filter((action) => action.action.trim());
      if (actions.length === 0) return "Anota al menos una acción concreta.";
      if (actions.some((action) => !action.person.trim())) return "Indica quién se responsabiliza de cada acción escrita.";
    }
    if (currentStep === 7 && !plan.participants.trim()) return "Indica los nombres de quienes participaron.";
    return null;
  }

  function go(next: number) {
    if (next === step + 1 && step >= 0 && step < 8) {
      const issue = validate(step);
      if (issue) {
        setError(issue);
        return;
      }
    }
    setError("");
    setStep(next);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadSketch(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Selecciona una imagen JPG, PNG o WebP.");
      return;
    }
    if (file.size > 12_000_000) {
      setError("La imagen debe pesar menos de 12 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const value = canvas.toDataURL("image/jpeg", 0.75);
      if (value.length > 1_500_000) throw new Error("La imagen sigue siendo demasiado grande; reduce sus dimensiones.");
      field("sketch", value);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No se pudo procesar la imagen.");
    }
  }

  async function submit() {
    for (let index = 0; index < 8; index += 1) {
      const issue = validate(index);
      if (issue) {
        setStep(index);
        setError(issue);
        return;
      }
    }
    if (!plan.consent) {
      setError("Confirma la autorización para registrar el plan.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api.post<Receipt>("/plan-familiar/public/plans", { ...plan, consent: true, downloadToken });
      if (!saved?.id || !saved?.code) throw new Error("El servidor no confirmó el registro.");
      setReceipt(saved);
    } catch (submitError) {
      setError(apiErrorMessage(submitError, "No fue posible registrar el plan. Tus respuestas siguen en pantalla."));
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!receipt) return;
    setPdfBusy(true);
    setError("");
    try {
      const response = await checkedApiFetch(`/plan-familiar/public/plans/${receipt.id}/pdf`, {
        headers: { Authorization: `Bearer ${downloadToken}` },
        timeoutMs: 60_000,
      });
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Plan_Familiar_${receipt.code}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (downloadError) {
      setError(apiErrorMessage(downloadError, "No se pudo descargar el PDF."));
    } finally {
      setPdfBusy(false);
    }
  }

  const input = (label: string, key: keyof ClientFamilyPlan, required = false, type = "text", placeholder = "") => (
    <label className="pf-field"><span>{label}{required && " *"}</span><input type={type} value={String(plan[key] ?? "")} placeholder={placeholder} maxLength={type === "tel" ? 30 : 500} onChange={(event) => field(key, event.target.value as never)} /></label>
  );

  if (step === -1) {
    return (
      <div className="pf-public" ref={top}>
        <header className="pf-header"><Link href="/plan-familiar" className="pf-brand"><span><ShieldCheck /></span><div><strong>Familias preparadas</strong><small>GALÁPAGOS · CGREG / DGTAR</small></div></Link><Link href="/plan-familiar/resultados" className="pf-admin-link"><LockKeyhole size={16} /> Resultados</Link></header>
        <main className="pf-hero">
          <section><p className="pf-eyebrow">LA RESILIENCIA COMIENZA EN EL HOGAR</p><h1>Un plan para cuidar a quienes más quieres.</h1><p>Conversen, acuerden rutas y responsabilidades, registren sus recursos y descarguen una copia para practicar en familia.</p><button type="button" className="pf-button pf-button-primary" onClick={start}>Crear nuestro plan <ChevronRight size={18} /></button></section>
          <aside><Home size={72} /><h2>Prepararnos hoy.<br />Cuidarnos siempre.</h2><ul><li>Ocho pasos guiados</li><li>Mapa y croquis opcionales</li><li>PDF familiar descargable</li></ul></aside>
        </main>
        <section className="pf-intro"><div><b>01</b><h3>Conversen</h3><p>Identifiquen necesidades y riesgos.</p></div><div><b>02</b><h3>Acuerden</h3><p>Definan rutas, contactos y tareas.</p></div><div><b>03</b><h3>Practiquen</h3><p>Descarguen el plan y ensayen juntos.</p></div></section>
        <section className="pf-privacy"><LockKeyhole /><p>Al enviar, las respuestas y una copia PDF se guardarán en SIGTAR para seguimiento institucional. Otras familias no pueden consultar su plan.</p></section>
      </div>
    );
  }

  if (receipt) {
    return (
      <div className="pf-public" ref={top}>
        <header className="pf-header"><span className="pf-brand"><span><ShieldCheck /></span><div><strong>Familias preparadas</strong><small>GALÁPAGOS · CGREG / DGTAR</small></div></span></header>
        <main className="pf-success"><CheckCircle2 size={64} /><p className="pf-eyebrow">PLAN REGISTRADO</p><h1>Su familia dio un paso importante.</h1><p>Guarden el código y descarguen el plan antes de cerrar esta página.</p><div className="pf-receipt"><span>Código de registro</span><strong>{receipt.code}</strong><small>{new Date(receipt.createdAt).toLocaleString("es-EC")}</small></div><button type="button" className="pf-button pf-button-primary" onClick={downloadPdf} disabled={pdfBusy}><Download size={18} /> {pdfBusy ? "Descargando…" : "Descargar nuestro plan en PDF"}</button>{error && <div className="pf-error">{error}</div>}<button type="button" className="pf-link-button" onClick={start}>Crear otro plan</button></main>
      </div>
    );
  }

  return (
    <div className="pf-public" ref={top}>
      <header className="pf-header"><button type="button" className="pf-brand pf-brand-button" onClick={() => go(-1)}><span><ShieldCheck /></span><div><strong>Familias preparadas</strong><small>GALÁPAGOS · CGREG / DGTAR</small></div></button><Link href="/plan-familiar/resultados" className="pf-admin-link"><LockKeyhole size={16} /> Resultados</Link></header>
      <main className="pf-workspace">
        <aside className="pf-steps"><p className="pf-eyebrow">NUESTRO PLAN FAMILIAR</p><h2>Un acuerdo.<br />Ocho pasos.</h2><nav>{FAMILY_PLAN_STEPS.map((name, index) => <button type="button" key={name} className={step === index ? "active" : ""} onClick={() => go(index)}><span>{index + 1}</span>{name}</button>)}<button type="button" className={step === 8 ? "active" : ""} onClick={() => go(8)}><span>9</span>Revisar y enviar</button></nav></aside>
        <section className="pf-form-area">
          <div className="pf-progress-copy"><span>{step < 8 ? `PASO ${step + 1} DE 8` : "REVISIÓN FINAL"}</span><span>{Math.round(((step + 1) / 9) * 100)}%</span></div><div className="pf-progress"><span style={{ width: `${((step + 1) / 9) * 100}%` }} /></div>
          <h1>{FAMILY_PLAN_STEPS[step] ?? "Revisen su plan"}</h1>

          {step === 0 && <><div className="pf-grid">{input("Nombre de la familia o responsable", "family", true, "text", "Ej.: Familia Bautista")}<label className="pf-field"><span>Isla *</span><select value={plan.island} onChange={(event) => field("island", event.target.value as ClientFamilyPlan["island"])}>{FAMILY_PLAN_ISLANDS.map((island) => <option key={island}>{island}</option>)}</select></label>{input("Fecha de elaboración", "date", true, "date")}{input("Dirección completa", "address", true)}{input("Barrio, sector o comunidad", "sector", true)}{input("Teléfono principal", "phone", true, "tel")}{input("Teléfono alternativo", "altPhone", false, "tel")}{input("Contacto fuera de la zona", "contact", true)}{input("Teléfono del contacto", "contactPhone", true, "tel")}{input("Punto de encuentro", "meeting", true)}{input("Si no hay señal, contactaremos a…", "noSignal", true)}{input("Fecha de revisión", "reviewDate", false, "date")}{input("Responsable de actualizar", "updater", true)}</div></>}

          {step === 1 && <><h3 className="pf-section-title">Integrantes</h3>{plan.members.map((member, index) => <article className="pf-entry" key={index}><div className="pf-entry-head"><strong>Integrante {index + 1}</strong>{plan.members.length > 1 && <button type="button" onClick={() => removeRow("members", index)}><Trash2 size={16} /></button>}</div><div className="pf-grid"><label className="pf-field"><span>Nombre y apellido *</span><input value={member.name} onChange={(event) => updateRow("members", index, { name: event.target.value })} /></label><label className="pf-field"><span>Edad *</span><input type="number" min="0" max="120" value={member.age} onChange={(event) => updateRow("members", index, { age: Number(event.target.value) })} /></label><label className="pf-field"><span>Relación *</span><select value={member.relation} onChange={(event) => updateRow("members", index, { relation: event.target.value })}><option value="">Seleccionar</option>{RELATIONS.map((value) => <option key={value}>{value}</option>)}</select></label><label className="pf-field"><span>Teléfono</span><input value={member.phone} onChange={(event) => updateRow("members", index, { phone: event.target.value })} /></label><label className="pf-field"><span>Apoyos requeridos</span><input value={member.support} placeholder="Medicina, movilidad, cuidado…" onChange={(event) => updateRow("members", index, { support: event.target.value })} /></label><label className="pf-field"><span>Rol *</span><select value={member.role} onChange={(event) => updateRow("members", index, { role: event.target.value })}><option value="">Seleccionar</option>{ROLES.map((value) => <option key={value}>{value}</option>)}</select></label></div></article>)}{plan.members.length < 30 && <button type="button" className="pf-add" onClick={() => field("members", [...plan.members, { name: "", age: 0, relation: "", phone: "", support: "", role: "" }])}><Plus size={17} /> Agregar integrante</button>}<h3 className="pf-section-title">Mascotas o animales</h3>{plan.pets.map((pet, index) => <article className="pf-entry" key={index}><div className="pf-entry-head"><strong>Mascota {index + 1}</strong><button type="button" onClick={() => removeRow("pets", index)}><Trash2 size={16} /></button></div><div className="pf-grid"><label className="pf-field"><span>Nombre o tipo *</span><input value={pet.name} onChange={(event) => updateRow("pets", index, { name: event.target.value })} /></label><label className="pf-field"><span>Responsable *</span><input value={pet.keeper} onChange={(event) => updateRow("pets", index, { keeper: event.target.value })} /></label><label className="pf-field"><span>Qué necesita llevar *</span><input value={pet.needs} onChange={(event) => updateRow("pets", index, { needs: event.target.value })} /></label></div></article>)}{plan.pets.length < 15 && <button type="button" className="pf-add" onClick={() => field("pets", [...plan.pets, { name: "", keeper: "", needs: "" }])}><Plus size={17} /> Agregar mascota</button>}</>}

          {step === 2 && <>{plan.risks.map((risk, index) => <article className="pf-entry" key={index}><div className="pf-entry-head"><strong>Riesgo {index + 1}</strong>{plan.risks.length > 1 && <button type="button" onClick={() => removeRow("risks", index)}><Trash2 size={16} /></button>}</div><div className="pf-grid"><label className="pf-field"><span>Riesgo *</span><select value={risk.type} onChange={(event) => updateRow("risks", index, { type: event.target.value })}><option value="">Seleccionar</option>{RISK_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label><label className="pf-field"><span>Prioridad</span><select value={risk.priority} onChange={(event) => updateRow("risks", index, { priority: event.target.value })}>{["Alta", "Media", "Baja"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="pf-field"><span>¿Qué puede pasar? *</span><textarea value={risk.effect} onChange={(event) => updateRow("risks", index, { effect: event.target.value })} /></label><label className="pf-field"><span>¿Cómo lo reduciremos? *</span><textarea value={risk.prevention} onChange={(event) => updateRow("risks", index, { prevention: event.target.value })} /></label><label className="pf-field pf-span-2"><span>Primer paso si ocurre *</span><input value={risk.first} onChange={(event) => updateRow("risks", index, { first: event.target.value })} /></label></div></article>)}{plan.risks.length < 3 && <button type="button" className="pf-add" onClick={() => field("risks", [...plan.risks, { type: "", effect: "", prevention: "", first: "", priority: "Media" }])}><Plus size={17} /> Agregar riesgo</button>}</>}

          {step === 3 && <>{plan.routes.map((route, index) => <article className="pf-entry" key={route.situation}><h3>{route.situation}</h3><div className="pf-grid"><label className="pf-field"><span>Ruta o salida segura *</span><input value={route.route} onChange={(event) => updateRow("routes", index, { route: event.target.value })} /></label><label className="pf-field"><span>Punto de encuentro *</span><input value={route.point} onChange={(event) => updateRow("routes", index, { point: event.target.value })} /></label><label className="pf-field pf-span-2"><span>Quién avisa y cómo *</span><input value={route.notice} onChange={(event) => updateRow("routes", index, { notice: event.target.value })} /></label></div></article>)}</>}

          {step === 4 && <><LocationPicker value={plan.location} onChange={(value) => field("location", value)} /><h3 className="pf-section-title">Croquis de la vivienda</h3><label className="pf-upload"><Upload size={32} /><strong>Sube una foto o imagen del croquis</strong><span>JPG, PNG o WebP · hasta 12 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void loadSketch(event.target.files?.[0])} /></label>{plan.sketch && <div className="pf-sketch">
            {/* The preview is a local data URL; Next Image cannot optimize it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={plan.sketch} alt="Croquis familiar" />
            <button type="button" className="pf-link-button" onClick={() => field("sketch", "")}>Quitar imagen</button>
          </div>}{input("Referencia cercana", "reference", false, "text", "Calle, edificio o lugar conocido")}</>}

          {step === 5 && <><div className="pf-resource-list">{plan.resources.map((resource, index) => <article className="pf-resource" key={resource.item}><strong>{resource.item}</strong><label><span>¿Disponible?</span><select value={resource.status} onChange={(event) => updateRow("resources", index, { status: event.target.value })}><option>Sí</option><option>No</option></select></label><label><span>Cantidad o fecha</span><input value={resource.amount} onChange={(event) => updateRow("resources", index, { amount: event.target.value })} /></label><label><span>Dónde está</span><input value={resource.location} onChange={(event) => updateRow("resources", index, { location: event.target.value })} /></label><label><span>Pendiente</span><input value={resource.pending} onChange={(event) => updateRow("resources", index, { pending: event.target.value })} /></label></article>)}</div>{input("Teléfonos útiles", "usefulPhones", false, "text", "ECU 911, familiares, vecinos…")}</>}

          {step === 6 && <>{plan.actions.map((action, index) => <article className="pf-entry" key={index}><div className="pf-entry-head"><strong>Acción {index + 1}</strong>{plan.actions.length > 6 && <button type="button" onClick={() => removeRow("actions", index)}><Trash2 size={16} /></button>}</div><div className="pf-grid"><label className="pf-field"><span>Momento</span><select value={action.moment} onChange={(event) => updateRow("actions", index, { moment: event.target.value })}>{["Antes", "Durante", "Después"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="pf-field"><span>Acción</span><input value={action.action} onChange={(event) => updateRow("actions", index, { action: event.target.value })} /></label><label className="pf-field"><span>Responsable</span><input value={action.person} onChange={(event) => updateRow("actions", index, { person: event.target.value })} /></label><label className="pf-field"><span>Fecha</span><input type="date" value={action.date} onChange={(event) => updateRow("actions", index, { date: event.target.value })} /></label><label className="pf-check"><input type="checkbox" checked={action.done} onChange={(event) => updateRow("actions", index, { done: event.target.checked })} /> Acción lista</label></div></article>)}{plan.actions.length < 20 && <button type="button" className="pf-add" onClick={() => field("actions", [...plan.actions, { moment: "Antes", action: "", person: "", date: "", done: false }])}><Plus size={17} /> Agregar acción</button>}</>}

          {step === 7 && <><div className="pf-grid"><label className="pf-field"><span>Fecha de práctica</span><input type="date" value={plan.practice.date} onChange={(event) => field("practice", { ...plan.practice, date: event.target.value })} /></label><label className="pf-field"><span>Qué ensayamos</span><input value={plan.practice.exercise} onChange={(event) => field("practice", { ...plan.practice, exercise: event.target.value })} /></label><label className="pf-field"><span>Qué mejoraremos</span><input value={plan.practice.improvement} onChange={(event) => field("practice", { ...plan.practice, improvement: event.target.value })} /></label><label className="pf-field"><span>Quién lo hará</span><input value={plan.practice.person} onChange={(event) => field("practice", { ...plan.practice, person: event.target.value })} /></label></div>{input("Nombres de quienes participaron", "participants", true)}</>}

          {step === 8 && <><div className="pf-review"><div><span>Familia</span><strong>{plan.family}</strong></div><div><span>Ubicación</span><strong>{plan.island} · {plan.sector}</strong></div><div><span>Integrantes</span><strong>{plan.members.length}</strong></div><div><span>Riesgos</span><strong>{plan.risks.map((risk) => risk.type).join(", ")}</strong></div><div><span>Punto de encuentro</span><strong>{plan.meeting}</strong></div><div><span>Mapa y croquis</span><strong>{plan.location ? "Coordenadas incluidas" : "Sin coordenadas"} · {plan.sketch ? "Croquis incluido" : "Sin croquis"}</strong></div></div><div className="pf-consent"><LockKeyhole /><div><h3>Registro de participación y copia del plan</h3><p>Se guardarán los datos del formulario, la ubicación si fue agregada y una copia PDF. Solo el personal de SIGTAR autorizado para este módulo podrá consultar los resultados.</p><label className="pf-check"><input type="checkbox" checked={plan.consent} onChange={(event) => field("consent", event.target.checked)} /> Autorizo el registro de las respuestas y la copia del plan para esta finalidad.</label></div></div></>}

          {error && <div className="pf-error" role="alert">{error}</div>}
          <div className="pf-form-actions"><button type="button" className="pf-button pf-button-secondary" disabled={busy} onClick={() => go(step === 0 ? -1 : step - 1)}><ChevronLeft size={17} /> {step === 0 ? "Inicio" : "Anterior"}</button>{step < 8 ? <button type="button" className="pf-button pf-button-primary" onClick={() => go(step + 1)}>Continuar <ChevronRight size={17} /></button> : <button type="button" className="pf-button pf-button-primary" disabled={!plan.consent || busy} onClick={() => void submit()}>{busy ? "Guardando…" : "Guardar plan y generar PDF"}</button>}</div>
          <p className="pf-session-note">Las respuestas se guardan únicamente al enviar. Mantén esta página abierta mientras completas el plan.</p>
        </section>
      </main>
    </div>
  );
}
