import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import type { GeoMap } from "@/types/geo";

const COLLECTION = "geo_maps";

// PATCH /geo/api/maps/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();

    const docRef = adminDb.collection(COLLECTION).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "Map not found" }, { status: 404 });
    }

    await docRef.update({
      ...body,
      updatedAt: new Date().toISOString(),
    });

    const updatedDoc = await docRef.get();
    return NextResponse.json({
      id: updatedDoc.id,
      ...updatedDoc.data(),
    } as GeoMap);
  } catch (error) {
    console.error("Error updating map:", error);
    return NextResponse.json({ error: "Failed to update map" }, { status: 500 });
  }
}

// DELETE /geo/api/maps/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const docRef = adminDb.collection(COLLECTION).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "Map not found" }, { status: 404 });
    }

    await docRef.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting map:", error);
    return NextResponse.json({ error: "Failed to delete map" }, { status: 500 });
  }
}
