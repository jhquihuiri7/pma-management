import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import { createReporter, getReportersByAdmin, deleteReporter } from "@/services/userService";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  try {
    const reporters = await getReportersByAdmin(session.user.adminId);
    return NextResponse.json(reporters);
  } catch (error: any) {
    console.error("[GET /api/users]", error);
    return errorResponse(error.message, 500);
  }
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const body = await req.json();
  const { name, email, password, unit, position } = body;

  if (!name || !email || !password) {
    return errorResponse("Name, email, and password are required");
  }

  if (password.length < 6) {
    return errorResponse("Password must be at least 6 characters");
  }

  try {
    const user = await createReporter(session.user.adminId, name, email, password, unit, position);
    return NextResponse.json(user, { status: 201 });
  } catch (error: any) {
    return errorResponse(error.message);
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");

  if (!userId) return errorResponse("userId is required");

  try {
    await deleteReporter(userId, session.user.adminId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error.message);
  }
}
