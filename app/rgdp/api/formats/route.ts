import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  errorResponse,
  forbiddenResponse,
} from "@/lib/api-utils";
import { adminDb } from "@/lib/firebase-admin";
import { getAuthenticatedDrive, getOrCreateFolder, uploadFile } from "@/lib/drive";
import { Format, FormatFunctionality } from "@/types";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const FUNCTIONALITY_LABELS: Record<FormatFunctionality, string> = {
  descargar_anexos: "Descargar Anexos",
};

// GET /api/formats "” list formats for the current admin
export async function GET() {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  try {
    const snapshot = await adminDb
      .collection("rgdp_formats")
      .where("adminId", "==", session.user.id)
      .orderBy("uploadedAt", "desc")
      .get();

    const formats: Format[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Format, "id">),
    }));

    return NextResponse.json(formats);
  } catch (error: unknown) {
    console.error("Error fetching formats:", error);
    return errorResponse("Error fetching formats", 500);
  }
}

// POST /api/formats "” upload a format file for a functionality
export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const functionality = formData.get("functionality") as FormatFunctionality | null;

    if (!file) return errorResponse("File is required");
    if (!functionality) return errorResponse("functionality is required");
    if (!FUNCTIONALITY_LABELS[functionality]) {
      return errorResponse("Invalid functionality");
    }
    if (file.size > MAX_FILE_SIZE) {
      return errorResponse("File size exceeds 20MB limit");
    }

    // Only accept Word documents
    const allowedMimeTypes = [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];
    if (!allowedMimeTypes.includes(file.type)) {
      return errorResponse("Only Word documents (.docx, .doc) are allowed");
    }

    // Get admin Drive root folder
    const adminDoc = await adminDb.collection("rgdp_admins").doc(session.user.id).get();
    if (!adminDoc.exists) return errorResponse("Admin not found", 404);
    const adminData = adminDoc.data() as { driveRootFolderId: string };

    if (!adminData.driveRootFolderId) {
      return errorResponse("Drive root folder not configured. Please create a project first.", 400);
    }

    const drive = await getAuthenticatedDrive(session.user.id);

    // Get or create the "formatos" folder under root
    const formatsFolderId = await getOrCreateFolder(
      drive,
      "formatos",
      adminData.driveRootFolderId
    );

    // Delete previous format for this functionality (if any) from Drive and Firestore
    const existing = await adminDb
      .collection("rgdp_formats")
      .where("adminId", "==", session.user.id)
      .where("functionality", "==", functionality)
      .get();

    for (const doc of existing.docs) {
      const data = doc.data() as Format;
      // Delete from Drive
      try {
        await drive.files.delete({ fileId: data.driveFileId });
      } catch {
        // Ignore if file already deleted from Drive
      }
      await doc.ref.delete();
    }

    // Convert File to Buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Upload to Drive "formatos" folder
    const { fileId, fileUrl } = await uploadFile(
      drive,
      buffer,
      file.name,
      file.type,
      formatsFolderId
    );

    // Save format record in Firestore
    const now = new Date().toISOString();
    const formatData: Omit<Format, "id"> = {
      adminId: session.user.id,
      functionality,
      functionalityLabel: FUNCTIONALITY_LABELS[functionality],
      driveFileId: fileId,
      driveUrl: fileUrl,
      fileName: file.name,
      formatsFolderId,
      uploadedAt: now,
    };

    const docRef = await adminDb.collection("rgdp_formats").add(formatData);

    return NextResponse.json({ id: docRef.id, ...formatData }, { status: 201 });
  } catch (error: unknown) {
    console.error("Error uploading format:", error);
    return errorResponse((error as Error).message || "Upload failed", 500);
  }
}

