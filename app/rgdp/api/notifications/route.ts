import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  errorResponse,
} from "@/lib/api-utils-rgdp";
import { getNotificationsForUser } from "@/services-rgdp/notificationService";

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const rawLimit = Number(searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), 100)
    : 30;

  try {
    const notifications = await getNotificationsForUser(
      session.user.id,
      session.user.adminId,
      limit
    );
    return NextResponse.json(notifications);
  } catch (error: unknown) {
    return errorResponse((error as Error).message, 500);
  }
}
