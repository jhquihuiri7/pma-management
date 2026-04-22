import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  errorResponse,
  forbiddenResponse,
} from "@/lib/api-utils";
import { adminDb } from "@/lib/firebase-admin";
import { getAuthenticatedDrive } from "@/lib/drive";
import { Format } from "@/types";

// DELETE /api/formats/[id] "” remove a format (from Firestore and Drive)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  try {
    const { id } = params;
    const docRef = adminDb.collection("rgdp_formats").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) return errorResponse("Format not found", 404);

    const data = doc.data() as Format;
    if (data.adminId !== session.user.id) return forbiddenResponse();

    // Delete from Drive
    try {
      const drive = await getAuthenticatedDrive(session.user.id);
      await drive.files.delete({ fileId: data.driveFileId });
    } catch {
      // Ignore Drive deletion errors (file may already be gone)
    }

    // Delete from Firestore
    await docRef.delete();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Error deleting format:", error);
    return errorResponse((error as Error).message || "Delete failed", 500);
  }
}
