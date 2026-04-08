import { adminDb } from "@/lib/firebase-admin";
import {
  getAuthenticatedDrive,
  getOrCreateFolder,
  uploadFile,
} from "@/lib/drive";

interface UploadResult {
  fileId: string;
  fileUrl: string;
}

export async function uploadEvidenceFile(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  adminId: string,
  planName: string,
  reporterName: string
): Promise<UploadResult> {
  const adminDoc = await adminDb.collection("admins").doc(adminId).get();
  if (!adminDoc.exists) {
    throw new Error("Admin not found");
  }

  const adminData = adminDoc.data()!;
  const rootFolderId = adminData.driveRootFolderId;

  if (!rootFolderId) {
    throw new Error("Google Drive root folder not configured");
  }

  const drive = await getAuthenticatedDrive(adminId);

  // Create folder structure: Root / Plan Name / Reporter Name /
  const planFolderId = await getOrCreateFolder(drive, planName, rootFolderId);
  const reporterFolderId = await getOrCreateFolder(
    drive,
    reporterName,
    planFolderId
  );

  return uploadFile(drive, fileBuffer, fileName, mimeType, reporterFolderId);
}
