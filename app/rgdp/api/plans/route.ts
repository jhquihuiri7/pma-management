import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import {
  createPlan,
  getPlansByAdmin,
  getPlansForReporter,
  getPlansForViewer,
} from "@/services-rgdp/planService";
import { Plan } from "@/types";
import { RGDP_LOCATION_TREE } from "@/lib/rgdpProjectForm";

const GALAPAGOS = "Gal\u00e1pagos";

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  let plans;
  if (session.user.role === "ADMIN") {
    plans = await getPlansByAdmin(session.user.adminId);
  } else if (session.user.role === "VIEWER") {
    plans = await getPlansForViewer(session.user.id);
  } else {
    plans = await getPlansForReporter(session.user.id);
  }

  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const body = await req.json();

  const title = String(body?.title ?? "").trim();
  const description = String(body?.description ?? "").trim();
  const report_per = String(body?.report_per ?? "6 meses");
  const tipo = body?.tipo;
  const start_date = body?.start_date;
  const visualization_url = body?.visualization_url;

  const location = body?.location as Plan["location"] | undefined;
  const ciiu = body?.ciiu as Plan["ciiu"] | undefined;
  const zoneType = body?.zoneType as Plan["zoneType"] | undefined;
  const coordinateFormat = body?.coordinateFormat as string | undefined;
  const geographicArea = body?.geographicArea as Plan["geographicArea"] | undefined;
  const implantationArea = body?.implantationArea as Plan["implantationArea"] | undefined;

  if (title.length < 1 || title.length > 500) {
    return errorResponse("Nombre del proyecto: 1 a 500 caracteres");
  }

  if (description.length < 25 || description.length > 2500) {
    return errorResponse("Resumen del proyecto: 25 a 2500 caracteres");
  }

  if (!location || !isFilled(location.province) || !isFilled(location.canton) || !isFilled(location.parish)) {
    return errorResponse("Provincia, canton y parroquia son obligatorios");
  }

  if (location.province !== GALAPAGOS) {
    return errorResponse("La provincia debe ser Gal\u00e1pagos");
  }

  const allowedCantons = Object.keys(RGDP_LOCATION_TREE[GALAPAGOS] ?? {});
  if (!allowedCantons.includes(location.canton)) {
    return errorResponse("Cant\u00f3n inv\u00e1lido para la provincia Gal\u00e1pagos");
  }

  const allowedParishes = RGDP_LOCATION_TREE[GALAPAGOS]?.[location.canton] ?? [];
  if (!allowedParishes.includes(location.parish)) {
    return errorResponse("Parroquia inv\u00e1lida para el cant\u00f3n seleccionado");
  }

  if (!ciiu?.principal?.code || !ciiu.principal.description) {
    return errorResponse("Actividad principal CIIU es obligatoria");
  }

  const ciiuCodes = [
    ciiu.principal.code,
    ciiu.complementary1?.code,
    ciiu.complementary2?.code,
  ].filter((value): value is string => Boolean(value));

  if (new Set(ciiuCodes).size !== ciiuCodes.length) {
    return errorResponse("No se pueden repetir codigos CIIU entre actividad principal y complementarias");
  }

  if (!zoneType) {
    return errorResponse("Tipo de zona es obligatorio");
  }

  if (!coordinateFormat || !isFilled(coordinateFormat)) {
    return errorResponse("Formato de coordenadas es obligatorio");
  }

  try {
    const plan = await createPlan(
      session.user.adminId,
      title,
      description,
      report_per as Plan["report_per"],
      undefined,
      tipo,
      start_date,
      undefined,
      undefined,
      {
        location: {
          province: location.province,
          canton: location.canton,
          parish: location.parish,
          reference: location.reference?.trim() || "",
        },
        ciiu,
        zoneType,
        coordinateFormat,
        ...(geographicArea ? { geographicArea } : {}),
        ...(implantationArea ? { implantationArea } : {}),
      },
      visualization_url
    );

    return NextResponse.json(plan, { status: 201 });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
