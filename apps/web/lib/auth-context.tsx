"use client";

/**
 * AuthProvider + useAuth — the replacement for `next-auth/react`'s useSession.
 *
 * Flow:
 *  - On mount, calls GET /auth/me to discover the current user from cookies.
 *  - login()/logout() proxy through `auth-client.ts` (which talks to apps/api).
 *  - The api-client transparently refreshes access tokens on 401.
 */

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { auth as authApi, ApiError, apiErrorMessage } from "./api-client";

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
  logout(): Promise<boolean>;
  logoutPending: boolean;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [logoutPending, setLogoutPending] = useState(false);
  const logoutPendingRef = useRef(false);
  const router = useRouter();

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
        toast.error(apiErrorMessage(err, "No se pudo verificar la sesión"));
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
    if (logoutPendingRef.current) return false;
    logoutPendingRef.current = true;
    setLogoutPending(true);
    try {
      await authApi.logout();
      setUser(null);
      setStatus("unauthenticated");
      router.push("/login");
      return true;
    } catch (error) {
      toast.error(apiErrorMessage(error, "No se pudo cerrar la sesión"));
      return false;
    } finally {
      logoutPendingRef.current = false;
      setLogoutPending(false);
    }
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, status, login, logout, logoutPending, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
