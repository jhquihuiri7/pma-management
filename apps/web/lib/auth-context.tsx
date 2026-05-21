"use client";

/**
 * AuthProvider + useAuth — the replacement for `next-auth/react`'s useSession.
 *
 * This is NOT wired into the live app yet. NextAuth + Firestore is still the
 * source of truth in production. After the Phase 7 cut, swap the root layout
 * from `<SessionProvider>` (NextAuth) to `<AuthProvider>` (this file) and
 * update components from `useSession()` to `useAuth()`.
 *
 * Flow:
 *  - On mount, calls GET /auth/me to discover the current user from cookies.
 *  - login()/logout() proxy through `auth-client.ts` (which talks to apps/api).
 *  - The api-client transparently refreshes access tokens on 401.
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { auth as authApi, ApiError } from "./api-client";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "REPORTER" | "VIEWER";
  adminId: string;
  apps: Array<"pma" | "rgdp" | "geo">;
};

interface AuthState {
  user: AuthUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  login(email: string, password: string): Promise<AuthUser>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");

  const refresh = useCallback(async () => {
    try {
      const res = await authApi.me();
      const me = res.user;
      const id = me.sub ?? me.id;
      if (!id) {
        setUser(null);
        setStatus("unauthenticated");
        return;
      }
      setUser({
        id,
        email: me.email,
        name: me.name,
        role: me.role,
        adminId: me.adminId,
        apps: me.apps,
      });
      setStatus("authenticated");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setStatus("unauthenticated");
      } else {
        setStatus("unauthenticated");
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    const u: AuthUser = {
      id: res.user.id,
      email: res.user.email,
      name: res.user.name,
      role: res.user.role as AuthUser["role"],
      adminId: res.user.adminId,
      apps: res.user.apps as AuthUser["apps"],
    };
    setUser(u);
    setStatus("authenticated");
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
