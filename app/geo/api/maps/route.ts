import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import type { GeoMap } from "@/types/geo";

const COLLECTION = "geo_maps";

// GET /geo/api/maps
export async function GET() {
  try {
    const snapshot = await adminDb.collection(COLLECTION).orderBy("createdAt", "desc").get();
    const maps = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as GeoMap[];
    return NextResponse.json(maps);
  } catch (error) {
    console.error("Error fetching maps:", error);
    return NextResponse.json({ error: "Failed to fetch maps" }, { status: 500 });
  }
}

// POST /geo/api/maps
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { title, description, categoryId, arcgisUrl, tags, center, zoom } = body;

    if (!title || !categoryId) {
      return NextResponse.json(
        { error: "Title and categoryId are required" },
        { status: 400 }
      );
    }

    const newMap: Omit<GeoMap, "id"> = {
      title,
      description: description || "",
      categoryId,
      arcgisUrl: arcgisUrl || "",
      tags: tags || [],
      layers: [],
      center: center || [-1.8, -78.2],
      zoom: zoom || 7,
      createdBy: "Admin",
      createdAt: new Date().toISOString(),
    };

    const docRef = await adminDb.collection(COLLECTION).add(newMap);

    return NextResponse.json({ id: docRef.id, ...newMap }, { status: 201 });
  } catch (error) {
    console.error("Error creating map:", error);
    return NextResponse.json({ error: "Failed to create map" }, { status: 500 });
  }
}
