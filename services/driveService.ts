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
  itemFolderId?: string
): Promise<UploadResult> {
  const adminDoc = await adminDb.collection("pma_admins").doc(adminId).get();
  if (!adminDoc.exists) {
    throw new Error("Admin not found");
  }

  const adminData = adminDoc.data()!;
  const rootFolderId = adminData.driveRootFolderId;

  if (!rootFolderId) {
    throw new Error("Google Drive root folder not configured");
  }

  const drive = await getAuthenticatedDrive(adminId);

  // If item already has its own Drive folder, upload directly there
  if (itemFolderId) {
    return uploadFile(drive, fileBuffer, fileName, mimeType, itemFolderId);
  }

  // Fallback: create folder under plan name (for items created before this feature)
  const planFolderId = await getOrCreateFolder(drive, planName, rootFolderId);
  return uploadFile(drive, fileBuffer, fileName, mimeType, planFolderId);
}

export async function createPlanDriveFolder(
  adminId: string,
  planName: string
): Promise<string> {
  const adminDoc = await adminDb.collection("pma_admins").doc(adminId).get();
  if (!adminDoc.exists) {
    throw new Error("Admin not found");
  }

  const adminData = adminDoc.data()!;
  const rootFolderId = adminData.driveRootFolderId;

  if (!rootFolderId) {
    throw new Error("Google Drive root folder not configured");
  }

  const drive = await getAuthenticatedDrive(adminId);
  return getOrCreateFolder(drive, planName, rootFolderId);
}

export async function createItemDriveFolder(
  adminId: string,
  itemName: string,
  planFolderId: string
): Promise<string> {
  const drive = await getAuthenticatedDrive(adminId);
  return getOrCreateFolder(drive, itemName, planFolderId);
}
