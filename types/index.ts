export type UserRole = 'ADMIN' | 'REPORTER';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  adminId: string;
  createdAt: string;
}

export interface Admin {
  id: string;
  email: string;
  name: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  tokenExpiresAt: number;
  driveRootFolderId: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  adminId: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Assignment {
  id: string;
  userId: string;
  planId: string;
  createdAt: string;
}

export interface Evidence {
  id: string;
  planId: string;
  uploadedBy: string;
  uploaderName: string;
  fileName: string;
  driveFileId: string;
  driveUrl: string;
  description: string;
  createdAt: string;
}
