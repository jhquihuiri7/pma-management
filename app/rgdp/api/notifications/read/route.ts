import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSession,
  unauthorizedResponse,
  errorResponse,
} from "@/lib/api-utils-rgdp";
import { markNotificationAsRead } from "@/services-rgdp/notificationService";

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session?.user) return unauthorizedResponse();

  const body = await req.json();
  const notificationId = body?.id as string | undefined;
  if (!notificationId) return errorResponse("Notification id is required");

  try {
    await markNotificationAsRead(
      notificationId,
      session.user.id,
      session.user.adminId
    );
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return errorResponse((error as Error).message, 400);
  }
}
