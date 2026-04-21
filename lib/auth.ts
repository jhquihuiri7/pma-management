import { NextAuthOptions } from "next-auth";
import { AppKey, UserRole } from "@/types";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { adminDb } from "./firebase-admin";
import { createRootFolder as createPmaRootFolder } from "./drive";
import { createRootFolder as createRgdpRootFolder } from "./drive-rgdp";
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

        const snapshot = await adminDb
          .collection("users")
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
          apps: user.apps || [],
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({
          access_token: account.access_token,
          refresh_token: account.refresh_token,
        });
        const drive = google.drive({ version: "v3", auth: oauth2Client });

        const tokenData: Record<string, unknown> = {
          googleAccessToken: account.access_token,
          tokenExpiresAt: account.expires_at
            ? account.expires_at * 1000
            : Date.now() + 3600 * 1000,
        };
        if (account.refresh_token) {
          tokenData.googleRefreshToken = account.refresh_token;
        }

        // Ensure entry in pma_admins
        const pmaAdminRef = adminDb.collection("pma_admins").doc(user.id);
        const pmaAdminDoc = await pmaAdminRef.get();
        if (!pmaAdminDoc.exists) {
          const rootFolderId = await createPmaRootFolder(drive);
          await pmaAdminRef.set({
            id: user.id,
            email: user.email,
            name: user.name,
            ...tokenData,
            driveRootFolderId: rootFolderId,
            createdAt: new Date().toISOString(),
          });
        } else {
          const existing = pmaAdminDoc.data()!;
          const update = { ...tokenData };
          if (!existing.driveRootFolderId) {
            (update as Record<string, unknown>).driveRootFolderId =
              await createPmaRootFolder(drive);
          }
          await pmaAdminRef.update(update);
        }

        // Ensure entry in rgdp_admins
        const rgdpAdminRef = adminDb.collection("rgdp_admins").doc(user.id);
        const rgdpAdminDoc = await rgdpAdminRef.get();
        if (!rgdpAdminDoc.exists) {
          const rootFolderId = await createRgdpRootFolder(drive);
          await rgdpAdminRef.set({
            id: user.id,
            email: user.email,
            name: user.name,
            ...tokenData,
            driveRootFolderId: rootFolderId,
            createdAt: new Date().toISOString(),
          });
        } else {
          const existing = rgdpAdminDoc.data()!;
          const update = { ...tokenData };
          if (!existing.driveRootFolderId) {
            (update as Record<string, unknown>).driveRootFolderId =
              await createRgdpRootFolder(drive);
          }
          await rgdpAdminRef.update(update);
        }

        // Ensure unified users record for admin
        await adminDb
          .collection("users")
          .doc(user.id)
          .set(
            {
              id: user.id,
              name: user.name,
              email: user.email,
              role: "ADMIN",
              adminId: user.id,
              apps: ["pma", "rgdp"],
              createdAt: new Date().toISOString(),
            },
            { merge: true }
          );
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        if (account?.provider === "google") {
          token.role = "ADMIN" as UserRole;
          token.adminId = user.id;
          token.apps = ["pma", "rgdp"];
        } else {
          token.role = (user as unknown as { role: UserRole }).role;
          token.adminId = (user as unknown as { adminId: string }).adminId;
          token.apps = (user as unknown as { apps?: AppKey[] }).apps || [];
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.adminId = token.adminId;
        session.user.apps = token.apps || [];
      }
      return session;
    },
  },
};
