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
 *
 * Rules:
 *  - Unauthenticated: every route is blocked except the auth pages and the
 *    public sections below.
 *  - Authenticated: hitting "/" or an auth page redirects to "/select-app".
 */

const ACCESS_COOKIE = "pma_access";

// Pages reachable without a session (login flow). Everything else is gated.
const AUTH_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/set-password",
];

// Sections browsable without a session. The Geoportal is public in read-only
// mode; edit/delete/add controls are gated client-side and on the API by role.
const PUBLIC_PATHS = ["/geo"];

function matchesPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isAuthPath(pathname: string) {
  return matchesPrefix(pathname, AUTH_PATHS);
}

function isPublicPath(pathname: string) {
  return matchesPrefix(pathname, PUBLIC_PATHS);
}

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = Boolean(req.cookies.get(ACCESS_COOKIE)?.value);
  const onAuthPath = isAuthPath(pathname);

  if (hasCookie) {
    // Logged in: the landing route and the auth pages all funnel to select-app.
    if (pathname === "/" || onAuthPath) {
      return NextResponse.redirect(new URL("/select-app", req.url));
    }
    return NextResponse.next();
  }

  // Not logged in: only the auth pages and public sections are allowed through.
  if (onAuthPath || isPublicPath(pathname)) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on every route except Next internals, the API proxy, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|fonts|.*\\..*).*)"],
};
