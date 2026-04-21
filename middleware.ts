import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const isPath = (value: string) =>
      pathname === value || pathname.startsWith(`${value}/`);
    const isAnyPath = (values: string[]) => values.some((v) => isPath(v));
    const isRgdpPath = isPath("/rgdp");

    const loginUrl = new URL("/login", req.url);
    const selectAppUrl = new URL("/select-app", req.url);

    if (isRgdpPath) {
      const rgdpProtectedPaths = [
        "/rgdp/dashboard",
        "/rgdp/plans",
        "/rgdp/users",
        "/rgdp/evidences",
        "/rgdp/formatos",
      ];
      const rgdpAdminOnlyPaths = ["/rgdp/users", "/rgdp/formatos"];
      const isRgdpProtected = isAnyPath(rgdpProtectedPaths);
      const isRgdpAdminRoute = isAnyPath(rgdpAdminOnlyPaths);

      if (isRgdpProtected) {
        if (!token) return NextResponse.redirect(loginUrl);
        const apps: string[] = (token as { apps?: string[] }).apps ?? [];
        if (!apps.includes("rgdp")) return NextResponse.redirect(selectAppUrl);
        if (isRgdpAdminRoute && token.role !== "ADMIN") {
          return NextResponse.redirect(new URL("/rgdp/dashboard", req.url));
        }
      }

      return NextResponse.next();
    }

    // PMA protected paths
    const pmaPath = isPath("/pma");
    
    if (pmaPath) {
      const protectedPaths = [
        "/pma/dashboard",
        "/pma/plans",
        "/pma/users",
        "/pma/evidences",
        "/pma/formatos",
      ];
      const adminOnlyPaths = ["/pma/users", "/pma/formatos"];
      const isProtectedPath = isAnyPath(protectedPaths);
      const isAdminRoute = isAnyPath(adminOnlyPaths);

      if (isProtectedPath) {
        if (!token) return NextResponse.redirect(loginUrl);
        const apps: string[] = (token as { apps?: string[] }).apps ?? [];
        if (!apps.includes("pma")) return NextResponse.redirect(selectAppUrl);
        if (isAdminRoute && token.role !== "ADMIN") {
          return NextResponse.redirect(new URL("/pma/dashboard", req.url));
        }
      }

      return NextResponse.next();
    }

    // Protect select-app — must be authenticated
    if (isPath("/select-app") && !token) {
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: () => true,
    },
  }
);

export const config = {
  matcher: [
    "/api/auth/:path*",
    "/select-app",
    "/pma",
    "/pma/:path*",
    "/rgdp",
    "/rgdp/:path*",
  ],
};
