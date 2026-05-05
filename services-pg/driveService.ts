import { adminDb } from "@/lib/firebase-admin";
import {
  getAuthenticatedDrive,
  getOrCreateFolder,
  uploadFile,
} from "@/lib/drive-pg";

interface UploadResult {
  fileId: string;
  fileUrl: string;
}

const APP_FOLDER_NAME = "Plan Galapagos";
const DEFAULT_SUBSYSTEM_FOLDER_NAME = "Sin proceso";

function normalizeFolderName(name: string, fallback: string): string {
  const normalized = name.trim().replace(/[\\/]/g, "-");
  return normalized.length > 0 ? normalized : fallback;
}

async function getAdminRootFolderId(adminId: string): Promise<string> {
  const adminDoc = await adminDb.collection("pg_admins").doc(adminId).get();
  if (!adminDoc.exists) {
    throw new Error("Admin not found");
  }

  const adminData = adminDoc.data()!;
  const rootFolderId = adminData.driveRootFolderId as string | undefined;
  if (!rootFolderId) {
    throw new Error("Google Drive root folder not configured");
  }

  return rootFolderId;
}

async function ensureAppBaseFolder(
  adminId: string
): Promise<{ drive: Awaited<ReturnType<typeof getAuthenticatedDrive>>; appFolderId: string }> {
  const rootFolderId = await getAdminRootFolderId(adminId);
  const drive = await getAuthenticatedDrive(adminId);
  const appFolderId = await getOrCreateFolder(drive, APP_FOLDER_NAME, rootFolderId);
  return { drive, appFolderId };
}

async function moveFolderIfNeeded(
  drive: Awaited<ReturnType<typeof getAuthenticatedDrive>>,
  folderId: string,
  targetParentId: string
): Promise<void> {
  const metadata = await drive.files.get({
    fileId: folderId,
    fields: "id,parents",
  });

  const currentParents = metadata.data.parents ?? [];
  if (currentParents.length === 1 && currentParents[0] === targetParentId) {
    return;
  }

  const removeParents = currentParents.filter((parentId) => parentId !== targetParentId).join(",");

  await drive.files.update({
    fileId: folderId,
    addParents: targetParentId,
    ...(removeParents ? { removeParents } : {}),
    fields: "id,parents",
  });
}

export async function uploadEvidenceFile(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  adminId: string,
  planName: string,
  itemFolderId?: string
): Promise<UploadResult> {
  const adminDoc = await adminDb.collection("pg_admins").doc(adminId).get();
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
  const appFolderId = await getOrCreateFolder(drive, APP_FOLDER_NAME, rootFolderId);
  const defaultSubsystemId = await getOrCreateFolder(
    drive,
    DEFAULT_SUBSYSTEM_FOLDER_NAME,
    appFolderId
  );
  const planFolderId = await getOrCreateFolder(
    drive,
    normalizeFolderName(planName, "Plan"),
    defaultSubsystemId
  );
  return uploadFile(drive, fileBuffer, fileName, mimeType, planFolderId);
}

export async function createPlanDriveFolder(
  adminId: string,
  planName: string
): Promise<string> {
  return ensurePlanDriveFolder(adminId, planName, DEFAULT_SUBSYSTEM_FOLDER_NAME);
}

export async function ensurePlanDriveFolder(
  adminId: string,
  planName: string,
  subsystemName: string,
  existingPlanFolderId?: string
): Promise<string> {
  const { drive, appFolderId } = await ensureAppBaseFolder(adminId);
  const subsystemFolderId = await getOrCreateFolder(
    drive,
    normalizeFolderName(subsystemName, DEFAULT_SUBSYSTEM_FOLDER_NAME),
    appFolderId
  );

  if (existingPlanFolderId) {
    await moveFolderIfNeeded(drive, existingPlanFolderId, subsystemFolderId);
    return existingPlanFolderId;
  }

  return getOrCreateFolder(
    drive,
    normalizeFolderName(planName, "Plan"),
    subsystemFolderId
  );
}

export async function createItemDriveFolder(
  adminId: string,
  itemName: string,
  planFolderId: string
): Promise<string> {
  return ensureItemDriveFolder(adminId, itemName, planFolderId);
}

export async function ensureItemDriveFolder(
  adminId: string,
  itemName: string,
  planFolderId: string,
  existingItemFolderId?: string
): Promise<string> {
  const drive = await getAuthenticatedDrive(adminId);

  if (existingItemFolderId) {
    await moveFolderIfNeeded(drive, existingItemFolderId, planFolderId);
    return existingItemFolderId;
  }

  return getOrCreateFolder(drive, normalizeFolderName(itemName, "Item"), planFolderId);
}


