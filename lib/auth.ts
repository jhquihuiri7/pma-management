import { NextAuthOptions } from "next-auth";
import { UserRole } from "@/types";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { adminDb } from "./firebase-admin";
import { createRootFolder } from "./drive";
import { google } from "googleapis";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const usersRef = adminDb.collection("pma_users");
        const snapshot = await usersRef
          .where("email", "==", credentials.email)
          .limit(1)
          .get();

        if (snapshot.empty) {
          throw new Error("Invalid credentials");
        }

        const userDoc = snapshot.docs[0];
        const user = userDoc.data();

        if (user.role !== "REPORTER" && user.role !== "VIEWER") {
          throw new Error("Invalid credentials");
        }

        if (user.passwordSet === false) {
          throw new Error("PASSWORD_NOT_SET");
        }

        const isValid = await bcrypt.compare(
          credentials.password,
          user.password
        );
        if (!isValid) {
          throw new Error("Invalid credentials");
        }

        return {
          id: userDoc.id,
          email: user.email,
          name: user.name,
          role: user.role,
          adminId: user.adminId,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Handle Google OAuth sign-in for ADMIN
      if (account?.provider === "google") {
        const adminRef = adminDb.collection("pma_admins").doc(user.id);
        const adminDoc = await adminRef.get();

        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({
          access_token: account.access_token,
          refresh_token: account.refresh_token,
        });
        const drive = google.drive({ version: "v3", auth: oauth2Client });

        if (!adminDoc.exists) {
          // First-time ADMIN setup
          const rootFolderId = await createRootFolder(drive);

          await adminRef.set({
            id: user.id,
            email: user.email,
            name: user.name,
            googleAccessToken: account.access_token,
            googleRefreshToken: account.refresh_token,
            tokenExpiresAt: account.expires_at
              ? account.expires_at * 1000
              : Date.now() + 3600 * 1000,
            driveRootFolderId: rootFolderId,
            createdAt: new Date().toISOString(),
          });

          // Also create a user record for the ADMIN
          await adminDb.collection("pma_users").doc(user.id).set({
            id: user.id,
            name: user.name,
            email: user.email,
            role: "ADMIN",
            adminId: user.id,
            createdAt: new Date().toISOString(),
          });
        } else {
          // Existing ADMIN - update tokens
          const updateData: Record<string, unknown> = {
            googleAccessToken: account.access_token,
            tokenExpiresAt: account.expires_at
              ? account.expires_at * 1000
              : Date.now() + 3600 * 1000,
          };
          if (account.refresh_token) {
            updateData.googleRefreshToken = account.refresh_token;
          }

          // Ensure root folder still exists
          const existingData = adminDoc.data()!;
          if (!existingData.driveRootFolderId) {
            const rootFolderId = await createRootFolder(drive);
            updateData.driveRootFolderId = rootFolderId;
          }

          await adminRef.update(updateData);
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        if (account?.provider === "google") {
          token.role = "ADMIN";
          token.adminId = user.id;
        } else {
          // Credentials provider (REPORTER)
          token.role = (user as unknown as { role: UserRole }).role;
          token.adminId = (user as unknown as { adminId: string }).adminId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.adminId = token.adminId;
      }
      return session;
    },
  },
};
