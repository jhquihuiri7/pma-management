import { getServerSession } from "next-auth";
import { authOptions } from "./auth-rgdp";
import { NextResponse } from "next/server";

export async function getAuthSession() {
  return getServerSession(authOptions);
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
