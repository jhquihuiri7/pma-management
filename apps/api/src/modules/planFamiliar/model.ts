import { z } from "zod";

const optionalText = z.string().trim().max(500);
const requiredText = optionalText.min(1, "Completen este campo");
const jpegDataUrl = z.string().max(1_500_000).refine(
  (value) => value === "" || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value),
  "La imagen debe ser JPEG",
);
const pngDataUrl = z.string().max(300_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "La firma debe ser PNG");

export const FAMILY_PLAN_ISLANDS = [
  "San Cristóbal",
  "Santa Cruz",
  "Isabela",
  "Floreana",
  "Otra",
] as const;

export const FAMILY_PLAN_RESOURCE_NAMES = [
  "Agua y alimentos no perecibles",
  "Linterna y pilas",
  "Radio o cargador portátil",
  "Botiquín y medicinas personales",
  "Documentos protegidos o copias",
  "Mascarillas, silbato y abrigo",
  "Llaves y dinero en efectivo",
  "Artículos para bebé, adulto mayor o mascota",
  "Otro recurso importante",
] as const;

export const familyEmergencyPlanSchema = z.object({
  submissionId: z.string().uuid(),
  family: requiredText,
  island: z.enum(FAMILY_PLAN_ISLANDS),
  sector: requiredText,
  address: requiredText,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone: z.string().trim().min(7).max(30),
  altPhone: optionalText,
  contact: requiredText,
  contactPhone: z.string().trim().min(7).max(30),
  meeting: requiredText,
  noSignal: requiredText,
  members: z.array(z.object({
    name: requiredText,
    age: z.coerce.number().int().min(0).max(120),
    relation: requiredText,
    phone: optionalText,
    support: optionalText,
    role: requiredText,
  }).strict()).min(1).max(30),
  pets: z.array(z.object({
    name: requiredText,
    keeper: requiredText,
    needs: requiredText,
  }).strict()).max(15),
  risks: z.array(z.object({
    type: requiredText,
    effect: requiredText,
    prevention: requiredText,
    first: requiredText,
    priority: z.enum(["Alta", "Media", "Baja"]),
  }).strict()).min(1).max(3),
  // Sismo, Tsunami, Inundación o lluvia intensa, Incendio u otra emergencia.
  routes: z.array(z.object({
    situation: requiredText,
    route: requiredText,
    point: requiredText,
    notice: requiredText,
  }).strict()).length(4),
  sketch: jpegDataUrl,
  reference: optionalText,
  location: z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    snapshot: jpegDataUrl,
    layer: z.enum(["Mapa", "Satélite"]),
  }).strict().nullable(),
  resources: z.array(z.object({
    item: requiredText,
    status: z.enum(["Sí", "No"]),
    amount: optionalText,
    location: optionalText,
  }).strict()).length(FAMILY_PLAN_RESOURCE_NAMES.length),
  usefulPhones: optionalText,
  actions: z.array(z.object({
    moment: z.enum(["Antes", "Durante", "Después"]),
    action: optionalText,
    person: optionalText,
  }).strict()).min(6).max(20),
  // The next drill; what to improve is handwritten on the printed plan after it.
  practice: z.object({
    date: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/),
    exercise: optionalText,
    person: optionalText,
  }).strict(),
  signature: pngDataUrl,
  consent: z.literal(true),
}).strict().superRefine((plan, context) => {
  // Responsibilities go to the household members registered in the plan.
  const isMember = (name: string) => plan.members.some((member) => member.name === name);
  const notMember = "Elijan a uno de los integrantes registrados";
  if (!plan.actions.some((action) => action.action)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["actions", 0, "action"],
      message: "Anoten al menos una acción concreta",
    });
  }
  plan.actions.forEach((action, index) => {
    if (action.action && !action.person) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actions", index, "person"],
        message: "Indiquen quién se responsabiliza de esta acción",
      });
    }
    if (!action.action && action.person) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actions", index, "action"],
        message: "Describan esta acción",
      });
    }
    if (action.person && !isMember(action.person)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["actions", index, "person"], message: notMember });
    }
  });
  plan.pets.forEach((pet, index) => {
    if (!isMember(pet.keeper)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["pets", index, "keeper"], message: notMember });
    }
  });
  if (plan.practice.person && !isMember(plan.practice.person)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["practice", "person"], message: notMember });
  }
});

export const familyEmergencyDownloadTokenSchema = z.object({
  downloadToken: z.string().uuid(),
}).passthrough();

// The results page builds its query with URLSearchParams, which sends every
// filter: "Todos los registros" arrives as `island=`, and `.optional()` alone
// only accepts a missing key, so the empty string was a 400 ValidationError.
const blankAsMissing = (value: unknown) => (value === "" ? undefined : value);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const familyPlanListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(100).optional(),
  island: z.preprocess(blankAsMissing, z.enum(FAMILY_PLAN_ISLANDS).optional()),
  from: z.preprocess(blankAsMissing, isoDate.optional()),
  to: z.preprocess(blankAsMissing, isoDate.optional()),
}).strict();

export type FamilyEmergencyPlanInput = z.infer<typeof familyEmergencyPlanSchema>;
export type FamilyPlanListQuery = z.infer<typeof familyPlanListQuerySchema>;
