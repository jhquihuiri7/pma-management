import { DefaultSession } from "next-auth";
import { AppKey, UserRole } from ".";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      adminId: string;
      apps: AppKey[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    adminId: string;
    apps: AppKey[];
  }
}
