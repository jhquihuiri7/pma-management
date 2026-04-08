import { google } from "googleapis";
import { adminDb } from "./firebase-admin";
import { Readable } from "stream";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

interface TokenData {
  googleAccessToken: string;
  googleRefreshToken: string;
  tokenExpiresAt: number;
}

export async function getAuthenticatedDrive(adminId: string) {
  const adminDoc = await adminDb.collection("admins").doc(adminId).get();
  if (!adminDoc.exists) {
    throw new Error("Admin not found");
  }

  const data = adminDoc.data() as TokenData;
  oauth2Client.setCredentials({
    access_token: data.googleAccessToken,
    refresh_token: data.googleRefreshToken,
  });

  // Refresh token if expired
  if (data.tokenExpiresAt < Date.now()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await adminDb.collection("admins").doc(adminId).update({
      googleAccessToken: credentials.access_token,
      tokenExpiresAt: credentials.expiry_date || Date.now() + 3600 * 1000,
    });
    oauth2Client.setCredentials(credentials);
  }

  return google.drive({ version: "v3", auth: oauth2Client });
}

export async function createFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string
): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  return res.data.id!;
}

export async function findFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string
): Promise<string | null> {
  const res = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });
  return res.data.files?.[0]?.id || null;
}

export async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string
): Promise<string> {
  const existing = await findFolder(drive, name, parentId);
  if (existing) return existing;
  return createFolder(drive, name, parentId);
}

export async function createRootFolder(
  drive: ReturnType<typeof google.drive>
): Promise<string> {
  // Check if root folder already exists
  const res = await drive.files.list({
    q: `name='Environmental Management App' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`,
    fields: "files(id)",
  });

  if (res.data.files?.length) {
    return res.data.files[0].id!;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: "Environmental Management App",
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });
  return folder.data.id!;
}

export async function uploadFile(
  drive: ReturnType<typeof google.drive>,
  file: Buffer,
  fileName: string,
  mimeType: string,
  folderId: string
): Promise<{ fileId: string; fileUrl: string }> {
  const stream = Readable.from(file);

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: "id, webViewLink",
  });

  // Make file viewable via link
  await drive.permissions.create({
    fileId: res.data.id!,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  return {
    fileId: res.data.id!,
    fileUrl: res.data.webViewLink!,
  };
}
