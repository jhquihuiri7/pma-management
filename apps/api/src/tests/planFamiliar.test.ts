import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  FAMILY_PLAN_RESOURCE_NAMES,
  familyEmergencyPlanSchema,
  familyPlanListQuerySchema,
  type FamilyEmergencyPlanInput,
} from "../modules/planFamiliar/model.js";
import { createFamilyPlanPdf } from "../modules/planFamiliar/pdf.js";

function validPlan(): FamilyEmergencyPlanInput {
  return {
    submissionId: "3f89d6bc-2d6d-4ec9-867e-d3d4da565aa1",
    family: "Familia de prueba",
    island: "San Cristóbal",
    sector: "Barrio Central",
    address: "Calle de prueba",
    date: "2026-10-12",
    phone: "0999999999",
    altPhone: "",
    contact: "Contacto",
    contactPhone: "0988888888",
    meeting: "Parque",
    noSignal: "María, 0988888888",
    members: [{ name: "Persona", age: 30, relation: "Responsable", phone: "", support: "", role: "Llevar la mochila" }],
    pets: [],
    risks: [{ type: "Sismo", effect: "Daños", prevention: "Asegurar objetos", first: "Evacuar", priority: "Alta" }],
    routes: [
      { situation: "Sismo", route: "Puerta principal", point: "Parque", notice: "Mensaje" },
      { situation: "Tsunami", route: "Calle hacia la zona alta", point: "Zona segura alta", notice: "Silbato" },
      { situation: "Inundación o lluvia intensa", route: "Calle alta", point: "Colina", notice: "Llamada" },
      { situation: "Incendio u otra emergencia", route: "Patio", point: "Esquina", notice: "Silbato" },
    ],
    sketch: "",
    reference: "Iglesia",
    location: { lat: -0.9025, lng: -89.6106, snapshot: "", layer: "Mapa" },
    resources: FAMILY_PLAN_RESOURCE_NAMES.map((item) => ({ item, status: "No", amount: "", location: "" })),
    usefulPhones: "911",
    actions: (["Antes", "Antes", "Durante", "Durante", "Después", "Después"] as const).map((moment, index) => ({
      moment,
      action: index === 0 ? "Revisar la mochila" : "",
      person: index === 0 ? "Persona" : "",
    })),
    practice: { date: "", exercise: "", person: "" },
    signature: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    consent: true,
  };
}

test("family plan schema accepts the complete eight-section contract", () => {
  assert.equal(familyEmergencyPlanSchema.parse(validPlan()).family, "Familia de prueba");
});

test("family plan schema requires one of the filterable islands and rejects orphan action responsibility", () => {
  // The results page filters by these exact values, so a blank or free-text island would never match.
  assert.equal(familyEmergencyPlanSchema.safeParse({ ...validPlan(), island: "" }).success, false);
  assert.equal(familyEmergencyPlanSchema.safeParse({ ...validPlan(), island: "Galápagos" }).success, false);

  const orphan = validPlan();
  orphan.actions[1] = { ...orphan.actions[1], person: "Alguien" };
  assert.equal(familyEmergencyPlanSchema.safeParse(orphan).success, false);
});

test("family plan responsibilities are assigned to registered members", () => {
  const plan = validPlan();
  plan.practice.person = "Persona";
  assert.equal(familyEmergencyPlanSchema.safeParse(plan).success, true);
  plan.practice.person = "Alguien de fuera";
  assert.equal(familyEmergencyPlanSchema.safeParse(plan).success, false);

  const action = validPlan();
  action.actions[0] = { ...action.actions[0], person: "Alguien de fuera" };
  assert.equal(familyEmergencyPlanSchema.safeParse(action).success, false);

  const pet = validPlan();
  pet.pets = [{ name: "Luna", keeper: "Persona", needs: "Agua" }];
  assert.equal(familyEmergencyPlanSchema.safeParse(pet).success, true);
  pet.pets[0].keeper = "Vecino";
  assert.equal(familyEmergencyPlanSchema.safeParse(pet).success, false);
});

test("family plan schema takes the four evacuation routes and no practice improvement", () => {
  const plan = validPlan();
  assert.equal(familyEmergencyPlanSchema.safeParse({ ...plan, routes: plan.routes.slice(0, 3) }).success, false);
  assert.equal(familyEmergencyPlanSchema.safeParse({ ...plan, practice: { ...plan.practice, improvement: "" } }).success, false);
});

test("family plan list query treats empty filters as missing", () => {
  // Exactly what the results page sends with "Todos los registros" selected.
  const query = familyPlanListQuerySchema.parse({ search: "", island: "", page: "1", pageSize: "50" });
  assert.equal(query.island, undefined);
  assert.equal(query.page, 1);
  assert.equal(familyPlanListQuerySchema.parse({ island: "Isabela", from: "", to: "" }).island, "Isabela");
  assert.equal(familyPlanListQuerySchema.safeParse({ island: "Galápagos" }).success, false);
});

async function pageCount(plan: FamilyEmergencyPlanInput) {
  const bytes = await createFamilyPlanPdf(
    plan,
    "a5b052a2-3874-429d-a871-ae103d323468",
    new Date("2026-10-12T15:00:00.000Z"),
  );
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString("ascii"), "%PDF");
  return (await PDFDocument.load(bytes)).getPageCount();
}

test("family plan PDF fits the poster on two sheets", async () => {
  assert.equal(await pageCount(validPlan()), 2);
});

test("family plan PDF moves answers that do not fit to an annex sheet", async () => {
  const plan = validPlan();
  plan.address = "Avenida Charles Darwin y calle Isabela ".repeat(12).trim();
  plan.members = Array.from({ length: 12 }, (_, index) => ({ ...plan.members[0], name: `Persona ${index + 1}` }));
  // Characters outside the embedded font are dropped instead of failing the export.
  plan.family = "Familia de prueba 🏠";
  assert.equal(await pageCount(plan), 3);
});
