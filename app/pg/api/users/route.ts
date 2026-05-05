import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  forbiddenResponse,
  errorResponse,
} from "@/lib/api-utils";
import {
  createReporter,
  createViewer,
  getManagedUsersByAdmin,
  deleteReporter,
  resendInvitation,
} from "@/services/userService";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  try {
    const users = await getManagedUsersByAdmin(session.user.adminId, "rgdp");
    return NextResponse.json(users);
  } catch (error: unknown) {
    console.error("[GET /api/users]", error);
    return errorResponse((error as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const body = await req.json();
  const { name, email, unit, position, role } = body;

  if (!name || !email) {
    return errorResponse("Nombre y correo son requeridos");
  }

  const userRole = role === "VIEWER" ? "VIEWER" : "REPORTER";

  try {
    const user =
      userRole === "VIEWER"
        ? await createViewer(session.user.adminId, name, email, unit, position, "rgdp")
        : await createReporter(session.user.adminId, name, email, unit, position, "rgdp");
    return NextResponse.json(user, { status: 201 });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") return forbiddenResponse();

  const body = await req.json();
  const { userId } = body;

  if (!userId) return errorResponse("userId es requerido");

  try {
    await resendInvitation(userId, session.user.adminId, "rgdp");
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
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
    await deleteReporter(userId, session.user.adminId, "rgdp");
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message);
  }
}
