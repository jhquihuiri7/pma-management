import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Protect admin-only routes
    const adminOnlyPaths = ["/users"];
    const isAdminRoute = adminOnlyPaths.some((path) =>
      pathname.startsWith(path)
    );

    if (isAdminRoute && token?.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/plans/:path*",
    "/users/:path*",
    "/evidences/:path*",
  ],
};
