import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: presence-only check of the access cookie issued by
 * apps/api. The real authentication and authorization (role/app) happen on
 * the backend; here we only avoid serving protected page shells to obviously
 * unauthenticated browsers and short-circuit redirects.
 *
 * We deliberately do NOT validate the JWT signature here — that requires the
 * Node crypto module which is unavailable in the Edge runtime, and any client
 * could in theory present an expired/forged token, but apps/api will reject
 * it on every data fetch.
 */

const ACCESS_COOKIE = "pma_access";
const APPS = ["pma", "rgdp", "pg", "pglp", "geo"] as const;

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAppPath = APPS.some((a) => pathname === `/${a}` || pathname.startsWith(`/${a}/`));
  const isSelectApp = pathname === "/select-app" || pathname.startsWith("/select-app/");
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  if (!isAppPath && !isSelectApp && !isAdminPath) return NextResponse.next();

  const hasCookie = Boolean(req.cookies.get(ACCESS_COOKIE)?.value);
  if (hasCookie) return NextResponse.next();
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/select-app",
    "/admin/:path*",
    "/pma/:path*",
    "/rgdp/:path*",
    "/pg/:path*",
    "/pglp/:path*",
    "/geo/:path*",
  ],
};
