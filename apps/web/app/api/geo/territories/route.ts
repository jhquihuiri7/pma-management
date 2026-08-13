import { NextResponse, type NextRequest } from "next/server";

const INEC_DPA_SERVICE =
  "https://idgn.ecuadorencifras.gob.ec/server/rest/services/Hosted/DPA_2020/FeatureServer";
const CACHE_SECONDS = 60 * 60 * 24 * 30;

type TerritoryLevel = "provinces" | "cantons";

interface ArcGisFeature {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry?: unknown;
}

interface ArcGisFeatureCollection {
  type?: string;
  features?: ArcGisFeature[];
  error?: { message?: string; details?: string[] };
}

function requestDefinition(level: TerritoryLevel, province: string | null) {
  if (level === "provinces") {
    return {
      layer: "0",
      where: "1=1",
      fields: "provincia,nom_pro",
      codeField: "provincia",
      nameField: "nom_pro",
      tolerance: "0.01",
    } as const;
  }

  if (!province || !/^\d{2}$/.test(province)) return null;
  return {
    layer: "1",
    where: `canton LIKE '${province}%'`,
    fields: "canton,nom_can",
    codeField: "canton",
    nameField: "nom_can",
    tolerance: "0.005",
  } as const;
}

export async function GET(request: NextRequest) {
  const level = request.nextUrl.searchParams.get("level") as TerritoryLevel | null;
  if (level !== "provinces" && level !== "cantons") {
    return NextResponse.json(
      { message: "El nivel territorial debe ser provinces o cantons." },
      { status: 400 },
    );
  }

  const definition = requestDefinition(
    level,
    request.nextUrl.searchParams.get("province"),
  );
  if (!definition) {
    return NextResponse.json(
      { message: "Se requiere un código provincial de dos dígitos." },
      { status: 400 },
    );
  }

  const query = new URLSearchParams({
    where: definition.where,
    outFields: definition.fields,
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "5",
    maxAllowableOffset: definition.tolerance,
    f: "geojson",
  });

  try {
    const response = await fetch(
      `${INEC_DPA_SERVICE}/${definition.layer}/query?${query.toString()}`,
      { next: { revalidate: CACHE_SECONDS } },
    );
    if (!response.ok) throw new Error(`INEC respondió HTTP ${response.status}`);

    const collection = (await response.json()) as ArcGisFeatureCollection;
    if (collection.error) {
      throw new Error(collection.error.message || "Consulta territorial rechazada por INEC");
    }

    const features = (collection.features ?? []).flatMap((feature) => {
      const code = feature.properties?.[definition.codeField];
      const name = feature.properties?.[definition.nameField];
      if (typeof code !== "string" || typeof name !== "string" || !feature.geometry) {
        return [];
      }
      return [{ code, name, geometry: feature.geometry }];
    });

    return NextResponse.json(
      {
        level,
        source: "INEC · División Político Administrativa 2020",
        sourceUrl: `${INEC_DPA_SERVICE}/${definition.layer}`,
        crs: "EPSG:4326",
        features,
      },
      {
        headers: {
          "Cache-Control": `public, max-age=86400, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=604800`,
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        message: "No se pudieron obtener los límites territoriales del INEC.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
