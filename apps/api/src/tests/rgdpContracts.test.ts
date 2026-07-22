import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAnnualGenerationTotal,
  exceedsAnnualGenerationLimit,
  validateMonthlyGenerationPeriod,
} from "../modules/rgdp/monthlyGenerationPolicy.js";
import {
  toMonthlyGenerationApi,
  toRgdpPlanApi,
  toRgdpPlanItemApi,
} from "../modules/rgdp/serializers.js";
import {
  findRgdtCatalogMatch,
  parseRgdtWasteCatalogCsv,
} from "../modules/rgdp/wasteCatalogModule.js";
import { toCanonicalRgdpPlanItemInput } from "../modules/rgdp/wasteItemContract.js";
import { toFormatApi } from "../modules/shared/formatContract.js";

test("RGDP serializers expose snake_case fields and numeric JSON values", () => {
  const createdAt = new Date("2026-01-15T12:00:00.000Z");
  const updatedAt = new Date("2026-02-15T12:00:00.000Z");
  const plan = toRgdpPlanApi({
    id: "plan-id",
    createdBy: "admin-id",
    title: "Plan",
    description: "Descripción",
    tipo: "Licencia",
    fase: "Operación",
    enfoque: "Controlar impactos",
    reportPer: "1 año",
    startDate: "2026-01-15",
    visualizationUrl: "https://example.test/map",
    storagePath: "RGDP/plan-id",
    location: null,
    ciiu: null,
    zoneType: null,
    coordinateFormat: null,
    geographicArea: null,
    implantationArea: null,
    createdAt,
    updatedAt,
  } as unknown as Parameters<typeof toRgdpPlanApi>[0]);

  assert.equal(plan.report_per, "1 año");
  assert.equal(plan.start_date, "2026-01-15");
  assert.equal(plan.visualization_url, "https://example.test/map");
  assert.equal((plan as unknown as Record<string, unknown>).reportPer, undefined);

  const item = toRgdpPlanItemApi({
    id: "item-id",
    planId: "plan-id",
    item: "NE-01 - Aceite",
    subplan: "RGDT",
    direccion: "Taller",
    environmentalActivity: "Aceite",
    identifiedEnvironmentalImpact: "Descripción",
    proposedMeasure: "Descripción",
    indicator: "T,I",
    verificationMethod: "Taller",
    periodicity: "Mensual",
    budget: "125.50",
    reportPer: "1 año",
    observation: null,
    storagePath: null,
    wasteCode: "NE-01",
    wasteName: "Aceite",
    wasteDescription: "Descripción",
    crtib: "T,I",
    annualGenerationKg: "1250.375",
    generationOrigin: "Taller",
    selfManagement: true,
    createdAt,
    updatedAt,
  } as unknown as Parameters<typeof toRgdpPlanItemApi>[0]);

  assert.equal(item.environmental_activity, "Aceite");
  assert.equal(item.report_per, "1 año");
  assert.equal(item.budget, 125.5);
  assert.equal(item.annualGenerationKg, 1250.375);
  assert.deepEqual(item.assignedUsers, []);

  const monthly = toMonthlyGenerationApi(
    {
      planItemId: "item-id",
      periodKey: "2026-02",
      generationKg: "10.125",
      updatedAt,
    },
    "plan-id"
  );
  assert.deepEqual(monthly, {
    id: "item-id:2026-02",
    planId: "plan-id",
    planItemId: "item-id",
    periodKey: "2026-02",
    generationKg: 10.125,
    updatedAt: updatedAt.toISOString(),
  });
});

test("monthly generation policy rejects invalid ranges and replaces a month in its calendar year", () => {
  assert.throws(
    () => validateMonthlyGenerationPeriod({ periodKey: "2026-7", planStartMonth: "2026-01", currentMonth: "2026-07" }),
    /YYYY-MM/
  );
  assert.throws(
    () => validateMonthlyGenerationPeriod({ periodKey: "2025-12", planStartMonth: "2026-01", currentMonth: "2026-07" }),
    /anterior/
  );
  assert.throws(
    () => validateMonthlyGenerationPeriod({ periodKey: "2026-08", planStartMonth: "2026-01", currentMonth: "2026-07" }),
    /futuro/
  );
  assert.doesNotThrow(() =>
    validateMonthlyGenerationPeriod({ periodKey: "2026-07", planStartMonth: "2026-01", currentMonth: "2026-07" })
  );

  const total = calculateAnnualGenerationTotal({
    periodKey: "2026-02",
    generationKg: 4.005,
    records: [
      { periodKey: "2025-12", generationKg: 999 },
      { periodKey: "2026-01", generationKg: 5.005 },
      { periodKey: "2026-02", generationKg: 100 },
    ],
  });
  assert.equal(total, 9.01);
  assert.equal(exceedsAnnualGenerationLimit(total, 9.01), false);
  assert.equal(exceedsAnnualGenerationLimit(total, 9.009), true);
});

test("RGDT catalog parsing and canonical item mapping preserve the public contract", () => {
  const catalog = parseRgdtWasteCatalogCsv(
    '\uFEFFDESCRIPCION;CRTIB;CODIGO\n"Aceite; mineral";T,I;NE-01\nDuplicado;C;NE-02\nDuplicado;C;NE-02\n'
  );
  assert.deepEqual(catalog, [
    { codigo: "NE-01", descripcion: "Aceite; mineral", crtib: "T,I" },
    { codigo: "NE-02", descripcion: "Duplicado", crtib: "C" },
  ]);
  assert.deepEqual(
    findRgdtCatalogMatch(catalog, {
      codigo: " ne-01 ",
      descripcion: "ACEITE; MINERAL",
      crtib: "t,i",
    }),
    catalog[0]
  );
  assert.equal(
    findRgdtCatalogMatch(catalog, { codigo: "NE-01", descripcion: "Otro", crtib: "T,I" }),
    null
  );

  const item = toCanonicalRgdpPlanItemInput(
    {
      wasteCode: " NE-01 ",
      wasteName: " Aceite mineral ",
      wasteDescription: " ",
      crtib: " T,I ",
      annualGenerationKg: 50.25,
      generationOrigin: " Taller ",
      selfManagement: true,
    },
    "6 meses"
  );
  assert.equal(item.item, "NE-01 - Aceite mineral");
  assert.equal(item.report_per, "6 meses");
  assert.equal(item.annualGenerationKg, 50.25);
  assert.equal(item.identified_environmental_impact, "-");
});

test("format serializer returns one stable DTO for PMA and RGDP consumers", () => {
  const uploadedAt = new Date("2026-07-20T10:00:00.000Z");
  const dto = toFormatApi(
    {
      id: "format-id",
      createdBy: "admin-id",
      functionality: "descargar_anexos",
      functionalityLabel: "Descargar Anexos",
      storagePath: "RGDP/_formats/format-id/modelo.docx",
      fileName: "modelo.docx",
      uploadedAt,
    },
    "/storage/RGDP/_formats/format-id/modelo.docx"
  );
  assert.equal(dto.driveFileId, dto.storagePath);
  assert.equal(dto.formatsFolderId, "RGDP/_formats/format-id");
  assert.equal(dto.uploadedAt, uploadedAt.toISOString());
});
