import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;
    const isPath = (value: string) => pathname === value || pathname.startsWith(`${value}/`);
    const isAnyPath = (values: string[]) => values.some((value) => isPath(value));
    const isApiRoute = pathname.startsWith("/pma/api") || pathname.startsWith("/rgdp/api") || pathname.startsWith("/pg/api") || pathname.startsWith("/geo/api");

    const loginUrl = new URL("/login", req.url);
    const selectAppUrl = new URL("/select-app", req.url);

    const denyUnauthenticated = () =>
      isApiRoute
        ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        : NextResponse.redirect(loginUrl);

    const denyAppAccess = () =>
      isApiRoute
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : NextResponse.redirect(selectAppUrl);

    const denyRoleAccess = (fallbackPath: string) =>
      isApiRoute
        ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
        : NextResponse.redirect(new URL(fallbackPath, req.url));

    if (isPath("/select-app") && !token) {
      return NextResponse.redirect(loginUrl);
    }

    if (isPath("/pma")) {
      if (!token) return denyUnauthenticated();

      const apps: string[] = (token as { apps?: string[] }).apps ?? [];
      if (!apps.includes("pma")) return denyAppAccess();

      const pmaAdminOnlyPaths = [
        "/pma/users",
        "/pma/formatos",
        "/pma/api/users",
        "/pma/api/formats",
      ];

      if (isAnyPath(pmaAdminOnlyPaths) && token.role !== "ADMIN") {
        return denyRoleAccess("/pma/dashboard");
      }

      return NextResponse.next();
    }

    if (isPath("/rgdp")) {
      if (!token) return denyUnauthenticated();

      const apps: string[] = (token as { apps?: string[] }).apps ?? [];
      if (!apps.includes("rgdp")) return denyAppAccess();

      const rgdpAdminOnlyPaths = [
        "/rgdp/users",
        "/rgdp/formatos",
        "/rgdp/api/users",
        "/rgdp/api/formats",
      ];

      if (isAnyPath(rgdpAdminOnlyPaths) && token.role !== "ADMIN") {
        return denyRoleAccess("/rgdp/dashboard");
      }

      return NextResponse.next();
    }

    if (isPath("/pg")) {
      if (!token) return denyUnauthenticated();

      const apps: string[] = (token as { apps?: string[] }).apps ?? [];
      if (!apps.includes("pg")) return denyAppAccess();

      const pgAdminOnlyPaths = [
        "/pg/users",
        "/pg/formatos",
        "/pg/api/users",
        "/pg/api/formats",
      ];

      if (isAnyPath(pgAdminOnlyPaths) && token.role !== "ADMIN") {
        return denyRoleAccess("/pg/dashboard");
      }

      return NextResponse.next();
    }

    if (isPath("/geo")) {
      if (!token) return denyUnauthenticated();

      const apps: string[] = (token as { apps?: string[] }).apps ?? [];
      if (!apps.includes("geo")) return denyAppAccess();

      const geoAdminOnlyPaths = ["/geo/api/maps/create"];

      if (isAnyPath(geoAdminOnlyPaths) && token.role !== "ADMIN") {
        return denyRoleAccess("/geo/maps");
      }

      return NextResponse.next();
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
  matcher: ["/api/auth/:path*", "/select-app", "/pma", "/pma/:path*", "/rgdp", "/rgdp/:path*", "/pg", "/pg/:path*", "/geo", "/geo/:path*"],
};
