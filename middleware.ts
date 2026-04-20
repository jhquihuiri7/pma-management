import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const isPath = (value: string) => pathname === value || pathname.startsWith(`${value}/`);
    const isAnyPath = (values: string[]) => values.some((value) => isPath(value));
    const isRgdpPath = isPath("/rgdp");

    // Accept OAuth callbacks without basePath and forward them to the real NextAuth route.
    if (pathname.startsWith("/api/auth/")) {
      const rewriteUrl = req.nextUrl.clone();
      rewriteUrl.pathname = `/pma${pathname}`;
      return NextResponse.rewrite(rewriteUrl);
    }

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

      if (isRgdpProtected && !token) {
        return NextResponse.redirect(new URL("/rgdp/login", req.url));
      }

      if (isRgdpAdminRoute && token?.role !== "ADMIN") {
        return NextResponse.redirect(new URL("/rgdp/dashboard", req.url));
      }

      const rewriteUrl = req.nextUrl.clone();
      rewriteUrl.pathname = `/pma${pathname}`;
      return NextResponse.rewrite(rewriteUrl);
    }

    // Protect admin-only routes
    const protectedPaths = [
      "/dashboard",
      "/plans",
      "/users",
      "/evidences",
      "/formatos",
      "/pma/dashboard",
      "/pma/plans",
      "/pma/users",
      "/pma/evidences",
      "/pma/formatos",
    ];
    const adminOnlyPaths = ["/users", "/formatos", "/pma/users", "/pma/formatos"];
    const isProtectedPath = isAnyPath(protectedPaths);
    const isAdminRoute = isAnyPath(adminOnlyPaths);

    if (isProtectedPath && !token) {
      return NextResponse.redirect(new URL("/pma/login", req.url));
    }

    if (isAdminRoute && token?.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/pma/dashboard", req.url));
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
    "/dashboard/:path*",
    "/plans/:path*",
    "/users/:path*",
    "/evidences/:path*",
    "/formatos/:path*",
    "/rgdp",
    "/rgdp/:path*",
  ],
};
