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
    noSignal: "Contacto fuera de la isla",
    reviewDate: "",
    updater: "Responsable",
    members: [{ name: "Persona", age: 30, relation: "Responsable", phone: "", support: "", role: "Llevar la mochila" }],
    pets: [],
    risks: [{ type: "Sismo", effect: "Daños", prevention: "Asegurar objetos", first: "Evacuar", priority: "Alta" }],
    routes: [
      { situation: "Sismo", route: "Puerta principal", point: "Parque", notice: "Mensaje" },
      { situation: "Inundación o lluvia intensa", route: "Calle alta", point: "Colina", notice: "Llamada" },
      { situation: "Incendio u otra emergencia", route: "Patio", point: "Esquina", notice: "Silbato" },
    ],
    sketch: "",
    reference: "Iglesia",
    location: { lat: -0.9025, lng: -89.6106, snapshot: "", layer: "Mapa" },
    resources: FAMILY_PLAN_RESOURCE_NAMES.map((item) => ({ item, status: "No", amount: "", location: "", pending: "" })),
    usefulPhones: "911",
    actions: (["Antes", "Antes", "Durante", "Durante", "Después", "Después"] as const).map((moment, index) => ({
      moment,
      action: index === 0 ? "Revisar la mochila" : "",
      person: index === 0 ? "Persona" : "",
      date: "",
      done: false,
    })),
    practice: { date: "", exercise: "", improvement: "", person: "" },
    participants: "Persona",
    consent: true,
  };
}

test("family plan schema accepts the complete eight-section contract", () => {
  assert.equal(familyEmergencyPlanSchema.parse(validPlan()).family, "Familia de prueba");
});

test("family plan schema preserves the canonical optional island and rejects orphan action responsibility", () => {
  const missingIsland = { ...validPlan(), island: "" };
  assert.equal(familyEmergencyPlanSchema.safeParse(missingIsland).success, true);

  const orphan = validPlan();
  orphan.actions[1] = { ...orphan.actions[1], person: "Alguien" };
  assert.equal(familyEmergencyPlanSchema.safeParse(orphan).success, false);
});

test("family plan list query treats empty filters as missing", () => {
  // Exactly what the results page sends with "Todos los registros" selected.
  const query = familyPlanListQuerySchema.parse({ search: "", island: "", page: "1", pageSize: "50" });
  assert.equal(query.island, undefined);
  assert.equal(query.page, 1);
  assert.equal(familyPlanListQuerySchema.parse({ island: "Isabela", from: "", to: "" }).island, "Isabela");
  assert.equal(familyPlanListQuerySchema.safeParse({ island: "Galápagos" }).success, false);
});

test("family plan PDF contains all sections across multiple pages", async () => {
  const bytes = await createFamilyPlanPdf(
    validPlan(),
    "a5b052a2-3874-429d-a871-ae103d323468",
    new Date("2026-10-12T15:00:00.000Z"),
  );
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString("ascii"), "%PDF");
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 2);
});
